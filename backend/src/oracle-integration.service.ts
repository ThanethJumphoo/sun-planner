import { Injectable, OnModuleDestroy } from '@nestjs/common';
import * as oracledb from 'oracledb';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, In } from 'typeorm';
import { StgErpItem } from './stg-erp-item.entity';
import { StgErpOrderHeader } from './stg-erp-order-header.entity';
import { StgErpOrderLine } from './stg-erp-order-line.entity';
import { DpsAutoBatchLog } from './dps-auto-batch-log.entity';
import { AUTO_BATCH_PLSQL } from './scripts/auto-batch-plsql';

@Injectable()
export class OracleIntegrationService implements OnModuleDestroy {
  private pool: oracledb.Pool | null = null;

  constructor(
    @InjectRepository(StgErpItem)
    private stgErpItemRepository: Repository<StgErpItem>,
    @InjectRepository(StgErpOrderHeader)
    private stgErpOrderHeaderRepository: Repository<StgErpOrderHeader>,
    @InjectRepository(StgErpOrderLine)
    private stgErpOrderLineRepository: Repository<StgErpOrderLine>,
    @InjectRepository(DpsAutoBatchLog)
    private dpsAutoBatchLogRepository: Repository<DpsAutoBatchLog>,
  ) {
    // เปิดใช้งาน Thick mode เพื่อรองรับ Oracle DB ที่ใช้ password verifier แบบเก่า
    try {
      oracledb.initOracleClient();
      console.log('✅ Oracle Client initialized in Thick mode');
    } catch (err: any) {
      if (err.message && !err.message.includes('already been initialized')) {
        console.error('Failed to initialize Oracle Client:', err.message);
      }
    }
  }

  /**
   * ฟังก์ชันเปิดใช้งาน Connection Pool
   */
  async getPool(): Promise<oracledb.Pool> {
    if (this.pool) return this.pool;

    try {
      this.pool = await oracledb.createPool({
        user: process.env.ORACLE_DB_USER || 'apps',
        password: process.env.ORACLE_DB_PASS || 'apps',
        connectString: `${process.env.ORACLE_DB_HOST || '172.25.10.12'}:${process.env.ORACLE_DB_PORT || '1522'}/${process.env.ORACLE_DB_SERVICE || 'PROD'}`,
        poolMin: 2,
        poolMax: 10,
        poolIncrement: 1,
      });
      console.log('✅ Oracle Connection Pool initialized successfully');
      return this.pool;
    } catch (err) {
      console.error('Oracle connection pool initialization error:', err);
      throw err;
    }
  }

  /**
   * ฟังก์ชันสำหรับเชื่อมต่อฐานข้อมูล Oracle ERP โดยดึงจาก Pool
   */
  async connect(): Promise<oracledb.Connection> {
    const pool = await this.getPool();
    return pool.getConnection();
  }

  /**
   * ตัวอย่างฟังก์ชันสำหรับดึงข้อมูล (SELECT)
   */
  async getSalesOrders(): Promise<any> {
    let conn;
    try {
      conn = await this.connect();

      // ตัวอย่างคำสั่ง SQL (เปลี่ยนชื่อ Table ให้ตรงกับของจริง เช่น OE_ORDER_HEADERS_ALL)
      const sql = `
        SELECT HEADER_ID, ORDER_NUMBER, ORDERED_DATE, FLOW_STATUS_CODE
        FROM OE_ORDER_HEADERS_ALL
        WHERE ROWNUM <= 10
        ORDER BY ORDERED_DATE DESC
      `;

      const result = await conn.execute(sql, [], {
        outFormat: oracledb.OUT_FORMAT_OBJECT,
      });
      return result.rows; // คืนค่าข้อมูลออกมาเป็น Array ของ Object
    } catch (err) {
      console.error('Query execution error:', err);
      throw err;
    } finally {
      if (conn) {
        try {
          await conn.close();
        } catch (e) {
          console.error('Error closing oracle connection:', e);
        }
      }
    }
  }

