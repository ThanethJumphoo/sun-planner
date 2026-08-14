import {
  Entity,
  Column,
  PrimaryGeneratedColumn,
  CreateDateColumn,
  UpdateDateColumn,
  ManyToOne,
  OneToMany,
  JoinColumn,
} from 'typeorm';

// ─── 1. BL DPS Plan Header (หัวตารางแผนผลิต BL ราย Sublot) ───
@Entity('bl_dps_plans')
export class BlDpsPlan {
  @PrimaryGeneratedColumn()
  id: number;

  @Column({ name: 'plan_date', type: 'date' })
  planDate: Date;

  @Column({ name: 'sublot', type: 'varchar', length: 50 })
  sublot: string;

  @Column({ name: 'shift', type: 'varchar', length: 20, default: 'A' })
  shift: string;

  @Column({ name: 'bl_untrimmed', type: 'decimal', precision: 18, scale: 2, default: 0 })
  blUntrimmed: number;

  @Column({ name: 'bl_trimmed', type: 'decimal', precision: 18, scale: 2, default: 0 })
  blTrimmed: number;

  @Column({ name: 'start_time', type: 'varchar', length: 20, nullable: true })
  startTime: string;

  @Column({ name: 'break_time', type: 'varchar', length: 50, nullable: true })
  breakTime: string;

  @Column({ name: 'break_duration', type: 'int', default: 60 })
  breakDuration: number;

  @Column({ name: 'work_hours', type: 'decimal', precision: 5, scale: 2, default: 8 })
  workHours: number;

  @Column({ name: 'chicken_weight', type: 'decimal', precision: 10, scale: 4, default: 0 })
  chickenWeight: number;

  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at' })
  updatedAt: Date;

  @OneToMany(() => BlDpsBeltGate, (bg) => bg.blDpsPlan, { cascade: true })
  beltGates: BlDpsBeltGate[];

  @OneToMany(() => BlDpsConveyorIcut, (ci) => ci.blDpsPlan, { cascade: true })
  conveyors: BlDpsConveyorIcut[];
}

// ─── 2. BL DPS Belt Gate ───
@Entity('bl_dps_belt_gates')
export class BlDpsBeltGate {
  @PrimaryGeneratedColumn()
  id: number;

  @ManyToOne(() => BlDpsPlan, (plan) => plan.beltGates, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'bl_dps_plan_id' })
  blDpsPlan: BlDpsPlan;

  @Column({ name: 'bin', type: 'int' })
  bin: number;

  @Column({ name: 'target_weight', type: 'varchar', length: 50, nullable: true })
  targetWeight: string;

  @Column({ name: 'pct_size', type: 'decimal', precision: 10, scale: 4, default: 0 })
  pctSize: number;

  @Column({ name: 'code', type: 'varchar', length: 50, nullable: true })
  code: string;

  @Column({ name: 'name', type: 'nvarchar', length: 255, nullable: true })
  name: string;

  @Column({ name: 'size', type: 'varchar', length: 50, nullable: true })
  size: string;

  @Column({ name: 'qty', type: 'decimal', precision: 18, scale: 2, default: 0 })
  qty: number;

  @Column({ name: 'chicken_weight', type: 'decimal', precision: 18, scale: 2, default: 0 })
  chickenWeight: number;

  @Column({ name: 'speed', type: 'decimal', precision: 18, scale: 2, default: 0 })
  speed: number;

  @Column({ name: 'sorting_time', type: 'decimal', precision: 18, scale: 2, default: 0 })
  sortingTime: number;

  @Column({ name: 'rm', type: 'decimal', precision: 18, scale: 2, default: 0 })
  rm: number;

  @Column({ name: 'fg_target', type: 'decimal', precision: 18, scale: 2, default: 0 })
  fgTarget: number;

  @Column({ name: 'diff1', type: 'decimal', precision: 18, scale: 2, default: 0 })
  diff1: number;

  @Column({ name: 'fg_rm_bl', type: 'decimal', precision: 18, scale: 2, default: 0 })
  fgRmBl: number;

  @Column({ name: 'fg_rm_blk', type: 'decimal', precision: 18, scale: 2, default: 0 })
  fgRmBlk: number;

  @Column({ name: 'diff2', type: 'decimal', precision: 18, scale: 2, default: 0 })
  diff2: number;
}

