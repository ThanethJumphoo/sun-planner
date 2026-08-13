import { Controller, Get } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { StgErpOrderLine } from './stg-erp-order-line.entity';
import { StgErpOrderHeader } from './stg-erp-order-header.entity';
import { ProductSpec } from './product-spec.entity';

@Controller('debug')
export class DebugController {
  constructor(
    @InjectRepository(StgErpOrderLine)
    private orderLineRepo: Repository<StgErpOrderLine>,
    @InjectRepository(StgErpOrderHeader)
    private orderHeaderRepo: Repository<StgErpOrderHeader>,
    @InjectRepository(ProductSpec) private specRepo: Repository<ProductSpec>,
  ) {}

  @Get('order')
  async getOrder() {
    const headers = await this.orderHeaderRepo.find({
      where: { erpOrderNumber: '1411012602907' },
    });
    if (!headers.length) return { message: 'header not found' };
    const headerId = headers[0].erpOrderHeaderId;
    const lines = await this.orderLineRepo.find({
      where: { erpOrderHeaderId: headerId, erpOrderItemCode: '111114213' },
    });
    if (!lines.length) return { message: 'line not found' };
    const spec = await this.specRepo.findOne({
      where: { erpItemCode: '111114213' },
    });
    return { header: headers[0], lines, spec };
  }
}
