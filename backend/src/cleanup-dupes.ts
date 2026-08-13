import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';
import { getRepositoryToken } from '@nestjs/typeorm';
import { StgErpOrderHeader } from './stg-erp-order-header.entity';

async function bootstrap() {
  const app = await NestFactory.createApplicationContext(AppModule);
  const repo = app.get(getRepositoryToken(StgErpOrderHeader));

  console.log('Finding duplicates...');
  
  // Find all headers
  const headers = await repo.find({ order: { id: 'ASC' } });
  
  const seen = new Set();
  const toDelete = [];
  
  for (const h of headers) {
    const key = `${h.erpOrderHeaderId}-${h.erpOrgId}`;
    if (seen.has(key)) {
      toDelete.push(h.id);
    } else {
      seen.add(key);
    }
  }

  if (toDelete.length > 0) {
    console.log(`Found ${toDelete.length} duplicates. Deleting...`);
    await repo.delete(toDelete);
    console.log('Duplicates deleted successfully.');
  } else {
    console.log('No duplicates found.');
  }

  await app.close();
}

bootstrap();
