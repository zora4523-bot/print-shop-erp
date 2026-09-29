import { randomUUID } from 'node:crypto';
import { Client } from 'pg';
import { beforeAll, describe, expect, it, vi } from 'vitest';
import { db } from '@/lib/db';
import { createWarehouse, createWarehouseLocation, listActiveWarehouseLocationOptions } from '@/lib/warehouse';
import { maintainWarehouse, type WarehouseMaintenanceInput } from '@/lib/warehouse-maintenance';
import { acquireWarehouseStockLock, WAREHOUSE_CONFIGURATION_LOCK } from '@/lib/warehouse-coordination';
import { createMaterialTransaction } from '@/lib/material';
import { createPurchaseOrder, createPurchaseReceipt, cancelPurchaseReceipt } from '@/lib/purchase';
import { createStockTransfer } from '@/lib/stock-transfer';
import { postInventoryCount } from '@/lib/inventory-count-posting';
import { listInventoryCountMaterials } from '@/lib/inventory-count';

vi.mock('server-only', () => ({}));
const url = process.env.DATABASE_URL;
const isolated = Boolean(url && url === process.env.E2E_DATABASE_URL && new URL(url).pathname.slice(1) === process.env.E2E_DATABASE_CONFIRM_DATABASE && /(?:^|_)e2e_/.test(new URL(url).pathname));
const postgres = isolated ? describe : describe.skip;
const prefix = `wh_${randomUUID().replaceAll('-', '')}`;
const actorId = `${prefix}_admin`;
const otherId = `${prefix}_sales`;

async function fixture() {
  const id = randomUUID().replaceAll('-', '');
  const warehouse = await createWarehouse({ code: `W${id}`, name: '仓库维护回归' }, actorId);
  const source = await createWarehouseLocation({ warehouseId: warehouse.id, code: 'SRC', name: '来源' }, actorId);
  const target = await createWarehouseLocation({ warehouseId: warehouse.id, code: 'DST', name: '目标' }, actorId);
  const material = await db.material.create({ data: { code: `M${id}`, name: '维护测试物料', unit: '件', category: 'OTHER' } });
  return { warehouse, source, target, material };
}
type Fixture = Awaited<ReturnType<typeof fixture>>;
const disable = (row: { id: string; updatedAt: Date }, kind: 'warehouse' | 'location' = 'location'): WarehouseMaintenanceInput => ({ kind, id: row.id, expectedUpdatedAt: row.updatedAt.toISOString(), operation: 'disable' });
const movement = (f: Fixture, locationId = f.target.id, direction: 'IN' | 'OUT' = 'IN') => createMaterialTransaction({ idempotencyKey: randomUUID(), materialId: f.material.id, locationId, direction, quantity: '2', reasonType: 'OTHER', remark: '仓库维护并发回归', operatorId: actorId, unitCost: null });

/** Hold exactly the coordination key, queue real domain transactions in order,
 * and release only after PostgreSQL confirms each waiter. No timing sleeps. */
async function ordered(first: () => Promise<unknown>, second: () => Promise<unknown>) {
  const gate = new Client({ connectionString: url });
  await gate.connect();
  const pending: Promise<unknown>[] = [];
  try {
    await gate.query('BEGIN');
    await gate.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))', [WAREHOUSE_CONFIGURATION_LOCK]);
    for (const [index, fn] of [first, second].entries()) {
      const promise = fn();
      // Attach rejection handling immediately; the final result remains inspectable.
      pending.push(promise.then((value) => ({ status: 'fulfilled', value }), (reason: unknown) => ({ status: 'rejected', reason })));
      const deadline = Date.now() + 3500;
      let count = 0;
      while (Date.now() < deadline) {
        const rows = await gate.query<{ count: string }>(`SELECT count(*)::text FROM pg_locks waiter JOIN pg_locks held ON held.locktype='advisory' AND held.pid=pg_backend_pid() AND held.granted AND waiter.locktype=held.locktype AND waiter.database=held.database AND waiter.classid=held.classid AND waiter.objid=held.objid AND waiter.objsubid=held.objsubid WHERE NOT waiter.granted`);
        count = Number(rows.rows[0]!.count);
        if (count >= index + 1) break;
      }
      expect(count).toBe(index + 1);
    }
    await gate.query('COMMIT');
    return await Promise.all(pending) as PromiseSettledResult<unknown>[];
  } finally { await gate.query('ROLLBACK'); await Promise.allSettled(pending); await gate.end(); }
}

