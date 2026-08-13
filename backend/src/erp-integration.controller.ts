import {
  Controller,
  Get,
  Post,
  Delete,
  Body,
  Param,
  Query,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { TargetSyncItem } from './target-sync-item.entity';
import { OracleIntegrationService } from './oracle-integration.service';

@Controller('api/erp')
export class ErpIntegrationController {
  constructor(
    @InjectRepository(TargetSyncItem)
    private targetItemRepo: Repository<TargetSyncItem>,
    private oracleService: OracleIntegrationService,
  ) {}

  @Get('items')
  async getItems() {
    return this.oracleService.getLocalItems();
  }

  // Get all target item codes
  @Get('target-items')
  async getTargetItems() {
    const items = await this.targetItemRepo.find({
      order: { createdAt: 'DESC' },
    });
    // Return full items instead of just item codes
    return items;
  }

  // Add new item codes
  @Post('target-items')
  async addTargetItems(@Body() body: { itemCodes: string[] }) {
    if (!body.itemCodes || !Array.isArray(body.itemCodes))
      return { success: false };

    for (const code of body.itemCodes) {
      const exists = await this.targetItemRepo.findOne({
        where: { itemCode: code },
      });
      if (!exists) {
        const newItem = this.targetItemRepo.create({ itemCode: code });
        await this.targetItemRepo.save(newItem);
      }
    }
    return { success: true };
  }

  // Remove an item code
  @Delete('target-items/:code')
  async removeTargetItem(@Param('code') code: string) {
    await this.targetItemRepo.delete({ itemCode: code });
    return { success: true };
  }

  // Trigger sync for all target items
  @Post('sync-items')
  async syncTargetItems() {
    const items = await this.targetItemRepo.find();
    const codes = items.map((i) => i.itemCode);
    if (codes.length === 0) return { message: 'No item codes to sync' };

    const syncedItems = await this.oracleService.syncItems(codes);
    const syncedCodes = new Set(syncedItems.map((i: any) => i.erpItemCode));

    // Update sync status
    for (const item of items) {
      item.lastSyncDate = new Date();
      if (syncedCodes.has(item.itemCode)) {
        item.lastSyncStatus = 'SUCCESS';
      } else {
        item.lastSyncStatus = 'FAILED';
      }
    }
    // Chunk the save to avoid MS SQL 2100 parameter limit
    const saveChunkSize = 50;
    for (let k = 0; k < items.length; k += saveChunkSize) {
      const chunkToSave = items.slice(k, k + saveChunkSize);
      await this.targetItemRepo.save(chunkToSave);
    }

    return { success: true, count: syncedItems.length, data: syncedItems };
  }

  // Trigger sync for order headers from Oracle ERP
  @Post('sync-order-headers')
  async syncOrderHeaders() {
    const syncedOrders = await this.oracleService.syncOrderHeaders();
    return { success: true, count: syncedOrders.length, data: syncedOrders };
  }

  // Get synced order headers from local DB
  @Get('order-headers')
  async getOrderHeaders() {
    const orders = await this.oracleService.getLocalOrderHeaders();
    return orders;
  }

  // Trigger sync for order lines from Oracle ERP
  @Post('sync-order-lines')
  async syncOrderLines() {
    const syncedLines = await this.oracleService.syncOrderLines();
    return { success: true, count: syncedLines.length, data: syncedLines };
  }

  // Get synced order lines from local DB
  @Get('order-lines')
  async getOrderLines() {
    const lines = await this.oracleService.getLocalOrderLines();
    return lines;
  }

  // Get enriched orders for Demand Management (headers + lines + item desc)
  @Get('demand-orders')
  async getDemandOrders(
    @Query('page') page?: string,
    @Query('limit') limit?: string,
    @Query('startDate') startDate?: string,
    @Query('endDate') endDate?: string,
    @Query('status') status?: string,
    @Query('searchText') searchText?: string,
    @Query('isManual') isManual?: string,
    @Query('shipStartDate') shipStartDate?: string,
    @Query('shipEndDate') shipEndDate?: string,
    @Query('headerIds') headerIds?: string,
    @Query('lineIds') lineIds?: string,
    @Query('grade') grade?: string,
  ) {
    return this.oracleService.getDemandOrders({
      page,
      limit,
      startDate,
      endDate,
      status,
      searchText,
      isManual,
      shipStartDate,
      shipEndDate,
      headerIds,
      lineIds,
      grade,
    } as any);
  }

  // Create manual demand order
  @Post('manual-order')
  async createManualOrder(@Body() body: any) {
    return this.oracleService.saveManualOrder(body);
  }

  // Update manual demand order
  @Post('manual-order/:id')
  async updateManualOrder(@Param('id') id: number, @Body() body: any) {
    return this.oracleService.updateManualOrder(id, body);
  }

  // Delete manual demand order
  @Delete('manual-order/:id')
  async deleteManualOrder(@Param('id') id: number) {
    return this.oracleService.deleteManualOrder(id);
  }

  // Get recipes for an item
  @Get('recipes/:itemCode')
  async getRecipes(@Param('itemCode') itemCode: string) {
    return this.oracleService.getRecipesByItemCode(itemCode);
  }

  // Create auto batch by inserting to Oracle ERP
  @Post('batch-auto')
  async createAutoBatch(@Body() body: { recipes: { recipeNo: string, recipeVersion: number | string }[], partId: string, planDate: string }) {
    if (!body || !body.recipes || !body.partId || !body.planDate) {
      return { success: false, message: 'Missing required parameters (recipes, partId, planDate)' };
    }
    return this.oracleService.createAutoBatch(body.recipes, body.partId, body.planDate);
  }

  // Get batch logs for a specific plan date and part id
  @Get('batch-logs/:partId/:planDate')
  async getBatchLogs(@Param('partId') partId: string, @Param('planDate') planDate: string) {
    return this.oracleService.getBatchLogs(partId, planDate);
  }
}