  /**
   * ดึงข้อมูล Item จาก Oracle ERP ตาม Item Code (SEGMENT1) หลายรายการ
   * @param itemCodes Array ของรหัสสินค้าที่ต้องการดึงจากหน้าเว็บ
   */
  async syncItems(itemCodes: string[]): Promise<any> {
    if (!itemCodes || itemCodes.length === 0) {
      return [];
    }

    let conn;
    try {
      conn = await this.connect();

      const savedItems = [];
      const chunkSize = 990;

      for (let i = 0; i < itemCodes.length; i += chunkSize) {
        const chunk = itemCodes.slice(i, i + chunkSize);
        const bindNames = chunk.map((_, idx) => `:code${idx}`).join(', ');

        const sql = `
          SELECT ITM.INVENTORY_ITEM_ID AS ERP_ITEM_ID,
                 ITM.ORGANIZATION_ID   AS ERP_ORG_ID,
                 ITM.ITEM_TYPE         AS ERP_ITEM_TYPE,
                 ITM.SEGMENT1          AS ERP_ITEM_CODE,
                 ITM.DESCRIPTION       AS ERP_ITEM_DESC,
                 ITM.PRIMARY_UOM_CODE  AS ERP_ITEM_UOM,
                 ITM.CREATION_DATE     AS ERP_CREATION_DATE,
                 ITM.LAST_UPDATE_DATE  AS ERP_LAST_UPDATE_DATE,
                 ITM.ENABLED_FLAG      AS ERP_ENABLED_FLAG
          FROM  MTL_SYSTEM_ITEMS_B ITM
          WHERE ITM.SEGMENT1 IN (${bindNames})
          AND   ITM.ORGANIZATION_ID = 82
          AND   ITM.ENABLED_FLAG = 'Y'
        `;

        const binds: any = {};
        chunk.forEach((code, idx) => {
          binds[`code${idx}`] = code;
        });

        const result = await conn.execute(sql, binds, {
          outFormat: oracledb.OUT_FORMAT_OBJECT,
        });

        const erpRows: any[] = result.rows || [];

        for (const row of erpRows) {
          let item = await this.stgErpItemRepository.findOne({
            where: { erpItemCode: row.ERP_ITEM_CODE, erpOrgId: row.ERP_ORG_ID },
          });

          if (!item) {
            item = this.stgErpItemRepository.create();
          }

          item.erpItemId = row.ERP_ITEM_ID;
          item.erpOrgId = row.ERP_ORG_ID;
          item.erpItemType = row.ERP_ITEM_TYPE;
          item.erpItemCode = row.ERP_ITEM_CODE;
          item.erpItemDesc = row.ERP_ITEM_DESC;
          item.erpItemUom = row.ERP_ITEM_UOM;
          item.erpCreationDate = row.ERP_CREATION_DATE;
          item.erpLastUpdateDate = row.ERP_LAST_UPDATE_DATE;
          item.erpEnabledFlag = row.ERP_ENABLED_FLAG;

          const saved = await this.stgErpItemRepository.save(item);
          savedItems.push(saved);
        }
      }

      return savedItems;
    } catch (err) {
      console.error('Error syncing items:', err);
      throw err;
    } finally {
      if (conn) {
        try {
          await conn.close();
        } catch (e) {
          console.error('Error closing oracle connection:', e);
        }
      }
    }
  }

  /**
   * ดึงข้อมูล Item ทั้งหมดจาก Local DB
   */
  async getLocalItems(): Promise<StgErpItem[]> {
    return this.stgErpItemRepository.find({
      order: { erpItemCode: 'ASC' },
      take: 1000,
    });
  }

  /**
   * ดึงข้อมูล Order Headers จาก Oracle ERP
   * ดึง Sales Orders ที่ BOOKED อยู่ใน Organization 82
   */
  async syncOrderHeaders(): Promise<any> {
    let conn;
    try {
      conn = await this.connect();

      const sql = `
        SELECT DISTINCT
              ODH.HEADER_ID         AS ERP_ORDER_HEADER_ID,
              ODH.ORG_ID            AS ERP_ORG_ID,
              ODH.ORDERED_DATE      AS ERP_ORDER_DATE,
              ODH.ORDER_NUMBER      AS ERP_ORDER_NUMBER,
              ODT.NAME              AS ERP_ORDER_TYPE,
              CUS.CUSTOMER_NUMBER   AS ERP_CUSTOMER_NUMBER,
              CUS.CUSTOMER_NAME     AS ERP_CUSTOMER_NAME,
              CUS.ATTRIBUTE1        AS ERP_CUSTOMER_GRADE,
              ODH.CREATION_DATE     AS ERP_CREATION_DATE,
              ODH.LAST_UPDATE_DATE  AS ERP_LAST_UPDATE_DATE,
              ODH.FLOW_STATUS_CODE  AS ERP_ORDER_STATUS
        FROM   OE_ORDER_HEADERS_ALL ODH
              JOIN OE_ORDER_LINES_ALL ODL ON ODL.HEADER_ID = ODH.HEADER_ID
              JOIN OE_TRANSACTION_TYPES_TL ODT ON ODT.TRANSACTION_TYPE_ID = ODH.ORDER_TYPE_ID
              JOIN AR_CUSTOMERS CUS ON CUS.CUSTOMER_ID = ODH.SOLD_TO_ORG_ID
        WHERE (ODT.NAME LIKE 'SFO%SO'
                OR ODT.NAME LIKE 'SFO%F')
        AND    ODL.SCHEDULE_SHIP_DATE >= ADD_MONTHS(TRUNC(SYSDATE, 'MM'), -3)
        AND    ODH.CANCELLED_FLAG = 'N'
        AND    ODH.ORG_ID = 82
        ORDER BY ODH.ORDERED_DATE DESC
      `;

      const result = await conn.execute(sql, [], {
        outFormat: oracledb.OUT_FORMAT_OBJECT,
      });

      const erpRows: any[] = result.rows || [];
      const savedOrders = [];

      for (const row of erpRows) {
        // Upsert: find existing or create new
        let order = await this.stgErpOrderHeaderRepository.findOne({
          where: {
            erpOrderHeaderId: row.ERP_ORDER_HEADER_ID,
            erpOrgId: row.ERP_ORG_ID,
          },
        });

        if (!order) {
          order = this.stgErpOrderHeaderRepository.create();
        }

        order.erpOrderHeaderId = row.ERP_ORDER_HEADER_ID;
        order.erpOrgId = row.ERP_ORG_ID;
        order.erpOrderDate = row.ERP_ORDER_DATE;
        order.erpOrderNumber = String(row.ERP_ORDER_NUMBER ?? '');
        order.erpOrderType = String(row.ERP_ORDER_TYPE ?? '');
        order.erpCustomerNumber = String(row.ERP_CUSTOMER_NUMBER ?? '');
        order.erpCustomerName = String(row.ERP_CUSTOMER_NAME ?? '');
        order.erpCustomerGrade = String(row.ERP_CUSTOMER_GRADE ?? '');
        order.erpCreationDate = row.ERP_CREATION_DATE;
        order.erpLastUpdateDate = row.ERP_LAST_UPDATE_DATE;
        order.erpOrderStatus = String(row.ERP_ORDER_STATUS ?? '');

        const saved = await this.stgErpOrderHeaderRepository.save(order);
        savedOrders.push(saved);
      }

      return savedOrders;
    } catch (err) {
      console.error('Error syncing order headers:', err);
      throw err;
    } finally {
      if (conn) {
        try {
          await conn.close();
        } catch (e) {
          console.error('Error closing oracle connection:', e);
        }
      }
    }
  }