postgres.sequential('warehouse maintenance · real isolated PostgreSQL', () => {
  beforeAll(async () => {
    await db.user.create({ data: { id: actorId, username: actorId, password: 'not-a-login-hash', displayName: '仓库测试管理员', role: 'ADMIN' } });
    await db.user.create({ data: { id: otherId, username: otherId, password: 'not-a-login-hash', displayName: '仓库测试销售', role: 'SALES' } });
  });

  it('rename uses monotonic CAS, no-op creates no audit, stale/unauthorized writes preserve data', async () => {
    const f = await fixture();
    const input = { ...disable(f.target), operation: 'rename' as const, name: '改正后的名称' };
    const after = await maintainWarehouse(input, actorId);
    expect(after.updatedAt.getTime()).toBeGreaterThan(f.target.updatedAt.getTime());
    await maintainWarehouse(input, actorId);
    expect(await db.businessAuditLog.count({ where: { entityId: f.target.id, action: 'WAREHOUSE_MAINTAINED' } })).toBe(1);
    await expect(maintainWarehouse({ ...input, name: '旧页面覆盖' }, actorId)).rejects.toThrow('已被修改');
    await expect(maintainWarehouse({ ...input, expectedUpdatedAt: after.updatedAt.toISOString(), name: '越权' }, otherId)).rejects.toThrow('无权');
    await expect(createWarehouse({ code: null, name: '越权仓库' }, otherId)).rejects.toThrow('无权');
    await db.user.update({ where: { id: otherId }, data: { role: 'ADMIN', isActive: false } });
    await expect(maintainWarehouse(input, otherId)).rejects.toThrow('无权');
    expect((await db.warehouseLocation.findUniqueOrThrow({ where: { id: f.target.id } })).name).toBe(input.name);
  });

  it('default and nonzero stock reject; parent disable preserves child flags and zero history may restore', async () => {
    const f = await fixture();
    const defaults = await db.warehouseLocation.findFirstOrThrow({ where: { isDefault: true, warehouse: { isDefault: true } } });
    await expect(maintainWarehouse(disable(defaults), actorId)).rejects.toThrow('默认');
    const defaultWarehouse = await db.warehouse.findUniqueOrThrow({ where: { id: defaults.warehouseId } });
    await expect(maintainWarehouse(disable(defaultWarehouse, 'warehouse'), actorId)).rejects.toThrow('默认');
    await movement(f);
    await expect(maintainWarehouse(disable(f.warehouse, 'warehouse'), actorId)).rejects.toThrow('仍有库存');
    await expect(maintainWarehouse(disable(f.target), actorId)).rejects.toThrow('仍有库存');
    await movement(f, f.target.id, 'OUT');
    await maintainWarehouse(disable(f.target), actorId);
    const off = await maintainWarehouse(disable(f.warehouse, 'warehouse'), actorId);
    expect((await listActiveWarehouseLocationOptions()).some((row) => row.warehouseId === f.warehouse.id)).toBe(false);
    await maintainWarehouse({ ...disable(off, 'warehouse'), operation: 'restore' }, actorId);
    expect((await db.warehouseLocation.findUniqueOrThrow({ where: { id: f.target.id } })).isActive).toBe(false);
    expect((await db.warehouseLocation.findUniqueOrThrow({ where: { id: f.source.id } })).isActive).toBe(true);
    expect(await db.materialTransaction.count({ where: { materialId: f.material.id } })).toBe(2);
  });

  for (const writer of ['movement', 'transfer', 'count', 'receipt'] as const) {
    for (const writeFirst of [true, false]) {
      it(`${writer} vs disable, ${writeFirst ? 'write' : 'disable'} first; no stock enters an inactive location`, async () => {
        const f = await fixture();
        if (writer === 'transfer') await movement(f, f.source.id);
        const supplier = writer === 'receipt' ? await db.party.create({ data: { code: randomUUID(), type: 'SUPPLIER', name: '并发收货供应商' } }) : null;
        const order = supplier ? await createPurchaseOrder({ supplierPartyId: supplier.id, materialId: f.material.id, quantity: '2', unitCost: null, expectedDate: null, remark: null }) : null;
        const write = () => writer === 'receipt'
          ? createPurchaseReceipt(order!.id, { idempotencyKey: randomUUID(), purchaseOrderItemId: order!.items[0]!.id, locationId: f.target.id, quantity: '2', unitCost: null, remark: null }, { id: actorId })
          : writer === 'movement' ? movement(f) : writer === 'transfer'
          ? createStockTransfer({ idempotencyKey: randomUUID(), materialId: f.material.id, sourceLocationId: f.source.id, destinationLocationId: f.target.id, quantity: '2', remark: null }, { id: actorId })
          : postInventoryCount({ idempotencyKey: randomUUID(), remark: '盘点核对库存', items: [{ materialId: f.material.id, locationId: f.target.id, bookQuantity: '0', countedQuantity: '2' }] }, { id: actorId });
        const stop = () => maintainWarehouse(disable(f.target), actorId);
        const [first, second] = await ordered(writeFirst ? write : stop, writeFirst ? stop : write);
        expect(first!.status).toBe('fulfilled');
        expect(second!.status).toBe('rejected');
        if (second!.status === 'rejected') expect(String(second!.reason)).toContain(writeFirst ? '仍有库存' : '已停用');
        const row = await db.warehouseLocation.findUniqueOrThrow({ where: { id: f.target.id } });
        expect(row.isActive).toBe(writeFirst);
        const positions = await db.materialLocationStock.findMany({ where: { materialId: f.material.id } });
        const total = positions.reduce((sum, item) => sum + Number(item.currentStock), 0);
        expect(Number((await db.material.findUniqueOrThrow({ where: { id: f.material.id } })).currentStock)).toBe(total);
        expect(Number(positions.find((item) => item.locationId === f.target.id)?.currentStock ?? 0)).toBe(writeFirst ? 2 : 0);
        expect(await db.businessAuditLog.count({ where: { entityId: f.target.id, action: 'WAREHOUSE_MAINTAINED' } })).toBe(writeFirst ? 0 : 1);
      });
    }
  }

  for (const createFirst of [true, false]) it(`create child vs parent disable, createFirst=${createFirst}`, async () => {
    const f = await fixture();
    const create = () => createWarehouseLocation({ warehouseId: f.warehouse.id, code: 'NEW', name: '新库位' }, actorId);
    const stop = () => maintainWarehouse(disable(f.warehouse, 'warehouse'), actorId);
    const [first, second] = await ordered(createFirst ? create : stop, createFirst ? stop : create);
    expect(first!.status).toBe('fulfilled');
    expect(second!.status).toBe(createFirst ? 'fulfilled' : 'rejected');
    expect((await listActiveWarehouseLocationOptions()).some((row) => row.warehouseId === f.warehouse.id)).toBe(false);
    expect(await db.warehouseLocation.count({ where: { warehouseId: f.warehouse.id, code: 'NEW' } })).toBe(createFirst ? 1 : 0);
  });

  for (const restoreFirst of [true, false]) it(`restore child vs parent disable, restoreFirst=${restoreFirst}`, async () => {
    const f = await fixture();
    const childOff = await maintainWarehouse(disable(f.target), actorId);
    const restore = () => maintainWarehouse({ ...disable(childOff), operation: 'restore' }, actorId);
    const stop = () => maintainWarehouse(disable(f.warehouse, 'warehouse'), actorId);
    const [first, second] = await ordered(restoreFirst ? restore : stop, restoreFirst ? stop : restore);
    expect(first!.status).toBe('fulfilled');
    expect(second!.status).toBe(restoreFirst ? 'fulfilled' : 'rejected');
    if (!restoreFirst && second!.status === 'rejected') expect(String(second!.reason)).toContain('请先启用所属仓库');
    const warehouseOff = await db.warehouse.findUniqueOrThrow({ where: { id: f.warehouse.id } });
    expect(warehouseOff.isActive).toBe(false);
    expect((await db.warehouseLocation.findUniqueOrThrow({ where: { id: f.target.id } })).isActive).toBe(restoreFirst);
    expect(await db.businessAuditLog.count({ where: { entityId: f.target.id, action: 'WAREHOUSE_MAINTAINED' } })).toBe(restoreFirst ? 2 : 1);
    await maintainWarehouse({ ...disable(warehouseOff, 'warehouse'), operation: 'restore' }, actorId);
    if (!restoreFirst) await restore();
    expect((await listActiveWarehouseLocationOptions()).some((row) => row.id === f.target.id)).toBe(true);
  });

  it('cancelling historical receipt requires restoring its inactive location, with no partial reversal', async () => {
    const f = await fixture();
    const supplier = await db.party.create({ data: { code: randomUUID(), type: 'SUPPLIER', name: '历史收货供应商' } });
    const order = await createPurchaseOrder({ supplierPartyId: supplier.id, materialId: f.material.id, quantity: '2', unitCost: null, expectedDate: null, remark: null });
    const received = await createPurchaseReceipt(order.id, { idempotencyKey: randomUUID(), purchaseOrderItemId: order.items[0]!.id, locationId: f.target.id, quantity: '2', unitCost: null, remark: null }, { id: actorId });
    await movement(f, f.target.id, 'OUT');
    const off = await maintainWarehouse(disable(f.target), actorId);
    await expect(cancelPurchaseReceipt(received.receipts[0]!.id, { id: actorId }, '历史退货')).rejects.toThrow('已停用');
    expect((await db.purchaseReceipt.findUniqueOrThrow({ where: { id: received.receipts[0]!.id } })).status).toBe('POSTED');
    expect(await db.materialTransaction.count({ where: { materialId: f.material.id } })).toBe(2);
    await maintainWarehouse({ ...disable(off), operation: 'restore' }, actorId);
    await movement(f);
    await cancelPurchaseReceipt(received.receipts[0]!.id, { id: actorId }, '历史退货');
    expect(Number((await db.material.findUniqueOrThrow({ where: { id: f.material.id } })).currentStock)).toBe(0);
  });

  it('counting excludes zero-stock rows in disabled locations or warehouses and identifies stale submissions', async () => {
    const f = await fixture();
    await movement(f); await movement(f, f.target.id, 'OUT');
    await movement(f, f.source.id); await movement(f, f.source.id, 'OUT');
    await maintainWarehouse(disable(f.target), actorId);
    const rows = await listInventoryCountMaterials({ q: f.material.code });
    expect(rows[0]!.locations.map((location) => location.locationId)).toEqual([f.source.id]);
    await expect(postInventoryCount({ idempotencyKey: randomUUID(), remark: '旧页面盘点', items: [{ materialId: f.material.id, locationId: f.target.id, bookQuantity: '0', countedQuantity: '1' }] }, { id: actorId })).rejects.toThrow(`${f.warehouse.name} / ${f.target.name}`);
    await maintainWarehouse(disable(f.warehouse, 'warehouse'), actorId);
    expect((await listInventoryCountMaterials({ q: f.material.code }))[0]!.locations).toEqual([]);
  });

  it('configuration lock timeout rolls back before any write and leaves normal shared writers usable', async () => {
    const gate = new Client({ connectionString: url }); await gate.connect();
    try {
      await gate.query('BEGIN'); await gate.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))', [WAREHOUSE_CONFIGURATION_LOCK]);
      await expect(db.$transaction(async (tx) => { await tx.$executeRaw`SET LOCAL lock_timeout='100ms'`; await acquireWarehouseStockLock(tx); throw new Error('must not pass lock'); })).rejects.toThrow('lock timeout');
      await gate.query('COMMIT');
      await expect(db.$transaction(async (tx) => { await acquireWarehouseStockLock(tx); return true; })).resolves.toBe(true);
    } finally { await gate.query('ROLLBACK'); await gate.end(); }
  });

  it.each(['maintain', 'warehouse', 'location'] as const)('real %s configuration timeout gives a recoverable error without writing', async (operation) => {
    const f = await fixture();
    const gate = new Client({ connectionString: url }); await gate.connect();
    let pending: Promise<PromiseSettledResult<unknown>> | undefined;
    try {
      await gate.query('BEGIN');
      await gate.query('SELECT pg_advisory_xact_lock_shared(hashtextextended($1,0))', [WAREHOUSE_CONFIGURATION_LOCK]);
      const deadline = (await gate.query("SELECT clock_timestamp() + interval '4 seconds' AS deadline")).rows[0].deadline;
      const action = operation === 'maintain' ? maintainWarehouse({ ...disable(f.target), operation: 'rename', name: '不能写入' }, actorId)
        : operation === 'warehouse' ? createWarehouse({ code: `T${randomUUID().replaceAll('-', '')}`, name: '不能写入' }, actorId)
        : createWarehouseLocation({ warehouseId: f.warehouse.id, code: 'TIMEOUT', name: '不能写入' }, actorId);
      pending = action.then((value) => ({ status: 'fulfilled' as const, value }), (reason: unknown) => ({ status: 'rejected' as const, reason }));
      while (!(await gate.query('SELECT clock_timestamp() >= $1::timestamptz AS elapsed', [deadline])).rows[0].elapsed) { /* Real DB deadline, no client-clock or injected lock timeout. */ }
      await gate.query('COMMIT');
      const result = await pending;
      expect(result.status).toBe('rejected');
      if (result.status === 'rejected') expect(result.reason).toMatchObject({ name: 'WarehouseInvariantError', message: '仓库正在处理出入库，请稍后重试' });
      expect((await db.warehouseLocation.findUniqueOrThrow({ where: { id: f.target.id } })).name).toBe(f.target.name);
      expect(await db.warehouseLocation.count({ where: { warehouseId: f.warehouse.id, code: 'TIMEOUT' } })).toBe(0);
    } finally { await gate.query('ROLLBACK'); if (pending) await pending; await gate.end(); }
  }, 10_000);
});
