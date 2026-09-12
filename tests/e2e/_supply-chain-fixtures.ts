import { randomBytes } from 'node:crypto';
import { Client } from 'pg';
import { databasePoolConfig } from '../../lib/database-session';
import { E2E_USERS } from './global-setup';

export function assertSupplyChainIsolation(): void {
  if (
    process.env.E2E_APPEND_ONLY_DATABASE_ISOLATED !== '1' ||
    !process.env.E2E_DATABASE_URL?.trim() ||
    process.env.DATABASE_URL?.trim() !== process.env.E2E_DATABASE_URL.trim()
  ) {
    throw new Error('采购和外协事务回归必须使用已启用的独立 E2E_DATABASE_URL');
  }
}

export async function withSupplyChainDb<T>(action: (db: Client) => Promise<T>): Promise<T> {
  assertSupplyChainIsolation();
  const db = new Client(databasePoolConfig(process.env.DATABASE_URL!));
  await db.connect();
  try { return await action(db); } finally { await db.end(); }
}

async function seedInTransaction<T>(action: (db: Client) => Promise<T>): Promise<T> {
  return withSupplyChainDb(async (db) => {
    await db.query('BEGIN');
    try {
      const value = await action(db);
      await db.query('COMMIT');
      return value;
    } catch (error) {
      await db.query('ROLLBACK');
      throw error;
    }
  });
}

// Only prerequisites are inserted. Purchase, receipt, reversal, outsource,
// amount confirmation, payments and completion must come from real UI actions.
// Keep each run's immutable business records; no cleanup deletes ledgers.
export async function seedPurchasePrerequisites() {
  const prefix = `e2e-purchase-${randomBytes(6).toString('hex')}`;
  const supplierId = `${prefix}-supplier`;
  const materialId = `${prefix}-material`;
  const warehouseId = `${prefix}-warehouse`;
  const locationId = `${prefix}-location`;
  await seedInTransaction(async (db) => {
    await db.query(
      `INSERT INTO "Party" (id,type,code,name,"isActive","createdAt","updatedAt")
       VALUES ($1::text,'SUPPLIER',$1::text,'采购回归供应商',TRUE,NOW(),NOW())`, [supplierId],
    );
    await db.query(
      `INSERT INTO "Material" (id,code,name,category,unit,"currentStock","isActive","createdAt","updatedAt")
       VALUES ($1::text,$1::text,'采购回归物料','OTHER','件',0,TRUE,NOW(),NOW())`, [materialId],
    );
    await db.query(
      `INSERT INTO "Warehouse" (id,code,name,"isActive","createdAt","updatedAt")
       VALUES ($1::text,$1::text,'采购回归仓库',TRUE,NOW(),NOW())`, [warehouseId],
    );
    await db.query(
      `INSERT INTO "WarehouseLocation" (id,"warehouseId",code,name,"isActive","createdAt","updatedAt")
       VALUES ($1,$2,'E2E','采购回归库位',TRUE,NOW(),NOW())`, [locationId, warehouseId],
    );
  });
  return { supplierId, materialId, warehouseId, locationId };
}

export async function readPurchaseState(purchaseOrderId: string, materialId: string) {
  return withSupplyChainDb(async (db) => {
    const order = await db.query<{ id: string; status: string }>('SELECT id,status::text FROM "PurchaseOrder" WHERE id=$1', [purchaseOrderId]);
    const items = await db.query<{ quantity: string; receivedQuantity: string }>('SELECT quantity::text,"receivedQuantity"::text FROM "PurchaseOrderItem" WHERE "purchaseOrderId"=$1 ORDER BY id', [purchaseOrderId]);
    const receipts = await db.query<{ id: string; status: string; cancelReason: string | null }>('SELECT id,status::text,"cancelReason" FROM "PurchaseReceipt" WHERE "purchaseOrderId"=$1 ORDER BY id', [purchaseOrderId]);
    const material = await db.query<{ currentStock: string }>('SELECT "currentStock"::text FROM "Material" WHERE id=$1', [materialId]);
    const locationStocks = await db.query<{ locationId: string; currentStock: string }>('SELECT "locationId","currentStock"::text FROM "MaterialLocationStock" WHERE "materialId"=$1 ORDER BY id', [materialId]);
    const transactions = await db.query<{ id: string; direction: string; quantity: string; reasonType: string; purchaseReceiptItemId: string }>('SELECT id,direction::text,quantity::text,"reasonType","purchaseReceiptItemId" FROM "MaterialTransaction" WHERE "materialId"=$1 ORDER BY "createdAt",id', [materialId]);
    return { order: order.rows[0], items: items.rows, receipts: receipts.rows, stock: material.rows[0]?.currentStock, locationStocks: locationStocks.rows, transactions: transactions.rows };
  });
}