  /**
   * ดึงข้อมูล Order Headers จาก Local DB (SQL Server) ที่ Sync มาแล้ว
   */
  async getLocalOrderHeaders(): Promise<StgErpOrderHeader[]> {
    return this.stgErpOrderHeaderRepository.find({
      order: { erpOrderDate: 'DESC' },
    });
  }

  /**
   * ดึงข้อมูล Order Lines จาก Oracle ERP ตาม Header IDs ที่ Sync มาแล้ว
   */
  async syncOrderLines(): Promise<any> {
    let conn;
    try {
      conn = await this.connect();

      // ดึง Header IDs ที่มีอยู่ในระบบ
      const headers = await this.stgErpOrderHeaderRepository.find();
      if (headers.length === 0) return [];

      const headerIds = headers.map((h) => h.erpOrderHeaderId);
      const savedLines = [];

      // Oracle has a limit of 1000 items in an IN clause.
      // We chunk the headerIds into groups of 990 to be safe.
      const chunkSize = 990;
      for (let i = 0; i < headerIds.length; i += chunkSize) {
        const chunk = headerIds.slice(i, i + chunkSize);
        const bindNames = chunk.map((_, idx) => `:hid${idx}`).join(', ');

        const sql = `
          SELECT ODL.LINE_ID             AS ERP_ORDER_LINE_ID,
                 ODL.HEADER_ID           AS ERP_ORDER_HEADER_ID,
                 ODL.ORG_ID              AS ERP_ORG_ID,
                 ODL.LINE_NUMBER         AS ERP_ORDER_LINE_NUMBER,
                 ODL.INVENTORY_ITEM_ID   AS ERP_ORDER_ITEM_ID,
                 ODL.ORDERED_ITEM        AS ERP_ORDER_ITEM_CODE,
                 NVL(
                   NULLIF(
                     INV_CONVERT.inv_um_convert(
                       ODL.INVENTORY_ITEM_ID,
                       5,
                       ODL.ORDERED_QUANTITY,
                       ODL.ORDER_QUANTITY_UOM,
                       'KG',
                       NULL,
                       NULL
                     ), 
                     -99999
                   ),
                   ODL.ORDERED_QUANTITY
                 )                       AS ERP_ORDER_ITEM_QTY,
                 CASE
                   WHEN ODL.ORDER_QUANTITY_UOM != 'KG' 
                        AND NVL(INV_CONVERT.inv_um_convert(ODL.INVENTORY_ITEM_ID, 5, 1, ODL.ORDER_QUANTITY_UOM, 'KG', NULL, NULL), -99999) != -99999
                     THEN 'KG'
                   ELSE ODL.ORDER_QUANTITY_UOM
                 END                     AS ERP_ORDER_ITEM_UOM,
                 ODL.SCHEDULE_SHIP_DATE  AS ERP_ORDER_SHIP_DATE,
                 ODL.CREATION_DATE       AS ERP_CREATION_DATE,
                 ODL.LAST_UPDATE_DATE    AS ERP_LAST_UPDATE_DATE,
                 ODL.FLOW_STATUS_CODE    AS ERP_ORDER_STATUS
          FROM   OE_ORDER_LINES_ALL ODL
          WHERE  ODL.HEADER_ID IN (${bindNames})
          ORDER BY ODL.HEADER_ID, ODL.LINE_NUMBER
        `;

        const binds: any = {};
        chunk.forEach((id, idx) => {
          binds[`hid${idx}`] = id;
        });

        const result = await conn.execute(sql, binds, {
          outFormat: oracledb.OUT_FORMAT_OBJECT,
        });

        const erpRows: any[] = result.rows || [];
        if (erpRows.length === 0) {
          continue;
        }
        const linesToSave = [];

        // 1. Fetch existing lines in one go for this chunk to check existence
        const erpLineIds = erpRows
          .map((r) => r.ERP_ORDER_LINE_ID)
          .filter((id) => id !== undefined && id !== null);
        if (erpLineIds.length === 0) {
          continue;
        }

        // 1b. Fetch existing lines in chunks of 500 to avoid MS SQL 2100 parameter limit
        const existingLines: StgErpOrderLine[] = [];
        const mssqlChunkSize = 500;
        for (let j = 0; j < erpLineIds.length; j += mssqlChunkSize) {
          const mssqlChunk = erpLineIds.slice(j, j + mssqlChunkSize);
          const chunkLines = await this.stgErpOrderLineRepository.find({
            where: mssqlChunk.map((id) => ({
              erpOrderLineId: id,
              erpOrgId: 82,
            })),
          });
          existingLines.push(...chunkLines);
        }
        const lineMap = new Map(
          existingLines.map((l) => [`${l.erpOrderLineId}_${l.erpOrgId}`, l]),
        );

        for (const row of erpRows) {
          const key = `${row.ERP_ORDER_LINE_ID}_${row.ERP_ORG_ID}`;
          let line = lineMap.get(key);

          if (!line) {
            line = this.stgErpOrderLineRepository.create();
          }

          line.erpOrderLineId = row.ERP_ORDER_LINE_ID;
          line.erpOrderHeaderId = row.ERP_ORDER_HEADER_ID;
          line.erpOrgId = row.ERP_ORG_ID;
          line.erpOrderLineNumber = String(row.ERP_ORDER_LINE_NUMBER);
          line.erpOrderItemId = row.ERP_ORDER_ITEM_ID;
          line.erpOrderItemCode = String(row.ERP_ORDER_ITEM_CODE ?? '');
          line.erpOrderItemQty = row.ERP_ORDER_ITEM_QTY;
          line.erpOrderItemUom = String(row.ERP_ORDER_ITEM_UOM ?? '');
          line.erpOrderShipDate = row.ERP_ORDER_SHIP_DATE;
          line.erpCreationDate = row.ERP_CREATION_DATE;
          line.erpLastUpdateDate = row.ERP_LAST_UPDATE_DATE;
          line.erpOrderStatus = String(row.ERP_ORDER_STATUS ?? '');

          linesToSave.push(line);
        }

        // 2. Bulk save for this chunk in safe batches of 50 to avoid MS SQL 2100 parameter limit
        if (linesToSave.length > 0) {
          const saveChunkSize = 50;
          for (let k = 0; k < linesToSave.length; k += saveChunkSize) {
            const chunkToSave = linesToSave.slice(k, k + saveChunkSize);
            const saved =
              await this.stgErpOrderLineRepository.save(chunkToSave);
            savedLines.push(...saved);
          }
        }

        // 3. Delete orphaned lines (lines that exist locally for these headers but were deleted in ERP)
        const localLinesForHeaders = [];
        for (let j = 0; j < chunk.length; j += mssqlChunkSize) {
          const headerChunk = chunk.slice(j, j + mssqlChunkSize);
          const lines = await this.stgErpOrderLineRepository.find({
            where: headerChunk.map((hid) => ({ erpOrderHeaderId: hid })),
          });
          localLinesForHeaders.push(...lines);
        }

        const oracleLineIds = new Set(
          erpRows.map((r) => String(r.ERP_ORDER_LINE_ID)),
        );
        const orphanedLines = localLinesForHeaders.filter(
          (l) => !oracleLineIds.has(String(l.erpOrderLineId)),
        );

        if (orphanedLines.length > 0) {
          console.log(
            `[ERP Sync] Deleting ${orphanedLines.length} orphaned order lines for synced headers...`,
          );
          // Delete in batches to avoid query limits
          const deleteChunkSize = 1000;
          for (let j = 0; j < orphanedLines.length; j += deleteChunkSize) {
            const deleteChunk = orphanedLines.slice(j, j + deleteChunkSize);
            await this.stgErpOrderLineRepository.remove(deleteChunk);
          }
        }
      }

      return savedLines;
    } catch (err) {
      console.error('Error syncing order lines:', err);
      throw err;
    } finally {
      if (conn) {
        try {
          await conn.close();
        } catch (e) {
          console.error('Error closing oracle connection:', e);
        }
      }
    }
  }

