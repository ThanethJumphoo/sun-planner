import { Entity, Column, PrimaryGeneratedColumn, Index } from 'typeorm';

@Entity('stg_erp_order_headers')
@Index(['erpOrderHeaderId', 'erpOrgId'])
export class StgErpOrderHeader {
  @PrimaryGeneratedColumn()
  id: number;

  @Column({ name: 'erp_order_header_id', type: 'int', nullable: true })
  erpOrderHeaderId: number;

  @Column({ name: 'erp_org_id', type: 'int', nullable: true })
  erpOrgId: number;

  @Column({ name: 'erp_order_date', type: 'datetime', nullable: true })
  erpOrderDate: Date;

  @Column({
    name: 'erp_order_number',
    type: 'varchar',
    length: 100,
    nullable: true,
  })
  erpOrderNumber: string;

  @Column({
    name: 'erp_order_type',
    type: 'varchar',
    length: 100,
    nullable: true,
  })
  erpOrderType: string;

  @Column({
    name: 'erp_customer_number',
    type: 'varchar',
    length: 100,
    nullable: true,
  })
  erpCustomerNumber: string;

  @Column({
    name: 'erp_customer_name',
    type: 'nvarchar',
    length: 500,
    nullable: true,
  })
  erpCustomerName: string;

  @Column({
    name: 'erp_customer_grade',
    type: 'varchar',
    length: 50,
    nullable: true,
  })
  erpCustomerGrade: string;

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

  @Column({ name: 'is_manual', type: 'bit', default: false })
  isManual: boolean;
}
