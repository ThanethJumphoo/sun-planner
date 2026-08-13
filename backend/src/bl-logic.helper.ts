import { EntityManager, Repository } from 'typeorm';
import { MpsPlan, MpsPlanDaily, MpsPlanOrder } from './mps-plan.entity';
import { MpsPlanSupply } from './mps-plan-supply.entity';
import { MpsPlanSupplySize } from './mps-plan-supply-size.entity';
import { MpsExceptionReport } from './mps-exception.entity';
import { BlBeltGateMatrix } from './bl-belt-gate-matrix.entity';
import { ProductSpec } from './product-spec.entity';
import { StgErpOrderLine } from './stg-erp-order-line.entity';
import { StgErpOrderHeader } from './stg-erp-order-header.entity';

interface BlDependencies {
  machineConfigs: any[];
  getItemCodesByPartType: (pt: string) => Promise<string[] | null>;
  parseLocalDate: (val: any) => string;
  formatDate: (val: any) => string;
  specRepo: Repository<ProductSpec>;
  masterYieldRepo: any;
  blBeltGateMatrixRepo: Repository<BlBeltGateMatrix>;
  bilWeightDistRepo: any;
}

export async function executeBlPlanGeneration(
  body: any,
  manager: EntityManager,
  deps: BlDependencies,
) {
  const { targetMonth, orderStartDate, orderEndDate } = body;
  const { parseLocalDate, formatDate } = deps;

  // ──────────────────────────────────────
  // 1. Fetch Belt Gate Matrix
  // ──────────────────────────────────────
  let blBeltGateMatrix = await deps.blBeltGateMatrixRepo.find({ order: { priority: 'ASC' } });
  if (!blBeltGateMatrix || blBeltGateMatrix.length === 0) {
    blBeltGateMatrix = [
      { priority: 1, targetProduct: '53-58', rmSize: '161-180', yieldPct: 81.33 },
      { priority: 2, targetProduct: '30-35', rmSize: '181-200', yieldPct: 82.52 },
      { priority: 3, targetProduct: '35-40', rmSize: '201-220', yieldPct: 83.47 },
      { priority: 4, targetProduct: '40-45', rmSize: '221-240', yieldPct: 83.18 },
      { priority: 5, targetProduct: '45-50', rmSize: '241-260', yieldPct: 83.03 },
      { priority: 6, targetProduct: '50-55', rmSize: '261-280', yieldPct: 81.99 },
      { priority: 7, targetProduct: '60-65', rmSize: '281-300', yieldPct: 80.00 }
    ] as any;
  }

  // ──────────────────────────────────────
  // 2. Fetch BIL Plan for RM Supply
  // ──────────────────────────────────────
  const bilPlan = await manager.findOne(MpsPlan, {
    where: { targetMonth, partType: 'bil' },
    relations: ['dailySummaries', 'supplyBreakdown', 'supplyBreakdown.sizes'],
    order: { createdAt: 'DESC' },
  });

  if (!bilPlan) {
    return {
      success: false,
      message: `ไม่สามารถสร้างแผน BL ได้ เนื่องจากไม่พบแผน BIL ของเดือน ${targetMonth} กรุณาสร้างแผน BIL ก่อน`,
    };
  }

  // ──────────────────────────────────────
  // 3. Create or Reset BL Plan
  // ──────────────────────────────────────
  const existingApproved = await manager.findOne(MpsPlan, { where: { targetMonth, partType: 'bl', status: 'APPROVED' } });
  if (existingApproved) {
    return { success: false, message: `มีแผน BL ที่ APPROVED แล้วสำหรับเดือน ${targetMonth} ต้อง Reject ก่อนถึงจะสร้างใหม่ได้` };
  }

  let plan = await manager.findOne(MpsPlan, { where: { targetMonth, partType: 'bl', status: 'DRAFT' } });
  if (plan) {
    await manager.delete(MpsPlanDaily, { mpsPlan: { id: plan.id } });
    await manager.delete(MpsPlanSupply, { mpsPlan: { id: plan.id } });
    await manager.delete(MpsPlanOrder, { mpsPlan: { id: plan.id } });
    await manager.delete(MpsExceptionReport, { mpsPlan: { id: plan.id } });
  } else {
    plan = manager.create(MpsPlan, {
      planName: `MPS ${targetMonth} - BL Draft`,
      targetMonth,
      partType: 'bl',
      status: 'DRAFT',
      createdBy: 'SYSTEM',
    });
    await manager.save(plan);
  }

  // ──────────────────────────────────────
  // 4. Build RM Supply from BIL byProducts
  // ──────────────────────────────────────
  const supplyMap = new Map<string, {
    totalBL: number;
    totalBLTH: number;
    totalBLDR: number;
    blSizes: Record<string, number>;
    initialSizes: Record<string, number>;
    blkSizes: Record<string, number>;
    mappedBlkSizes: Record<string, number>;
    internalBlkSizes: Record<string, number>;
    externalBlkSizes: Record<string, number>;
    available: { BL: number, BLTH: number, BLDR: number };
    internalAvailable: { BL: number, BLTH: number, BLDR: number };
    externalAvailable: { BL: number, BLTH: number, BLDR: number };
    initialInternal: { BL: number, BLTH: number, BLDR: number };
    initialExternal: { BL: number, BLTH: number, BLDR: number };
    internalSizes: Record<string, number>;
    externalSizes: Record<string, number>;
  }>();

  const supplyRecords: MpsPlanSupply[] = [];

  const blColLabelsMap: Record<string, string> = {};
  if (deps.bilWeightDistRepo) {
    const matrices = await deps.bilWeightDistRepo.find();
    matrices.forEach((m: any) => {
      if (m.blColLabel) {
        blColLabelsMap[m.colLabel] = m.blColLabel;
      }
    });
  }
  (deps as any)._blColLabelsMap = blColLabelsMap;

  if (bilPlan.supplyBreakdown) {
    for (const supply of bilPlan.supplyBreakdown) {
      const dateStr = parseLocalDate(supply.productionDate);
      if (!dateStr) continue;

      let byProducts: Record<string, any> = {};
      try {
        byProducts = JSON.parse(supply.byProducts || '{}');
      } catch (e) { /* ignore */ }

      // Extract BL data from BIL byProducts
      // BIL stores BL as key "BL-DEBONE" with { name, qty, processName }
      const blData = byProducts['BL-DEBONE'] || byProducts['BL'] || byProducts['BL (Debone)'] || {};
      const bpVals = Object.values(byProducts) as any[];
      const blThData = bpVals.find(v => v.name && v.name.includes('สะโพก')) || byProducts['BL-TH'] || {};
      const blDrData = bpVals.find(v => v.name && v.name.includes('น่อง')) || byProducts['BL-DR'] || {};
      
            const blKgRaw = Number(blData.qty || blData.kg || blData.quantity || 0);
      const blKg = blKgRaw * 0.75;
      const blkKg = blKgRaw * 0.25;

      const blThKg = Number(blThData.qty || blThData.kg || blThData.quantity || 0) * 0.75;
      const blDrKg = Number(blDrData.qty || blDrData.kg || blDrData.quantity || 0) * 0.75;
      
      const intBlKgRaw = Number(blData.internalQty ?? blKgRaw);
      const extBlKgRaw = Number(blData.externalQty ?? 0);
      
      const intBlKg = intBlKgRaw * 0.75;
      const extBlKg = extBlKgRaw * 0.75;
      const intBlkKg = intBlKgRaw * 0.25;
      const extBlkKg = extBlKgRaw * 0.25;

      const intBlThKg = Number(blThData.internalQty ?? (blThData.qty || blThData.kg || 0)) * 0.75;
      const extBlThKg = Number(blThData.externalQty ?? 0) * 0.75;
      const intBlDrKg = Number(blDrData.internalQty ?? (blDrData.qty || blDrData.kg || 0)) * 0.75;
      const extBlDrKg = Number(blDrData.externalQty ?? 0) * 0.75;
      
      const blRatioInt = blKg > 0 ? intBlKg / blKg : 1;
      const blRatioExt = blKg > 0 ? extBlKg / blKg : 0;
      const thRatioInt = blThKg > 0 ? intBlThKg / blThKg : 1;
      const thRatioExt = blThKg > 0 ? extBlThKg / blThKg : 0;
      const drRatioInt = blDrKg > 0 ? intBlDrKg / blDrKg : 1;
      const drRatioExt = blDrKg > 0 ? extBlDrKg / blDrKg : 0;

      const rawBlSizes = { ...(blData.sizes || {}) };
      const blSizes: Record<string, number> = {};
      const blkSizes: Record<string, number> = {};

      // Fallback for missing BL-DEBONE sizes before split
      const currentBlSizeSumRaw = Object.values(rawBlSizes).reduce((sum: number, v: any) => sum + Number(v), 0) as number;
      if (blKgRaw > 0 && currentBlSizeSumRaw < blKgRaw * 0.95) {
        const missingKgRaw = blKgRaw - currentBlSizeSumRaw;
        let totalBilSizes = 0;
        const bilSizesMap: Record<string, number> = {};
        if (supply.sizes) {
          supply.sizes.forEach((sz: any) => {
            bilSizesMap[sz.groupSize] = (bilSizesMap[sz.groupSize] || 0) + Number(sz.quantityKg || 0);
            totalBilSizes += Number(sz.quantityKg || 0);
          });
        }
        if (totalBilSizes > 0) {
          Object.keys(bilSizesMap).forEach(bilSz => {
            let blSz = (deps as any)._blColLabelsMap ? (deps as any)._blColLabelsMap[bilSz] || `BL ${bilSz}` : `BL ${bilSz}`;
            if (blSz.startsWith('BL ')) blSz = blSz.replace('BL ', '');
            const ratio = bilSizesMap[bilSz] / totalBilSizes;
            rawBlSizes[blSz] = (rawBlSizes[blSz] || 0) + (missingKgRaw * ratio);
          });
        } else {
          rawBlSizes['Unsize'] = (rawBlSizes['Unsize'] || 0) + missingKgRaw;
        }
      }

      Object.entries(rawBlSizes).forEach(([sz, qty]) => {
        let rawSz = sz;
        if (rawSz.startsWith('BL ')) rawSz = rawSz.replace('BL ', '');
        const prefixedSize = rawSz.startsWith('BL') ? rawSz : `BL ${rawSz}`;
        
        const qtyNum = Number(qty);
        blSizes[prefixedSize] = qtyNum * 0.75;
        blkSizes[rawSz] = qtyNum * 0.25;
      });

      const blThSizes: Record<string, number> = {};
      Object.entries(blThData.sizes || {}).forEach(([size, qty]: any) => {
        const prefixedSize = size.startsWith('BL') ? size : `BL-TH ${size}`;
        blThSizes[prefixedSize] = Number(qty) * 0.75;
      });

      const blDrSizes: Record<string, number> = {};
      Object.entries(blDrData.sizes || {}).forEach(([size, qty]: any) => {
        const prefixedSize = size.startsWith('BL') ? size : `BL-DR ${size}`;
        blDrSizes[prefixedSize] = Number(qty) * 0.75;
      });
      
      Object.entries(blThSizes).forEach(([size, qty]) => {
        blSizes[size] = (blSizes[size] || 0) + qty;
      });
      Object.entries(blDrSizes).forEach(([size, qty]) => {
        blSizes[size] = (blSizes[size] || 0) + qty;
      });

      const internalSizes: Record<string, number> = {};
      const externalSizes: Record<string, number> = {};
      Object.keys(blSizes).forEach(k => {
          if (k.includes('TH')) {
              internalSizes[k] = blSizes[k] * thRatioInt;
              externalSizes[k] = blSizes[k] * thRatioExt;
          } else if (k.includes('DR')) {
              internalSizes[k] = blSizes[k] * drRatioInt;
              externalSizes[k] = blSizes[k] * drRatioExt;
          } else {
              internalSizes[k] = blSizes[k] * blRatioInt;
              externalSizes[k] = blSizes[k] * blRatioExt;
          }
      });

      const internalBlkSizes: Record<string, number> = {};
      const externalBlkSizes: Record<string, number> = {};
      Object.keys(blkSizes).forEach(k => {
          internalBlkSizes[k] = blkSizes[k] * blRatioInt;
          externalBlkSizes[k] = blkSizes[k] * blRatioExt;
      });

      supplyMap.set(dateStr, {
        totalBL: blKg,
        totalBLTH: blThKg,
        totalBLDR: blDrKg,
        blSizes: { ...blSizes },
        initialSizes: { ...blSizes },
        blkSizes: { ...blkSizes },
        mappedBlkSizes: {},
        internalBlkSizes,
        externalBlkSizes,
        available: { BL: blKg, BLTH: blThKg, BLDR: blDrKg },
        internalAvailable: { BL: intBlKg, BLTH: intBlThKg, BLDR: intBlDrKg },
        externalAvailable: { BL: extBlKg, BLTH: extBlThKg, BLDR: extBlDrKg },
        initialInternal: { BL: intBlKg, BLTH: intBlThKg, BLDR: intBlDrKg },
        initialExternal: { BL: extBlKg, BLTH: extBlThKg, BLDR: extBlDrKg },
        internalSizes,
        externalSizes
      });

      supplyRecords.push(manager.create(MpsPlanSupply, {
        mpsPlan: plan,
        productionDate: supply.productionDate,
        intakeBirds: 0,
        totalWeight: blKg + blThKg + blDrKg,
        avgWeight: 0,
        slaughteredWeight: blKg + blThKg + blDrKg,
        byProducts: JSON.stringify({
          'BL': { kg: blKg, sizes: blSizes },
          'BL-TH': { kg: blThKg, sizes: blThSizes },
          'BL-DR': { kg: blDrKg, sizes: blDrSizes },
        }),
      }));
    }
  }

  if (supplyRecords.length > 0) {
    const savedSupplies = await manager.save(supplyRecords);
    
    // Save accurate BL sizes for UI and Excel export instead of copying raw RM bird sizes
    const supplySizeRecords: MpsPlanSupplySize[] = [];
    for (const [dateStr, supData] of supplyMap.entries()) {
      const savedSup = savedSupplies.find(s => parseLocalDate(s.productionDate) === dateStr);
      if (!savedSup) continue;
      
      for (const [sz, qty] of Object.entries(supData.blSizes)) {
        if (Number(qty) <= 0) continue;
        supplySizeRecords.push(manager.create(MpsPlanSupplySize, {
          mpsPlanSupply: savedSup,
          groupSize: sz,
          quantityKg: Number(qty),
          partName: 'BL',
          productionDate: savedSup.productionDate,
        }));
      }
    }

    if (supplySizeRecords.length > 0) {
      await manager.save(supplySizeRecords);
    }
  }

  // ──────────────────────────────────────
  // 5. Fetch BL Orders
  // ──────────────────────────────────────
  const allSpecs = await deps.specRepo.find();
  const specMap = new Map(allSpecs.map(s => [s.erpItemCode, s]));

  const allowedItemCodes = await deps.getItemCodesByPartType('bl');
  const startStr = orderStartDate || targetMonth + '-01';
  const start = new Date(`${startStr}T00:00:00`);
  const endStr = orderEndDate || (() => {
    const maxSpecLead = allSpecs.length > 0 ? Math.max(...allSpecs.map(s => (s as any).maxProductLead || 0)) : 90;
    const additionalMonths = Math.max(2, Math.ceil(maxSpecLead / 30) + 1);
    const d = new Date(start);
    d.setMonth(d.getMonth() + additionalMonths);
    d.setDate(0);
    return formatDate(d);
  })();
  const end = new Date(`${endStr}T23:59:59`);

  let rawLines: StgErpOrderLine[] = [];
  if (allowedItemCodes && allowedItemCodes.length > 0) {
    rawLines = await manager.createQueryBuilder(StgErpOrderLine, 'line')
      .where('line.erpOrderItemCode IN (:...itemCodes)', { itemCodes: allowedItemCodes })
      .andWhere('line.erpOrderShipDate >= :start AND line.erpOrderShipDate <= :end', { start, end })
      .andWhere("line.erpOrderStatus != 'CANCELLED'")
      .getMany();
  }

  const plannedQtyMap = new Map<number, number>();
  if (rawLines.length > 0) {
    const lineIds = rawLines.map(l => l.erpOrderLineId);
    const existingOrders = await manager.createQueryBuilder(MpsPlanOrder, 'ord')
      .innerJoin('ord.mpsPlan', 'plan')
      .where('ord.erpOrderLineId IN (:...lineIds)', { lineIds })
      .andWhere('plan.id != :currentPlanId', { currentPlanId: plan.id })
      .getMany();
      
    for (const eo of existingOrders) {
       plannedQtyMap.set(eo.erpOrderLineId, (plannedQtyMap.get(eo.erpOrderLineId) || 0) + Number(eo.quantityKg));
    }
  }

  const headerIds = [...new Set(rawLines.map(l => l.erpOrderHeaderId))];
  const headers: StgErpOrderHeader[] = headerIds.length > 0
    ? await manager.createQueryBuilder(StgErpOrderHeader, 'header')
        .where('header.erpOrderHeaderId IN (:...headerIds)', { headerIds })
        .getMany()
    : [];
  const headerMap = new Map(headers.map(h => [h.erpOrderHeaderId, h.erpOrderNumber]));

  // ──────────────────────────────────────
  // 6. Classify orders
  // ──────────────────────────────────────
  // Flow การผลิต BL ที่ถูกต้อง:
  // Phase 1: I-Cut → RM BL → BLK ≤60g + BL-TH (20g range) + BL BLOCK (Co-Product)
  // Phase 2: BL BLOCK ขายตรง (ถ้ามีออเดอร์)
  // Phase 3: BL BLOCK ที่เหลือ → BLK (Belt Gate Sizing)
  // Phase 4: BLK > 60g (คนตัด Manual) → RM BL
  // Phase 5: BL-DR → RM BL-DR
  // Phase 6: Manual Trimming อื่นๆ → RM BL ที่เหลือ

  const extractBeltGateSizes = (desc: string, specSize?: string): { rmSizes: string[], targetProduct: string, yieldPct: number, isFallback?: boolean } | null => {
    for (const rule of blBeltGateMatrix) {
      if (desc.includes(rule.targetProduct)) {
        return { rmSizes: [rule.rmSize], targetProduct: rule.targetProduct, yieldPct: Number(rule.yieldPct || 100) };
      }
    }
    
    let sToUse = specSize;
    if (!sToUse || sToUse.toLowerCase() === 'unsize' || sToUse.trim() === '') {
      // Try to extract size like "280-300" or "200 g" from description
      const descMatch = desc.match(/(\d+)\s*[-–]\s*(\d+)/);
      if (descMatch) {
        sToUse = descMatch[0];
      } else {
        const descSingle = desc.match(/\b(\d{2,4})\s*(g|กรัม|g\.|gram)\b/i);
        if (descSingle) {
          sToUse = descSingle[1];
        } else {
          const descDown = desc.match(/(\d{2,4})\s*(down|dwn)/i);
          if (descDown) sToUse = `${descDown[1]} down`;
          const descUp = desc.match(/(\d{2,4})\s*(up)/i);
          if (descUp) sToUse = `${descUp[1]} up`;
        }
      }
    }

    // Fallback to parsed size
    if (sToUse && sToUse.toLowerCase() !== 'unsize' && sToUse.trim() !== '') {
      let sizeKey = sToUse.replace(/\s*[A-Za-z]+.*/, ''); 
      return { rmSizes: [sizeKey], targetProduct: sizeKey, yieldPct: 100, isFallback: true };
    }
    return null;
  };

  const classifyOrder = (order: StgErpOrderLine) => {
    const spec = specMap.get(order.erpOrderItemCode);
    const desc = ((spec as any)?.erpItemDesc || order.erpOrderItemCode || '').toUpperCase();
    
    let result = 'OTHER';
    if (desc.includes('BL BLOCK') || desc.includes('BL_BLOCK') || desc.includes('BLBLOCK')) result = 'BL_BLOCK';
    else if (desc.includes('BL TH') || desc.includes('BL-TH') || desc.includes('BLTH')) result = 'BLTH';
    else if (desc.includes('BL DR') || desc.includes('BL-DR') || desc.includes('BLDR')) result = 'BLDR';
    else if (desc.includes('BLK')) result = 'BLK';
    else if (extractBeltGateSizes(desc, (spec as any)?.productSize)) result = 'BLK';
    

    return result;
  };

  const getGradeWeight = (order: StgErpOrderLine) => {
    const header = headers.find(h => h.erpOrderHeaderId === order.erpOrderHeaderId);
    const grade = (header?.erpCustomerGrade || '').toUpperCase();
    if (grade === 'A' || grade.includes('GRADE A')) return 1;
    if (grade === 'B' || grade.includes('GRADE B')) return 2;
    return 3;
  };

  const prioritySort = (a: StgErpOrderLine, b: StgErpOrderLine) => {
    const dateA = new Date(a.erpOrderShipDate).getTime();
    const dateB = new Date(b.erpOrderShipDate).getTime();
    if (dateA !== dateB) return dateA - dateB;
    const gA = getGradeWeight(a);
    const gB = getGradeWeight(b);
    if (gA !== gB) return gA - gB;
    return (a.priority ?? 9999) - (b.priority ?? 9999);
  };



  // Phase 1: Belt Gate SIZING
  // Phase 2: SPECIAL (BL TH / BL DR without I-Cut)
  // Phase 3: I-CUT (RM remaining -> BLK <=60g, BL TH 20g range, creates BL BLOCK)
  // Phase 4: BL BLOCK Direct Sale (if any) & Manual Trimming from BL BLOCK
  // Phase 5: Manual BLK (>60g) & Other Trimming (RM remaining)

  const phase1SizingOrders: StgErpOrderLine[] = [];
  const phase2SpecialOrders: StgErpOrderLine[] = [];
  const phase3IcutOrders: StgErpOrderLine[] = [];
  const phase4BlBlockOrders: StgErpOrderLine[] = [];
  const phase4BlBlockSaleOrders: StgErpOrderLine[] = [];
  const phase5ManualOrders: StgErpOrderLine[] = [];

  for (const order of rawLines) {
    const spec = specMap.get(order.erpOrderItemCode);
    const icutSpeed = Number((spec as any)?.icutSpeed || 0);
    const classification = classifyOrder(order);
    const itemDesc = ((spec as any)?.erpItemDesc || order.erpOrderItemCode || '').toUpperCase();
    const specSize = (spec as any)?.productSize;
    const mapping = extractBeltGateSizes(itemDesc, specSize);

    if (classification === 'BL_BLOCK') {
      phase4BlBlockSaleOrders.push(order);
    } else if (mapping && icutSpeed === 0) {
      // Phase 1: Belt Gate SIZING (must not be an I-Cut order)
      phase1SizingOrders.push(order);
    } else if ((classification === 'BLDR' || classification === 'BLTH') && icutSpeed === 0) {
      // Phase 2: SPECIAL (BL-TH, BL-DR that don't need I-Cut)
      phase2SpecialOrders.push(order);
    } else if (icutSpeed > 0) {
      // Phase 3: I-CUT
      phase3IcutOrders.push(order);
    } else if (classification === 'BLK' && icutSpeed === 0 && !mapping) {
      // If it's BLK manual and no belt gate mapping, can we do it from BL BLOCK?
      // Yes, if it's a manual trimming BLK, it goes to Phase 4 (where we try to use BL BLOCK)
      // and if not enough, it will fall back to Phase 5 (use RM). We put it in Phase 4 list.
      phase4BlBlockOrders.push(order);
    } else {
      // Phase 5: Other manual trimming
      phase5ManualOrders.push(order);
    }
  }

  phase1SizingOrders.sort(prioritySort);
  phase2SpecialOrders.sort(prioritySort);
  phase3IcutOrders.sort(prioritySort);
  phase4BlBlockOrders.sort(prioritySort);
  phase4BlBlockSaleOrders.sort(prioritySort);
  phase5ManualOrders.sort(prioritySort);
  // ──────────────────────────────────────
  // 7. Allocation helpers
  // ──────────────────────────────────────
  const mpsOrdersToSave: MpsPlanOrder[] = [];
  const exceptionsToSave: MpsExceptionReport[] = [];
  const dailyTracker = new Map<string, { icutUsedKg: number; icutUsedHours: number; manualUsedKg: number; blBlockProduced: number; blBlockUsed: number }>();

  const getTracker = (dateStr: string) => {
    if (!dailyTracker.has(dateStr)) {
      dailyTracker.set(dateStr, { icutUsedKg: 0, icutUsedHours: 0, manualUsedKg: 0, blBlockProduced: 0, blBlockUsed: 0 });
    }
    return dailyTracker.get(dateStr)!;
  };

  // I-CUT Capacity (4 machines * 9.25 hours/shift = 37 hours)
  const MAX_ICUT_HOURS_PER_DAY = 37;

  const subtractDays = (d: Date, days: number) => {
    const nd = new Date(d.getTime());
    nd.setDate(nd.getDate() - days);
    return nd;
  };

  const createOrderRecord = (order: StgErpOrderLine, allocQty: number, prodDate: Date, shipDate: Date, itemDesc: string, productType: string) => {
    return manager.create(MpsPlanOrder, {
      mpsPlan: plan,
      erpOrderLineId: order.erpOrderLineId,
      soNumber: headerMap.get(order.erpOrderHeaderId) || '-',
      itemCode: order.erpOrderItemCode,
      itemDesc: itemDesc,
      productType: productType,
      quantityKg: allocQty,
      shipDate: shipDate,
      plannedProductionDate: prodDate,
      finishedProductionDate: prodDate,
      isManualOverride: false,
    });
  };

  const createExceptionRecord = (order: StgErpOrderLine, remainingQty: number, shipDate: Date, reason: string) => {
    return manager.create(MpsExceptionReport, {
      mpsPlan: plan,
      erpOrderLineId: order.erpOrderLineId,
      soNumber: headerMap.get(order.erpOrderHeaderId) || '-',
      itemCode: order.erpOrderItemCode,
      shipDate: shipDate,
      requiredKg: Number(order.erpOrderItemQty || 0),
      shortageKg: remainingQty,
      reason: reason,
    });
  };

  // ══════════════════════════════════════
  // Phase 1: I-Cut Orders (icutSpeed > 0)
  // RM BL → สินค้าหลัก (BLK ≤60g / BL-TH) + BL BLOCK (Co-Product)
  // ══════════════════════════════════════

  const icutMaster = await manager.getRepository('ICutMaster').findOne({ where: { isActive: true } });
  const coproductYieldPct = Number((icutMaster as any)?.coproductYieldPct ?? 0.20); // Default 0.20 (20%)
  const mainYieldPct = 1.0 - coproductYieldPct;


  // ──────────────────────────────────────
  // Helper for tracking Internal/External Deduction
  // ──────────────────────────────────────
  const deductRM = (sup: any, rmType: 'BL' | 'BLTH' | 'BLDR', qty: number, isExternalAllowed: boolean, sizeKey?: string) => {
    let toDeduct = qty;
    let extDeducted = 0;
    let intDeducted = 0;

    // Phase A: Try External First (if allowed)
    if (isExternalAllowed && toDeduct > 0) {
      let availExt = sup.externalAvailable[rmType];
      if (sizeKey) {
        availExt = Math.min(availExt, sup.externalSizes[sizeKey] || 0);
      }
      const deduct = Math.min(availExt, toDeduct);
      if (deduct > 0) {
        sup.externalAvailable[rmType] -= deduct;
        if (sizeKey) sup.externalSizes[sizeKey] -= deduct;
        extDeducted += deduct;
        toDeduct -= deduct;
      }
    }

    // Phase B: Try Internal
    if (toDeduct > 0) {
      let availInt = sup.internalAvailable[rmType];
      if (sizeKey) {
        availInt = Math.min(availInt, sup.internalSizes[sizeKey] || 0);
      }
      const deduct = Math.min(availInt, toDeduct);
      if (deduct > 0) {
        sup.internalAvailable[rmType] -= deduct;
        if (sizeKey) sup.internalSizes[sizeKey] -= deduct;
        intDeducted += deduct;
        toDeduct -= deduct;
      }
    }

    // Fallback sync total aggregate
    const totalDeducted = extDeducted + intDeducted;
    sup.available[rmType] -= totalDeducted;
    if (sizeKey) sup.blSizes[sizeKey] -= totalDeducted;

    return { total: totalDeducted, intUsed: intDeducted, extUsed: extDeducted };
  };

  const resolveTargetSize = (sup: any, targetSize: string, isFallback: boolean) => {
    let matchSz = targetSize;
    if (isFallback) {
      const m = targetSize.match(/(\d+)\s*[-–]\s*(\d+)/);
      if (m) {
        const lo = Number(m[1]), hi = Number(m[2]);
        const foundKey = Object.keys(sup.internalSizes).find(k => {
           if (k === targetSize || k === `BL ${targetSize}`) return true;
           const km = k.match(/(\d+)\s*[-–]\s*(\d+)/);
           if (km) {
              const klo = Number(km[1]), khi = Number(km[2]);
              return Math.max(lo, klo) <= Math.min(hi, khi);
           }
           return false;
        });
        if (foundKey) matchSz = foundKey;
      } else {
        const foundKey = Object.keys(sup.internalSizes).find(k => k === `BL ${targetSize}`);
        if (foundKey) matchSz = foundKey;
      }
    }
    return matchSz;
  };

  // ══════════════════════════════════════
  // Phase 1: Sizing (BLK without I-Cut)
  // ══════════════════════════════════════
  for (const order of phase1SizingOrders) {

    const spec = specMap.get(order.erpOrderItemCode);
    const itemDesc = (spec as any)?.erpItemDesc || order.erpOrderItemCode;
    const descUpper = itemDesc.toUpperCase();
    const productType = (spec as any)?.productType || 'Freeze';
    const specSize = (spec as any)?.productSize;
    const minLead = (spec as any)?.minProductLead ?? 1;
    const maxLead = (spec as any)?.maxProductLead ?? 3;
    const rawOrderQty = Number(order.erpOrderItemQty || 0);
    const alreadyPlanned = plannedQtyMap.get(order.erpOrderLineId) || 0;
    const orderQty = Math.max(0, rawOrderQty - alreadyPlanned);
    let remainingQty = orderQty;
    if (remainingQty <= 0) continue;
    const shipDate = new Date(order.erpOrderShipDate);

    const requiredMapping = extractBeltGateSizes(descUpper, specSize);
    if (!requiredMapping) continue;
    const yieldMultiplier = requiredMapping.yieldPct / 100;

    for (let leadDay = minLead; leadDay <= maxLead; leadDay++) {
      if (remainingQty <= 0) break;
      const prodDate = subtractDays(shipDate, leadDay);
      const dateStr = formatDate(prodDate);
      const sup = supplyMap.get(dateStr);
      if (!sup) continue;

      const rmNeeded = remainingQty / yieldMultiplier;
      let allocRmQty = 0;

      // Pull from specific Belt Gate mapped sizes
      for (const targetSize of requiredMapping.rmSizes) {
        if (allocRmQty >= rmNeeded) break;
        
        const rmType = descUpper.includes('TH') ? 'BLTH' : 'BL';
        const allowedExt = !!(spec as any)?.isExternalRmAllowed;
        
        let matchSz = resolveTargetSize(sup, targetSize, !!(requiredMapping as any).isFallback);

        let availTargetSize = sup.internalSizes[matchSz] || 0;
        if (allowedExt) availTargetSize += (sup.externalSizes[matchSz] || 0);

        if (availTargetSize > 0) {
          const normalRmToUse = Math.min(availTargetSize, rmNeeded - allocRmQty);
          const actualDeducted = deductRM(sup, rmType, normalRmToUse, allowedExt, matchSz);
          allocRmQty += actualDeducted.total;
        }
      }

      if (allocRmQty <= 0) continue;

      const productProduced = Math.round(allocRmQty * yieldMultiplier);
      remainingQty -= productProduced;
      mpsOrdersToSave.push(createOrderRecord(order, productProduced, prodDate, shipDate, itemDesc, productType));
    }

    if (remainingQty > 0) {
      exceptionsToSave.push(createExceptionRecord(order, remainingQty, shipDate, `RM BL supply ตาม Size ที่กำหนดไม่เพียงพอสำหรับ order Sizing นี้`));
    }
  }

  // ══════════════════════════════════════
  // Phase 2: SPECIAL (BL TH / BL DR without I-Cut)
  // ══════════════════════════════════════
  for (const order of phase2SpecialOrders) {
    const spec = specMap.get(order.erpOrderItemCode);
    const itemDesc = (spec as any)?.erpItemDesc || order.erpOrderItemCode;
    const classification = classifyOrder(order);
    const productType = (spec as any)?.productType || 'Freeze';
    const minLead = (spec as any)?.minProductLead ?? 1;
    const maxLead = (spec as any)?.maxProductLead ?? 3;
    const rawOrderQty = Number(order.erpOrderItemQty || 0);
    const alreadyPlanned = plannedQtyMap.get(order.erpOrderLineId) || 0;
    const orderQty = Math.max(0, rawOrderQty - alreadyPlanned);
    let remainingQty = orderQty;
    if (remainingQty <= 0) continue;
    const shipDate = new Date(order.erpOrderShipDate);

    for (let leadDay = minLead; leadDay <= maxLead; leadDay++) {
      if (remainingQty <= 0) break;
      const prodDate = subtractDays(shipDate, leadDay);
      const dateStr = formatDate(prodDate);
      const sup = supplyMap.get(dateStr);
      if (!sup) continue;

      let avail = 0;
      if (classification === 'BLDR') avail = sup.available.BLDR;
      else if (classification === 'BLTH') avail = sup.available.BLTH;
      
      if (avail <= 0) continue;

      const allocQty = Math.round(Math.min(avail, remainingQty));
      if (allocQty <= 0) continue;

      if (classification === 'BLDR') sup.available.BLDR -= allocQty;
      else if (classification === 'BLTH') sup.available.BLTH -= allocQty;
      
      remainingQty -= allocQty;
      mpsOrdersToSave.push(createOrderRecord(order, allocQty, prodDate, shipDate, itemDesc, productType));
    }

    if (remainingQty > 0) {
      exceptionsToSave.push(createExceptionRecord(order, remainingQty, shipDate, `RM Special supply ไม่เพียงพอสำหรับ order นี้`));
    }
  }




  // ══════════════════════════════════════
  // Phase 2.5: Transfer Leftover BL to BLK and Apply Belt Gate Matrix
  // ══════════════════════════════════════
  for (const [dateStr, sup] of supplyMap.entries()) {
    for (const [sz, qty] of Object.entries(sup.blSizes)) {
      if (qty > 0) {
        let rawSz = sz;
        if (rawSz.startsWith('BL ')) rawSz = rawSz.replace('BL ', '');
        sup.blkSizes[rawSz] = (sup.blkSizes[rawSz] || 0) + qty;
        
        const intQty = sup.internalSizes[sz] || 0;
        const extQty = sup.externalSizes[sz] || 0;
        (sup as any).internalBlkSizes[rawSz] = ((sup as any).internalBlkSizes[rawSz] || 0) + intQty;
        (sup as any).externalBlkSizes[rawSz] = ((sup as any).externalBlkSizes[rawSz] || 0) + extQty;
        
        sup.blSizes[sz] = 0;
        sup.internalSizes[sz] = 0;
        sup.externalSizes[sz] = 0;
      }
    }
    
    (sup as any).mappedInternalBlkSizes = {};
    (sup as any).mappedExternalBlkSizes = {};

    for (const [rmSz, qty] of Object.entries(sup.blkSizes)) {
      if (qty <= 0) continue;
      
      let mapped = false;
      for (const rule of blBeltGateMatrix || []) {
        let isMatch = false;
        if (rule.rmSize === rmSz) {
            isMatch = true;
        } else {
            const r1 = rule.rmSize.match(/(\d+)\s*-\s*(\d+)/);
            const r2 = rmSz.match(/(\d+)\s*-\s*(\d+)/);
            if (r1 && r2) {
               const min1 = Number(r1[1]), max1 = Number(r1[2]);
               const min2 = Number(r2[1]), max2 = Number(r2[2]);
               if (min1 <= max2 && min2 <= max1) isMatch = true;
            }
        }
        
        if (isMatch) {
           const targetQty = qty * Number(rule.yieldPct || 100) / 100.0;
           const targetSz = rule.targetProduct;
           (sup as any).mappedBlkSizes[targetSz] = ((sup as any).mappedBlkSizes[targetSz] || 0) + targetQty;
           
           const intQty = (sup as any).internalBlkSizes[rmSz] || 0;
           const extQty = (sup as any).externalBlkSizes[rmSz] || 0;
           
           (sup as any).mappedInternalBlkSizes[targetSz] = ((sup as any).mappedInternalBlkSizes[targetSz] || 0) + (intQty * Number(rule.yieldPct || 100) / 100.0);
           (sup as any).mappedExternalBlkSizes[targetSz] = ((sup as any).mappedExternalBlkSizes[targetSz] || 0) + (extQty * Number(rule.yieldPct || 100) / 100.0);
           
           mapped = true;
           break;
        }
      }
      
      if (!mapped) {
         (sup as any).mappedBlkSizes[rmSz] = ((sup as any).mappedBlkSizes[rmSz] || 0) + qty;
         (sup as any).mappedInternalBlkSizes[rmSz] = ((sup as any).mappedInternalBlkSizes[rmSz] || 0) + ((sup as any).internalBlkSizes[rmSz] || 0);
         (sup as any).mappedExternalBlkSizes[rmSz] = ((sup as any).mappedExternalBlkSizes[rmSz] || 0) + ((sup as any).externalBlkSizes[rmSz] || 0);
      }
    }
  }


    // Save mapped BLK sizes to DB
    const supplySizeRecordsBlk: MpsPlanSupplySize[] = [];
    for (const [dateStr, supData] of supplyMap.entries()) {
      const savedSup = supplyRecords.find(s => parseLocalDate(s.productionDate) === dateStr);
      if (!savedSup) continue;
      
      for (const [sz, qty] of Object.entries((supData as any).mappedBlkSizes || {})) {
        if (Number(qty) <= 0) continue;
        supplySizeRecordsBlk.push(manager.create(MpsPlanSupplySize, {
          mpsPlanSupply: savedSup,
          groupSize: sz,
          quantityKg: Number(qty),
          partName: 'BLK',
          productionDate: savedSup.productionDate,
        }));
      }
    }
    console.log(`[DEBUG] Found ${supplySizeRecordsBlk.length} BLK sizes to save to DB.`);
    if (supplySizeRecordsBlk.length > 0) {
      await manager.save(supplySizeRecordsBlk);
      console.log(`[DEBUG] Successfully saved BLK sizes.`);
    }

  // ══════════════════════════════════════
  // Phase 3: I-CUT (RM remaining -> BLK <=60g, BL TH 20g range)

  // ══════════════════════════════════════
  for (const order of phase3IcutOrders) {
    const spec = specMap.get(order.erpOrderItemCode);
    const itemDesc = (spec as any)?.erpItemDesc || order.erpOrderItemCode;
    const descUpper = itemDesc.toUpperCase();
    const classification = classifyOrder(order);
    const productType = (spec as any)?.productType || 'Freeze';
    const minLead = (spec as any)?.minProductLead ?? 1;
    const maxLead = (spec as any)?.maxProductLead ?? 3;
    const rawOrderQty = Number(order.erpOrderItemQty || 0);
    const alreadyPlanned = plannedQtyMap.get(order.erpOrderLineId) || 0;
    const orderQty = Math.max(0, rawOrderQty - alreadyPlanned);
    let remainingQty = orderQty;
    if (remainingQty <= 0) continue;
    const shipDate = new Date(order.erpOrderShipDate);

    const yieldMultiplier = mainYieldPct;

    for (let leadDay = minLead; leadDay <= maxLead; leadDay++) {
      if (remainingQty <= 0) break;
      const prodDate = subtractDays(shipDate, leadDay);
      const dateStr = formatDate(prodDate);
      const sup = supplyMap.get(dateStr);
      if (!sup) continue;

      const rmType = classification === 'BLTH' ? 'BLTH' : 'BLK';
      const allowedExt = !!(spec as any)?.isExternalRmAllowed;
      
      let avail = 0;
      if (rmType === 'BLTH') {
        avail = sup.internalAvailable.BLTH;
        if (allowedExt) avail += sup.externalAvailable.BLTH;
      }

      const mapping = extractBeltGateSizes(descUpper, (spec as any)?.productSize);
      let sizeKeysToUse: string[] = [];
      
      if (rmType === 'BLK') {
         // I-Cut BLK consumes from mappedBlkSizes!
         // mapping.targetProduct might not exactly match the key, but extractBeltGateSizes returns rmSizes.
         // Wait, the Phase 2.5 matrix mapped RM BLK into target sizes (e.g. "53-58").
         // The order's `specSize` is "53-58 g".
         // Let's just match the target sizes exactly from mappedBlkSizes based on the order's product size.
         const targetProductKeys = Object.keys((sup as any).mappedBlkSizes || {});
         const orderSize = ((spec as any)?.productSize || '').toLowerCase().replace(/\s+/g, '');
         let matchedKey = targetProductKeys.find(k => k.toLowerCase().replace(/\s+/g, '') === orderSize);
         
         if (!matchedKey && mapping && mapping.targetProduct) {
             matchedKey = targetProductKeys.find(k => k.toLowerCase().replace(/\s+/g, '') === mapping.targetProduct.toLowerCase().replace(/\s+/g, ''));
         }
         
         if (matchedKey) {
            avail = ((sup as any).mappedInternalBlkSizes[matchedKey] || 0) + (allowedExt ? ((sup as any).mappedExternalBlkSizes[matchedKey] || 0) : 0);
            sizeKeysToUse.push(matchedKey);
         } else {
            // Try range matching if order size is like '30-40' and target sizes are '30-35', '35-40'
            const orderMatch = orderSize.match(/(\d+)\s*[-–]\s*(\d+)/);
            if (orderMatch) {
              const oMin = Number(orderMatch[1]);
              const oMax = Number(orderMatch[2]);
              for (const k of targetProductKeys) {
                const kMatch = k.match(/(\d+)\s*[-–]\s*(\d+)/);
                if (kMatch) {
                  const kMin = Number(kMatch[1]);
                  const kMax = Number(kMatch[2]);
                  if (kMin >= oMin && kMax <= oMax) {
                    sizeKeysToUse.push(k);
                    avail += ((sup as any).mappedInternalBlkSizes[k] || 0) + (allowedExt ? ((sup as any).mappedExternalBlkSizes[k] || 0) : 0);
                  }
                }
              }
            }
         }
         
         if (sizeKeysToUse.length === 0 && mapping && mapping.rmSizes.length > 0) {
            // Fallback to checking mapping target product if it wasn't strictly found
            avail = 0;
            for (const sz of mapping.rmSizes) {
              const intQty = (sup as any).mappedInternalBlkSizes[sz] || 0;
              const extQty = (sup as any).mappedExternalBlkSizes[sz] || 0;
              avail += intQty + (allowedExt ? extQty : 0);
              sizeKeysToUse.push(sz);
            }
         }
      } else {
         if (mapping && mapping.rmSizes.length > 0) {
           let maxAvail = 0;
           for (const targetSize of mapping.rmSizes) {
             let matchSz = resolveTargetSize(sup, targetSize, !!(mapping as any).isFallback);
             maxAvail += (sup.internalSizes[matchSz] || 0) + (allowedExt ? (sup.externalSizes[matchSz] || 0) : 0);
             sizeKeysToUse.push(matchSz);
           }
           avail = Math.min(avail, maxAvail);
         }
      }

      if (avail <= 0) continue;

      const tracker = getTracker(dateStr);
      const icutHoursRemaining = MAX_ICUT_HOURS_PER_DAY - tracker.icutUsedHours;
      if (icutHoursRemaining <= 0) continue;

      const icutSpeed = spec && (spec as any).icutSpeed ? Number((spec as any).icutSpeed) : 1000;
      const rmNeeded = remainingQty / yieldMultiplier;
      const maxFgAllowedByTime = icutHoursRemaining * icutSpeed;
      const maxRmAllowedByTime = maxFgAllowedByTime / yieldMultiplier;
      let allocRmQty = Math.round(Math.min(avail, rmNeeded, maxRmAllowedByTime));
      
      if (allocRmQty <= 0) continue;

      let deducted = { total: 0, extUsed: 0, intUsed: 0 };
      if (rmType === 'BLK') {
        let remainingToDeduct = allocRmQty;
        for (const sz of sizeKeysToUse) {
           if (remainingToDeduct <= 0) break;
           const availSz = ((sup as any).mappedInternalBlkSizes[sz] || 0) + (allowedExt ? ((sup as any).mappedExternalBlkSizes[sz] || 0) : 0);
           const deductAmt = Math.min(availSz, remainingToDeduct);
           if (deductAmt > 0) {
              let extToUse = 0;
              let intToUse = 0;
              if (allowedExt) {
                extToUse = Math.min((sup as any).mappedExternalBlkSizes[sz] || 0, deductAmt);
                intToUse = deductAmt - extToUse;
              } else {
                intToUse = deductAmt;
              }
                (sup as any).mappedInternalBlkSizes[sz] -= intToUse;
                if (allowedExt) (sup as any).mappedExternalBlkSizes[sz] -= extToUse;
                
                (sup as any).mappedBlkSizes[sz] -= deductAmt;

                // CRITICAL: Deduct from global available BL pool so Phase 5 does not over-allocate
                sup.internalAvailable.BL -= intToUse;
                if (allowedExt) sup.externalAvailable.BL -= extToUse;
                sup.available.BL -= deductAmt;
                
                deducted.total += deductAmt;
              deducted.extUsed += extToUse;
              deducted.intUsed += intToUse;
              remainingToDeduct -= deductAmt;
           }
        }
        allocRmQty = deducted.total;
      } else {
        if (sizeKeysToUse.length > 0) {
          let remainingToDeduct = allocRmQty;
          for (const sz of sizeKeysToUse) {
             if (remainingToDeduct <= 0) break;
             const availSz = (sup.internalSizes[sz] || 0) + (allowedExt ? (sup.externalSizes[sz] || 0) : 0);
             const deductAmt = Math.min(availSz, remainingToDeduct);
             if (deductAmt > 0) {
                const res = deductRM(sup, rmType, deductAmt, allowedExt, sz);
                deducted.total += res.total;
                deducted.extUsed += res.extUsed;
                deducted.intUsed += res.intUsed;
                remainingToDeduct -= res.total;
             }
          }
          allocRmQty = deducted.total;
        } else {
          deducted = deductRM(sup, rmType, allocRmQty, allowedExt);
        }
      }


      const productProduced = Math.round(allocRmQty * yieldMultiplier);
      const blockProduced = allocRmQty - productProduced;
      
      const blockRatioInt = allocRmQty > 0 ? deducted.intUsed / allocRmQty : 1;
      const blockRatioExt = allocRmQty > 0 ? deducted.extUsed / allocRmQty : 0;

      const hoursUsed = productProduced / icutSpeed;
      tracker.icutUsedKg += productProduced;
      tracker.icutUsedHours += hoursUsed;
      
      remainingQty -= productProduced;

      // Extract original size to map BL BLOCK
      const specSize = (spec as any)?.productSize || '';
      let blockKey = 'BL_BLOCK_UNSIZED';
      const m = specSize.match(/(\d+)\s*-\s*(\d+)/);
      if (m) {
        blockKey = `BL_BLOCK_${m[1]}_${m[2]}`;
      }
      
      sup.blSizes[blockKey] = (sup.blSizes[blockKey] || 0) + blockProduced;
      sup.blSizes['TOTAL_BL_BLOCK'] = (sup.blSizes['TOTAL_BL_BLOCK'] || 0) + blockProduced;
      
      sup.internalSizes[blockKey] = (sup.internalSizes[blockKey] || 0) + (blockProduced * blockRatioInt);
      sup.externalSizes[blockKey] = (sup.externalSizes[blockKey] || 0) + (blockProduced * blockRatioExt);
      sup.internalSizes['TOTAL_BL_BLOCK'] = (sup.internalSizes['TOTAL_BL_BLOCK'] || 0) + (blockProduced * blockRatioInt);
      sup.externalSizes['TOTAL_BL_BLOCK'] = (sup.externalSizes['TOTAL_BL_BLOCK'] || 0) + (blockProduced * blockRatioExt);

      tracker.blBlockProduced += blockProduced;

      let remainingToDeduct = allocRmQty;
      for (const [sz, qty] of Object.entries(sup.blSizes)) {
        if (sz.startsWith('BL_BLOCK') || sz === 'TOTAL_BL_BLOCK') continue;
        if (remainingToDeduct <= 0) break;
        if (qty > 0) {
          const deduct = Math.min(qty, remainingToDeduct);
          sup.blSizes[sz] -= deduct;
          remainingToDeduct -= deduct;
        }
      }

      mpsOrdersToSave.push(createOrderRecord(order, productProduced, prodDate, shipDate, itemDesc, productType));
    }

    if (remainingQty > 0) {
      exceptionsToSave.push(createExceptionRecord(order, remainingQty, shipDate, `RM supply หรือ I-Cut capacity ไม่เพียงพอสำหรับ order I-Cut นี้`));
    }
  }

  // ══════════════════════════════════════
  // Phase 4: BL BLOCK Direct Sale & Manual Trimming from BL BLOCK
  // ══════════════════════════════════════
  for (const order of phase4BlBlockSaleOrders) {
    const spec = specMap.get(order.erpOrderItemCode);
    const itemDesc = (spec as any)?.erpItemDesc || order.erpOrderItemCode;
    const productType = (spec as any)?.productType || 'Freeze';
    const minLead = (spec as any)?.minProductLead ?? 1;
    const maxLead = (spec as any)?.maxProductLead ?? 3;
    const rawOrderQty = Number(order.erpOrderItemQty || 0);
    const alreadyPlanned = plannedQtyMap.get(order.erpOrderLineId) || 0;
    const orderQty = Math.max(0, rawOrderQty - alreadyPlanned);
    let remainingQty = orderQty;
    if (remainingQty <= 0) continue;
    const shipDate = new Date(order.erpOrderShipDate);

    for (let leadDay = minLead; leadDay <= maxLead; leadDay++) {
      if (remainingQty <= 0) break;
      const prodDate = subtractDays(shipDate, leadDay);
      const dateStr = formatDate(prodDate);
      const sup = supplyMap.get(dateStr);
      if (!sup) continue;

      const availBlock = sup.blSizes['TOTAL_BL_BLOCK'] || 0;
      if (availBlock <= 0) continue;

      const allocQty = Math.round(Math.min(availBlock, remainingQty));
      if (allocQty <= 0) continue;

      let toDeduct = allocQty;
      for (const sz of Object.keys(sup.blSizes)) {
        if (sz.startsWith('BL_BLOCK_') && sz !== 'TOTAL_BL_BLOCK') {
          const availSz = sup.blSizes[sz];
          if (availSz > 0 && toDeduct > 0) {
            const use = Math.min(availSz, toDeduct);
            sup.blSizes[sz] -= use;
            toDeduct -= use;
          }
        }
      }
      sup.blSizes['TOTAL_BL_BLOCK'] -= allocQty;
      remainingQty -= allocQty;

      mpsOrdersToSave.push(createOrderRecord(order, allocQty, prodDate, shipDate, itemDesc, productType));
    }

    if (remainingQty > 0) {
      exceptionsToSave.push(createExceptionRecord(order, remainingQty, shipDate, `BL BLOCK supply ไม่เพียงพอสำหรับ order ขายตรงนี้`));
    }
  }

  for (const order of phase4BlBlockOrders) {
    const spec = specMap.get(order.erpOrderItemCode);
    const itemDesc = (spec as any)?.erpItemDesc || order.erpOrderItemCode;
    const productType = (spec as any)?.productType || 'Freeze';
    const specSize = (spec as any)?.productSize || '';
    const minLead = (spec as any)?.minProductLead ?? 1;
    const maxLead = (spec as any)?.maxProductLead ?? 3;
    const rawOrderQty = Number(order.erpOrderItemQty || 0);
    const alreadyPlanned = plannedQtyMap.get(order.erpOrderLineId) || 0;
    const orderQty = Math.max(0, rawOrderQty - alreadyPlanned);
    let remainingQty = orderQty;
    if (remainingQty <= 0) continue;
    const shipDate = new Date(order.erpOrderShipDate);
    
    // Map required block size (1 step up)
    // E.g. Order is 20-25g, we need BL_BLOCK_25_30
    let requiredBlockKey: string | null = null;
    const m = specSize.match(/(\d+)\s*-\s*(\d+)/);
    if (m) {
      const lo = parseInt(m[1], 10);
      const hi = parseInt(m[2], 10);
      requiredBlockKey = `BL_BLOCK_${lo + 5}_${hi + 5}`; // Hardcoded 5g step up assumption
    }

    for (let leadDay = minLead; leadDay <= maxLead; leadDay++) {
      if (remainingQty <= 0) break;
      const prodDate = subtractDays(shipDate, leadDay);
      const dateStr = formatDate(prodDate);
      const sup = supplyMap.get(dateStr);
      if (!sup) continue;
      
      const tracker = getTracker(dateStr);

      const allowedExt = !!(spec as any)?.isExternalRmAllowed;
      let availBlock = 0;
      let blockKeyUsed = '';
      
      const checkBlockAvail = (key: string) => {
          let a = sup.internalSizes[key] || 0;
          if (allowedExt) a += (sup.externalSizes[key] || 0);
          return a;
      };

      if (requiredBlockKey && checkBlockAvail(requiredBlockKey) > 0) {
         availBlock = checkBlockAvail(requiredBlockKey);
         blockKeyUsed = requiredBlockKey;
      } else if (checkBlockAvail('BL_BLOCK_UNSIZED') > 0) {
         availBlock = checkBlockAvail('BL_BLOCK_UNSIZED');
         blockKeyUsed = 'BL_BLOCK_UNSIZED';
      }

      if (availBlock > 0) {
        const blockToUse = Math.min(availBlock, remainingQty);
        
        // Deduct from internal/external Block Sizes proportionally or sequentially
        let remainingDeduct = blockToUse;
        if (allowedExt && sup.externalSizes[blockKeyUsed] > 0) {
            const extDeduct = Math.min(sup.externalSizes[blockKeyUsed], remainingDeduct);
            sup.externalSizes[blockKeyUsed] -= extDeduct;
            sup.externalSizes['TOTAL_BL_BLOCK'] -= extDeduct;
            remainingDeduct -= extDeduct;
        }
        if (remainingDeduct > 0 && sup.internalSizes[blockKeyUsed] > 0) {
            const intDeduct = Math.min(sup.internalSizes[blockKeyUsed], remainingDeduct);
            sup.internalSizes[blockKeyUsed] -= intDeduct;
            sup.internalSizes['TOTAL_BL_BLOCK'] -= intDeduct;
            remainingDeduct -= intDeduct;
        }

        sup.blSizes[blockKeyUsed] -= blockToUse;
        sup.blSizes['TOTAL_BL_BLOCK'] -= blockToUse;
        remainingQty -= blockToUse;
        tracker.blBlockUsed += blockToUse;
        tracker.manualUsedKg += blockToUse;

        mpsOrdersToSave.push(createOrderRecord(order, blockToUse, prodDate, shipDate, itemDesc, productType));
      }
    }
    
    // If remaining, push it to phase 5 to use RM BL directly
    if (remainingQty > 0) {
       // We mock a StgErpOrderLine with reduced qty
       const leftoverOrder = { ...order, erpOrderItemQty: remainingQty };
       phase5ManualOrders.push(leftoverOrder as any);
    }
  }

  // ══════════════════════════════════════
  // Phase 5: Manual BLK (>60g) & Other Trimming (RM remaining)
  // ══════════════════════════════════════
  for (const order of phase5ManualOrders) {

    const spec = specMap.get(order.erpOrderItemCode);
    const itemDesc = (spec as any)?.erpItemDesc || order.erpOrderItemCode;
    const classification = classifyOrder(order);
    const productType = (spec as any)?.productType || 'Freeze';
    const productYield = Number((spec as any)?.productYield || 0.90);
    const minLead = (spec as any)?.minProductLead ?? 1;
    const maxLead = (spec as any)?.maxProductLead ?? 3;
    const rawOrderQty = Number(order.erpOrderItemQty || 0);
    const alreadyPlanned = plannedQtyMap.get(order.erpOrderLineId) || 0;
    const orderQty = Math.max(0, rawOrderQty - alreadyPlanned);
    let remainingQty = orderQty;
    if (remainingQty <= 0) continue;
    const shipDate = new Date(order.erpOrderShipDate);

    for (let leadDay = minLead; leadDay <= maxLead; leadDay++) {
      if (remainingQty <= 0) break;
      const prodDate = subtractDays(shipDate, leadDay);
      const dateStr = formatDate(prodDate);
      const sup = supplyMap.get(dateStr);
      if (!sup) continue;
      
      const tracker = getTracker(dateStr);
      const rmNeeded = remainingQty / productYield;
      let allocRmQty = 0;

      // 1. ดึง BL BLOCK ที่เหลือก่อน (ถ้ามี)
      const availBlock = sup.blSizes['TOTAL_BL_BLOCK'] || 0;
      if (availBlock > 0 && classification === 'BLK') {
        const blockToUse = Math.min(availBlock, rmNeeded);
        let toDeduct = blockToUse;
        for (const sz of Object.keys(sup.blSizes)) {
          if (sz.startsWith('BL_BLOCK_') && sz !== 'TOTAL_BL_BLOCK') {
            const availSz = sup.blSizes[sz];
            if (availSz > 0 && toDeduct > 0) {
              const use = Math.min(availSz, toDeduct);
              sup.blSizes[sz] -= use;
              toDeduct -= use;
            }
          }
        }
        sup.blSizes['TOTAL_BL_BLOCK'] -= blockToUse;
        allocRmQty += blockToUse;
        tracker.blBlockUsed += blockToUse;
      }

      // 2. ดึง RM ตามประเภท (BLTH ดึง BL-TH, อื่นๆ ดึง BL)
      if (allocRmQty < rmNeeded) {
        if (classification === 'BLTH' && sup.available.BLTH > 0) {
          const rmToUse = Math.min(sup.available.BLTH, rmNeeded - allocRmQty);
          sup.available.BLTH -= rmToUse;
          allocRmQty += rmToUse;
        }
        
        // Fallback to RM BL
        if (allocRmQty < rmNeeded && sup.available.BL > 0) {
          const descUpper = itemDesc.toUpperCase();
          const mapping = extractBeltGateSizes(descUpper, (spec as any)?.productSize);
          const allowedExt = !!(spec as any)?.isExternalRmAllowed;
          
          let maxBlAvail = sup.available.BL;
          let sizeKeysToUse: string[] = [];
          
          if (mapping && mapping.rmSizes.length > 0) {
             maxBlAvail = 0;
             for (const sz of mapping.rmSizes) {
                maxBlAvail += (sup.internalSizes[sz] || 0) + (allowedExt ? (sup.externalSizes[sz] || 0) : 0);
                sizeKeysToUse.push(sz);
             }
          }

          if (maxBlAvail > 0) {
            const normalRmToUse = Math.min(maxBlAvail, rmNeeded - allocRmQty);
            
            if (sizeKeysToUse.length > 0) {
               let actualDeductedTotal = 0;
               let remainingToDeduct = normalRmToUse;
               for (const sz of sizeKeysToUse) {
                  if (remainingToDeduct <= 0) break;
                  const availSz = (sup.internalSizes[sz] || 0) + (allowedExt ? (sup.externalSizes[sz] || 0) : 0);
                  const deductAmt = Math.min(availSz, remainingToDeduct);
                  if (deductAmt > 0) {
                     const res = deductRM(sup, 'BL', deductAmt, allowedExt, sz);
                     actualDeductedTotal += res.total;
                     remainingToDeduct -= res.total;
                  }
               }
               allocRmQty += actualDeductedTotal;
            } else {
               const res = deductRM(sup, 'BL', normalRmToUse, allowedExt);
               allocRmQty += res.total;
            }
          }
        }
      }

      if (allocRmQty <= 0) continue;

      const productProduced = Math.round(allocRmQty * productYield);
      tracker.manualUsedKg += allocRmQty;

      remainingQty -= productProduced;
      mpsOrdersToSave.push(createOrderRecord(order, productProduced, prodDate, shipDate, itemDesc, productType));
    }

    if (remainingQty > 0) {
      exceptionsToSave.push(createExceptionRecord(order, remainingQty, shipDate, `RM supply ไม่เพียงพอสำหรับ order Manual นี้`));
    }
  }
  // ──────────────────────────────────────
  // Save Orders and Exceptions
  // ──────────────────────────────────────
  const saveChunkSize = 100;
  if (mpsOrdersToSave.length > 0) {
    for (let k = 0; k < mpsOrdersToSave.length; k += saveChunkSize) {
      await manager.save(mpsOrdersToSave.slice(k, k + saveChunkSize));
    }
  }
  if (exceptionsToSave.length > 0) {
    for (let k = 0; k < exceptionsToSave.length; k += saveChunkSize) {
      await manager.save(exceptionsToSave.slice(k, k + saveChunkSize));
    }
  }

  // ──────────────────────────────────────
  // Build and Save Daily Summaries
  // ──────────────────────────────────────
  const dailyToSave: MpsPlanDaily[] = [];
  let totalDemandKg = 0;
  let totalSupplyKg = 0;

  for (const [dateStr, sup] of supplyMap.entries()) {
    const tracker = getTracker(dateStr);
    const ordersForDay = mpsOrdersToSave.filter(o => formatDate(o.plannedProductionDate) === dateStr);
    const dayDemand = ordersForDay.reduce((sum, o) => sum + Number(o.quantityKg || 0), 0);
    totalDemandKg += dayDemand;
    totalSupplyKg += sup.totalBL + sup.totalBLTH + sup.totalBLDR;


    const initInt = sup.initialInternal;
    const initExt = sup.initialExternal;
    const totalInt = initInt.BL + initInt.BLTH + initInt.BLDR;
    const totalExt = initExt.BL + initExt.BLTH + initExt.BLDR;

    dailyToSave.push(manager.create(MpsPlanDaily, {
      mpsPlan: plan,
      productionDate: new Date(dateStr),
      intakeBirds: 0,
      rmFlAvailKg: sup.totalBL + sup.totalBLTH + sup.totalBLDR,
      internalRmKg: totalInt,
      externalRmKg: totalExt,
      demandKg: dayDemand,
      cuttingStaff: 0,
      supportStaff: 0,
      totalStaff: 0,
      blTrackerJson: JSON.stringify({
        icutUsedKg: tracker.icutUsedKg,
        icutUsedHours: tracker.icutUsedHours,
        icutCapacityHours: MAX_ICUT_HOURS_PER_DAY,
        manualUsedKg: tracker.manualUsedKg,
        blBlockProduced: tracker.blBlockProduced,
        blBlockUsed: tracker.blBlockUsed,
        internalRemaining: { ...sup.initialInternal },
        externalRemaining: { ...sup.initialExternal },
        rmBreakdown: {
          bl: sup.totalBL,
          blTh: sup.totalBLTH,
          blDr: sup.totalBLDR
        },
        beltGateSizes: sup.initialSizes
      })
    }));
  }

  if (dailyToSave.length > 0) {
    await manager.save(dailyToSave);
  }

  // Update plan
  plan.status = 'DRAFT';
  await manager.save(plan);

  return {
    success: true,
    message: `สร้างแผน BL สำเร็จ: ${mpsOrdersToSave.length} orders, ${exceptionsToSave.length} exceptions`,
    plan: {
      id: plan.id,
      targetMonth,
      totalSupplyKg: Math.round(totalSupplyKg),
      totalDemandKg: Math.round(totalDemandKg),
      ordersPlaced: mpsOrdersToSave.length,
      exceptions: exceptionsToSave.length,
      icutCapacityPerDay: MAX_ICUT_HOURS_PER_DAY,
    },
  };
}