export async function seedOutsourcePrerequisites() {
  const prefix = `e2e-outsource-${randomBytes(6).toString('hex')}`;
  const orderId = `${prefix}-order`;
  const orderNo = `OUT-${prefix.slice(-12)}`;
  const craftId = `${prefix}-craft`;
  const itemIds = [`${prefix}-item-1`, `${prefix}-item-2`] as const;
  await seedInTransaction(async (db) => {
    const actor = await db.query<{ id: string }>('SELECT id FROM "User" WHERE username=$1::citext AND role=\'ADMIN\' AND "isActive"=TRUE', [E2E_USERS.owner!.username]);
    if (actor.rowCount !== 1) throw new Error('外协回归需要隔离库中的管理员 fixture');
    await db.query(
      `INSERT INTO "Craft" (id,name,code,"isOutsource","inHouseMachineTypes","isActive","createdAt","updatedAt")
       VALUES ($1,$2,$1,TRUE,ARRAY[]::"MachineType"[],TRUE,NOW(),NOW())`, [craftId, `外协回归工艺 ${prefix}`],
    );
    // A pure-outsource current generation legitimately has no internal work.
    // The completion service must still enforce quantity coverage for both
    // styles and write PACKING/completedAt itself after the second receipt.
    await db.query(
      `INSERT INTO "Order" (id,"orderNo","submitterId","submitterRole","createdById","settlementType",status,"workOrderVersion","requiresOutsource","customName","customerRef","submittedAt","createdAt","updatedAt")
       VALUES ($1,$2,$3,'ADMIN',$3,'FACTORY_DIRECT','RELEASED',1,TRUE,'外协回归工单','外协回归客户',NOW(),NOW(),NOW())`,
      [orderId, orderNo, actor.rows[0]!.id],
    );
    for (const [index, itemId] of itemIds.entries()) {
      await db.query(
        `INSERT INTO "OrderItem" (id,"orderId",sequence,name,"pricingRoute",craft,"productStructure",specification,"paperType","paperWeightGsm",quantity,"frontFoilColors","foilColors","foilTechnique","printColors","printColorsKnown",crafts,"createdAt","updatedAt")
         VALUES ($1,$2,$3,$4,'COLOR_PRINT','PRINT','STANDARD_ENVELOPE','大号88×165','200g铜版纸',200,$5,ARRAY[]::text[],ARRAY[]::text[],'NONE',ARRAY['四色']::text[],TRUE,ARRAY[$6]::text[],NOW(),NOW())`,
        [itemId, orderId, index + 1, `外协回归款${index + 1}`, (index + 1) * 100, craftId],
      );
    }
  });
  return { orderId, orderNo, itemIds };
}

export async function readOutsourceState(orderId: string) {
  return withSupplyChainDb(async (db) => {
    const order = await db.query<{ status: string; completedAt: Date | null; workOrderVersion: number }>('SELECT status::text,"completedAt","workOrderVersion" FROM "Order" WHERE id=$1', [orderId]);
    const rows = await db.query<{ id: string; status: string; totalQty: number; amount: string | null }>('SELECT id,status::text,"totalQty",amount::text FROM "OutsourceOrder" WHERE "orderId"=$1 ORDER BY "createdAt",id', [orderId]);
    const snapshots = await db.query<{ outsourceOrderId: string; orderItemId: string; quantity: number }>('SELECT snapshot."outsourceOrderId",snapshot."orderItemId",snapshot.quantity FROM "OutsourceOrderItemSnapshot" snapshot JOIN "OutsourceOrder" outsource ON outsource.id=snapshot."outsourceOrderId" WHERE outsource."orderId"=$1 ORDER BY snapshot."orderItemId"', [orderId]);
    const payments = await db.query<{ id: string; outsourceOrderId: string; amount: string }>('SELECT payment.id,payment."outsourceOrderId",payment.amount::text FROM "OutsourcePayment" payment JOIN "OutsourceOrder" outsource ON outsource.id=payment."outsourceOrderId" WHERE outsource."orderId"=$1 ORDER BY payment."createdAt",payment.id', [orderId]);
    const changes = await db.query<{ outsourceOrderId: string; previousAmount: string | null; newAmount: string; reason: string }>('SELECT change."outsourceOrderId",change."previousAmount"::text,change."newAmount"::text,change.reason FROM "OutsourceAmountChange" change JOIN "OutsourceOrder" outsource ON outsource.id=change."outsourceOrderId" WHERE outsource."orderId"=$1 ORDER BY change."createdAt",change.id', [orderId]);
    const completionLogs = await db.query<{ id: string }>('SELECT id FROM "OrderLog" WHERE "orderId"=$1 AND action=\'PRODUCTION_COMPLETED\' ORDER BY id', [orderId]);
    return { order: order.rows[0], rows: rows.rows, snapshots: snapshots.rows, payments: payments.rows, changes: changes.rows, completionLogs: completionLogs.rows };
  });
}