  /**
   * ดึงข้อมูล Order Lines จาก Local DB (SQL Server) ที่ Sync มาแล้ว
   */
  async getLocalOrderLines(): Promise<StgErpOrderLine[]> {
    return this.stgErpOrderLineRepository.find({
      order: { erpOrderHeaderId: 'DESC', erpOrderLineNumber: 'ASC' },
    });
  }

  /**
   * บันทึกรายการ Order แบบ Manual (IVQF, YTR, etc.)
   */
  async saveManualOrder(data: {
    erpOrderNumber: string;
    erpOrderType: string;
    erpCustomerName: string;
    erpOrderDate: string;
    lines: {
      erpOrderItemCode: string;
      erpOrderItemQty: number;
      erpOrderShipDate: string;
    }[];
  }): Promise<any> {
    // 1. Create Header
    const header = this.stgErpOrderHeaderRepository.create({
      erpOrderNumber: data.erpOrderNumber,
      erpOrderType: data.erpOrderType,
      erpCustomerName: data.erpCustomerName,
      erpOrderDate: new Date(data.erpOrderDate),
      erpOrderStatus: 'BOOKED',
      erpOrgId: 82,
      isManual: true,
      erpCreationDate: new Date(),
      erpLastUpdateDate: new Date(),
    });

    const savedHeader = await this.stgErpOrderHeaderRepository.save(header);

    // Use a high offset for manual header IDs to avoid collision with Oracle IDs
    savedHeader.erpOrderHeaderId = 900000000 + savedHeader.id;
    await this.stgErpOrderHeaderRepository.save(savedHeader);

    // 2. Create Lines
    const savedLines = [];
    for (let i = 0; i < data.lines.length; i++) {
      const lineData = data.lines[i];
      let line = this.stgErpOrderLineRepository.create({
        erpOrderHeaderId: savedHeader.erpOrderHeaderId,
        erpOrgId: 82,
        erpOrderLineNumber: String(i + 1),
        erpOrderItemCode: lineData.erpOrderItemCode,
        erpOrderItemQty: lineData.erpOrderItemQty,
        erpOrderItemUom: 'KG', // Default
        erpOrderShipDate: new Date(lineData.erpOrderShipDate),
        erpOrderStatus: 'BOOKED',
        isManual: true,
        erpCreationDate: new Date(),
        erpLastUpdateDate: new Date(),
      });
      line = await this.stgErpOrderLineRepository.save(line);
      line.erpOrderLineId = 900000000 + line.id;
      await this.stgErpOrderLineRepository.save(line);
      savedLines.push(line);
    }

    return { ...savedHeader, lines: savedLines };
  }

