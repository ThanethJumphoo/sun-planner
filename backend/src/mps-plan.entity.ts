import {
  Entity,
  Column,
  PrimaryGeneratedColumn,
  CreateDateColumn,
  UpdateDateColumn,
  OneToMany,
  ManyToOne,
  JoinColumn,
  VersionColumn,
} from 'typeorm';

import { MpsPlanSupply } from './mps-plan-supply.entity';

// ─── 1. MPS Plan Header (หัวตารางแผนการผลิต) ───
@Entity('mps_plans')
export class MpsPlan {
  @PrimaryGeneratedColumn()
  id: number;

  @Column({ name: 'plan_name', type: 'nvarchar', length: 100, nullable: true })
  planName: string; // เช่น "MPS May 2026 - V1"

  @Column({ name: 'part_type', type: 'varchar', length: 50, default: 'fillet' })
  partType: string;

  @Column({ name: 'target_month', type: 'varchar', length: 7 })
  targetMonth: string; // "YYYY-MM" (เช่น "2026-05")

  @Column({ name: 'status', type: 'varchar', length: 20, default: 'DRAFT' })
  status: string; // DRAFT, FROZEN, APPROVED, CANCELLED

  // ภาพรวมทั้งหมดของแผน ณ ตอนที่ Generate (ป้องกันตัวเลขเปลี่ยนเมื่อ Master Data เปลี่ยน)
  @Column({ name: 'total_intake_birds', type: 'int', default: 0 })
  totalIntakeBirds: number;

  @Column({
    name: 'total_rm_fl_kg',
    type: 'decimal',
    precision: 18,
    scale: 2,
    default: 0,
  })
  totalRmFlKg: number;

  @Column({
    name: 'total_internal_rm_kg',
    type: 'decimal',
    precision: 18,
    scale: 2,
    default: 0,
  })
  totalInternalRmKg: number;

  @Column({
    name: 'total_external_rm_kg',
    type: 'decimal',
    precision: 18,
    scale: 2,
    default: 0,
  })
  totalExternalRmKg: number;

  @Column({
    name: 'total_demand_kg',
    type: 'decimal',
    precision: 18,
    scale: 2,
    default: 0,
  })
  totalDemandKg: number;

  @Column({ name: 'locked_days', type: 'nvarchar', length: 1000, nullable: true })
  lockedDays: string; // Comma-separated locked dates

  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at' })
  updatedAt: Date;

  @OneToMany(() => MpsPlanDaily, (daily) => daily.mpsPlan, { cascade: true })
  dailySummaries: MpsPlanDaily[];

  @OneToMany(() => MpsPlanSupply, (supply) => supply.mpsPlan, { cascade: true })
  supplyBreakdown: MpsPlanSupply[];

  @OneToMany(() => MpsPlanOrder, (order) => order.mpsPlan, { cascade: true })
  orders: MpsPlanOrder[];

  @OneToMany('MpsExceptionReport', 'mpsPlan', { cascade: true })
  exceptions: any[]; // Using string type to avoid circular dependency issues if not imported directly
}

// ─── 2. MPS Plan Daily Summary (สรุปตัวเลขรายวันของแผนนั้น) ───
@Entity('mps_plan_daily')
export class MpsPlanDaily {
  @PrimaryGeneratedColumn()
  id: number;

  @ManyToOne(() => MpsPlan, (plan) => plan.dailySummaries, {
    onDelete: 'CASCADE',
  })
  @JoinColumn({ name: 'mps_plan_id' })
  mpsPlan: MpsPlan;

  @Column({ name: 'production_date', type: 'date' })
  productionDate: Date;

  // Snapshot ของ Supply & Demand ในแต่ละวัน
  @Column({ name: 'intake_birds', type: 'int', default: 0 })
  intakeBirds: number;

  @Column({
    name: 'rm_fl_avail_kg',
    type: 'decimal',
    precision: 18,
    scale: 2,
    default: 0,
  })
  rmFlAvailKg: number;

  @Column({
    name: 'internal_rm_kg',
    type: 'decimal',
    precision: 18,
    scale: 2,
    default: 0,
  })
  internalRmKg: number;

  @Column({
    name: 'external_rm_kg',
    type: 'decimal',
    precision: 18,
    scale: 2,
    default: 0,
  })
  externalRmKg: number;

  @Column({
    name: 'demand_kg',
    type: 'decimal',
    precision: 18,
    scale: 2,
    default: 0,
  })
  demandKg: number;

  @Column({ name: 'cutting_staff', type: 'int', default: 0 })
  cuttingStaff: number;

  @Column({ name: 'support_staff', type: 'int', default: 0 })
  supportStaff: number;

  @Column({ name: 'total_staff', type: 'int', default: 0 })
  totalStaff: number;

  @Column({ name: 'bl_tracker_json', type: 'text', nullable: true })
  blTrackerJson: string | null;
}

// ─── 3. MPS Plan Orders (เก็บ Snapshot การจัดสรร Order เข้าสู่วันผลิต) ───
@Entity('mps_plan_orders')
export class MpsPlanOrder {
  @PrimaryGeneratedColumn()
  id: number;

  @ManyToOne(() => MpsPlan, (plan) => plan.orders, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'mps_plan_id' })
  mpsPlan: MpsPlan;

  @Column({ name: 'erp_order_line_id', type: 'int' })
  erpOrderLineId: number;

  @Column({ name: 'so_number', type: 'varchar', length: 100, nullable: true })
  soNumber: string;

  @Column({ name: 'item_code', type: 'varchar', length: 100 })
  itemCode: string;

  @Column({ name: 'item_desc', type: 'nvarchar', length: 255, nullable: true })
  itemDesc: string;

  @Column({ name: 'product_type', type: 'varchar', length: 50 })
  productType: string; // CHILLED, FREEZE (Snapshot ค่ามาจาก Spec ณ ตอนนั้น)

  @Column({ name: 'quantity_kg', type: 'decimal', precision: 18, scale: 2 })
  quantityKg: number;

  // วันส่งสินค้าดั้งเดิม
  @Column({ name: 'ship_date', type: 'date' })
  shipDate: Date;

  // วันที่ระบบ/คนจัดสรรให้ผลิต (Planned Production Date)
  @Column({ name: 'planned_production_date', type: 'date' })
  plannedProductionDate: Date;

  // วันที่ผลิตเสร็จ (Finished Production Date)
  @Column({ name: 'finished_production_date', type: 'date', nullable: true })
  finishedProductionDate: Date;

  @Column({ name: 'is_manual_override', type: 'bit', default: 0 })
  isManualOverride: boolean; // ให้รู้ว่าอันนี้คนลากย้ายเอง ไม่ได้มาจากการ Auto

  @VersionColumn({ name: 'version', default: 1 })
  version: number;
}
