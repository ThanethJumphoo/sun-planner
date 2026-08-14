import { DpsManpower } from './dps-manpower.entity';
import { MasterYield } from './master-yield.entity';
import { MachineConfig } from './machine-config.entity';
import { ProductSpec } from './product-spec.entity';
import { DpsAutoBatchLog } from './dps-auto-batch-log.entity';

import { Controller, Get, Post, Put, Delete, Body, Param, Query, NotFoundException, Res } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, DataSource } from 'typeorm';
import { DpsPlan, DpsSublot, DpsSublotBin, DpsOrder, DpsAllocation } from './dps-plan.entity';









import * as express from 'express';
import * as ExcelJS from 'exceljs';


@Controller('api/dps')
export class DpsController {
  constructor(
    private dataSource: DataSource,
    @InjectRepository(DpsPlan) private planRepo: Repository<DpsPlan>,
    @InjectRepository(DpsSublot) private sublotRepo: Repository<DpsSublot>,
    @InjectRepository(DpsOrder) private orderRepo: Repository<DpsOrder>,
    @InjectRepository(DpsAllocation) private allocationRepo: Repository<DpsAllocation>,
  ) {}

  @Get(':date')
  async getPlanByDate(@Param('date') date: string, @Query('partType') partType: string) {
    const pt = partType || 'fillet';
    const plan = await this.planRepo.findOne({
      where: { productionDate: new Date(date), partType: pt },
      relations: [
        'sublots', 
        'sublots.bins', 
        'orders', 
        'allocations', 
        'allocations.sourceBin', 
        'allocations.sourceBin.sublot',
        'allocations.targetOrder'
      ],
    });
    if (!plan) return { exists: false };
    return { exists: true, data: plan };
  }

  @Delete(':date')
  async deletePlan(@Param('date') date: string, @Query('partType') partType: string) {
    const pt = partType || 'fillet';
    const existing = await this.planRepo.findOne({ where: { productionDate: new Date(date), partType: pt } });
    if (existing) {
      await this.planRepo.remove(existing);
    }
    return { success: true };
  }

  @Post(':date/generate')
  async saveGeneratedPlan(@Param('date') date: string, @Body() payload: any) {
    return await this.dataSource.transaction(async (manager) => {
      const pt = payload.partType || 'fillet';

      // 1. Delete existing if any (to replace) — scoped by partType
      const existing = await manager.findOne(DpsPlan, { where: { productionDate: new Date(date), partType: pt } });
      if (existing) {
        await manager.remove(existing);
      }

      // 2. Map frontend payload to entities
      const plan = manager.create(DpsPlan, {
        productionDate: new Date(date),
        partType: pt,
        status: 'CONFIRMED',
        totalSupplyKg: payload.totalSupplyKg,
        totalDemandKg: payload.totalDemandKg,
        fulfillmentRate: payload.fulfillmentRate,
      });

      // Map sublots
      plan.sublots = payload.sublots.map((sl: any) => {
        const sublot = new DpsSublot();
        sublot.sublotNumber = sl.id.includes('_') ? sl.id.split('_')[0] : sl.id;
        sublot.farmName = sl.farmName;
        sublot.shift = sl.shift || 'A';
        sublot.totalBirds = Math.round(sl.totalBirds);
        sublot.totalWeightKg = Math.round(sl.totalWeightKg);
        sublot.avgLiveWeight = sl.avgLiveWeight;
        sublot.coProductKg = Number((sl.coProductKg || 0).toFixed(1));
        sublot.supportManpower = sl.supportManpower || 0;
        
        sublot.bilManpower = sl.bilManpower === '' || sl.bilManpower == null ? null : Number(sl.bilManpower);
        sublot.bilSpeed = sl.bilSpeed === '' || sl.bilSpeed == null ? null : Number(sl.bilSpeed);
        sublot.bilHours = sl.bilHours === '' || sl.bilHours == null ? null : Number(sl.bilHours);
        sublot.bilPieceWeight = sl.bilPieceWeight === '' || sl.bilPieceWeight == null ? null : Number(sl.bilPieceWeight);

        sublot.bins = Object.keys(sl.bins).map(binKey => {
          const bin = new DpsSublotBin();
          bin.sizeLabel = binKey;
          bin.availableKg = Number((sl.bins[binKey] || 0).toFixed(1));
          return bin;
        });

        return sublot;
      });

      const customIdMap = new Map<string, number>();
      let customCounter = Math.floor(Math.random() * 1000000);

      // Map orders
      plan.orders = payload.orders.map((o: any) => {
        const order = new DpsOrder();
        if (o.id.startsWith('L-CUSTOM-')) {
          order.erpOrderLineId = -(customCounter++);
          customIdMap.set(o.id, order.erpOrderLineId);
        } else {
          order.erpOrderLineId = parseInt(o.id.replace('L-', '')) || 0;
        }
        order.itemCode = o.itemCode;
        order.itemDesc = o.itemDesc;
        order.productType = o.type;
        order.productSize = o.size;
        order.requiredKg = Number(o.qty.toFixed(1));
        order.fulfilledKg = Number(o.fulfilledKg.toFixed(1));
        order.unfulfilledKg = Number(o.unfulfilledKg.toFixed(1));
        return order;
      });

      // Let's save the plan first with sublots and orders, then add allocations.
      const savedPlan = await manager.save(plan);

      // Reload to get IDs
      const reloadedPlan = await manager.findOne(DpsPlan, {
        where: { id: savedPlan.id },
        relations: ['sublots', 'sublots.bins', 'orders'],
      });

      if (!reloadedPlan) return { success: false, message: 'Plan not found after saving' };

      // Build allocations
      const allocationsToSave = [];
      for (const alloc of payload.allocations) {
        const allocSublotNumber = alloc.sublotId.includes('_') ? alloc.sublotId.split('_')[0] : alloc.sublotId;
        const allocShift = alloc.sublotId.includes('_') ? alloc.sublotId.split('_')[1] : null;

        const dbSublot = reloadedPlan.sublots.find(s => {
          if (allocShift) {
            return s.sublotNumber === allocSublotNumber && s.shift === allocShift;
          }
          return s.sublotNumber === allocSublotNumber;
        });
        if (!dbSublot) continue;
        
        const dbBin = dbSublot.bins.find(b => b.sizeLabel === alloc.size);
        const dbOrder = reloadedPlan.orders.find(o => {
          if (alloc.orderId.startsWith('L-CUSTOM-')) {
            return Number(o.erpOrderLineId) === Number(customIdMap.get(alloc.orderId));
          }
          return `L-${o.erpOrderLineId}` === alloc.orderId || `${o.erpOrderLineId}` === alloc.orderId;
        });
        
        if (!dbOrder) continue;

        const newAlloc = manager.create(DpsAllocation, {
          dpsPlan: reloadedPlan,
          sourceBin: dbBin,
          targetOrder: dbOrder,
          allocatedKg: Number(alloc.qty.toFixed(1)),
          allocationPass: 'Auto',
        });
        allocationsToSave.push(newAlloc);
      }

      if (allocationsToSave.length > 0) {
        await manager.save(allocationsToSave);
      }

      return { success: true, planId: savedPlan.id };
    });
  }