  /**
   * แก้ไขรายการ Order แบบ Manual
   */
  async updateManualOrder(id: number, data: any): Promise<any> {
    const header = await this.stgErpOrderHeaderRepository.findOne({
      where: { id, isManual: true },
    });
    if (!header) throw new Error('Order not found');

    header.erpOrderNumber = data.erpOrderNumber;
    header.erpOrderType = data.erpOrderType;
    header.erpCustomerName = data.erpCustomerName;
    header.erpOrderDate = new Date(data.erpOrderDate);
    header.erpLastUpdateDate = new Date();
    await this.stgErpOrderHeaderRepository.save(header);

    // ลบ Lines เก่าทิ้งแล้วลงใหม่
    await this.stgErpOrderLineRepository.delete({
      erpOrderHeaderId: header.erpOrderHeaderId,
    });

    const savedLines = [];
    for (let i = 0; i < data.lines.length; i++) {
      const lineData = data.lines[i];
      let line = this.stgErpOrderLineRepository.create({
        erpOrderHeaderId: header.erpOrderHeaderId,
        erpOrgId: 82,
        erpOrderLineNumber: String(i + 1),
        erpOrderItemCode: lineData.erpOrderItemCode,
        erpOrderItemQty: lineData.erpOrderItemQty,
        erpOrderItemUom: 'KG',
        erpOrderShipDate: new Date(lineData.erpOrderShipDate),
        erpOrderStatus: 'BOOKED',
        isManual: true,
        erpCreationDate: new Date(),
        erpLastUpdateDate: new Date(),
      });
      line = await this.stgErpOrderLineRepository.save(line);
      line.erpOrderLineId = 900000000 + line.id;
      await this.stgErpOrderLineRepository.save(line);
      savedLines.push(line);
    }

    return { ...header, lines: savedLines };
  }

  /**
   * ลบรายการ Order แบบ Manual
   */
  async deleteManualOrder(headerId: number): Promise<any> {
    const header = await this.stgErpOrderHeaderRepository.findOne({
      where: { id: headerId, isManual: true },
    });
    if (!header) throw new Error('Order not found or not a manual order');

    // Delete lines first
    await this.stgErpOrderLineRepository.delete({
      erpOrderHeaderId: header.erpOrderHeaderId,
    });
    // Delete header
    await this.stgErpOrderHeaderRepository.delete(header.id);

    return { success: true };
  }

