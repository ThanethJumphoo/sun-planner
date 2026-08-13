import { Entity, Column, PrimaryGeneratedColumn, Index } from 'typeorm';

@Entity('stg_erp_order_lines')
@Index(['erpOrderLineId', 'erpOrgId'], { unique: true })
export class StgErpOrderLine {
  @PrimaryGeneratedColumn()
  id: number;

  @Column({ name: 'erp_order_line_id', type: 'int', nullable: true })
  erpOrderLineId: number;

  @Column({ name: 'erp_order_header_id', type: 'int', nullable: true })
  erpOrderHeaderId: number;

  @Column({ name: 'erp_org_id', type: 'int', nullable: true })
  erpOrgId: number;

  @Column({
    name: 'erp_order_line_number',
    type: 'varchar',
    length: 50,
    nullable: true,
  })
  erpOrderLineNumber: string;

  @Column({ name: 'erp_order_item_id', type: 'int', nullable: true })
  erpOrderItemId: number;

  @Column({
    name: 'erp_order_item_code',
    type: 'varchar',
    length: 100,
    nullable: true,
  })
  erpOrderItemCode: string;

  @Column({
    name: 'erp_order_item_qty',
    type: 'decimal',
    precision: 18,
    scale: 4,
    nullable: true,
  })
  erpOrderItemQty: number;

  @Column({
    name: 'erp_order_item_uom',
    type: 'varchar',
    length: 20,
    nullable: true,
  })
  erpOrderItemUom: string;

  @Column({ name: 'erp_order_ship_date', type: 'datetime', nullable: true })
  erpOrderShipDate: Date;

  @Column({ name: 'erp_creation_date', type: 'datetime', nullable: true })
  erpCreationDate: Date;

  @Column({ name: 'erp_last_update_date', type: 'datetime', nullable: true })
  erpLastUpdateDate: Date;

  @Column({
    name: 'erp_order_status',
    type: 'varchar',
    length: 50,
    nullable: true,
  })
  erpOrderStatus: string;

  // Added for MPS Scheduling
  @Column({ name: 'planned_production_date', type: 'datetime', nullable: true })
  plannedProductionDate: Date;

  @Column({
    name: 'finished_production_date',
    type: 'datetime',
    nullable: true,
  })
  finishedProductionDate: Date;

  // Priority: lower number = higher priority (1 = highest)
  @Column({ name: 'priority', type: 'int', nullable: true, default: null })
  priority: number;

  @Column({ name: 'is_manual', type: 'bit', default: false })
  isManual: boolean;
}
