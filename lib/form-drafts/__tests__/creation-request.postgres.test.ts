import { randomUUID } from 'node:crypto';
import { Client } from 'pg';
import { beforeAll, describe, expect, it, vi } from 'vitest';
import { db } from '@/lib/db';
import { createPurchaseOrder } from '@/lib/purchase';
import { createBom } from '@/lib/bom';
import { createBomSchema, createPurchaseOrderSchema } from '@/lib/auth/schemas';
import { creationLockKey, getCreationRequest, type CreationRequest } from '../creation-request';

// These are append-only integration fixtures, never the ordinary development DB.
const url = process.env.DATABASE_URL;
const isolated = Boolean(url && url === process.env.E2E_DATABASE_URL &&
  new URL(url).pathname.slice(1) === process.env.E2E_DATABASE_CONFIRM_DATABASE &&
  /(?:^|_)e2e_/.test(new URL(url).pathname));
const postgres = isolated ? describe : describe.skip;
vi.mock('server-only', () => ({}));
const prefix = `form_${randomUUID().replaceAll('-', '')}`;
const actorId = `${prefix}_admin`;
const otherId = `${prefix}_other`;
const supplierId = `${prefix}_supplier`;
const materialId = `${prefix}_material`;
const categoryId = `${prefix}_category`;
const identity = (): CreationRequest => ({ actorId, draftId: randomUUID(), clientRequestId: randomUUID() });
const purchase = () => createPurchaseOrderSchema.parse({ supplierPartyId: supplierId, materialId, quantity: '123', unitCost: '2.5', expectedDate: '', remark: '保留录入' });

postgres.sequential('form creation · real domain transactions on isolated PostgreSQL', () => {
  beforeAll(async () => {
    for (const id of [actorId, otherId]) await db.user.create({ data: { id, username: id, displayName: '录入恢复测试', password: 'not-a-login-hash', role: 'ADMIN' } });
    await db.party.create({ data: { id: supplierId, code: supplierId, type: 'SUPPLIER', name: '恢复供应商' } });
    await db.material.create({ data: { id: materialId, code: materialId, name: '恢复物料', category: 'OTHER', unit: '件' } });
    await db.productCategoryNode.create({ data: { id: categoryId, path: `root.${prefix}`, name: '恢复分类', legacyCategory: 'CUSTOM_FLAT_FOIL' } });
  });

  it('concurrent purchase submits and a lost-response retry create one entity and one audit; changed facts reject', async () => {
    const request = identity();
    const input = purchase();
    const results = await Promise.all(Array.from({ length: 3 }, () => createPurchaseOrder(input, undefined, request)));
    expect(new Set(results.map((result) => result.id)).size).toBe(1);
    const replay = await createPurchaseOrder({ ...input, quantity: '123.00', unitCost: '2.5000' }, undefined, request);
    expect(replay.id).toBe(results[0]!.id);
    await expect(createPurchaseOrder({ ...input, quantity: '124' }, undefined, request)).rejects.toThrow('当前内容不同');
    expect(await db.formCreationRequest.count({ where: { actorId, clientRequestId: request.clientRequestId } })).toBe(1);
    expect(await db.businessAuditLog.count({ where: { actorId, action: 'FORM_CREATED', entityId: replay.id } })).toBe(1);
    expect(await getCreationRequest('purchase-new', { ...request, actorId: otherId })).toBeNull();
    await expect(getCreationRequest('purchase-new', { ...request, draftId: randomUUID() })).rejects.toThrow('不匹配');
    const separateActor = await createPurchaseOrder(input, undefined, { ...request, actorId: otherId });
    expect(separateActor.id).not.toBe(replay.id);
  });

  it('BOM replay keeps row relations, decimal values and target; failed unique insert leaves no receipt', async () => {
    const request = identity();
    const input = createBomSchema.parse({ targetType: 'CATEGORY', categoryNodeId: categoryId, name: '恢复清单', version: '1', baseQuantity: '1', items: [{ materialId, quantity: '22', remark: '第二行' }] });
    const [first, second] = await Promise.all([createBom(input, request), createBom(input, request)]);
    expect(first.id).toBe(second.id);
    expect(first.items).toHaveLength(1);
    expect(first.items[0]!.quantity.toString()).toBe('22');
    expect(first.items[0]!.materialId).toBe(materialId);
    const failed = identity();
    await expect(createBom(input, failed)).rejects.toThrow();
    expect(await getCreationRequest('bom-new', failed)).toBeNull();
    await expect(createBom({ ...input, name: '改过的清单' }, request)).rejects.toThrow('当前内容不同');
  });

  it('a status query queued behind an in-flight create observes its commit instead of claiming failure', async () => {
    const request = identity();
    const blocker = new Client({ connectionString: url });
    await blocker.connect();
    let creating: ReturnType<typeof createPurchaseOrder> | undefined;
    let checking: ReturnType<typeof getCreationRequest> | undefined;
    async function waitBlocked(count: number) {
      const deadline = Date.now() + 3000;
      while (Date.now() < deadline) {
        const rows = await blocker.query<{ count: string }>("SELECT count(*)::text FROM pg_locks WHERE locktype='advisory' AND NOT granted AND database=(SELECT oid FROM pg_database WHERE datname=current_database())");
        if (Number(rows.rows[0]!.count) >= count) return;
      }
      throw new Error(`Expected ${count} blocked advisory locks`);
    }
    try {
      await blocker.query('BEGIN');
      await blocker.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))', [creationLockKey('purchase-new', request)]);
      creating = createPurchaseOrder(purchase(), undefined, request);
      await waitBlocked(1);
      checking = getCreationRequest('purchase-new', request);
      await waitBlocked(2);
      await blocker.query('COMMIT');
      const [created, status] = await Promise.all([creating, checking]);
      expect(status?.entityId).toBe(created.id);
    } finally {
      await blocker.query('ROLLBACK');
      await Promise.allSettled([creating, checking]);
      await blocker.end();
    }
  });

  it('SQL cannot erase or mutate deduplication evidence, and inactive/non-admin actors cannot create', async () => {
    const request = identity();
    await createPurchaseOrder(purchase(), undefined, request);
    await expect(db.formCreationRequest.deleteMany({ where: { actorId, clientRequestId: request.clientRequestId } })).rejects.toThrow('immutable');
    await expect(db.formCreationRequest.updateMany({ where: { actorId, clientRequestId: request.clientRequestId }, data: { payloadHash: '0'.repeat(64) } })).rejects.toThrow('immutable');
    await db.user.update({ where: { id: otherId }, data: { isActive: false } });
    await expect(createPurchaseOrder(purchase(), undefined, { ...identity(), actorId: otherId })).rejects.toThrow('当前账号不能');
    await db.user.update({ where: { id: otherId }, data: { isActive: true, role: 'SALES' } });
    await expect(createPurchaseOrder(purchase(), undefined, { ...identity(), actorId: otherId })).rejects.toThrow('当前账号不能');
  });
});