  /**
   * ดึงข้อมูล Orders สำหรับ Demand Management (Header + Lines + Item Desc จาก stg_erp_items)
   */
  async getDemandOrders(query?: {
    page?: string;
    limit?: string;
    startDate?: string;
    endDate?: string;
    status?: string;
    searchText?: string;
    isManual?: string;
    shipStartDate?: string;
    shipEndDate?: string;
    grade?: string;
  }): Promise<any> {
    const page = query?.page;
    const limit = query?.limit;
    const startDate = query?.startDate;
    const endDate = query?.endDate;
    const status = query?.status;
    const searchText = query?.searchText;
    const isManual = query?.isManual;
    const shipStartDate = query?.shipStartDate;
    const shipEndDate = query?.shipEndDate;
    const grade = query?.grade;
    const headerIdsParam = (query as any)?.headerIds;
    const lineIdsParam = (query as any)?.lineIds;

    const queryBuilder =
      this.stgErpOrderHeaderRepository.createQueryBuilder('header');

    if (startDate && endDate) {
      queryBuilder.andWhere(
        'header.erpOrderDate BETWEEN :startDate AND :endDate',
        { startDate, endDate },
      );
    } else if (startDate) {
      queryBuilder.andWhere('header.erpOrderDate >= :startDate', { startDate });
    } else if (endDate) {
      queryBuilder.andWhere('header.erpOrderDate <= :endDate', { endDate });
    }

    if (shipStartDate && shipEndDate) {
      let subQueryCondition = `header.erpOrderHeaderId IN (
        SELECT DISTINCT l.erp_order_header_id 
        FROM stg_erp_order_lines l 
        WHERE l.erp_order_ship_date BETWEEN :shipStartDate AND :shipEndDate
      )`;

      const binds: any = { shipStartDate, shipEndDate };
      const orConditions = [];

      if (headerIdsParam) {
        const ids = headerIdsParam
          .split(',')
          .map((id: string) => parseInt(id.trim(), 10))
          .filter(Boolean);
        if (ids.length > 0) {
          orConditions.push(`header.erpOrderHeaderId IN (:...headerIds)`);
          binds.headerIds = ids;
        }
      }

      if (lineIdsParam) {
        const lineIds = lineIdsParam
          .split(',')
          .map((id: string) => parseInt(id.trim(), 10))
          .filter(Boolean);
        if (lineIds.length > 0) {
          orConditions.push(`header.erpOrderHeaderId IN (
            SELECT DISTINCT l2.erp_order_header_id 
            FROM stg_erp_order_lines l2 
            WHERE l2.erp_order_line_id IN (:...lineIds)
          )`);
          binds.lineIds = lineIds;
        }
      }

      if (orConditions.length > 0) {
        subQueryCondition = `(${subQueryCondition} OR ${orConditions.join(' OR ')})`;
      }

      queryBuilder.andWhere(subQueryCondition, binds);
    } else {
      const binds: any = {};
      const orConditions = [];

      if (headerIdsParam) {
        const ids = headerIdsParam
          .split(',')
          .map((id: string) => parseInt(id.trim(), 10))
          .filter(Boolean);
        if (ids.length > 0) {
          orConditions.push(`header.erpOrderHeaderId IN (:...headerIds)`);
          binds.headerIds = ids;
        }
      }

      if (lineIdsParam) {
        const lineIds = lineIdsParam
          .split(',')
          .map((id: string) => parseInt(id.trim(), 10))
          .filter(Boolean);
        if (lineIds.length > 0) {
          orConditions.push(`header.erpOrderHeaderId IN (
            SELECT DISTINCT l2.erp_order_header_id 
            FROM stg_erp_order_lines l2 
            WHERE l2.erp_order_line_id IN (:...lineIds)
          )`);
          binds.lineIds = lineIds;
        }
      }

      if (orConditions.length > 0) {
        queryBuilder.andWhere(`(${orConditions.join(' OR ')})`, binds);
      }
    }

    if (status && status !== 'ALL') {
      queryBuilder.andWhere('header.erpOrderStatus = :status', { status });
    }

    if (grade && grade !== 'ALL') {
      queryBuilder.andWhere('header.erpCustomerGrade = :grade', { grade });
    }

    if (isManual !== undefined) {
      queryBuilder.andWhere('header.isManual = :isManual', {
        isManual: isManual === 'true' ? 1 : 0,
      });
    }

    if (searchText) {
      queryBuilder.andWhere(
        '(header.erpOrderNumber LIKE :search OR header.erpCustomerName LIKE :search OR header.erpCustomerNumber LIKE :search)',
        { search: `%${searchText}%` },
      );
    }

    queryBuilder.orderBy('header.erpOrderDate', 'DESC');

    let headers: StgErpOrderHeader[];
    let total = 0;
    const pageNum = page ? parseInt(page, 10) : undefined;
    const limitNum = limit ? parseInt(limit, 10) : undefined;

    if (pageNum && limitNum) {
      queryBuilder.skip((pageNum - 1) * limitNum).take(limitNum);
      const [data, count] = await queryBuilder.getManyAndCount();
      headers = data;
      total = count;
    } else {
      // Only apply a safety limit when NO date filters are present.
      // When shipStartDate/shipEndDate filters are active, return ALL matching
      // headers so the Demand Plan tab shows complete data.
      if (!shipStartDate && !shipEndDate && !startDate && !endDate) {
        queryBuilder.take(1000);
      }
      headers = await queryBuilder.getMany();
    }

    if (headers.length === 0) {
      return pageNum && limitNum
        ? {
            success: true,
            data: [],
            total: 0,
            page: pageNum,
            limit: limitNum,
            totalPages: 0,
          }
        : [];
    }

    const headerIds = headers.map((h) => h.erpOrderHeaderId);

    // Fetch lines only for these headers in chunks to avoid MS SQL 2100 param limit
    const lines: any[] = [];
    const chunkSize = 500;
    for (let i = 0; i < headerIds.length; i += chunkSize) {
      const chunkIds = headerIds.slice(i, i + chunkSize);
      const chunkLines = await this.stgErpOrderLineRepository.find({
        where: { erpOrderHeaderId: In(chunkIds) },
      });
      lines.push(...chunkLines);
    }

    // Extract unique item codes to fetch descriptions
    const uniqueItemCodes = [...new Set(lines.map((l) => l.erpOrderItemCode))];
    const items: any[] = [];
    if (uniqueItemCodes.length > 0) {
      for (let i = 0; i < uniqueItemCodes.length; i += chunkSize) {
        const chunkCodes = uniqueItemCodes.slice(i, i + chunkSize);
        const chunkItems = await this.stgErpItemRepository.find({
          where: { erpItemCode: In(chunkCodes) },
        });
        items.push(...chunkItems);
      }
    }

    // สร้าง Map ของ Item Code -> Item Description
    const itemMap = new Map<string, string>();
    items.forEach((i) => itemMap.set(i.erpItemCode, i.erpItemDesc));

    // Fetch the sum of quantity_kg from mps_plan_orders grouped by erp_order_line_id
    const allocationMap = new Map<number, number>();
    const lineIds = lines
      .map((l) => l.erpOrderLineId)
      .filter((id) => id !== null && id !== undefined);
    if (lineIds.length > 0) {
      const allocationChunkSize = 500;
      for (let i = 0; i < lineIds.length; i += allocationChunkSize) {
        const chunk = lineIds.slice(i, i + allocationChunkSize);
        const allAllocations = await this.stgErpOrderLineRepository.query(`
          SELECT erp_order_line_id AS lineId, SUM(quantity_kg) AS totalAllocated
          FROM mps_plan_orders
          WHERE erp_order_line_id IN (${chunk.join(',')})
          GROUP BY erp_order_line_id
        `);
        allAllocations.forEach((alloc: any) => {
          allocationMap.set(
            Number(alloc.lineId),
            Number(alloc.totalAllocated || 0),
          );
        });
      }
    }

    const mappedData = headers.map((h) => ({
      ...h,
      lines: lines
        .filter((l) => l.erpOrderHeaderId === h.erpOrderHeaderId)
        .sort(
          (a, b) => Number(a.erpOrderLineNumber) - Number(b.erpOrderLineNumber),
        )
        .map((l) => ({
          ...l,
          erpItemDesc: itemMap.get(l.erpOrderItemCode) || null,
          isItemSynced: itemMap.has(l.erpOrderItemCode),
          totalAllocatedQty: allocationMap.get(l.erpOrderLineId) || 0,
        })),
    }));

    if (pageNum && limitNum) {
      return {
        success: true,
        data: mappedData,
        total,
        page: pageNum,
        limit: limitNum,
        totalPages: Math.ceil(total / limitNum),
      };
    } else {
      return mappedData;
    }
  }

