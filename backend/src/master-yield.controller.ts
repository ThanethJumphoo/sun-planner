import {
  Controller,
  Get,
  Post,
  Put,
  Delete,
  Body,
  Param,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, IsNull } from 'typeorm';
import { MasterYield } from './master-yield.entity';
import { ProductSpec } from './product-spec.entity';

@Controller('api/master-yield')
export class MasterYieldController {
  constructor(
    @InjectRepository(MasterYield)
    private readonly masterYieldRepository: Repository<MasterYield>,
    @InjectRepository(ProductSpec)
    private readonly productSpecRepository: Repository<ProductSpec>,
  ) {}

  @Get()
  async getTree() {
    return this.masterYieldRepository.find({
      relations: [
        'children',
        'children.children',
        'children.children.children',
      ],
      where: { parentId: IsNull() },
      order: { createdAt: 'ASC' },
    });
  }

  @Get('nodes')
  async getAllNodes() {
    return this.masterYieldRepository.find();
  }

  @Post()
  async createNode(@Body() data: Partial<MasterYield>) {
    const node = this.masterYieldRepository.create(data);
    return this.masterYieldRepository.save(node);
  }

  @Put(':id')
  async updateNode(
    @Param('id') id: string,
    @Body() data: Partial<MasterYield>,
  ) {
    await this.masterYieldRepository.update(id, data);
    return this.masterYieldRepository.findOne({ where: { id } });
  }

  @Delete(':id')
  async deleteNode(@Param('id') id: string) {
    const node = await this.masterYieldRepository.findOne({
      where: { id },
      relations: ['children', 'children.children'],
    });
    if (!node) return { success: false };

    // Collect all IDs to delete
    const idsToDelete = [id];
    if (node.children) {
      for (const child of node.children) {
        idsToDelete.push(child.id);
        if (child.children) {
          for (const grandchild of child.children) {
            idsToDelete.push(grandchild.id);
          }
        }
      }
    }

    // 1. Cleanup ProductSpecs referencing these IDs
    const allSpecs = await this.productSpecRepository.find();
    const specsToUpdate = [];

    for (const spec of allSpecs) {
      if (spec.masterYieldIds) {
        const currentIds = spec.masterYieldIds
          .split(',')
          .map((s) => s.trim())
          .filter((s) => s);
        const filteredIds = currentIds.filter(
          (cid) => !idsToDelete.includes(cid),
        );

        if (currentIds.length !== filteredIds.length) {
          spec.masterYieldIds =
            filteredIds.length > 0 ? filteredIds.join(',') : null;
          specsToUpdate.push(spec);
        }
      }
    }

    if (specsToUpdate.length > 0) {
      await this.productSpecRepository.save(specsToUpdate);
    }

    // 2. Delete nodes (from bottom up to avoid FK constraints)
    if (node.children) {
      for (const child of node.children) {
        if (child.children) {
          for (const grandchild of child.children) {
            await this.masterYieldRepository.delete(grandchild.id);
          }
        }
        await this.masterYieldRepository.delete(child.id);
      }
    }

    await this.masterYieldRepository.delete(id);
    return { success: true };
  }
}
