import { Controller, Get, Post, Body, Param } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { BlDpsPlan, BlDpsBeltGate, BlDpsConveyorIcut } from './bl-dps-plan.entity';

@Controller('api/bl-dps')
export class BlDpsController {
  constructor(
    @InjectRepository(BlDpsPlan)
    private blDpsPlanRepo: Repository<BlDpsPlan>,
    @InjectRepository(BlDpsBeltGate)
    private blDpsBeltGateRepo: Repository<BlDpsBeltGate>,
    @InjectRepository(BlDpsConveyorIcut)
    private blDpsConveyorIcutRepo: Repository<BlDpsConveyorIcut>,
  ) {}

  @Get(':date')
  async getPlanByDate(@Param('date') date: string) {
    const plans = await this.blDpsPlanRepo.find({
      where: { planDate: new Date(date) },
      relations: ['beltGates', 'conveyors'],
    });

    if (!plans || plans.length === 0) {
      return [];
    }

    // Map back to frontend structure
    return plans.map(plan => {
      return {
        id: plan.sublot,
        shift: plan.shift,
        startTime: plan.startTime,
        breakTime: plan.breakTime,
        breakDuration: plan.breakDuration,
        workHours: plan.workHours,
        chickenWeight: Number(plan.chickenWeight),
        blUntrimmed: Number(plan.blUntrimmed),
        blTrimmed: Number(plan.blTrimmed),
        beltGateItems: plan.beltGates.map(bg => ({
          bin: bg.bin,
          targetWeight: bg.targetWeight,
          pctSize: Number(bg.pctSize),
          code: bg.code,
          name: bg.name,
          size: bg.size,
          qty: Number(bg.qty),
          chickenWeight: Number(bg.chickenWeight),
          speed: Number(bg.speed),
          sortingTime: Number(bg.sortingTime),
          rm: Number(bg.rm),
          fgTarget: Number(bg.fgTarget),
          diff1: Number(bg.diff1),
          fgRmBl: Number(bg.fgRmBl),
          fgRmBlk: Number(bg.fgRmBlk),
          diff2: Number(bg.diff2),
        })).sort((a, b) => a.bin - b.bin),
        conveyorItems: plan.conveyors.filter(c => c.section === 'conveyor').map(c => ({
          sublot: plan.sublot,
          position: c.position,
          itemCode: c.itemCode,
          itemDesc: c.itemDesc,
          workers: c.workers,
          speed: Number(c.speed),
          pctYield: Number(c.pctYield),
          pctScrapBl: Number(c.pctScrapBl),
          pctSblB: Number(c.pctSblB),
          pctBlB: Number(c.pctBlB),
          pctSkin: Number(c.pctSkin),
          pctScrapBl2: Number(c.pctScrapBl2),
          pctDrum: Number(c.pctDrum),
          cutTime: Number(c.cutTime),
          yieldKg: Number(c.yieldKg),
          scrapBlKg: Number(c.scrapBlKg),
          sblBKg: Number(c.sblBKg),
          blBKg: Number(c.blBKg),
          skinKg: Number(c.skinKg),
          scrapBl2Kg: Number(c.scrapBl2Kg),
          drumKg: Number(c.drumKg),
          rmKg: Number(c.rmKg),
          rmUsedKg: Number(c.rmUsedKg),
          rmType: c.rmType,
        })),
        icutItems: plan.conveyors.filter(c => c.section === 'icut').map(c => ({
          sublot: plan.sublot,
          position: c.position,
          itemCode: c.itemCode,
          itemDesc: c.itemDesc,
          workers: c.workers,
          speed: Number(c.speed),
          pctYield: Number(c.pctYield),
          pctScrapBl: Number(c.pctScrapBl),
          pctSblB: Number(c.pctSblB),
          pctBlB: Number(c.pctBlB),
          pctSkin: Number(c.pctSkin),
          pctScrapBl2: Number(c.pctScrapBl2),
          pctDrum: Number(c.pctDrum),
          cutTime: Number(c.cutTime),
          yieldKg: Number(c.yieldKg),
          scrapBlKg: Number(c.scrapBlKg),
          sblBKg: Number(c.sblBKg),
          blBKg: Number(c.blBKg),
          skinKg: Number(c.skinKg),
          scrapBl2Kg: Number(c.scrapBl2Kg),
          drumKg: Number(c.drumKg),
          rmKg: Number(c.rmKg),
          rmUsedKg: Number(c.rmUsedKg),
          rmType: c.rmType,
        })),
      };
    });
  }

