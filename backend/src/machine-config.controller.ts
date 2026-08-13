import { Controller, Get, Post, Body, Param } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { MachineConfig } from './machine-config.entity';

@Controller('api/machine-config')
export class MachineConfigController {
  constructor(
    @InjectRepository(MachineConfig)
    private readonly configRepo: Repository<MachineConfig>,
  ) {}

  @Get()
  async getAllConfigs() {
    return this.configRepo.find({ order: { id: 'ASC' } });
  }

  @Post('seed')
  async seedInitialData() {
    const defaultConfigs = [
      {
        machineKey: 'toridas',
        machineName: 'Toridas Machine',
        machineType: 'DEBONE',
        capacityPcsPerHour: 1500,
        yieldPercentage: 0.75,
        defaultLines: 3,
        machinesPerLine: 4,
        workersPerUnit: 28, // Using the Excel reference "28 people for 12 machines"
        isActive: true,
      },
      {
        machineKey: 'auto_foodmate',
        machineName: 'Auto Foodmate',
        machineType: 'DEBONE',
        capacityPcsPerHour: 6000,
        yieldPercentage: 0.7,
        defaultLines: 1,
        machinesPerLine: 2,
        workersPerUnit: 7, // 7 pax per machine
        isActive: true,
      },
      {
        machineKey: 'xray_bl',
        machineName: 'X-Ray BL',
        machineType: 'XRAY',
        capacityPcsPerHour: 6000,
        yieldPercentage: 1.0,
        defaultLines: 6, // 6 machines
        machinesPerLine: 1,
        workersPerUnit: 4, // 4 pax per machine
        isActive: true,
      },
      {
        machineKey: 'manual_cut_leg',
        machineName: 'จุดกรีดน่อง (Manual)',
        machineType: 'MANUAL_STATION',
        capacityPcsPerHour: 1080, // 18 pcs/min = 1080 pcs/hr
        yieldPercentage: 1.0,
        defaultLines: 1,
        machinesPerLine: 1,
        workersPerUnit: 1,
        isActive: true,
      },
      {
        machineKey: 'manual_debone_bl',
        machineName: 'จุด Debone BL (Manual)',
        machineType: 'MANUAL_STATION',
        capacityPcsPerHour: 690, // 11.5 pcs/min = 690 pcs/hr
        yieldPercentage: 1.0,
        defaultLines: 1,
        machinesPerLine: 1,
        workersPerUnit: 1,
        isActive: true,
      },
      {
        machineKey: 'manual_scrape_bl',
        machineName: 'จุดขูดขน BL (Manual)',
        machineType: 'MANUAL_STATION',
        capacityPcsPerHour: 1080, // 18 pcs/min = 1080 pcs/hr
        yieldPercentage: 1.0,
        defaultLines: 1,
        machinesPerLine: 1,
        workersPerUnit: 1,
        isActive: true,
      },
      {
        machineKey: 'spec_check_bl',
        machineName: 'ตรวจ Spec BL',
        machineType: 'MANUAL_STATION',
        capacityPcsPerHour: 6000, // unlimited effectively, just based on belts
        yieldPercentage: 1.0,
        defaultLines: 5, // 5 belts
        machinesPerLine: 1,
        workersPerUnit: 2, // 2 pax per belt
        isActive: true,
      },
      {
        machineKey: 'manual_cut_ns',
        machineName: 'จุดทำ นส.',
        machineType: 'MANUAL_STATION',
        capacityPcsPerHour: 330, // 5.5 pcs/min = 330 pcs/hr
        yieldPercentage: 1.0,
        defaultLines: 1,
        machinesPerLine: 1,
        workersPerUnit: 1,
        isActive: true,
      },
      {
        machineKey: 'icut',
        machineName: 'I-CUT Machine',
        machineType: 'BL_PROCESSING',
        capacityPcsPerHour: 1250, 
        yieldPercentage: 0.95,
        defaultLines: 1,
        machinesPerLine: 1,
        workersPerUnit: 2,
        isActive: true,
      }
    ];

    let addedCount = 0;
    for (const conf of defaultConfigs) {
      const exists = await this.configRepo.findOne({
        where: { machineKey: conf.machineKey },
      });
      if (!exists) {
        await this.configRepo.save(this.configRepo.create(conf));
        addedCount++;
      }
    }
    return { success: true, message: `Seeded ${addedCount} machine configs.` };
  }

  @Post(':id/update')
  async updateConfig(@Param('id') id: number, @Body() body: any) {
    const config = await this.configRepo.findOne({ where: { id } });
    if (!config) return { success: false, message: 'Config not found' };

    if (body.capacityPcsPerHour !== undefined)
      config.capacityPcsPerHour = Number(body.capacityPcsPerHour);
    if (body.yieldPercentage !== undefined)
      config.yieldPercentage = Number(body.yieldPercentage);
    if (body.defaultLines !== undefined)
      config.defaultLines = Number(body.defaultLines);
    if (body.machinesPerLine !== undefined)
      config.machinesPerLine = Number(body.machinesPerLine);
    if (body.workersPerUnit !== undefined)
      config.workersPerUnit = Number(body.workersPerUnit);
    if (body.isActive !== undefined) config.isActive = Boolean(body.isActive);

    await this.configRepo.save(config);
    return { success: true, data: config };
  }
}
