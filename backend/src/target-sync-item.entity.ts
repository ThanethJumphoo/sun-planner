import {
  Entity,
  Column,
  PrimaryGeneratedColumn,
  CreateDateColumn,
} from 'typeorm';

@Entity('target_sync_items')
export class TargetSyncItem {
  @PrimaryGeneratedColumn()
  id: number;

  @Column({ name: 'item_code', type: 'varchar', length: 100, unique: true })
  itemCode: string;

  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;

  @Column({
    name: 'last_sync_status',
    type: 'varchar',
    length: 50,
    nullable: true,
  })
  lastSyncStatus: string;

  @Column({ name: 'last_sync_date', type: 'datetime', nullable: true })
  lastSyncDate: Date;
}
