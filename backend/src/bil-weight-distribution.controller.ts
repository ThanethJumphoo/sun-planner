import { Controller, Get, Post, Body } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { BilWeightDistribution } from './bil-weight-distribution.entity';

@Controller('api/bil-weight-distribution')
export class BilWeightDistributionController {
  constructor(
    @InjectRepository(BilWeightDistribution)
    private wdRepo: Repository<BilWeightDistribution>,
  ) {}

  // ─── Get all distribution data (returns matrix-friendly structure) ───
  @Get()
  async getAll() {
    const rows = await this.wdRepo.find({
      order: { rowLabel: 'ASC', colLabel: 'ASC' },
    });

    // Build matrix structure for frontend
    const rowLabels = [...new Set(rows.map((r) => r.rowLabel))];
    const colLabels = [...new Set(rows.map((r) => r.colLabel))];
    const matrix: Record<string, Record<string, number>> = {};
    const blColLabelsMap: Record<string, string> = {};

    for (const r of rows) {
      if (!matrix[r.rowLabel]) matrix[r.rowLabel] = {};
      matrix[r.rowLabel][r.colLabel] = Number(r.distValue);
      if (r.blColLabel && !blColLabelsMap[r.colLabel]) {
        blColLabelsMap[r.colLabel] = r.blColLabel;
      }
    }

    return {
      rowLabels,
      colLabels,
      blColLabelsMap,
      matrix,
      totalRecords: rows.length,
    };
  }

  // ─── Bulk save (Delete all & re-insert) ───
  @Post('bulk-save')
  async bulkSave(
    @Body()
    body: {
      rowLabels: string[];
      colLabels: string[];
      blColLabelsMap?: Record<string, string>;
      matrix: Record<string, Record<string, number>>;
    },
  ) {
    // 1. Delete all existing records
    await this.wdRepo.clear();

    // 2. Flatten matrix and insert
    const entities: BilWeightDistribution[] = [];
    for (const rowLabel of body.rowLabels) {
      for (const colLabel of body.colLabels) {
        const val = body.matrix?.[rowLabel]?.[colLabel] ?? 0;
        const blColLabel = body.blColLabelsMap?.[colLabel] || undefined;
        const entity = this.wdRepo.create({
          rowLabel,
          colLabel,
          blColLabel,
          distValue: val,
        });
        entities.push(entity);
      }
    }

    const saved = await this.wdRepo.save(entities, { chunk: 100 });
    return { success: true, count: saved.length };
  }
}
