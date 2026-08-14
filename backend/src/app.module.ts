import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AppController } from './app.controller';
import { AppService } from './app.service';
import { AuthModule } from './auth/auth.module';
import { UsersModule } from './users/users.module';
import { User } from './users/entities/user.entity';
import { ChickenReceivingModule } from './chicken-receiving/chicken-receiving.module';
import { StgErpItem } from './stg-erp-item.entity';
import { StgErpOrderHeader } from './stg-erp-order-header.entity';
import { StgErpOrderLine } from './stg-erp-order-line.entity';
import { TargetSyncItem } from './target-sync-item.entity';
import { DpsAutoBatchLog } from './dps-auto-batch-log.entity';
import { OracleIntegrationService } from './oracle-integration.service';
import { ErpIntegrationController } from './erp-integration.controller';
import { MachineConfig } from './machine-config.entity';
import { MachineConfigController } from './machine-config.controller';
import { ProductSpec } from './product-spec.entity';
import { ProductSpecController } from './product-spec.controller';
import { WeightDistribution } from './weight-distribution.entity';
import { WeightDistributionController } from './weight-distribution.controller';
import { BilWeightDistribution } from './bil-weight-distribution.entity';
import { BilWeightDistributionController } from './bil-weight-distribution.controller';
import { MpsController } from './mps.controller';
import { MpsPlan, MpsPlanDaily, MpsPlanOrder } from './mps-plan.entity';
import { MpsPlanSupply } from './mps-plan-supply.entity';
import { MpsPlanSupplySize } from './mps-plan-supply-size.entity';
import { MpsExceptionReport } from './mps-exception.entity';
import {
  DpsPlan,
  DpsSublot,
  DpsSublotBin,
  DpsOrder,
  DpsAllocation,
} from './dps-plan.entity';
import { DpsManpower } from './dps-manpower.entity';
import { ChickenReceivingWeeklySize } from './chicken-receiving/entities/weekly-size.entity';
import { ManualOperation } from './manual-operation.entity';
import { ManualOperationController } from './manual-operation.controller';
import { DpsController } from './dps.controller';
import {
  FilletConfig,
  FilletGroup,
  FilletSizeCalc,
} from './fillet-size.entity';
import { FilletSizeController } from './fillet-size.controller';
import { MasterYield } from './master-yield.entity';
import { MasterYieldController } from './master-yield.controller';
import { ExternalRmSupply } from './external-rm-supply.entity';
import { ExternalRmSupplyController } from './external-rm-supply.controller';
import { ICutMaster } from './icut-master.entity';
import { BlBeltGateMatrix } from './bl-belt-gate-matrix.entity';
import { BlBeltGateMatrixController } from './bl-belt-gate-matrix.controller';
import { BlDpsPlan, BlDpsBeltGate, BlDpsConveyorIcut } from './bl-dps-plan.entity';
import { BlDpsController } from './bl-dps.controller';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      envFilePath:
        process.env.NODE_ENV === 'production'
          ? '.env.production'
          : ['.env.development', '.env'],
    }),
    TypeOrmModule.forRootAsync({
      imports: [ConfigModule],
      useFactory: (configService: ConfigService) => ({
        type: 'mssql',
        host: configService.get<string>('DB_HOST'),
        port: parseInt(configService.get<string>('DB_PORT') || '1433'),
        username:
          configService.get<string>('DB_USER') ||
          configService.get<string>('DB_USERNAME'),
        password:
          configService.get<string>('DB_PASS') ||
          configService.get<string>('DB_PASSWORD'),
        database:
          configService.get<string>('DB_NAME') ||
          configService.get<string>('DB_DATABASE'),
        autoLoadEntities: true,
        synchronize:
          configService.get<string>('NODE_ENV') !== 'production' ||
          configService.get<string>('FORCE_DB_SYNC') === 'true',
        options: {
          encrypt: true,
          trustServerCertificate: true,
        },
      }),
      inject: [ConfigService],
    }),
    AuthModule,
    UsersModule,
    ChickenReceivingModule,
    TypeOrmModule.forFeature([
      StgErpItem,
      StgErpOrderHeader,
      StgErpOrderLine,
      TargetSyncItem,
      DpsAutoBatchLog,
      ProductSpec,
      WeightDistribution,
      BilWeightDistribution,
      MpsPlan,
      MpsPlanDaily,
      MpsPlanOrder,
      MpsPlanSupply,
      MpsPlanSupplySize,
      MpsExceptionReport,
      DpsPlan,
      DpsManpower,
      DpsSublot,
      DpsSublotBin,
      DpsOrder,
      DpsAllocation,
      ManualOperation,
      FilletConfig,
      FilletGroup,
      FilletSizeCalc,
      MasterYield,
      ChickenReceivingWeeklySize,
      MachineConfig,
      ExternalRmSupply,
      ICutMaster,
      BlBeltGateMatrix,
      BlDpsPlan,
      BlDpsBeltGate,
      BlDpsConveyorIcut,
    ]),
  ],
  controllers: [
    AppController,
    ErpIntegrationController,
    ProductSpecController,
    WeightDistributionController,
    BilWeightDistributionController,
    MpsController,
    ManualOperationController,
    DpsController,
    FilletSizeController,
    MasterYieldController,
    MachineConfigController,
    ExternalRmSupplyController,
    BlBeltGateMatrixController,
    BlDpsController,
    require('./debug.controller').DebugController,
  ],
  providers: [AppService, OracleIntegrationService],
})
export class AppModule {}