  @Get(':date/export')
  async exportPlan(@Param('date') date: string, @Query('partType') partType: string, @Res() res: express.Response) {
    const pt = partType || 'fillet';
    const plan = await this.planRepo.findOne({
      where: { productionDate: new Date(date), partType: pt },
      relations: [
        'sublots', 
        'sublots.bins', 
        'orders', 
        'allocations', 
        'allocations.sourceBin', 
        'allocations.sourceBin.sublot',
        'allocations.targetOrder'
      ],
    });

    if (!plan) {
      return res.status(404).json({ success: false, message: 'Plan not found' });
    }

    const workbook = new ExcelJS.Workbook();


    
    const batchLogs = await this.dataSource.getRepository(DpsAutoBatchLog).find({
      where: { planDate: date, partId: pt, status: 'SUCCESS' },
      order: { createdAt: 'DESC' }
    });
    const batchLogMap = new Map<string, string>();
    for (const log of batchLogs) {
      const displayBatch = log.batchNo || log.batchName;
      if (!batchLogMap.has(log.itemCode?.trim()?.toUpperCase()) && displayBatch) {
        batchLogMap.set(log.itemCode?.trim()?.toUpperCase(), displayBatch);
      }
    }

    let manpowerData: any = null;
    if (pt === 'bil') {
      manpowerData = await this.dataSource.getRepository(DpsManpower).findOne({
        where: { dpsPlan: { id: plan.id } }
      });
    }
    const specs = await this.dataSource.getRepository(ProductSpec).find();
    const specMap = new Map<string, any>();
    specs.forEach((s: any) => {
      if (!s.erpItemCode) return;
      specMap.set(s.erpItemCode.trim(), {
        speed: Number(s.productSpeed) || 45,
        weight: Number(s.productWeight) || 0,
        masterYieldIds: s.masterYieldIds || '',
        itemDesc: s.erpItemDesc || '',
        yield: Number(s.productYield) || 0,
      });
    });

    let yieldNodeTypeMap = new Map<string, string>();
    let bilYieldPct = 0.25;
    let bilProcess1Codes: string[] = [];
    let bilProcess2Codes: string[] = [];
    let machineConfigs: any[] = [];
    let shiftCuttingManpower: Record<string, number> = {};
    let yieldNodeNameMap = new Map<string, string>();

    if (pt === 'fillet') {
      ['A', 'B'].forEach(shift => {
        let shiftPcs = 0;
        plan.allocations.forEach(a => {
          if ((a.sourceBin?.sublot?.shift || 'A').toUpperCase().trim() === shift) {
            const speed = specMap.get(a.targetOrder?.itemCode?.trim() || '')?.speed || 45;
            shiftPcs += Number(a.allocatedKg) / speed;
          }
        });
        shiftCuttingManpower[shift] = Math.ceil(shiftPcs / 9.58);
      });
    }

    if (pt === 'bil') {
      const yields = await this.dataSource.getRepository(MasterYield).find();
      yields.forEach((y: any) => {
        yieldNodeTypeMap.set(y.id, y.type);
        yieldNodeNameMap.set(y.name, y.type);
      });
      const bilLc = yields.find((y: any) => y.name === 'BIL L/C' && y.type === 'CATEGORY');
      if (bilLc) bilYieldPct = Number(bilLc.yieldPercentage) || 0.25;

      const p1Proc = yields.find((y: any) => y.name === 'P1' && y.type === 'PROCESS');
      const p2Proc = yields.find((y: any) => y.name === 'P2' && y.type === 'PROCESS');

      specs.forEach((s: any) => {
        const pIds = (s.masterYieldIds || '').split(',').map((x: string) => x.trim());
        if (p1Proc && pIds.includes(p1Proc.id)) bilProcess1Codes.push(s.erpItemCode);
        if (p2Proc && pIds.includes(p2Proc.id)) bilProcess2Codes.push(s.erpItemCode);
      });

      machineConfigs = await this.dataSource.getRepository(MachineConfig).find();
    }

    const getProductType = (itemCode: string): 'main' | 'coproduct' | 'byproduct' => {
      const spec = specMap.get(itemCode);
      if (!spec) return 'main';
      if (spec.masterYieldIds) {
        const processIds = spec.masterYieldIds.split(',').map((id: any) => id.trim());
        for (const id of processIds) {
          const nodeType = yieldNodeTypeMap.get(id);
          if (nodeType === 'CO-PRODUCT') return 'coproduct';
          if (nodeType === 'BY-PRODUCT') return 'byproduct';
        }
      }
      return 'main';
    };

    const sublotRemainingPieces = new Map<string, number>();
    const shiftTotalPieces = new Map<string, number>();
    const shiftRemainingPiecesMap = new Map<string, number>();
    const shiftDemandP1 = new Map<string, number>();
    const shiftWorkersHoursP1 = new Map<string, number>();
    const shiftWorkersHoursSep = new Map<string, number>();
    const shiftThighPcs = new Map<string, number>();
    const shiftDrumPcs = new Map<string, number>();

    if (pt === 'bil') {
      plan.sublots.forEach(sl => {
        let currentRm = 0;
        let demandP1 = 0;
        let p1Hours = 0;
        let sepHours = 0;
        let thighPcs = 0;
        let drumPcs = 0;

        const slNet = (sl.totalWeightKg || 0) * 0.9575 * 0.95 * bilYieldPct;
        const totalPcs = (sl.totalBirds || 0) * 2;
        const avgPieceWeight = totalPcs > 0 ? slNet / totalPcs : 0.3;

        plan.allocations.filter(a => a.sourceBin?.sublot?.sublotNumber === sl.sublotNumber).forEach(alloc => {
          const itemCode = alloc.targetOrder?.itemCode;
          if (!itemCode) return;
          
          const type = getProductType(itemCode);
          if (type === 'main') {
            currentRm += Number(alloc.allocatedKg);
          }

          if (bilProcess1Codes.includes(itemCode)) {
            demandP1 += Number(alloc.allocatedKg);
            const speed = specMap.get(itemCode)?.speed || 45;
            p1Hours += Number(alloc.allocatedKg) / speed;
          } else if (bilProcess2Codes.includes(itemCode)) {
            const spec = specMap.get(itemCode);
            const speed = spec?.speed || 45;
            const yieldPct = spec?.yield || 0.5;
            const pcs = avgPieceWeight > 0 && yieldPct > 0 ? Number(alloc.allocatedKg) / (avgPieceWeight * yieldPct) : 0;
            const isDrum = spec?.itemDesc.includes('น่อง') && !spec?.itemDesc.includes('สะโพก');
            if (isDrum) drumPcs += pcs;
            else thighPcs += pcs;
            sepHours += Number(alloc.allocatedKg) / speed;
          }
        });

        const initialFg = slNet;
        const debonedRmKg = Math.max(0, initialFg - currentRm);
        const debonedPieces = Math.round(avgPieceWeight > 0 ? debonedRmKg / avgPieceWeight : 0);
        sublotRemainingPieces.set(sl.sublotNumber, debonedPieces);

        const shift = (sl.shift || 'A').toUpperCase();
        shiftTotalPieces.set(shift, (shiftTotalPieces.get(shift) || 0) + totalPcs);
        shiftDemandP1.set(shift, (shiftDemandP1.get(shift) || 0) + demandP1);
        shiftWorkersHoursP1.set(shift, (shiftWorkersHoursP1.get(shift) || 0) + p1Hours);
        shiftWorkersHoursSep.set(shift, (shiftWorkersHoursSep.get(shift) || 0) + sepHours);
        shiftThighPcs.set(shift, (shiftThighPcs.get(shift) || 0) + thighPcs);
        shiftDrumPcs.set(shift, (shiftDrumPcs.get(shift) || 0) + drumPcs);
      });

      ['A', 'B'].forEach(shift => {
        let remainingPieces = shiftTotalPieces.get(shift) || 0;
        const piecesForP1 = (shiftDemandP1.get(shift) || 0) / 0.3;
        remainingPieces = Math.max(0, remainingPieces - piecesForP1);
        const piecesToCutForP2 = Math.max(shiftThighPcs.get(shift) || 0, shiftDrumPcs.get(shift) || 0);
        const actualPiecesCutP2 = Math.min(remainingPieces, piecesToCutForP2);
        remainingPieces = Math.max(0, remainingPieces - actualPiecesCutP2);
        shiftRemainingPiecesMap.set(shift, remainingPieces);
      });
    }

    // Sheet 1: Shift Summary

    const summarySheet = workbook.addWorksheet('Shift Summary');
    
    // Sheet 2: Sublot Breakdown
    const detailSheet = workbook.addWorksheet('Sublot Breakdown');

    // Gather and group allocations
    const shiftSummaries: Record<string, Record<string, {
      itemCode: string;
      itemDesc: string;
      productSize: string;
      qty: number;
    }>> = {};

    const shiftManpower: Record<string, number> = {};
    plan.sublots.forEach(sl => {
      const shift = (sl.shift || 'A').toUpperCase().trim();
      if (!shiftManpower[shift]) shiftManpower[shift] = 0;
      shiftManpower[shift] += Number(sl.supportManpower || 0);
    });

    plan.allocations.forEach(alloc => {
      const sublot = alloc.sourceBin?.sublot;
      const shift = (sublot?.shift || 'A').toUpperCase().trim();
      const order = alloc.targetOrder;
      
      if (!order || order.erpOrderLineId === 9999992) return;
      
      if (!shiftSummaries[shift]) {
        shiftSummaries[shift] = {};
      }
      
      const key = `${order.itemCode}_${order.productSize}`;
      if (!shiftSummaries[shift][key]) {
        shiftSummaries[shift][key] = {
          itemCode: order.itemCode,
          itemDesc: order.itemDesc,
          productSize: order.productSize || '-',
          qty: 0
        };
      }
      shiftSummaries[shift][key].qty += Number(alloc.allocatedKg);
    });

    // Format target date as DD/MM/YYYY
    const formattedDate = new Date(date).toLocaleDateString('th-TH', {
      year: 'numeric',
      month: 'long',
      day: 'numeric'
    });

    // ─── 1. SHIFT SUMMARY SHEET ───
    summarySheet.views = [{ showGridLines: true }];
    
    // Title Banner
    summarySheet.mergeCells('A1:E1');
    const titleCell = summarySheet.getCell('A1');
    titleCell.value = 'รายงานสรุปผลผลิตรายกะ (Daily Shift Production Summary)';
    titleCell.font = { name: 'Segoe UI', size: 16, bold: true, color: { argb: 'FFFFFFFF' } };
    titleCell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF1F497D' } }; // Dark Navy
    titleCell.alignment = { vertical: 'middle', horizontal: 'center' };
    summarySheet.getRow(1).height = 40;

    // Info Section
    summarySheet.getCell('A3').value = 'วันที่ผลิต (Production Date):';
    summarySheet.getCell('A3').font = { bold: true };
    summarySheet.getCell('B3').value = formattedDate;

    summarySheet.getCell('D3').value = 'ประเภทแผน (Part Type):';
    summarySheet.getCell('D3').font = { bold: true };
    summarySheet.getCell('E3').value = pt.toUpperCase();
    
    summarySheet.getRow(3).height = 20;

    // Let's list each shift's summary
    let currentRow = 5;

    // --- DEMAND ORDERS SECTION ---
    summarySheet.getCell(`A${currentRow}`).value = 'แผนความต้องการสินค้า (Demand Orders)';
    summarySheet.getCell(`A${currentRow}`).font = { name: 'Segoe UI', size: 12, bold: true, color: { argb: 'FF1F497D' } };
    currentRow++;

    const demandHeaders = ['รหัสสินค้า (Code)', 'รายละเอียดสินค้า (Description)', 'ขนาด (Size)', 'ความต้องการ (Demand Kg)', 'เติมเต็มแล้ว (Fulfilled Kg)', 'สถานะ'];
    const demandHeaderRow = summarySheet.addRow(demandHeaders);
    demandHeaderRow.height = 20;
    demandHeaderRow.eachCell((cell, colNum) => {
      if (colNum > demandHeaders.length) return;
      cell.font = { name: 'Segoe UI', size: 10, bold: true, color: { argb: 'FFFFFFFF' } };
      cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF1F497D' } }; // Dark Navy
      cell.alignment = { vertical: 'middle', horizontal: 'center' };
      cell.border = { top: { style: 'thin' }, left: { style: 'thin' }, bottom: { style: 'thin' }, right: { style: 'thin' } };
    });
    currentRow++;

    plan.orders.forEach(order => {
      const isManual = order.erpOrderLineId < 0;
      const status = order.fulfilledKg >= order.requiredKg ? 'COMPLETED' : 'PENDING';
      const row = summarySheet.addRow([
        order.itemCode,
        order.itemDesc,
        order.productSize || '-',
        order.requiredKg,
        order.fulfilledKg,
        isManual ? `MANUAL (${status})` : status
      ]);
      row.eachCell((cell, colNum) => {
        if (colNum > demandHeaders.length) return;
        cell.font = { name: 'Segoe UI', size: 10 };
        cell.border = { top: { style: 'thin' }, left: { style: 'thin' }, bottom: { style: 'thin' }, right: { style: 'thin' } };
        if (colNum >= 4 && colNum <= 5) {
          cell.alignment = { vertical: 'middle', horizontal: 'right' };
          cell.numFmt = '#,##0.0';
        } else {
          cell.alignment = { vertical: 'middle', horizontal: 'center' };
        }
      });
      currentRow++;
    });

    currentRow += 2; // Spacing before shifts


    const sortedShifts = Object.keys(shiftSummaries).sort();
    if (sortedShifts.length === 0) {
      summarySheet.getCell(`A${currentRow}`).value = 'ไม่มีข้อมูลการจัดสรรผลผลิต';
      summarySheet.getCell(`A${currentRow}`).font = { italic: true };
    } else {
      sortedShifts.forEach(shift => {
        // Shift Title Row
        summarySheet.mergeCells(`A${currentRow}:E${currentRow}`);
        const shiftHeaderCell = summarySheet.getCell(`A${currentRow}`);
        shiftHeaderCell.value = `กะ ${shift} (Shift ${shift})`;
        shiftHeaderCell.font = { name: 'Segoe UI', size: 12, bold: true, color: { argb: 'FF1F497D' } };
        shiftHeaderCell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFDCE6F1' } }; // Light Slate Blue
        shiftHeaderCell.alignment = { vertical: 'middle', horizontal: 'left' };
        summarySheet.getRow(currentRow).height = 25;
        currentRow++;

        // Table Header
        const headers = ['ลำดับ (No.)', 'รหัสสินค้า (Product Code)', 'รายละเอียดสินค้า (Description)', 'ขนาด (Size)', 'น้ำหนักผลิตรวม (Total Qty - Kg)', 'เลข Batch (Batch No)'];
        const headerRow = summarySheet.addRow(headers);
        headerRow.height = 25;
        headerRow.eachCell((cell) => {
          cell.font = { name: 'Segoe UI', size: 10, bold: true, color: { argb: 'FFFFFFFF' } };
          cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF4F81BD' } }; // Steel Blue
          cell.alignment = { vertical: 'middle', horizontal: 'center' };
          cell.border = { top: { style: 'thin' }, left: { style: 'thin' }, bottom: { style: 'thin' }, right: { style: 'thin' } };
        });
        
        let startDataRow = currentRow + 1;
        let index = 1;
        const items = Object.values(shiftSummaries[shift]);
        items.forEach(item => {
          let cleanDesc = item.itemDesc || '-';
          if (cleanDesc.startsWith(`${item.itemCode} - `)) {
            cleanDesc = cleanDesc.replace(`${item.itemCode} - `, '');
          } else if (cleanDesc === item.itemCode) {
            cleanDesc = '-';
          }
          
          const rowData = [
            index++,
            item.itemCode,
            cleanDesc,
            item.productSize,
            Number(item.qty.toFixed(1)),
            batchLogMap.get(item.itemCode?.trim()?.toUpperCase()) || '-'
          ];
          const dataRow = summarySheet.addRow(rowData);
          dataRow.height = 20;
          dataRow.eachCell((cell, colNum) => {
            cell.font = { name: 'Segoe UI', size: 10 };
            cell.border = { top: { style: 'thin' }, left: { style: 'thin' }, bottom: { style: 'thin' }, right: { style: 'thin' } };
            if (colNum === 1 || colNum === 2 || colNum === 4) {
              cell.alignment = { vertical: 'middle', horizontal: 'center' };
            } else if (colNum === 3) {
              cell.alignment = { vertical: 'middle', horizontal: 'left' };
            } else if (colNum === 5) {
              cell.alignment = { vertical: 'middle', horizontal: 'right' };
              cell.numFmt = '#,##0.0';
            }
          });
          currentRow++;
        });

        // Shift Total Row
        const totalRow = summarySheet.addRow(['รวมกะ ' + shift, '', '', '', { formula: `=SUM(E${startDataRow}:E${currentRow + 1})` }, '']);
        summarySheet.mergeCells(`A${currentRow + 2}:D${currentRow + 2}`);
        totalRow.height = 22;
        totalRow.eachCell({ includeEmpty: true }, (cell, colNum) => {
          if (colNum > 6) return;
          cell.font = { name: 'Segoe UI', size: 10, bold: true };
          cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFF2F2F2' } };
          cell.border = { top: { style: 'thin' }, left: { style: 'thin' }, bottom: { style: 'thin' }, right: { style: 'thin' } };
          if (colNum === 1) {
            cell.alignment = { vertical: 'middle', horizontal: 'right' };
          } else if (colNum === 5) {
            cell.alignment = { vertical: 'middle', horizontal: 'right' };
            cell.numFmt = '#,##0.0';
          }
        });

        currentRow += 3;

        if (pt === 'bil') {
          // Machine Capacity Manpower
          const shiftRemainingMain = plan.sublots
            .filter(sl => (sl.shift || 'A').toUpperCase().trim() === shift)
            .reduce((sum, sl) => sum + sl.bins.reduce((bSum, b) => bSum + Number(b.availableKg || 0), 0), 0);
          
          const shiftTotalBirds = plan.sublots
            .filter(sl => (sl.shift || 'A').toUpperCase().trim() === shift)
            .reduce((sum, sl) => sum + Number(sl.totalBirds || 0), 0);

          const workHours = 9.58;
          const rmBL = shiftRemainingMain * 0.77; 
          const piecesBl = (rmBL / 0.223).toFixed(0); 
          const totalBlPieces = Number(piecesBl) || 0;
          
          const getMachine = (key: string) => machineConfigs.find(m => m.machineKey === key && m.isActive);
          const foodmate = getMachine('auto_foodmate');
          const toridas = getMachine('toridas');
          const manualCutLeg = getMachine('manual_cut_leg');
          const manualScrapeBl = getMachine('manual_scrape_bl');
          const deboneBl = getMachine('manual_debone_bl');
          const xrayBl = getMachine('xray_bl');
          const specCheckBl = getMachine('spec_check_bl');
          const manualNs = getMachine('manual_cut_ns');

          const remainingPieces = totalBlPieces;
          
          const toridasSpeed = toridas?.capacityPcsPerHour || 1500;
          const foodmateSpeed = foodmate?.capacityPcsPerHour || 6000;
          const xraySpeed = xrayBl?.capacityPcsPerHour || 6000;
          
          const piecesPerShift = remainingPieces;

          const toridasCapPerShift = (toridas?.defaultLines || 3) * (toridas?.machinesPerLine || 4) * toridasSpeed * workHours;
          const foodmateCapPerShift = (foodmate?.defaultLines || 1) * (foodmate?.machinesPerLine || 1) * foodmateSpeed * workHours;

          const toridasInputPcsPerShift = Math.min(piecesPerShift, toridasCapPerShift);
          const leftoverPcsPerShift = Math.max(0, piecesPerShift - toridasInputPcsPerShift);
          const foodmateInputPcsPerShift = Math.min(leftoverPcsPerShift, foodmateCapPerShift);
          const manualDebonePcsPerShift = piecesPerShift;

          let toridasPax = 0;
          let toridasLinesNeeded = 0;
          if (toridasInputPcsPerShift > 0) {
            const capPerToridasLine = (toridas?.machinesPerLine || 4) * toridasSpeed * workHours;
            toridasLinesNeeded = Math.ceil(toridasInputPcsPerShift / capPerToridasLine);
            toridasPax = toridasLinesNeeded * (toridas?.workersPerUnit || 5);
          }

          let autoFoodmatePax = 0;
          let foodmateLinesNeeded = 0;
          if (foodmateInputPcsPerShift > 0) {
            const capPerFoodmateLine = (foodmate?.machinesPerLine || 1) * foodmateSpeed * workHours;
            foodmateLinesNeeded = Math.ceil(foodmateInputPcsPerShift / capPerFoodmateLine);
            autoFoodmatePax = foodmateLinesNeeded * (foodmate?.workersPerUnit || 5);
          }

          let deboneBlPax = 0;
          if (manualDebonePcsPerShift > 0) {
            const manualDeboneSpeedHr = deboneBl?.capacityPcsPerHour || (11.5 * 60);
            const deboneWorkHoursPerShift = manualDebonePcsPerShift / manualDeboneSpeedHr;
            deboneBlPax = Math.ceil(deboneWorkHoursPerShift / workHours);
          }

          const cutLegSpeedHr = manualCutLeg?.capacityPcsPerHour || (18 * 60);
          const cutLegWorkHoursPerShift = piecesPerShift / cutLegSpeedHr;
          const cutLegPax = piecesPerShift > 0 ? Math.ceil(cutLegWorkHoursPerShift / workHours) : 0;

          const scrapeSpeedHr = manualScrapeBl?.capacityPcsPerHour || (18 * 60);
          const scrapeWorkHoursPerShift = piecesPerShift / scrapeSpeedHr;
          const scrapeBlPax = piecesPerShift > 0 ? Math.ceil(scrapeWorkHoursPerShift / workHours) : 0;

          const totalDeboneLines = toridasLinesNeeded + foodmateLinesNeeded;
          const specCheckPax = totalDeboneLines > 0 ? totalDeboneLines * (specCheckBl?.workersPerUnit || 2) : 0;

          let xrayPax = 0;
          if (piecesPerShift > 0) {
            const xrayCapPerShift = xraySpeed * workHours;
            const xrayMachinesNeeded = Math.ceil(piecesPerShift / xrayCapPerShift);
            const xrayCount = Math.min(xrayBl?.defaultLines || 3, xrayMachinesNeeded);
            xrayPax = xrayCount * (xrayBl?.workersPerUnit || 2);
          }

          const nsPieces = remainingPieces > 0 ? shiftTotalBirds * 2 : 0; 
          const nsPiecesPerShift = nsPieces;
          const nsSpeedHr = manualNs?.capacityPcsPerHour || (5.5 * 60);
          const nsWorkHoursPerShift = nsPiecesPerShift / nsSpeedHr;
          const nsPax = nsPiecesPerShift > 0 ? Math.ceil(nsWorkHoursPerShift / workHours) : 0;

          const machineRoles = [
            { label: 'กรีดน่องรวม (18 ชิ้น/นาที)', val: cutLegPax },
            { label: 'Auto Debone (Foodmate)', val: autoFoodmatePax },
            { label: 'Debone BL (11.5 ชิ้น/นาที)', val: deboneBlPax },
            { label: 'เครื่อง Toridas', val: toridasPax },
            { label: 'ขูดขน (18 ชิ้น/นาที)', val: scrapeBlPax },
            { label: 'ตรวจ spec BL', val: specCheckPax },
            { label: 'X-ray BL', val: xrayPax },
            { label: 'ทำ นส. (5.5 ชิ้น/นาที)', val: nsPax },
          ];

          summarySheet.addRow([]); // Blank row
          currentRow++;
          const machineTitle = summarySheet.addRow(['จำนวนคนตาม Capacity เครื่อง / กะ ' + shift, '', '', '', '', '']);
          summarySheet.mergeCells(`A${currentRow}:D${currentRow}`);
          machineTitle.height = 22;
          machineTitle.eachCell({ includeEmpty: true }, (cell, colNum) => {
            if (colNum > 6) return;
            cell.font = { name: 'Segoe UI', size: 10, bold: true, color: { argb: 'FF0000FF' } }; // Blue
            cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFE6F2FF' } }; // Light Blue
            cell.border = { top: { style: 'thin' }, left: { style: 'thin' }, bottom: { style: 'thin' }, right: { style: 'thin' } };
          });
          currentRow++;

          machineRoles.forEach((role, idx) => {
            const machineRow = summarySheet.addRow([role.label, '', '', '', role.val, 'คน']);
            summarySheet.mergeCells(`A${currentRow}:D${currentRow}`);
            machineRow.height = 22;
            machineRow.eachCell({ includeEmpty: true }, (cell, colNum) => {
              if (colNum > 6) return;
              cell.font = { name: 'Segoe UI', size: 10, bold: true, color: { argb: 'FF0000FF' } };
              cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFF5F8FF' } };
              const isLast = idx === machineRoles.length - 1;
              cell.border = { top: { style: 'thin' }, left: { style: 'thin' }, bottom: { style: isLast ? 'double' : 'thin' }, right: { style: 'thin' } };
              if (colNum === 1) cell.alignment = { vertical: 'middle', horizontal: 'right' };
              else if (colNum === 5) { cell.alignment = { vertical: 'middle', horizontal: 'right' }; cell.numFmt = '#,##0'; }
              else if (colNum === 6) { cell.alignment = { vertical: 'middle', horizontal: 'center' }; }
            });
            currentRow++;
          });

          summarySheet.addRow([]); // Blank row
          currentRow++;

          // Support Manpower Row
          const supportRoles = [
            { label: 'บริการจุดงาน BL A+B', val: Math.ceil((manpowerData?.serviceBlPax || 13) / 2) },
            { label: 'IN+บริการจุดงาน LJ+ชั่งกระดูก+...', val: Math.ceil((manpowerData?.inServiceLjPax || 4) / 2) },
            { label: 'บริการ นส.+IN (2+2)', val: Math.ceil((manpowerData?.serviceNsInPax || 8) / 2) },
            { label: 'EN=IN+ข้อสั้น+หนัง', val: Math.ceil((manpowerData?.enInShortSkinPax || 6) / 2) },
            { label: 'ขาหัก+Deboneมือ+เศษBL', val: Math.ceil((manpowerData?.brokenLegDebonePax || 2) / 2) },
            { label: 'RM+เดินยอด (3+1)*2', val: Math.ceil((manpowerData?.rmWalkPax || 7) / 2) },
            { label: 'อนามัย+สวมถุง+ล้างมีด+ฯลฯ', val: Math.ceil((manpowerData?.hygienePax || 17) / 2) },
            { label: 'เอกสาร+erp', val: Math.ceil((manpowerData?.erpDocPax || 4) / 2) },
          ];

          supportRoles.forEach((role, idx) => {
            const supportRow = summarySheet.addRow([`${role.label} / กะ ` + shift, '', '', '', role.val, '']);
            summarySheet.mergeCells(`A${currentRow}:D${currentRow}`);
            supportRow.height = 22;
            supportRow.eachCell({ includeEmpty: true }, (cell, colNum) => {
              if (colNum > 6) return;
              cell.font = { name: 'Segoe UI', size: 10, bold: true, color: { argb: 'FF800080' } };
              cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFFDF3F9' } };
              const isLast = idx === supportRoles.length - 1;
              cell.border = { top: { style: 'thin' }, left: { style: 'thin' }, bottom: { style: isLast ? 'double' : 'thin' }, right: { style: 'thin' } };
              if (colNum === 1) cell.alignment = { vertical: 'middle', horizontal: 'right' };
              else if (colNum === 5) { cell.alignment = { vertical: 'middle', horizontal: 'right' }; cell.numFmt = '#,##0'; }
            });
            currentRow++;
          });
        } else {
          // Trimming Manpower (Fillet specific)
          const trimRow = summarySheet.addRow(['จำนวนคนตัดแต่ง (Trimming Manpower) / กะ ' + shift, '', '', '', shiftCuttingManpower[shift] || 0, '']);
          summarySheet.mergeCells(`A${currentRow}:D${currentRow}`);
          trimRow.height = 22;
          trimRow.eachCell({ includeEmpty: true }, (cell, colNum) => {
            if (colNum > 6) return;
            cell.font = { name: 'Segoe UI', size: 10, bold: true, color: { argb: 'FF0000FF' } }; // Blue
            cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFE6F2FF' } }; // Light Blue
            cell.border = { top: { style: 'thin' }, left: { style: 'thin' }, bottom: { style: 'thin' }, right: { style: 'thin' } };
            if (colNum === 1) cell.alignment = { vertical: 'middle', horizontal: 'right' };
            else if (colNum === 5) { cell.alignment = { vertical: 'middle', horizontal: 'right' }; cell.numFmt = '#,##0'; }
          });
          currentRow++;

          const supportRow = summarySheet.addRow(['จำนวนคนบริการ (Support Manpower) / กะ ' + shift, '', '', '', shiftManpower[shift] || 0, '']);
          summarySheet.mergeCells(`A${currentRow}:D${currentRow}`);
          supportRow.height = 22;
          supportRow.eachCell({ includeEmpty: true }, (cell, colNum) => {
            if (colNum > 6) return;
            cell.font = { name: 'Segoe UI', size: 10, bold: true, color: { argb: 'FF800080' } }; // Purple
            cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFFDF3F9' } }; // Light Purple
            cell.border = { top: { style: 'thin' }, left: { style: 'thin' }, bottom: { style: 'double' }, right: { style: 'thin' } };
            if (colNum === 1) {
              cell.alignment = { vertical: 'middle', horizontal: 'right' };
            } else if (colNum === 5) {
              cell.alignment = { vertical: 'middle', horizontal: 'right' };
              cell.numFmt = '#,##0';
            }
          });
          currentRow++;
        }
        
        currentRow += 2; // Add spacing before next shift
      });
    }

    // Auto-fit columns for Shift Summary sheet
    if (summarySheet.columns) {
      summarySheet.columns.forEach(column => {
        if (column && column.eachCell) {
          let maxLen = 10;
          column.eachCell({ includeEmpty: true }, cell => {
            const val = cell.value ? cell.value.toString() : '';
            if (val.length > maxLen) maxLen = val.length;
          });
          column.width = Math.min(Math.max(maxLen + 3, 12), 40);
        }
      });
    }

    // ─── 2. SUBLOT BREAKDOWN SHEET ───
    detailSheet.views = [{ showGridLines: true }];
    
    // Title Banner
    detailSheet.mergeCells('A1:H1');
    const titleCell2 = detailSheet.getCell('A1');
    titleCell2.value = 'รายละเอียดการผลิตแยกรายซับลอต (Daily Sublot Production Details)';
    titleCell2.font = { name: 'Segoe UI', size: 16, bold: true, color: { argb: 'FFFFFFFF' } };
    titleCell2.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF1F497D' } }; // Dark Navy
    titleCell2.alignment = { vertical: 'middle', horizontal: 'center' };
    detailSheet.getRow(1).height = 40;

    // Info Section
    detailSheet.getCell('A3').value = 'วันที่ผลิต (Production Date):';
    detailSheet.getCell('A3').font = { bold: true };
    detailSheet.getCell('B3').value = formattedDate;

    detailSheet.getCell('F3').value = 'ประเภทแผน (Part Type):';
    detailSheet.getCell('F3').font = { bold: true };
    detailSheet.getCell('G3').value = pt.toUpperCase();
    
    detailSheet.getRow(3).height = 20;

    // Section 1: Incoming Sublots
    detailSheet.getCell('A5').value = '1. รายการวัตถุดิบไก่เข้าแยกรายซับลอต (Raw Material Incoming)';
    detailSheet.getCell('A5').font = { name: 'Segoe UI', size: 12, bold: true, color: { argb: 'FF1F497D' } };
    
    const rmHeaders = ['ลำดับ', 'ซับลอต', 'ชื่อฟาร์ม', 'กะ', 'จำนวนตัว (Birds)', 'น้ำหนักเฉลี่ย (Avg Wt)', 'น้ำหนักรวม (RM Wt)', 'ยอด Grade B (Co-product)'];
    if (pt === 'bil') {
      rmHeaders.push('เนื้อเหลือดีโบน (Est. Rem - Pcs)');
    }
    const rmHeaderRow = detailSheet.addRow(rmHeaders);
    rmHeaderRow.height = 25;
    rmHeaderRow.eachCell({ includeEmpty: true }, (cell, colNum) => {
      if (colNum > rmHeaders.length) return;
      cell.font = { name: 'Segoe UI', size: 10, bold: true, color: { argb: 'FFFFFFFF' } };
      cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF5B9BD5' } }; // Soft Blue
      cell.alignment = { vertical: 'middle', horizontal: 'center' };
      cell.border = { top: { style: 'thin' }, left: { style: 'thin' }, bottom: { style: 'thin' }, right: { style: 'thin' } };
    });

    let startRmRow = 7;
    let rmIdx = 1;
    plan.sublots.forEach(sl => {
      if (!sl.totalBirds && !sl.totalWeightKg) return; // Skip cloned remainder sublots that have 0 intake

      const rowData = [
        rmIdx++,
        sl.sublotNumber || '-',
        sl.farmName || '-',
        (sl.shift || 'A').toUpperCase(),
        Number(sl.totalBirds || 0),
        Number(sl.avgLiveWeight || 0),
        Number(sl.totalWeightKg || 0),
        Number(sl.coProductKg || 0)
      ];

      if (pt === 'bil') {
        let remainingMainKg = 0;
        if (sl.bins) {
          sl.bins.forEach(b => {
            const t = yieldNodeNameMap.get(b.sizeLabel);
            if (t === 'MAIN' || !t) {
              remainingMainKg += Number(b.availableKg || 0);
            }
          });
        }
        let estRemPcs = 0;
        const avgW = Number(sl.avgLiveWeight || 0);
        const toridasY = Number(sl.bilManpower || 77) / 100;
        const blY = Number(sl.bilPieceWeight || 0.09);
        if (avgW > 0 && blY > 0) {
          estRemPcs = (remainingMainKg * toridasY) / avgW / blY;
        }
        rowData.push(Math.round(estRemPcs));
      }

      const row = detailSheet.addRow(rowData);
      row.height = 20;
      row.eachCell((cell, colNum) => {
        cell.font = { name: 'Segoe UI', size: 10 };
        cell.border = { top: { style: 'thin' }, left: { style: 'thin' }, bottom: { style: 'thin' }, right: { style: 'thin' } };
        if (colNum <= 4) {
          cell.alignment = { vertical: 'middle', horizontal: 'center' };
        } else if (colNum === 5) {
          cell.alignment = { vertical: 'middle', horizontal: 'right' };
          cell.numFmt = '#,##0';
        } else if (colNum === 6) {
          cell.alignment = { vertical: 'middle', horizontal: 'right' };
          cell.numFmt = '0.0000';
        } else if (colNum === 7 || colNum === 8) {
          cell.alignment = { vertical: 'middle', horizontal: 'right' };
          cell.numFmt = '#,##0.0';
        }
      });
    });

    let currentDetailRow = startRmRow + plan.sublots.length + 2;

    // Section 2: Detailed Allocations by Sublot
    detailSheet.getCell(`A${currentDetailRow}`).value = '2. รายละเอียดการจัดสรรผลผลิตรายซับลอต (Production Allocation Details)';
    detailSheet.getCell(`A${currentDetailRow}`).font = { name: 'Segoe UI', size: 12, bold: true, color: { argb: 'FF1F497D' } };
    currentDetailRow++;

    const allocHeaders = ['ซับลอต', 'ชื่อฟาร์ม', 'กะ', 'รหัสสินค้า (Code)', 'รายละเอียดสินค้า (Description)', 'ขนาด (Size)', 'น้ำหนักจัดสรร (Allocated - Kg)', 'วิธีการจัดสรร (Pass)', 'ขนาดถุง (Bag Size - Kg)', 'จำนวนถุง (Bags)'];
    
    // We add row manually
    const allocHeaderRow = detailSheet.insertRow(currentDetailRow, allocHeaders);
    allocHeaderRow.height = 25;
    allocHeaderRow.eachCell({ includeEmpty: true }, (cell, colNum) => {
      if (colNum > allocHeaders.length) return;
      cell.font = { name: 'Segoe UI', size: 10, bold: true, color: { argb: 'FFFFFFFF' } };
      cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF4F81BD' } }; // Steel Blue
      cell.alignment = { vertical: 'middle', horizontal: 'center' };
      cell.border = { top: { style: 'thin' }, left: { style: 'thin' }, bottom: { style: 'thin' }, right: { style: 'thin' } };
    });
    currentDetailRow++;

    const allocMap = new Map<string, any>();
    plan.allocations.forEach(alloc => {
      const sublot = alloc.sourceBin?.sublot;
      const order = alloc.targetOrder;
      if (!sublot || !order) return;

      const key = `${sublot.sublotNumber}_${order.itemCode}`;
      if (!allocMap.has(key)) {
        let cleanDesc = order.itemDesc || '-';
        if (cleanDesc.startsWith(`${order.itemCode} - `)) {
          cleanDesc = cleanDesc.replace(`${order.itemCode} - `, '');
        } else if (cleanDesc === order.itemCode) {
          cleanDesc = '-';
        }

        allocMap.set(key, {
          sublotNumber: sublot.sublotNumber || '-',
          farmName: sublot.farmName || '-',
          shift: (sublot.shift || 'A').toUpperCase(),
          itemCode: order.itemCode,
          itemDesc: cleanDesc,
          productSize: order.productSize || '-',
          allocatedKg: 0,
          allocationPass: alloc.allocationPass || 'Auto'
        });
      }
      allocMap.get(key).allocatedKg += Number(alloc.allocatedKg);
    });

    const groupedAllocs = Array.from(allocMap.values());
    groupedAllocs.sort((a, b) => {
      const sA = a.sublotNumber;
      const sB = b.sublotNumber;
      return sA.localeCompare(sB, undefined, { numeric: true });
    }).forEach(alloc => {
      const weight = specMap.get(alloc.itemCode)?.weight || 0;
      const bags = weight > 0 ? Math.ceil(alloc.allocatedKg / weight) : 0;
      const bagSizeStr = weight > 0 ? weight.toString() : '-';

      const row = detailSheet.addRow([
        alloc.sublotNumber,
        alloc.farmName,
        alloc.shift,
        alloc.itemCode,
        alloc.itemDesc,
        alloc.productSize,
        alloc.allocatedKg,
        alloc.allocationPass,
        bagSizeStr,
        bags
      ]);
      row.height = 20;
      row.eachCell((cell, colNum) => {
        cell.font = { name: 'Segoe UI', size: 10 };
        cell.border = { top: { style: 'thin' }, left: { style: 'thin' }, bottom: { style: 'thin' }, right: { style: 'thin' } };
        if (colNum === 1 || colNum === 3 || colNum === 4 || colNum === 6 || colNum === 8) {
          cell.alignment = { vertical: 'middle', horizontal: 'center' };
        } else if (colNum === 2 || colNum === 5) {
          cell.alignment = { vertical: 'middle', horizontal: 'left' };
        } else if (colNum === 7) {
          cell.alignment = { vertical: 'middle', horizontal: 'right' };
          cell.numFmt = '#,##0.0';
        }
      });
      currentDetailRow++;
    });

    // Auto-fit columns for Sublot Breakdown sheet
    if (detailSheet.columns) {
      detailSheet.columns.forEach(column => {
        if (column && column.eachCell) {
          let maxLen = 10;
          column.eachCell({ includeEmpty: true }, cell => {
            const val = cell.value ? cell.value.toString() : '';
            if (val.length > maxLen) maxLen = val.length;
          });
          column.width = Math.min(Math.max(maxLen + 3, 12), 40);
        }
      });
    }

    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', `attachment; filename=DPS_Plan_${date}_${pt}.xlsx`);

    await workbook.xlsx.write(res);
    res.end();
  }
}

