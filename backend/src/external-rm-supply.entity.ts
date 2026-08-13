import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  UpdateDateColumn,
} from 'typeorm';

@Entity('external_rm_supplies')
export class ExternalRmSupply {
  @PrimaryGeneratedColumn()
  id: number;

  @Column({ name: 'received_date', type: 'date' })
  receivedDate: Date;

  @Column({
    name: 'part_name',
    type: 'varchar',
    length: 50,
    default: 'BIL L/C',
  })
  partName: string;

  @Column({
    name: 'total_weight_kg',
    type: 'decimal',
    precision: 10,
    scale: 2,
    default: 0,
  })
  totalWeightKg: number;

  @Column({ name: 'vendor_name', type: 'varchar', length: 100, nullable: true })
  vendorName: string;

  @Column({ name: 'lot_number', type: 'varchar', length: 50, nullable: true })
  lotNumber: string;

  // JSON string storing the exact sizing breakdown of the external RM e.g. {"180-210": 5000, "210-230": 2000}
  @Column({ name: 'size_breakdown_json', type: 'text', nullable: true })
  sizeBreakdownJson: string;

  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at' })
  updatedAt: Date;
}
