import {
  Entity,
  Column,
  PrimaryGeneratedColumn,
  CreateDateColumn,
  UpdateDateColumn,
  OneToOne,
  JoinColumn,
} from 'typeorm';
import { DpsPlan } from './dps-plan.entity';

@Entity('dps_manpower')
export class DpsManpower {
  @PrimaryGeneratedColumn()
  id: number;

  @OneToOne(() => DpsPlan, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'dps_plan_id' })
  dpsPlan: DpsPlan;

  // Manual Inputs
  @Column({ name: 'order_bil_sc_kg', type: 'decimal', precision: 18, scale: 2, default: 0 })
  orderBilScKg: number;

  @Column({ name: 'target_workers', type: 'int', default: 312 })
  targetWorkers: number;

  @Column({ name: 'current_workers', type: 'int', default: 387 })
  currentWorkers: number;

  // Fixed Roles
  @Column({ name: 'service_bl_pax', type: 'int', default: 13 })
  serviceBlPax: number;

  @Column({ name: 'in_service_lj_pax', type: 'int', default: 4 })
  inServiceLjPax: number;

  @Column({ name: 'service_ns_in_pax', type: 'int', default: 8 })
  serviceNsInPax: number;

  @Column({ name: 'en_in_short_skin_pax', type: 'int', default: 6 })
  enInShortSkinPax: number;

  @Column({ name: 'broken_leg_debone_pax', type: 'int', default: 2 })
  brokenLegDebonePax: number;

  @Column({ name: 'rm_walk_pax', type: 'int', default: 7 })
  rmWalkPax: number;

  @Column({ name: 'hygiene_pax', type: 'int', default: 17 })
  hygienePax: number;

  @Column({ name: 'erp_doc_pax', type: 'int', default: 4 })
  erpDocPax: number;

  // Calculated Results Snapshot
  @Column({ name: 'total_calculated_workers', type: 'int', default: 0 })
  totalCalculatedWorkers: number;

  @Column({ name: 'shortage_workers', type: 'int', default: 0 })
  shortageWorkers: number;

  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at' })
  updatedAt: Date;
}
