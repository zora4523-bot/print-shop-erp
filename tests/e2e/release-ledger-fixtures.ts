import { randomUUID } from 'node:crypto';
import bcrypt from 'bcryptjs';
import { Client } from 'pg';
import { assertActivatedE2eDatabase } from '../../scripts/lib/e2e-environment';
import { currentShanghaiMonth } from '../../lib/dashboard/shanghai-clock';
import { E2E_PASSWORD } from './global-setup';

export async function withLedgerDb<T>(run: (db: Client) => Promise<T>): Promise<T> {
  const database = assertActivatedE2eDatabase();
  const db = new Client({ connectionString: database.url });
  await db.connect();
  try {
    const identity = await db.query('SELECT current_database() AS name');
    if (identity.rows[0]?.name !== database.databaseName) throw new Error('Ledger fixture database identity mismatch');
    return await run(db);
  } finally { await db.end(); }
}

export type LedgerAccount = { id: string; username: string; name: string };

async function createAccount(db: Client, prefix: string, worker: boolean, startDate: string): Promise<LedgerAccount> {
  const suffix = randomUUID().slice(0, 8);
  const account = { id: `e2e-${prefix}-${suffix}`, username: `e2e-${prefix}-${suffix}`, name: `验收${prefix}${suffix}` };
  await db.query(`INSERT INTO "User" (id, username, "displayName", password, role,
    "workerType", "employmentType", "employmentStartDate", "isActive", "updatedAt")
    VALUES ($1,$2,$3,$4,$5::"Role",$6::"WorkerType",'FULL_TIME',$7::date,true,NOW())`,
  [account.id, account.username, account.name, await bcrypt.hash(E2E_PASSWORD, 10),
    worker ? 'WORKER' : 'ADMIN', worker ? 'PACKER' : null, startDate]);
  return account;
}

export async function seedInventoryLedgerFixture() {
  return withLedgerDb(async (db) => {
    const suffix = randomUUID().slice(0, 8);
    const fixture = {
      materialId: `e2e-inventory-material-${suffix}`, materialCode: `E2E-LEDGER-${suffix}`,
      materialName: `库存验收物料${suffix}`, warehouseId: `e2e-ledger-warehouse-${suffix}`,
      warehouseName: `验收仓${suffix}`, sourceId: `e2e-ledger-source-${suffix}`,
      destinationId: `e2e-ledger-destination-${suffix}`,
    };
    await db.query('BEGIN');
    try {
      const admin = await createAccount(db, 'inventory', false, `${currentShanghaiMonth()}-01`);
      await db.query(`INSERT INTO "Material" (id,code,name,category,unit,"currentStock","updatedAt")
        VALUES ($1,$2,$3,'OTHER','个',0,NOW())`, [fixture.materialId, fixture.materialCode, fixture.materialName]);
      await db.query(`INSERT INTO "Warehouse" (id,code,name,"updatedAt") VALUES ($1,$2,$3,NOW())`,
        [fixture.warehouseId, `E2E-${suffix}`, fixture.warehouseName]);
      for (const [id, code, name] of [[fixture.sourceId, 'SOURCE', '来源'], [fixture.destinationId, 'DEST', '目标']]) {
        await db.query(`INSERT INTO "WarehouseLocation" (id,"warehouseId",code,name,"updatedAt") VALUES ($1,$2,$3,$4,NOW())`,
          [id, fixture.warehouseId, code, name]);
      }
      await db.query('COMMIT');
      return { ...fixture, admin };
    } catch (error) { await db.query('ROLLBACK'); throw error; }
  });
}

export async function inventoryLedger(materialId: string) {
  return withLedgerDb(async (db) => {
    const material = await db.query<{ currentStock: string }>('SELECT "currentStock"::text AS "currentStock" FROM "Material" WHERE id=$1', [materialId]);
    const stocks = await db.query<{ locationId: string; quantity: string }>(
      'SELECT "locationId", "currentStock"::text AS quantity FROM "MaterialLocationStock" WHERE "materialId"=$1 ORDER BY "locationId"', [materialId]);
    const transactions = await db.query<{ id: string; direction: string; quantity: string; reasonType: string; stockTransferId: string | null; inventoryCountItemId: string | null }>(
      `SELECT id,direction::text,quantity::text,"reasonType","stockTransferId","inventoryCountItemId"
       FROM "MaterialTransaction" WHERE "materialId"=$1 ORDER BY "occurredAt",id`, [materialId]);
    const transfers = await db.query('SELECT id,"idempotencyKey",quantity::text FROM "StockTransfer" WHERE "materialId"=$1', [materialId]);
    const counts = await db.query(`SELECT item.id,item."bookQuantity"::text,item."countedQuantity"::text,item.difference::text,
      count."idempotencyKey" FROM "InventoryCountItem" item JOIN "InventoryCount" count ON count.id=item."inventoryCountId"
      WHERE item."materialId"=$1`, [materialId]);
    return { total: material.rows[0]?.currentStock, stocks: stocks.rows, transactions: transactions.rows,
      transfers: transfers.rows, counts: counts.rows };
  });
}

export async function seedSalaryLedgerFixture() {
  const [year, month] = currentShanghaiMonth().split('-').map(Number);
  const previous = new Date(Date.UTC(year!, month! - 2, 1));
  const period = `${previous.getUTCFullYear()}-${String(previous.getUTCMonth() + 1).padStart(2, '0')}`;
  return withLedgerDb(async (db) => {
    const admin = await createAccount(db, 'salary-admin', false, `${period}-01`);
    const worker = await createAccount(db, 'salary-packer', true, `${period}-01`);
    return { admin, worker, month: period, date: `${period}-01` };
  });
}

// 历史打包时薪月结只剩存档：直接写一条已归档记录，模拟切换工序计件前的旧数据。
export async function archiveHourlyPayroll(workerId: string, month: string) {
  return withLedgerDb(async (db) => {
    await db.query(`INSERT INTO "HourlyWorkerPayroll" (id,"workerId",month,"totalWorkHours","totalOtHours",
      "hourlyRate","otMultiplier","baseSalary","otSalary","totalSalary","salaryRuleSnapshot","isPaid","updatedAt")
      VALUES ($1,$2,$3,8,2,11,1,88,22,110,'{"workerType":"PACKER"}'::jsonb,true,NOW())`,
    [`e2e-archive-${randomUUID().slice(0, 8)}`, workerId, month]);
  });
}

export async function salaryLedger(workerId: string, month: string) {
  return withLedgerDb(async (db) => ({
    attendance: (await db.query(`SELECT id,"normalHours"::text,"otHours"::text,"workUnits"::text,
      "roleSnapshot"::text,"workerTypeSnapshot"::text,"identitySnapshotVerified"
      FROM "Attendance" WHERE "workerId"=$1 AND to_char(date,'YYYY-MM')=$2`, [workerId, month])).rows,
    payroll: (await db.query(`SELECT id,"totalWorkHours"::text,"totalOtHours"::text,"hourlyRate"::text,
      "otMultiplier"::text,"baseSalary"::text,"otSalary"::text,"totalSalary"::text,
      "dailyDetail","salaryRuleSnapshot","isPaid","paidAt","updatedAt"
      FROM "HourlyWorkerPayroll" WHERE "workerId"=$1 AND month=$2`, [workerId, month])).rows,
  }));
}