  @Post('save')
  async savePlan(@Body() body: { targetDate: string; sublots: any[] }) {
    const { targetDate, sublots } = body;
    if (!targetDate || !sublots) return { success: false, message: 'Invalid payload' };

    // Find and remove existing plans for this date (Full Overwrite)
    const existingPlans = await this.blDpsPlanRepo.find({
      where: { planDate: new Date(targetDate) }
    });
    
    if (existingPlans.length > 0) {
      await this.blDpsPlanRepo.remove(existingPlans);
    }

    // Insert new plans
    for (const sublot of sublots) {
      const plan = new BlDpsPlan();
      plan.planDate = new Date(targetDate);
      plan.sublot = sublot.id;
      plan.shift = sublot.shift;
      plan.startTime = sublot.startTime;
      plan.breakTime = sublot.breakTime;
      plan.breakDuration = sublot.breakDuration || 60;
      plan.workHours = sublot.workHours || 8;
      plan.chickenWeight = sublot.chickenWeight || 0;
      plan.blUntrimmed = sublot.blUntrimmed || 0;
      plan.blTrimmed = sublot.blTrimmed || 0;

      plan.beltGates = [];
      if (sublot.beltGateItems) {
        for (const bg of sublot.beltGateItems) {
          const bgEntity = new BlDpsBeltGate();
          bgEntity.bin = bg.bin;
          bgEntity.targetWeight = bg.targetWeight;
          bgEntity.pctSize = bg.pctSize || 0;
          bgEntity.code = bg.code;
          bgEntity.name = bg.name;
          bgEntity.size = bg.size;
          bgEntity.qty = bg.qty || 0;
          bgEntity.chickenWeight = bg.chickenWeight || 0;
          bgEntity.speed = bg.speed || 0;
          bgEntity.sortingTime = bg.sortingTime || 0;
          bgEntity.rm = bg.rm || 0;
          bgEntity.fgTarget = bg.fgTarget || 0;
          bgEntity.diff1 = bg.diff1 || 0;
          bgEntity.fgRmBl = bg.fgRmBl || 0;
          bgEntity.fgRmBlk = bg.fgRmBlk || 0;
          bgEntity.diff2 = bg.diff2 || 0;
          plan.beltGates.push(bgEntity);
        }
      }

      plan.conveyors = [];
      
      const mapConveyor = (item: any, section: string) => {
        const cEntity = new BlDpsConveyorIcut();
        cEntity.section = section;
        cEntity.position = item.position;
        cEntity.itemCode = item.itemCode;
        cEntity.itemDesc = item.itemDesc;
        cEntity.workers = item.workers || 0;
        cEntity.speed = item.speed || 0;
        cEntity.pctYield = item.pctYield || 0;
        cEntity.pctScrapBl = item.pctScrapBl || 0;
        cEntity.pctSblB = item.pctSblB || 0;
        cEntity.pctBlB = item.pctBlB || 0;
        cEntity.pctSkin = item.pctSkin || 0;
        cEntity.pctScrapBl2 = item.pctScrapBl2 || 0;
        cEntity.pctDrum = item.pctDrum || 0;
        cEntity.cutTime = item.cutTime || 0;
        cEntity.yieldKg = item.yieldKg || 0;
        cEntity.scrapBlKg = item.scrapBlKg || 0;
        cEntity.sblBKg = item.sblBKg || 0;
        cEntity.blBKg = item.blBKg || 0;
        cEntity.skinKg = item.skinKg || 0;
        cEntity.scrapBl2Kg = item.scrapBl2Kg || 0;
        cEntity.drumKg = item.drumKg || 0;
        cEntity.rmKg = item.rmKg || 0;
        cEntity.rmUsedKg = item.rmUsedKg || 0;
        cEntity.rmType = item.rmType;
        return cEntity;
      };

      if (sublot.conveyorItems) {
        for (const c of sublot.conveyorItems) {
          plan.conveyors.push(mapConveyor(c, 'conveyor'));
        }
      }

      if (sublot.icutItems) {
        for (const i of sublot.icutItems) {
          plan.conveyors.push(mapConveyor(i, 'icut'));
        }
      }

      await this.blDpsPlanRepo.save(plan);
    }

    return { success: true, message: 'Plan saved successfully' };
  }
}