// ─── 3. BL DPS Conveyor & I-CUT ───
@Entity('bl_dps_conveyor_icut')
export class BlDpsConveyorIcut {
  @PrimaryGeneratedColumn()
  id: number;

  @ManyToOne(() => BlDpsPlan, (plan) => plan.conveyors, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'bl_dps_plan_id' })
  blDpsPlan: BlDpsPlan;

  @Column({ name: 'section', type: 'varchar', length: 20 })
  section: string; // 'conveyor' or 'icut'

  @Column({ name: 'position', type: 'varchar', length: 50, nullable: true })
  position: string;

  @Column({ name: 'item_code', type: 'varchar', length: 50, nullable: true })
  itemCode: string;

  @Column({ name: 'item_desc', type: 'nvarchar', length: 255, nullable: true })
  itemDesc: string;

  @Column({ name: 'workers', type: 'int', default: 0 })
  workers: number;

  @Column({ name: 'speed', type: 'decimal', precision: 18, scale: 2, default: 0 })
  speed: number;

  @Column({ name: 'pct_yield', type: 'decimal', precision: 10, scale: 4, default: 0 })
  pctYield: number;

  @Column({ name: 'pct_scrap_bl', type: 'decimal', precision: 10, scale: 4, default: 0 })
  pctScrapBl: number;

  @Column({ name: 'pct_sbl_b', type: 'decimal', precision: 10, scale: 4, default: 0 })
  pctSblB: number;

  @Column({ name: 'pct_bl_b', type: 'decimal', precision: 10, scale: 4, default: 0 })
  pctBlB: number;

  @Column({ name: 'pct_skin', type: 'decimal', precision: 10, scale: 4, default: 0 })
  pctSkin: number;

  @Column({ name: 'pct_scrap_bl2', type: 'decimal', precision: 10, scale: 4, default: 0 })
  pctScrapBl2: number;

  @Column({ name: 'pct_drum', type: 'decimal', precision: 10, scale: 4, default: 0 })
  pctDrum: number;

  @Column({ name: 'cut_time', type: 'decimal', precision: 18, scale: 2, default: 0 })
  cutTime: number;

  @Column({ name: 'yield_kg', type: 'decimal', precision: 18, scale: 2, default: 0 })
  yieldKg: number;

  @Column({ name: 'scrap_bl_kg', type: 'decimal', precision: 18, scale: 2, default: 0 })
  scrapBlKg: number;

  @Column({ name: 'sbl_b_kg', type: 'decimal', precision: 18, scale: 2, default: 0 })
  sblBKg: number;

  @Column({ name: 'bl_b_kg', type: 'decimal', precision: 18, scale: 2, default: 0 })
  blBKg: number;

  @Column({ name: 'skin_kg', type: 'decimal', precision: 18, scale: 2, default: 0 })
  skinKg: number;

  @Column({ name: 'scrap_bl2_kg', type: 'decimal', precision: 18, scale: 2, default: 0 })
  scrapBl2Kg: number;

  @Column({ name: 'drum_kg', type: 'decimal', precision: 18, scale: 2, default: 0 })
  drumKg: number;

  @Column({ name: 'rm_kg', type: 'decimal', precision: 18, scale: 2, default: 0 })
  rmKg: number;

  @Column({ name: 'rm_used_kg', type: 'decimal', precision: 18, scale: 2, default: 0 })
  rmUsedKg: number;

  @Column({ name: 'rm_type', type: 'varchar', length: 50, nullable: true })
  rmType: string;
}