  /**
   * ดึงข้อมูลสูตร (Recipe) จาก Oracle ERP ตาม Item Code
   */
  async getRecipesByItemCode(itemCode: string): Promise<any> {
    const item = await this.stgErpItemRepository.findOne({
      where: { erpItemCode: itemCode },
    });

    if (!item || !item.erpItemId) {
      console.warn(`Item code ${itemCode} not found in local DB or missing erpItemId`);
      return [];
    }

    const itemId = item.erpItemId;
    let conn;
    try {
      conn = await this.connect();

      const sql = `
        SELECT RCP.RECIPE_ID,
               RECIPE_NO,
               RECIPE_VERSION,
               RECIPE_DESCRIPTION
        FROM   GMD_RECIPES RCP
        JOIN   FM_FORM_MST FHDR ON FHDR.FORMULA_ID = RCP.FORMULA_ID
        JOIN   FM_MATL_DTL FDTL ON FDTL.FORMULA_ID = FHDR.FORMULA_ID
        WHERE  RCP.OWNER_ORGANIZATION_ID = 122
        AND    RCP.RECIPE_STATUS = 700
        AND    FHDR.FORMULA_STATUS = 700
        AND    FDTL.INVENTORY_ITEM_ID = :itemId
      `;

      const result = await conn.execute(sql, { itemId: Number(itemId) }, {
        outFormat: oracledb.OUT_FORMAT_OBJECT,
      });

      return result.rows;
    } catch (err) {
      console.error('Error fetching recipes:', err);
      throw err;
    } finally {
      if (conn) {
        try {
          await conn.close();
        } catch (e) {
          console.error('Error closing oracle connection:', e);
        }
      }
    }
  }

