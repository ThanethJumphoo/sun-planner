import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  UpdateDateColumn,
} from 'typeorm';

@Entity('icut_master')
export class ICutMaster {
  @PrimaryGeneratedColumn()
  id: number;

  @Column({ name: 'machine_name', length: 100 })
  machineName: string;

  @Column({
    name: 'capacity_kg_per_hr',
    type: 'decimal',
    precision: 10,
    scale: 2,
    default: 1200,
  })
  capacityKgPerHr: number;

  @Column({ name: 'workers_per_machine', type: 'int', default: 30 })
  workersPerMachine: number;

  // e.g. "BL (S) 35-40g"
  @Column({ name: 'target_product_code', length: 50, nullable: true })
  targetProductCode: string;

  // 80% Main product, 20% BL Block Co-product
  @Column({
    name: 'main_yield_pct',
    type: 'decimal',
    precision: 5,
    scale: 2,
    default: 0.8,
  })
  mainYieldPct: number;

  @Column({
    name: 'coproduct_yield_pct',
    type: 'decimal',
    precision: 5,
    scale: 2,
    default: 0.2,
  })
  coproductYieldPct: number;

  @Column({ name: 'is_active', default: true })
  isActive: boolean;

  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at' })
  updatedAt: Date;
}
