import {
  Entity,
  Column,
  PrimaryGeneratedColumn,
  CreateDateColumn,
  UpdateDateColumn,
} from 'typeorm';

@Entity('dps_auto_batch_logs')
export class DpsAutoBatchLog {
  @PrimaryGeneratedColumn()
  id: number;

  @Column({ name: 'batch_name', length: 100 })
  batchName: string;

  @Column({ name: 'part_id', length: 50, nullable: true })
  partId: string;

  @Column({ name: 'plan_date', length: 20, nullable: true })
  planDate: string;

  @Column({ name: 'item_code', length: 50, nullable: true })
  itemCode: string;

  @Column({ name: 'recipe_no', length: 50 })
  recipeNo: string;

  @Column({ name: 'recipe_version', length: 10 })
  recipeVersion: string;

  @Column({ name: 'batch_no', length: 50, nullable: true })
  batchNo: string;

  @Column({ name: 'status', length: 20, default: 'PENDING' })
  status: string;

  @Column({ name: 'error_msg', type: 'text', nullable: true })
  errorMsg: string;

  @Column({ name: 'created_by', length: 50, nullable: true })
  createdBy: string;

  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at' })
  updatedAt: Date;
}
