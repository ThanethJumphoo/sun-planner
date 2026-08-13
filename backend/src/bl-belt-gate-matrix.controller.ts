import { Controller, Get, Post, Body } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { BlBeltGateMatrix } from './bl-belt-gate-matrix.entity';

@Controller('api/bl-belt-gate-matrix')
export class BlBeltGateMatrixController {
  constructor(
    @InjectRepository(BlBeltGateMatrix)
    private readonly matrixRepo: Repository<BlBeltGateMatrix>,
  ) {}

  @Get()
  async getAll() {
    return this.matrixRepo.find({
      order: { targetProduct: 'ASC', priority: 'ASC' },
    });
  }

  @Post()
  async saveAll(@Body() body: { data: Partial<BlBeltGateMatrix>[] }) {
    if (!body.data || !Array.isArray(body.data)) {
      return { success: false, message: 'Invalid data format' };
    }

    // Simple replace all for matrix
    await this.matrixRepo.clear();
    const toSave = body.data.map((item) =>
      this.matrixRepo.create({
        targetProduct: item.targetProduct,
        priority: Number(item.priority),
        rmSize: item.rmSize,
        yieldPct: Number(item.yieldPct),
      }),
    );
    await this.matrixRepo.save(toSave);
    return {
      success: true,
      message: 'Matrix saved successfully',
      count: toSave.length,
    };
  }
}
