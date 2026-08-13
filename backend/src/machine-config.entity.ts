import {
  Entity,
  Column,
  PrimaryGeneratedColumn,
  CreateDateColumn,
  UpdateDateColumn,
} from 'typeorm';

@Entity('machine_config')
export class MachineConfig {
  @PrimaryGeneratedColumn()
  id: number;

  @Column({ name: 'MACHINE_KEY', type: 'varchar', length: 50, unique: true })
  machineKey: string;

  @Column({ name: 'MACHINE_NAME', type: 'varchar', length: 100 })
  machineName: string;

  @Column({ name: 'MACHINE_TYPE', type: 'varchar', length: 50 })
  machineType: string;

  @Column({ name: 'CAPACITY_PCS_PER_HOUR', type: 'int', default: 0 })
  capacityPcsPerHour: number;

  @Column({
    name: 'YIELD_PERCENTAGE',
    type: 'decimal',
    precision: 5,
    scale: 4,
    default: 1.0,
  })
  yieldPercentage: number;

  @Column({ name: 'DEFAULT_LINES', type: 'int', default: 1 })
  defaultLines: number;

  @Column({ name: 'MACHINES_PER_LINE', type: 'int', default: 1 })
  machinesPerLine: number;

  @Column({ name: 'WORKERS_PER_UNIT', type: 'int', default: 0 })
  workersPerUnit: number;

  @Column({ name: 'IS_ACTIVE', type: 'bit', default: 1 })
  isActive: boolean;

  @CreateDateColumn({ name: 'CREATED_AT' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'UPDATED_AT' })
  updatedAt: Date;
}
