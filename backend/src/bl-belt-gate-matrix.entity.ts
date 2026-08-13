import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  UpdateDateColumn,
} from 'typeorm';

@Entity('bl_belt_gate_matrix')
export class BlBeltGateMatrix {
  @PrimaryGeneratedColumn()
  id: number;

  @Column({ type: 'nvarchar', length: 100 })
  targetProduct: string; // e.g., "BLK 25-30 G"

  @Column({ type: 'int', default: 1 })
  priority: number; // e.g., 1 (highest priority)

  @Column({ type: 'nvarchar', length: 100 })
  rmSize: string; // e.g., "225-243"

  @Column({ type: 'decimal', precision: 5, scale: 2, default: 0 })
  yieldPct: number; // e.g., 83.40 (Percentage)

  @CreateDateColumn()
  createdAt: Date;

  @UpdateDateColumn()
  updatedAt: Date;
}
