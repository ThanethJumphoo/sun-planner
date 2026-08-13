import {
  Controller,
  Get,
  Post,
  Body,
  Param,
  ParseIntPipe,
  Put,
  Delete,
  Query,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, Between } from 'typeorm';
import { ExternalRmSupply } from './external-rm-supply.entity';

@Controller('api/external-rm-supplies')
export class ExternalRmSupplyController {
  constructor(
    @InjectRepository(ExternalRmSupply)
    private readonly rmSupplyRepo: Repository<ExternalRmSupply>,
  ) {}

  @Get()
  async getAll(
    @Query('page') page?: string,
    @Query('limit') limit?: string,
    @Query('startDate') startDate?: string,
    @Query('endDate') endDate?: string,
    @Query('partName') partName?: string,
  ) {
    const where: any = {};

    if (startDate && endDate) {
      where.receivedDate = Between(startDate, endDate);
    } else if (startDate) {
      where.receivedDate = Between(startDate, '9999-12-31');
    } else if (endDate) {
      where.receivedDate = Between('1970-01-01', endDate);
    }

    if (partName) {
      where.partName = partName;
    }

    const order: any = { receivedDate: 'DESC' };

    if (page && limit) {
      const pageNum = parseInt(page, 10) || 1;
      const limitNum = parseInt(limit, 10) || 100;
      const [data, total] = await this.rmSupplyRepo.findAndCount({
        where,
        order,
        skip: (pageNum - 1) * limitNum,
        take: limitNum,
      });

      return {
        success: true,
        data,
        total,
        page: pageNum,
        limit: limitNum,
        totalPages: Math.ceil(total / limitNum),
      };
    } else {
      const data = await this.rmSupplyRepo.find({
        where,
        order,
      });
      return { success: true, data };
    }
  }

  @Post()
  async create(@Body() dto: any) {
    const supply = this.rmSupplyRepo.create(dto);
    const saved = await this.rmSupplyRepo.save(supply);
    return { success: true, data: saved };
  }

  @Put(':id')
  async update(@Param('id', ParseIntPipe) id: number, @Body() dto: any) {
    await this.rmSupplyRepo.update(id, dto);
    const updated = await this.rmSupplyRepo.findOne({ where: { id } });
    return { success: true, data: updated };
  }

  @Delete(':id')
  async delete(@Param('id', ParseIntPipe) id: number) {
    await this.rmSupplyRepo.delete(id);
    return { success: true };
  }
}