  /**
   * สร้าง Auto Batch โดยบันทึกลง SG_GME_BATCH_INF
   */
  async createAutoBatch(recipes: { recipeNo: string, recipeVersion: number | string, itemCode?: string }[], partId: string, planDate: string): Promise<any> {
    if (!recipes || recipes.length === 0) return { success: false, message: 'No recipes provided' };
    
    // Format planDate to YYYYMMDD (assuming planDate might come as YYYY-MM-DD or similar)
    const cleanDate = planDate ? planDate.replace(/-/g, '') : new Date().toISOString().split('T')[0].replace(/-/g, '');
    const prefix = `DPS-${(partId || 'UNKNOWN').toUpperCase()}-${cleanDate}-`;
    
    let conn;
    try {
      conn = await this.connect();

      // Find max sequence for the day
      const seqSql = `
        SELECT MAX(BATCH_NAME) as MAX_BATCH
        FROM SG_GME_BATCH_INF
        WHERE BATCH_NAME LIKE :prefix
      `;
      const seqResult = await conn.execute(seqSql, { prefix: `${prefix}%` }, { outFormat: oracledb.OUT_FORMAT_OBJECT });
      
      let nextSeq = 1;
      const maxBatch = (seqResult.rows?.[0] as any)?.MAX_BATCH;
      if (maxBatch) {
        const parts = maxBatch.split('-');
        const lastSeqStr = parts[parts.length - 1];
        const lastSeq = parseInt(lastSeqStr, 10);
        if (!isNaN(lastSeq)) {
          nextSeq = lastSeq + 1;
        }
      }
      
      const batchName = `${prefix}${nextSeq.toString().padStart(2, '0')}`;
      
      // Get unique recipes to insert into Oracle
      const uniqueRecipes = Array.from(new Map(recipes.map(r => [r.recipeNo, r])).values());

      // Insert unique recipes
      for (const recipe of uniqueRecipes) {
        const insertSql = `
          INSERT INTO SG_GME_BATCH_INF (
            RECIPE_NO,
            RECIPE_VERSION,
            FLAG,
            BATCH_NAME
          ) VALUES (
            :recipeNo,
            :recipeVersion,
            'N',
            :batchName
          )
        `;
        
        await conn.execute(insertSql, {
          recipeNo: String(recipe.recipeNo),
          recipeVersion: Number(recipe.recipeVersion),
          batchName: batchName
        }, { autoCommit: false });
      }
      
      // Commit transaction
      await conn.commit();
      
      // Execute the Auto Batch PL/SQL script
      const plsqlBinds = {
        user_id: '1228',
        plan_start_date: `${cleanDate.substring(0, 4)}/${cleanDate.substring(4, 6)}/${cleanDate.substring(6, 8)} 00:00:00`,
        org_code: 'PRD',
        batch_name: batchName,
        x_retcode: { dir: oracledb.BIND_OUT, type: oracledb.STRING, maxSize: 10 },
        x_errbuf: { dir: oracledb.BIND_OUT, type: oracledb.STRING, maxSize: 2000 }
      };

      const plsqlResult = await conn.execute(AUTO_BATCH_PLSQL, plsqlBinds, { autoCommit: true });
      const retcode = (plsqlResult.outBinds as any)?.x_retcode;
      const errbuf = (plsqlResult.outBinds as any)?.x_errbuf;
      console.log(`Auto Batch PL/SQL Result -> Retcode: ${retcode}, Errbuf: ${errbuf}`);

      // Query Oracle for generated Batch Numbers mapped by Recipe No
      const fetchBatchNosSql = `
        SELECT h.BATCH_NO, r.RECIPE_NO, r.RECIPE_VERSION, b.FLAG, b.ERROR_MSG
        FROM GME_BATCH_HEADER h
        JOIN GMD_RECIPE_VALIDITY_RULES v ON h.RECIPE_VALIDITY_RULE_ID = v.RECIPE_VALIDITY_RULE_ID
        JOIN GMD_RECIPES r ON v.RECIPE_ID = r.RECIPE_ID
        JOIN SG_GME_BATCH_INF b ON r.RECIPE_NO = b.RECIPE_NO AND SUBSTR(b.RECIPE_VERSION,1,2) = TO_CHAR(r.RECIPE_VERSION) AND b.BATCH_NAME = h.ATTRIBUTE2
        WHERE h.ATTRIBUTE2 = :batchName
      `;
      
      let batchMapping: any[] = [];
      try {
        const batchNosResult = await conn.execute(fetchBatchNosSql, { batchName }, { outFormat: oracledb.OUT_FORMAT_OBJECT });
        batchMapping = batchNosResult.rows || [];
      } catch (e) {
        console.error('Error fetching generated batch numbers:', e);
      }

      // Query any failed items in SG_GME_BATCH_INF that didn't get a BATCH_NO
      const fetchFailedSql = `
        SELECT RECIPE_NO, RECIPE_VERSION, FLAG, ERROR_MSG
        FROM SG_GME_BATCH_INF
        WHERE BATCH_NAME = :batchName AND FLAG = 'E'
      `;
      try {
        const failedResult = await conn.execute(fetchFailedSql, { batchName }, { outFormat: oracledb.OUT_FORMAT_OBJECT });
        if (failedResult.rows && failedResult.rows.length > 0) {
          batchMapping = [...batchMapping, ...failedResult.rows];
        }
      } catch (e) {
        console.error('Error fetching failed batches:', e);
      }

      // Save logs to local database - FOR EACH ITEM CARD (not just unique recipes)
      const logs = recipes.map(recipe => {
        const mappingItem: any = batchMapping.find((m: any) => 
          String(m.RECIPE_NO) === String(recipe.recipeNo)
        );
        
        let status = 'PENDING';
        let errorMsg = null;
        let batchNo = null;

        if (mappingItem) {
          status = mappingItem.FLAG === 'Y' ? 'SUCCESS' : (mappingItem.FLAG === 'E' ? 'ERROR' : 'UNKNOWN');
          errorMsg = mappingItem.ERROR_MSG;
          batchNo = mappingItem.BATCH_NO || null;
        } else if (retcode !== '0') {
          status = 'ERROR';
          errorMsg = errbuf || 'API Error without mapping';
        }

        return this.dpsAutoBatchLogRepository.create({
          batchName,
          partId: partId || 'UNKNOWN',
          planDate: planDate,
          itemCode: recipe.itemCode || undefined,
          recipeNo: String(recipe.recipeNo),
          recipeVersion: String(recipe.recipeVersion),
          status,
          errorMsg,
          batchNo
        });
      });
      if (logs.length > 0) {
        await this.dpsAutoBatchLogRepository.save(logs);
      }
      
      return { 
        success: true, 
        batchName: batchName, 
        count: recipes.length,
        retcode,
        errbuf
      };
    } catch (err) {
      console.error('Error creating auto batch:', err);
      if (conn) {
        try { await conn.rollback(); } catch (e) {}
      }
      throw err;
    } finally {
      if (conn) {
        try {
          await conn.close();
        } catch (e) {
          console.error('Error closing oracle connection:', e);
        }
      }
    }
  }

  /**
   * ดึงประวัติการรัน Batch Auto
   */
  async getBatchLogs(partId: string, planDate: string) {
    try {
      const logs = await this.dpsAutoBatchLogRepository.find({
        where: {
          partId,
          planDate
        },
        order: {
          createdAt: 'DESC'
        }
      });
      return { success: true, logs };
    } catch (err) {
      console.error('Error fetching batch logs:', err);
      return { success: false, message: 'Failed to fetch batch logs' };
    }
  }

  /**
   * ปิดการเชื่อมต่อเมื่อ Module ถูกทำลาย (แอปปิดตัว)
   */
  async onModuleDestroy() {
    if (this.pool) {
      try {
        await this.pool.close(10);
        console.log('Oracle Connection Pool closed successfully');
      } catch (err) {
        console.error('Error closing Oracle connection pool:', err);
      }
    }
  }
}
