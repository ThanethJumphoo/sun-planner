import * as ExcelJS from 'exceljs';
import { MpsPlan, MpsPlanOrder } from './mps-plan.entity';
import { ProductSpec } from './product-spec.entity';
import { StgErpOrderHeader } from './stg-erp-order-header.entity';

export async function generateBlExcelPlan(
  plan: MpsPlan,
  orders: MpsPlanOrder[],
  specs: ProductSpec[],
  orderHeaders: StgErpOrderHeader[],
  blColLabelsMap: Record<string, string>,
): Promise<ExcelJS.Workbook> {
  const workbook = new ExcelJS.Workbook();
  const sheet = workbook.addWorksheet('BL MPS Plan');

  // Prepare Data
  const dailyMap = new Map();
  plan.dailySummaries
    .sort(
      (a: any, b: any) =>
        new Date(a.productionDate).getTime() -
        new Date(b.productionDate).getTime(),
    )
    .forEach((d: any) => {
      dailyMap.set(new Date(d.productionDate).toISOString().split('T')[0], {
        summary: d,
        orders: new Map(),
      });
    });

  const dates = Array.from(dailyMap.keys());
  const specMap = new Map();
  specs.forEach((s) => specMap.set(s.erpItemCode, s));

  const itemMap = new Map();
  orders.forEach((o) => itemMap.set(o.itemCode, o.itemDesc));
  const itemCodes = Array.from(itemMap.keys()).sort();

  orders.forEach((o) => {
    const dateKey = new Date(o.plannedProductionDate)
      .toISOString()
      .split('T')[0];
    if (dailyMap.has(dateKey)) {
      const d = dailyMap.get(dateKey);
      d.orders.set(o.itemCode, (d.orders.get(o.itemCode) || 0) + o.quantityKg);
    }
  });

  // ─── FIRST PASS: Collect BL size keys from supply.byProducts (same source as frontend modal) ───
  const allBlSizeKeysSet = new Set<string>();
  const dailyBlSizesMap = new Map<
    string,
    Record<
      string,
      { internalVal: number; externalVal: number; totalVal: number }
    >
  >();

  const supplies = (plan as any).supplyBreakdown || [];
  supplies.forEach((supply: any) => {
    const supDate = new Date(supply.productionDate).toISOString().split('T')[0];

    let bp: any = {};
    try {
      bp = JSON.parse(supply.byProducts || '{}');
    } catch (e) {}
    const blData = bp['BL-DEBONE'] || bp['BL'] || bp['BL (Debone)'] || {};
    const totalBlQty = Number(blData.qty || blData.kg || 0);
    const blSizesDb = blData.sizes || {};
    const intTotal = Number(blData.internalQty || 0);
    const extTotal = Number(blData.externalQty || 0);
    const intRatio = totalBlQty > 0 ? intTotal / totalBlQty : 1;
    const extRatio = totalBlQty > 0 ? extTotal / totalBlQty : 0;

    const blSizesFrontend: Record<
      string,
      { internalVal: number; externalVal: number; totalVal: number }
    > = {};

    if (Object.keys(blSizesDb).length > 0) {
      // Path A: sizes exist in byProducts → use directly (same as frontend line 2712-2715)
      for (const [sz, qty] of Object.entries(blSizesDb)) {
        const q = Number(qty);
        if (q > 0) {
          blSizesFrontend[sz] = {
            internalVal: q * intRatio,
            externalVal: q * extRatio,
            totalVal: q,
          };
          allBlSizeKeysSet.add(sz);
        }
      }
    } else if (
      supply.sizes &&
      Array.isArray(supply.sizes) &&
      supply.sizes.length > 0
    ) {
      // Path B: no sizes in byProducts → compute from supply.sizes relation (same as frontend line 2665-2711)
      // Build demand map from orders
      const d = dailyMap.get(supDate);
      const demandKgByBilSize: Record<string, number> = {};
      if (d) {
        d.orders.forEach((qty: number, itemCode: string) => {
          const spec = specs.find((s) => s.erpItemCode === itemCode);
          const oSize = spec?.productSize?.trim() || '';
          if (oSize && oSize.toLowerCase() !== 'unsize' && oSize !== '') {
            const sizeMatch = oSize.match(/(\d+-\d+|\d+\s*Up|\d+\s*Down)/i);
            let mappedSize = sizeMatch ? sizeMatch[0] : oSize;
            if (mappedSize.toLowerCase().includes('down'))
              mappedSize = mappedSize.replace(/\s+/g, '') + 'Down';
            if (mappedSize.toLowerCase().includes('up'))
              mappedSize = mappedSize.replace(/\s+/g, '') + 'Up';
            mappedSize = mappedSize
              .replace('DownDown', 'Down')
              .replace('UpUp', 'Up');
            const oYield =
              spec?.productYield && Number(spec.productYield) > 0
                ? Number(spec.productYield)
                : 1;
            demandKgByBilSize[mappedSize] =
              (demandKgByBilSize[mappedSize] || 0) + qty / oYield;
          }
        });
      }

      const bilSizesMap: Record<string, number> = {};
      supply.sizes.forEach((s: any) => {
        if (s.groupSize) {
          bilSizesMap[s.groupSize] =
            (bilSizesMap[s.groupSize] || 0) + Number(s.quantityKg || 0);
        }
      });

      const initialRems: { bilSz: string; rem: number; totalQty: number }[] =
        [];
      let sumInitialRem = 0;
      let sumTotalQty = 0;

      Object.keys(bilSizesMap).forEach((bilSz) => {
        const internalQty = bilSizesMap[bilSz];
        const totalQty = internalQty;
        let demand = 0;
        for (const [dSize, dQty] of Object.entries(demandKgByBilSize)) {
          if (
            bilSz.toLowerCase().replace(/\s+/g, '') ===
            dSize.toLowerCase().replace(/\s+/g, '')
          )
            demand += dQty;
        }
        const rem = Math.max(0, totalQty - demand);
        initialRems.push({ bilSz, rem, totalQty });
        sumInitialRem += rem;
        sumTotalQty += totalQty;
      });

      const trk = supply._tracker || {};
      const rm = trk.rmBreakdown || {};
      const blRmTotal = Number(rm.bl || 0);

      initialRems.forEach(({ bilSz, rem, totalQty }) => {
        let finalRem = 0;
        if (sumInitialRem > 0) {
          finalRem = rem * (blRmTotal / sumInitialRem);
        } else if (sumTotalQty > 0) {
          finalRem = totalQty * (blRmTotal / sumTotalQty);
        }

        if (finalRem > 0) {
          const blSz = blColLabelsMap[bilSz] || `BL ${bilSz}`;
          const blQty = finalRem * 0.75;
          blSizesFrontend[blSz] = {
            internalVal: (blSizesFrontend[blSz]?.internalVal || 0) + blQty,
            externalVal: 0,
            totalVal: (blSizesFrontend[blSz]?.totalVal || 0) + blQty,
          };
          allBlSizeKeysSet.add(blSz);
        }
      });
    }

    dailyBlSizesMap.set(supDate, blSizesFrontend);
  });

  // Sort size keys: numeric-based sorting, "Down" first, then ranges, then "Up"
  const blSizeKeys = Array.from(allBlSizeKeysSet).sort((a, b) => {
    const numA = parseInt(a.match(/\d+/)?.[0] || '0', 10);
    const numB = parseInt(b.match(/\d+/)?.[0] || '0', 10);
    if (numA !== numB) return numA - numB;
    return a.localeCompare(b);
  });

  // ─── LAYOUT SETUP (Dates as Rows, Metrics as Columns) ───
  // Row 1: Section Headers
  const sectionRow = sheet.addRow([]);
  let colIdx = 3; // Start after Date, Day

  const supplyStart = colIdx;
  const supplyEnd = colIdx + 11; // Total(4), Int(4), Ext(4) = 12 columns
  sectionRow.getCell(supplyStart).value = 'Supply Control (RM BL)';
  sheet.mergeCells(1, supplyStart, 1, supplyEnd);
  colIdx = supplyEnd + 1;

  const icutStart = colIdx;
  const icutEnd = colIdx + 4; // Process, Hours, Cap, Util, Manual
  sectionRow.getCell(icutStart).value = 'I-Cut & Manual Trimming';
  sheet.mergeCells(1, icutStart, 1, icutEnd);
  colIdx = icutEnd + 1;

  const blockStart = colIdx;
  const blockEnd = colIdx + 1; // Produced, Used
  sectionRow.getCell(blockStart).value = 'BL BLOCK Tracking';
  sheet.mergeCells(1, blockStart, 1, blockEnd);
  colIdx = blockEnd + 1;

  const sizeStart = colIdx;
  const sizeEnd = colIdx + blSizeKeys.length * 2 - 1;
  if (blSizeKeys.length > 0) {
    sectionRow.getCell(sizeStart).value = 'BL Size';
    if (sizeEnd > sizeStart) sheet.mergeCells(1, sizeStart, 1, sizeEnd);
  }
  colIdx = blSizeKeys.length > 0 ? sizeEnd + 1 : colIdx;

  const prodStart = colIdx;
  const prodEnd = colIdx + itemCodes.length - 1;
  if (itemCodes.length > 0) {
    sectionRow.getCell(prodStart).value = 'Production Plan';
    if (prodEnd > prodStart) sheet.mergeCells(1, prodStart, 1, prodEnd);
  }

  // Style Section Headers
  const secDefs = [
    { start: supplyStart, end: supplyEnd, color: 'FF4472C4' },
    { start: icutStart, end: icutEnd, color: 'FFE67CA0' },
    { start: blockStart, end: blockEnd, color: 'FFED7D31' },
    { start: sizeStart, end: sizeEnd, color: 'FF2E7D32' },
    { start: prodStart, end: prodEnd, color: 'FF7030A0' },
  ];
  secDefs.forEach((sec) => {
    if (sec.start <= sec.end) {
      for (let i = sec.start; i <= sec.end; i++) {
        const cell = sectionRow.getCell(i);
        cell.fill = {
          type: 'pattern',
          pattern: 'solid',
          fgColor: { argb: sec.color },
        };
        cell.font = { color: { argb: 'FFFFFFFF' }, bold: true, size: 10 };
        cell.alignment = { horizontal: 'center' };
        cell.border = {
          top: { style: 'thin' },
          left: { style: 'thin' },
          bottom: { style: 'thin' },
          right: { style: 'thin' },
        };
      }
    }
  });

  // Row 2: Sub-Headers (Item Descriptions for Production Plan)
  const machineNameRow = sheet.addRow([]);
  itemCodes.forEach((code, idx) => {
    machineNameRow.getCell(prodStart + idx).value = itemMap.get(code) || '';
  });
  for (let i = prodStart; i <= prodEnd; i++) {
    const cell = machineNameRow.getCell(i);
    cell.font = { bold: true, size: 8 };
    cell.fill = {
      type: 'pattern',
      pattern: 'solid',
      fgColor: { argb: 'FFF2F2F2' },
    };
    cell.alignment = { horizontal: 'center', wrapText: true };
    cell.border = {
      top: { style: 'thin' },
      left: { style: 'thin' },
      bottom: { style: 'thin' },
      right: { style: 'thin' },
    };
  }
  machineNameRow.height = 30;

  // Row 3: Column Headers
  const subHeaders = [
    'Date',
    'Day',
    'Total RM BL',
    'BL (เนื้อรวม)',
    'BL-TH (สะโพก)',
    'BL-DR (น่อง)',
    'Int. RM Total',
    'Int. BL (เนื้อรวม)',
    'Int. BL-TH (สะโพก)',
    'Int. BL-DR (น่อง)',
    'Ext. RM Total',
    'Ext. BL (เนื้อรวม)',
    'Ext. BL-TH (สะโพก)',
    'Ext. BL-DR (น่อง)',
    'I-Cut Process (kg)',
    'I-Cut Hours',
    'I-Cut Cap (hrs)',
    'I-Cut Util (%)',
    'Manual Trim (kg)',
    'Block Produced',
    'Block Used',
    ...blSizeKeys.flatMap((sz) => [`Int. ${sz}`, `Ext. ${sz}`]),
    ...itemCodes,
  ];
  const headerRow = sheet.addRow(subHeaders);
  headerRow.eachCell((cell) => {
    cell.font = { bold: true, size: 8 };
    cell.fill = {
      type: 'pattern',
      pattern: 'solid',
      fgColor: { argb: 'FFD9D9D9' },
    };
    cell.alignment = {
      horizontal: 'center',
      vertical: 'middle',
      wrapText: true,
    };
    cell.border = {
      top: { style: 'thin' },
      left: { style: 'thin' },
      bottom: { style: 'thin' },
      right: { style: 'thin' },
    };
  });
  headerRow.height = 35;

  // Data Rows
  dates.forEach((dateStr) => {
    const d = dailyMap.get(dateStr);
    const dateObj = new Date(dateStr);
    const trk = (() => {
      try {
        return JSON.parse(d.summary.blTrackerJson || '{}');
      } catch (e) {
        return {};
      }
    })();
    const rm = trk.rmBreakdown || {};
    const intRm = trk.internalRemaining || {};
    const extRm = trk.externalRemaining || {};

    const blKg = Number(rm.bl || 0);
    const blThKg = Number(rm.blTh || 0);
    const blDrKg = Number(rm.blDr || 0);

    const totalBlSum = blKg + blThKg + blDrKg;

    const intBl = Number(intRm.BL || 0);
    const intBlTh = Number(intRm.BLTH || 0);
    const intBlDr = Number(intRm.BLDR || 0);
    const totalIntBl = intBl + intBlTh + intBlDr;

    const extBl = Number(extRm.BL || 0);
    const extBlTh = Number(extRm.BLTH || 0);
    const extBlDr = Number(extRm.BLDR || 0);
    const totalExtBl = extBl + extBlTh + extBlDr;

    const icutCap = Number(trk.icutCapacityHours || 37);
    const icutHours = Number(trk.icutUsedHours || 0);
    const icutUtil = icutCap > 0 ? (icutHours / icutCap) * 100 : 0;

    const rmBlUsed = Number(trk.rmBlUsed || 0);
    const intRatio = totalBlSum > 0 ? totalIntBl / totalBlSum : 1;
    const extRatio = totalBlSum > 0 ? totalExtBl / totalBlSum : 0;
    const totalIntRm = Math.round(rmBlUsed * intRatio);
    const totalExtRm = Math.round(rmBlUsed * extRatio);

    const rowData: any[] = [
      `${dateObj.getDate()}/${dateObj.toLocaleString('en-US', { month: 'short' })}`,
      dateObj.toLocaleDateString('en-US', { weekday: 'short' }),
      rmBlUsed,
      blKg,
      blThKg,
      blDrKg,
      totalIntRm,
      intBl,
      intBlTh,
      intBlDr,
      totalExtRm,
      extBl,
      extBlTh,
      extBlDr,
      Number(trk.icutUsedKg || 0),
      icutHours,
      icutCap,
      `${icutUtil.toFixed(1)}%`,
      Number(trk.manualUsedKg || 0),
      Number(trk.blBlockProduced || 0),
      Number(trk.blBlockUsed || 0),
    ];

    // BL Size columns — use pre-computed data from first pass (same source as frontend modal)
    const dailySizes = dailyBlSizesMap.get(dateStr) || {};
    blSizeKeys.forEach((sz) => {
      const sizeData = dailySizes[sz];
      rowData.push(Math.round(sizeData?.internalVal || 0));
      rowData.push(Math.round(sizeData?.externalVal || 0));
    });

    itemCodes.forEach((code) => {
      rowData.push(d.orders.get(code) || 0);
    });

    const dataRow = sheet.addRow(rowData);
    dataRow.eachCell((cell, colNumber) => {
      if (colNumber > 2 && typeof cell.value === 'number') {
        cell.numFmt = '#,##0';
      }
      cell.border = {
        top: { style: 'thin' },
        left: { style: 'thin' },
        bottom: { style: 'thin' },
        right: { style: 'thin' },
      };
    });
  });

  // Totals Row
  const totalRowData: any[] = ['Total', ''];
  for (let i = 2; i < subHeaders.length; i++) {
    if (i === 15) {
      // I-Cut Util (%)
      totalRowData.push('');
      continue;
    }
    let colSum = 0;
    for (let r = 4; r < 4 + dates.length; r++) {
      const val = sheet.getCell(r, i + 1).value;
      if (typeof val === 'number') colSum += val;
    }
    totalRowData.push(colSum);
  }
  const totalsRow = sheet.addRow(totalRowData);
  totalsRow.eachCell((cell, colNumber) => {
    cell.font = { bold: true };
    cell.fill = {
      type: 'pattern',
      pattern: 'solid',
      fgColor: { argb: 'FFFFE699' },
    };
    if (colNumber > 2 && typeof cell.value === 'number') {
      cell.numFmt = '#,##0';
    }
    cell.border = {
      top: { style: 'thin' },
      left: { style: 'thin' },
      bottom: { style: 'thin' },
      right: { style: 'thin' },
    };
  });

  // Formatting
  sheet.views = [{ state: 'frozen', xSplit: 2, ySplit: 3 }];
  sheet.getColumn(1).width = 10;
  sheet.getColumn(2).width = 6;
  for (let c = 3; c <= subHeaders.length; c++) sheet.getColumn(c).width = 12;

  return workbook;
}
