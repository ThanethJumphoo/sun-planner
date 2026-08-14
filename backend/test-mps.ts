import { NestFactory } from '@nestjs/core';
import { AppModule } from './src/app.module';
import { MpsController } from './src/mps.controller';

async function bootstrap() {
  const app = await NestFactory.createApplicationContext(AppModule);
  const mpsController = app.get(MpsController);
  
  // Need to supply valid date based on DB records if '2024-11-20' fails
  // But wait, the user's plan clearly shows '111117249' is processed.
  // We can just query `productSpecs` directly to test the map logic.
  const specRepo = app.get('ProductSpecRepository'); // we don't need this if we just run the controller
  
  const res = await mpsController.getApprovedOrdersForDate('2024-11-20', 'bl');
  console.log('Result length:', res.length);
  if (res.length > 0) {
    const item = res.find(o => String(o.itemCode).trim() === '111117249');
    console.log('Item:', item);
  } else {
    // try finding ANY order with 111117249
    const orderRepo = app.get('MpsPlanOrderRepository');
    const order = await orderRepo.findOne({ where: { itemCode: '111117249' } });
    if (order) {
      console.log('Found order in DB:', order.plannedProductionDate);
      const res2 = await mpsController.getApprovedOrdersForDate(order.plannedProductionDate, 'bl');
      const item2 = res2.find(o => String(o.itemCode).trim() === '111117249');
      console.log('Item from API:', item2);
    } else {
      console.log('No order found with itemCode 111117249');
    }
  }
  
  await app.close();
}
bootstrap();
