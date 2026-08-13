import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';
import { DataSource } from 'typeorm';

async function bootstrap() {
  const app = await NestFactory.createApplicationContext(AppModule);
  const dataSource = app.get(DataSource);
  try {
    console.log('Querying product_specs...');
    const specs = await dataSource.query('SELECT erp_item_code, product_speed, product_weight, master_yield_ids, erp_item_desc, product_yield FROM product_specs');
    console.log('Specs fetched:', specs.length);

    console.log('Querying master_yield...');
    const yields = await dataSource.query('SELECT id, name, type, yieldPercentage FROM master_yield');
    console.log('Yields fetched:', yields.length);

    console.log('Querying machine_config...');
    const machineConfigs = await dataSource.query('SELECT MACHINE_KEY, CAPACITY_PCS_PER_HOUR, DEFAULT_YIELD_PERCENTAGE, DEFAULT_LINES, MACHINES_PER_LINE, WORKERS_PER_UNIT FROM machine_config');
    console.log('MachineConfigs fetched:', machineConfigs.length);
  } catch (e) {
    console.error('Error:', e);
  } finally {
    await app.close();
  }
}
bootstrap();
