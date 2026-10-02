import { preserveCarriedCompletionInTx, reconcileProductionOrderInTx } from '../order-state';
import { createReworkOrder } from '@/lib/order/rework';
import { repairProductionMetadata, scanProductionRecovery } from '../recovery';
import { holdFactoryOrder, resumeFactoryOrder } from '@/lib/order/admin-workflow';
import { createOrderChangeRequest, withdrawOrderChangeRequest, previewOrderChangeRequestPricing, reviewOrderChangeRequest, previewOrderCancellationSettlement } from '@/lib/order/change-request';
import { reviewProductionFact } from '../fact-review';
import { getPieceworkSettlementDay } from '@/lib/salary/piecework-settlement';
import { dispatchNotification } from '@/lib/notification/dispatch';
import { createHash, randomUUID } from 'node:crypto';
import { Client } from 'pg';
import { utimes } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { beforeAll, describe, expect, it, vi } from 'vitest';
import { db } from '@/lib/db';
import { publishProductionDispatch } from '../dispatch';
import { currentDispatchTargets } from '../dispatch-targets';
import { registerProductionCompletion } from '../completion-registration';
import { allocateProductionWages } from '@/lib/salary/production-wages';
import { lockPieceworkSettlement } from '@/lib/salary/piecework-settlement';
import { activateProductionOperationsInTx } from '../operation-materialization-service';
import { newPrintPageAttempt, recordPrintPage } from '@/lib/order/print-record';
import { getOrderForPrint } from '@/lib/order/print-view';
import { getSetting } from '@/lib/settings';
import { createNextOrderPrintRequest } from '@/lib/order/print-jobs';
import { recordBatchPrint } from '@/lib/order/batch-print';
import { orderPdfSnapshotKey } from '@/lib/pdf/order-snapshot';
import { writePdfArtifact } from '@/lib/pdf/artifacts';
import { BACKGROUND_JOB_TYPES } from '@/lib/background-jobs/types';
import { registerShipment } from '@/lib/order/shipment-registration';
import { assertShipOrderReadinessInTx } from '@/lib/order';
import { reportProductionOperation } from '../operation-reporting';
import { resolveWorkerWorkOrderScan } from '../work-order-scan';
import { correctProductionRegistration } from '../correct-registration';
import { todayShanghai } from '@/lib/dashboard/shanghai-clock';

vi.mock('server-only', () => ({}));
vi.mock('@/lib/notification/dispatch', () => ({ dispatchNotification: vi.fn() }));
const url = process.env.DATABASE_URL;
const isolated = !!url && url === process.env.E2E_DATABASE_URL && new URL(url).pathname.slice(1) === process.env.E2E_DATABASE_CONFIRM_DATABASE && /_e2e_/.test(new URL(url).pathname);
const pg = isolated ? describe : describe.skip;
const prefix = `dispatch_${randomUUID().replaceAll('-', '')}`;
const admin = { id: `${prefix}_admin`, role: 'ADMIN' as const, displayName: '排单管理员', username: `${prefix}_admin` };
let worker: { id: string; role: 'WORKER' };
let collaborator: { id: string; role: 'WORKER' };
async function newWorker() {
  const id = `worker_${randomUUID()}`;
  await db.user.create({ data: { id, username: id, password: 'not-a-login-hash', displayName: '生产师傅', role: 'WORKER', workerType: 'MACHINE', machineType: 'HAND_PRESS' } });
  return { id, role: 'WORKER' as const };
}
async function historicalRate(workerId: string, effectiveFrom: Date) {
  // A private, new fixture book: no published/shared book is ever backdated.
  await db.$transaction(async tx => {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext('print-shop-erp:piecework-price-book:publish'))`;
    const template = await tx.pieceworkPriceBook.findFirstOrThrow({ where: { workerId: null, status: 'PUBLISHED' }, include: { rules: true } });
    const latest = await tx.pieceworkPriceBook.aggregate({ _max: { version: true } });
    const book = await tx.pieceworkPriceBook.create({ data: { workerId, version: latest._max.version! + 1, sourceName: 'TEST historical worker rate',
      rules: { create: template.rules.filter(rule => rule.operationType === 'PARTIAL').map(rule => ({ operationType: rule.operationType, unit: rule.unit, amount: rule.amount, smallOrderAmount: rule.smallOrderAmount, setupAmount: rule.setupAmount })) } } });
    await tx.pieceworkPriceBook.update({ where: { id: book.id }, data: { status: 'PUBLISHED', effectiveFrom, publishedAt: effectiveFrom, publishedById: admin.id,
      sourceSha256: template.sourceSha256, manifestSha256: template.manifestSha256, ruleSetSha256: template.ruleSetSha256, publishNote: '仅隔离测试：原日已生效的独立个人工价' } });
  });
}
async function fixture(quantity = 1000) {
  const craft = await db.craft.findUniqueOrThrow({ where: { code: 'FLAT_FOIL_PARTIAL' } });
  const order = await db.order.create({ data: { orderNo: `DISPATCH-${randomUUID()}`, customName: '排单验收工单', submitterId: `${prefix}_sales`, createdById: admin.id, submitterRole: 'SALES', settlementType: 'EXTERNAL_SALES',
    status: 'CONFIRMED', pricingStatus: 'ADMIN_CONFIRMED', pricingConfirmedAt: new Date(), pricingConfirmedById: admin.id, confirmedFee: '100', totalAmount: '100',
    items: { create: { name: '验收款', sequence: 1, quantity, craft: 'PARTIAL', pricingRoute: 'CUSTOM_SINGLE_FLAT_FOIL', productStructure: 'STANDARD_ENVELOPE', foilTechnique: 'FLAT', frontFoilColors: ['亚金'], crafts: [craft.id], paperType: '珠光纸' } } }, include: { items: true } });
  await db.orderPackagingGroup.create({ data: { orderId: order.id, sequence: 1, mode: 'SINGLE_STYLE', actualBagCount: quantity, lines: { create: { orderItemId: order.items[0].id, unitsPerBag: 1 } } } });
  const { targets } = await currentDispatchTargets(db, order.id);
  const request = { requestKey: randomUUID(), orders: [{ id: order.id, revision: order.revision, version: order.workOrderVersion, assignments: Object.fromEntries(targets.map(target => [target.key, worker.id])) }] };
  return { order, request };
}
async function assigned() {
  const f = await fixture();
  await publishProductionDispatch(f.request, admin);
  const job = await db.productionJob.findFirstOrThrow({ where: { orderId: f.order.id } });
  return { ...f, job };
}
function completion(job: { id: string; revision: number }, quantity = '1000') { return { jobId: job.id, revision: job.revision, quantity, mode: 'COMPLETE' as const, reason: '' }; }
pg.sequential('single owner dispatch/completion · real PostgreSQL', () => {
  beforeAll(async () => {
    if (!isolated) throw new Error('Disposable database required');
    await db.user.create({ data: { ...admin, password: 'not-a-login-hash' } });
    await db.user.create({ data: { id: `${prefix}_sales`, username: `${prefix}_sales`, displayName: '验收销售', role: 'SALES', password: 'not-a-login-hash' } });
    worker = await newWorker(); collaborator = await newWorker();
    expect(await db.pieceworkPriceBook.count({ where: { status: 'PUBLISHED', workerId: null } })).toBeGreaterThan(0);
  });
  it('atomically publishes, replays after printing, rejects a different payload, and enforces personal scan ownership', async () => {
    const f = await assigned();
    await expect(publishProductionDispatch(f.request, admin)).resolves.toEqual([f.order.id]);
    expect(await db.productionJob.count({ where: { orderId: f.order.id } })).toBe(1);
    expect(await db.orderPrintJob.count({ where: { orderId: f.order.id } })).toBe(1);
    await expect(publishProductionDispatch({ ...f.request, orders: [{ ...f.request.orders[0], assignments: Object.fromEntries(Object.keys(f.request.orders[0].assignments).map(key => [key, collaborator.id])) }] }, admin)).rejects.toThrow('变化');
    expect(await resolveWorkerWorkOrderScan(f.order.orderNo, collaborator)).toBeNull();
    expect((await resolveWorkerWorkOrderScan(f.order.orderNo, worker))?.defaultTaskId).toBe(f.job.id);
    await expect(registerProductionCompletion(completion(f.job), collaborator)).rejects.toThrow('未安排');
    await expect(reportProductionOperation({ operationId: f.job.operationId!, completedQty: 1, defectQty: 0, reworkQty: 0, idempotencyKey: randomUUID() }, worker)).rejects.toThrow('已安排');
  });
  it('publishes a five-order selection atomically and replays without duplicate jobs or print requests', async () => {
    worker = await newWorker();
    const fixtures = [];
    for (let i = 0; i < 5; i++) fixtures.push(await fixture());
    const input = { requestKey: randomUUID(), orders: fixtures.flatMap(row => row.request.orders) };
    const ids = fixtures.map(row => row.order.id);
    await publishProductionDispatch(input, admin); await publishProductionDispatch(input, admin);
    expect(await db.productionJob.count({ where: { orderId: { in: ids }, workerId: worker.id } })).toBe(5);
    expect(await db.orderPrintJob.count({ where: { orderId: { in: ids } } })).toBe(5);
    expect(await db.order.count({ where: { id: { in: ids }, status: 'RELEASED' } })).toBe(5);
  });
  it('rolls back every order when one worker assignment is invalid', async () => {
    const a = await fixture(); const b = await fixture();
    b.request.orders[0].assignments = Object.fromEntries(Object.keys(b.request.orders[0].assignments).map(key => [key, admin.id]));
    await expect(publishProductionDispatch({ requestKey: randomUUID(), orders: [...a.request.orders, ...b.request.orders] }, admin)).rejects.toThrow('师傅');
    expect(await db.productionJob.count({ where: { orderId: { in: [a.order.id, b.order.id] } } })).toBe(0);
    expect((await db.order.findUniqueOrThrow({ where: { id: a.order.id } })).status).toBe('CONFIRMED');
  });
  it('counts real production once under worker/backfill competition and ignores packing registration', async () => {
    const f = await assigned();
    const result = await Promise.allSettled([registerProductionCompletion(completion(f.job), worker), registerProductionCompletion({ ...completion(f.job), mode: 'BACKFILL', workDate: todayShanghai(), reason: '忘记扫码' }, admin)]);
    expect(result.some(row => row.status === 'fulfilled')).toBe(true);
    const order = await db.order.findUniqueOrThrow({ where: { id: f.order.id } });
    expect(order.status).toBe('PACKING'); expect(order.completedAt).not.toBeNull();
    expect(await db.productionWage.count({ where: { jobId: f.job.id } })).toBe(1);
    expect(await db.productionWageEntry.count({ where: { wage: { jobId: f.job.id } } })).toBe(1);
    expect((await db.productionOperation.findFirstOrThrow({ where: { orderId: f.order.id, operationType: 'PACKING' } })).status).toBe('PENDING');
  });
  it('rejects a worker per-item split; the worker registers the total and the order items keep their planned split', async () => {
    const f = await fixture();
    const craft = await db.craft.findUniqueOrThrow({ where: { code: 'FLAT_FOIL_PARTIAL' } });
    const second = await db.orderItem.create({ data: { orderId: f.order.id, name: '验收款B', sequence: 2, quantity: 1000, craft: 'PARTIAL', pricingRoute: 'CUSTOM_SINGLE_FLAT_FOIL', productStructure: 'STANDARD_ENVELOPE', foilTechnique: 'FLAT', frontFoilColors: ['亚金'], crafts: [craft.id], paperType: '珠光纸' } });
    await db.orderPackagingGroup.create({ data: { orderId: f.order.id, sequence: 2, mode: 'SINGLE_STYLE', actualBagCount: 1000, lines: { create: { orderItemId: second.id, unitsPerBag: 1 } } } });
    const { targets } = await currentDispatchTargets(db, f.order.id);
    await publishProductionDispatch({ requestKey: randomUUID(), orders: [{ ...f.request.orders[0], assignments: Object.fromEntries(targets.map(target => [target.key, worker.id])) }] }, admin);
    const job = await db.productionJob.findFirstOrThrow({ where: { orderId: f.order.id } });
    expect(job.plannedQty.toString()).toBe('2000');
    const [first] = f.order.items;
    // 业主 2026-10-01：师傅不逐款登记，逐款数量按工单、由管理员核定。
    await expect(registerProductionCompletion({ ...completion(job, '2000'), itemQuantities: { [first.id]: '0', [second.id]: '2000' }, reason: '只做了 B 款' }, worker)).rejects.toThrow('逐款数量由管理员核定');
    const untouched = await db.productionJob.findUniqueOrThrow({ where: { id: job.id } });
    expect(untouched.status).toBe('PENDING');
    expect(await db.productionWage.count({ where: { jobId: job.id } })).toBe(0);
    await registerProductionCompletion(completion(untouched, '2000'), worker);
    const done = await db.productionJob.findUniqueOrThrow({ where: { id: job.id } });
    expect(done.status).toBe('COMPLETED');
    expect((done.snapshot as { actualItemQuantities?: unknown }).actualItemQuantities).toEqual({ [first.id]: '1000', [second.id]: '1000' });
  });
  it('holds altered quantity without wages, rejects bypass, then approves exactly once', async () => {
    const f = await assigned();
    await registerProductionCompletion({ ...completion(f.job, '990'), reason: '核对实际成品' }, worker);
    expect(await db.productionWage.count({ where: { jobId: f.job.id } })).toBe(0);
    expect((await db.order.findUniqueOrThrow({ where: { id: f.order.id } })).status).toBe('RELEASED');
    const pending = await db.productionJob.findUniqueOrThrow({ where: { id: f.job.id } });
    await expect(registerProductionCompletion(completion(pending), worker)).rejects.toThrow('待审批');
    await registerProductionCompletion({ ...completion(pending, '990'), mode: 'APPROVE', reason: '核实成品 990 个' }, admin);
    expect((await db.productionWage.findFirstOrThrow({ where: { jobId: f.job.id } })).amount?.toString()).toBe('198');
  });
  it('preserves original wages, inherits ownership and registers only added quantity with pending manual wages', async () => {
    const f = await assigned(); await registerProductionCompletion(completion(f.job), worker);
    const original = await db.productionWage.findFirstOrThrow({ where: { jobId: f.job.id } });
    await db.$transaction(async tx => {
      await tx.orderItem.update({ where: { id: f.order.items[0].id }, data: { quantity: 1300 } });
      await tx.orderPackagingGroup.updateMany({ where: { orderId: f.order.id }, data: { actualBagCount: 1300 } });
      await tx.order.update({ where: { id: f.order.id }, data: { workOrderVersion: 2, completedAt: null } });
      await activateProductionOperationsInTx(tx, f.order.id, admin, undefined, { targetStatus: 'PACKING', allowVersionRematerialization: true });
    });
    const job = await db.productionJob.findFirstOrThrow({ where: { orderId: f.order.id, workOrderVersion: 2 } });
    expect(job.workerId).toBe(worker.id); expect(job.plannedQty.toString()).toBe('300'); expect(job.manualPricing).toBe(true);
    await expect(registerProductionCompletion(completion(f.job), worker)).rejects.toThrow('改版');
    await registerProductionCompletion(completion(job, '300'), worker);
    expect((await db.productionWage.findUniqueOrThrow({ where: { id: original.id } })).amount?.toString()).toBe(original.amount?.toString());
    const pending = await db.productionWage.findFirstOrThrow({ where: { jobId: job.id } }); expect(pending.amount).toBeNull();
    const nextDay = new Date(Date.now() + 86400000);
    await expect(lockPieceworkSettlement({ reporterId: worker.id, workDate: todayShanghai(), actor: admin, now: nextDay })).rejects.toThrow('待补录');
    const input = { jobId: job.id, requestKey: randomUUID(), reason: '改版实际生产提成', allocations: [{ workerId: worker.id, amount: '7', expectedRevision: pending.revision }, { workerId: collaborator.id, amount: '5', expectedRevision: -1 }] };
    await allocateProductionWages(input, admin); await allocateProductionWages(input, admin);
    const receipt = await lockPieceworkSettlement({ reporterId: collaborator.id, workDate: todayShanghai(), actor: admin, now: nextDay });
    expect(receipt.payableAmount).toBe('5.00'); expect(receipt.reportCount).toBe(1);
    await expect(allocateProductionWages({ ...input, requestKey: randomUUID(), allocations: input.allocations.map(row => ({ ...row, expectedRevision: row.workerId === worker.id ? 1 : 0 })) }, admin)).rejects.toThrow('已结算');
  });
  it('reverses only an unsettled erroneous registration and permits a fresh registration without duplicating wages', async () => {
    const f = await assigned(); await registerProductionCompletion(completion(f.job), worker);
    const completed = await db.productionJob.findUniqueOrThrow({ where: { id: f.job.id } });
    const input = { jobId: f.job.id, revision: completed.revision, requestKey: randomUUID(), reason: '未实际生产，误扫码', notActuallyProduced: true as const };
    await correctProductionRegistration(input, admin); await correctProductionRegistration(input, admin);
    const reopened = await db.productionJob.findUniqueOrThrow({ where: { id: f.job.id } });
    expect(reopened.status).toBe('PENDING');
    expect((await db.productionWage.findFirstOrThrow({ where: { jobId: f.job.id } })).amount?.toString()).toBe('0');
    expect(await db.productionWageEntry.count({ where: { wage: { jobId: f.job.id } } })).toBe(2);
    await registerProductionCompletion(completion(reopened), worker);
    expect((await db.productionWage.findFirstOrThrow({ where: { jobId: f.job.id } })).amount?.toString()).toBe('200');
    expect(await db.productionWage.count({ where: { jobId: f.job.id } })).toBe(1);
    expect(await db.productionWageEntry.count({ where: { wage: { jobId: f.job.id } } })).toBe(3);
    await expect(db.productionWageEntry.updateMany({ where: { wage: { jobId: f.job.id } }, data: { reason: 'rewrite' } })).rejects.toThrow();
    await expect(db.productionWage.updateMany({ where: { jobId: f.job.id }, data: { amount: '1' } })).rejects.toThrow();
    await expect(db.productionJob.update({ where: { id: f.job.id }, data: { workerId: collaborator.id } })).rejects.toThrow();
  });
  it('allows a reasoned quantity correction before completion and preserves the original request', async () => {
    const f = await assigned(); await registerProductionCompletion({ ...completion(f.job, '990'), reason: '实际数量待核对' }, worker);
    const pending = await db.productionJob.findUniqueOrThrow({ where: { id: f.job.id } });
    await expect(lockPieceworkSettlement({ reporterId: worker.id, workDate: todayShanghai(), actor: admin, now: new Date(Date.now() + 86400000) })).rejects.toThrow('数量待审批');
    await expect(registerProductionCompletion({ ...completion(pending, '999'), mode: 'APPROVE', reason: '' }, admin)).rejects.toThrow('说明');
    await registerProductionCompletion({ ...completion(pending, '999'), mode: 'APPROVE', reason: '逐箱复核为 999' }, admin);
    const completed = await db.productionJob.findUniqueOrThrow({ where: { id: f.job.id } });
    expect(completed.completedQty?.toString()).toBe('999'); expect(completed.requestedQty?.toString()).toBe('990');
    expect((await db.productionWage.findFirstOrThrow({ where: { jobId: f.job.id } })).amount?.toString()).toBe('199.8');
    await expect(registerProductionCompletion({ ...completion(pending, '990'), mode: 'APPROVE', reason: '旧页面' }, admin)).rejects.toThrow('变化');
  });
  it('requires explicit no-production evidence to reject and preserves the original request in audit', async () => {
    const f = await assigned(); await registerProductionCompletion({ ...completion(f.job, '990'), reason: '误报数量' }, worker);
    const pending = await db.productionJob.findUniqueOrThrow({ where: { id: f.job.id } });
    await expect(registerProductionCompletion({ ...completion(pending, '990'), mode: 'REJECT', reason: '未核实' }, admin)).rejects.toThrow('没有实际生产');
    await registerProductionCompletion({ ...completion(pending, '990'), mode: 'REJECT', reason: '已向原师傅核实未开工', notActuallyProduced: true }, admin);
    const reset = await db.productionJob.findUniqueOrThrow({ where: { id: f.job.id } });
    expect(reset.status).toBe('PENDING'); expect(reset.workDate).toBeNull();
    expect(await db.productionWage.count({ where: { jobId: f.job.id } })).toBe(0);
    expect((await db.orderLog.findFirstOrThrow({ where: { orderId: f.order.id, action: 'PRODUCTION_QUANTITY_REJECTED' } })).changedFields).toMatchObject({ requestedQty: '990', workDate: todayShanghai(), notActuallyProduced: true });
    await registerProductionCompletion(completion(reset), worker);
  });
  it('rejects stale reassignment and non-admin publication', async () => {
    const f = await assigned();
    await expect(publishProductionDispatch({ ...f.request, requestKey: randomUUID() }, admin)).rejects.toThrow('已修改');
    await expect(publishProductionDispatch({ ...f.request, requestKey: randomUUID() }, worker)).rejects.toThrow('管理员');
  });
  it('permits administrator backfill for an inactive historical owner but blocks that worker', async () => {
    const savedWorker = worker;
    worker = await newWorker();
    try {
      const f = await assigned();
      await db.user.update({ where: { id: worker.id }, data: { isActive: false } });
      await expect(registerProductionCompletion(completion(f.job), worker)).rejects.toThrow('未安排');
      await registerProductionCompletion({ ...completion(f.job), mode: 'BACKFILL', reason: '已离职师傅当日忘记扫码', workDate: todayShanghai() }, admin);
      expect((await db.productionWage.findFirstOrThrow({ where: { jobId: f.job.id } })).workerId).toBe(worker.id);
    } finally { worker = savedWorker; }
  });
  it('keeps text-only revision complete and creates a new manual-priced task for changed artwork', async () => {
    const f = await assigned(); await registerProductionCompletion(completion(f.job), worker);
    async function revise(version: number, artworkVersion: string | null) {
      await db.$transaction(async tx => {
        await tx.orderItem.update({ where: { id: f.order.items[0].id }, data: { name: '文字修改', ...(artworkVersion ? { artworkVersion } : {}) } });
        await tx.order.update({ where: { id: f.order.id }, data: { workOrderVersion: version } });
        await activateProductionOperationsInTx(tx, f.order.id, admin, undefined, { targetStatus: 'PACKING', allowVersionRematerialization: true });
      });
      return db.productionJob.findFirstOrThrow({ where: { orderId: f.order.id, workOrderVersion: version } });
    }
    const carried = await revise(2, null);
    expect(carried.status).toBe('CARRIED'); expect(carried.plannedQty.toString()).toBe('0');
    const changed = await revise(3, '新版设计');
    expect(changed.status).toBe('PENDING'); expect(changed.plannedQty.toString()).toBe('1000'); expect(changed.workerId).toBe(worker.id);
    expect((await db.order.findUniqueOrThrow({ where: { id: f.order.id } })).status).toBe('RELEASED');
    const original = await db.productionJob.findUniqueOrThrow({ where: { id: f.job.id } });
    await expect(correctProductionRegistration({ jobId: original.id, revision: original.revision, requestKey: randomUUID(), reason: '已改版不能冲回真实生产', notActuallyProduced: true }, admin)).rejects.toThrow('后续生产');
    expect((await db.productionWage.findFirstOrThrow({ where: { jobId: original.id } })).amount?.toString()).toBe('200');
  });

  it('inherits a shipped order owner onto its separate redo and keeps manual pending wages out of shipping gates', async () => {
    const original = await assigned(); await registerProductionCompletion(completion(original.job), worker);
    await db.order.update({ where: { id: original.order.id }, data: { status: 'SHIPPED', shippedAt: new Date() } });
    const redo = await fixture(200);
    await db.$transaction(async tx => {
      await tx.order.update({ where: { id: redo.order.id }, data: { kind: 'REWORK', sourceOrderId: original.order.id, settlementType: 'NO_CHARGE', billingMode: 'NO_CHARGE', pricingStatus: 'AUTO_CONFIRMED', pricingConfirmedById: null, confirmedFee: '0', totalAmount: '0' } });
      await tx.orderItem.update({ where: { id: redo.order.items[0].id }, data: { pricingSnapshot: { source: 'FREE_REWORK', version: 1, sourceOrderId: original.order.id, sourceOrderItemId: original.order.items[0].id } } });
      await tx.orderShipment.create({ data: { orderId: redo.order.id, sequence: 1, receiverName: '测试收件人', receiverPhone: '13800138000', receiverAddress: '测试地址', lines: { create: { orderItemId: redo.order.items[0].id, quantity: 200 } } } });
      await activateProductionOperationsInTx(tx, redo.order.id, admin, undefined, { targetStatus: 'RELEASED' });
    });
    const job = await db.productionJob.findFirstOrThrow({ where: { orderId: redo.order.id } });
    expect(job.workerId).toBe(worker.id); expect(job.manualPricing).toBe(true);
    await registerProductionCompletion(completion(job, '200'), worker);
    expect((await db.productionWage.findFirstOrThrow({ where: { jobId: job.id } })).amount).toBeNull();
    await db.$transaction(async tx => { await expect(assertShipOrderReadinessInTx(tx, { orderId: redo.order.id, workOrderVersion: 1, settlementType: 'NO_CHARGE', isVersionedCommand: false, hasSubmittedShipmentDetails: true, simpleProduction: true, requiresOutsource: false })).resolves.toHaveLength(1); });
    const ready = await db.order.findUniqueOrThrow({ where: { id: redo.order.id }, include: { shipments: true } });
    const shipmentInput = { orderId: ready.id, shipmentId: ready.shipments[0].id, expectedVersion: ready.shipments[0].registrationVersion, expectedRevision: ready.revision, expectedEditVersion: ready.editVersion, expectedWorkOrderVersion: ready.workOrderVersion, expectedPriceRevision: ready.priceRevision, idempotencyKey: randomUUID(), trackingNo: 'TEST12345', carrierCode: 'ZTO' as const, carrierName: '', confirm: true };
    await registerShipment(shipmentInput, admin); await registerShipment(shipmentInput, admin);
    expect((await db.orderShipment.findUniqueOrThrow({ where: { id: shipmentInput.shipmentId } })).status).toBe('SHIPPED');
    expect((await db.productionWage.findFirstOrThrow({ where: { jobId: job.id } })).amount).toBeNull();
    expect((await db.order.findUniqueOrThrow({ where: { id: original.order.id } })).status).toBe('SHIPPED');
    expect((await db.productionWage.findFirstOrThrow({ where: { jobId: original.job.id } })).amount?.toString()).toBe('200');
  });

  it('creates a reprint task when a printed but unproduced order changes owner', async () => {
    const f = await assigned();
    // 业主 2026-10-02 点打印即记已打印：走真实打印页的「渲染 → 记录」。
    const baseUrl = 'http://localhost:3000';
    const renderPage = async () => newPrintPageAttempt((await getOrderForPrint(f.order.id, admin, baseUrl))!, (await getSetting('factory_name')).name);
    const firstPage = await renderPage();
    await expect(recordPrintPage(firstPage, admin, baseUrl)).resolves.toBe('MARKED');
    const stalePage = await renderPage();
    const current = await db.order.findUniqueOrThrow({ where: { id: f.order.id } });
    const newOwner = await newWorker();
    // 纸上只印师傅姓名：换成不同姓名的师傅，纸面内容才真的不同。
    await db.user.update({ where: { id: newOwner.id }, data: { displayName: '接手师傅' } });
    const request = { requestKey: randomUUID(), orders: [{ ...f.request.orders[0], revision: current.revision, assignments: Object.fromEntries(Object.keys(f.request.orders[0].assignments).map(key => [key, newOwner.id])) }] };
    await expect(publishProductionDispatch(request, admin)).rejects.toThrow('尚未生产');
    await reviewProductionFact({ jobId: f.job.id, jobRevision: f.job.revision, reviewRevision: -1, mode: 'UNPRODUCED', reason: '原师傅确认尚未开工', notActuallyProduced: true }, admin);
    await publishProductionDispatch(request, admin); await publishProductionDispatch(request, admin);
    expect((await db.productionJob.findUniqueOrThrow({ where: { id: f.job.id } })).workerId).toBe(newOwner.id);
    expect(await db.orderPrintJob.count({ where: { orderId: f.order.id, state: 'PENDING', printKind: 'REPRINT' } })).toBe(1);
    // 同版本换师傅：仍开着的旧打印页（纸上是原师傅）关闭打印对话框，不能把新的补打任务记为已打印；
    // 第一页记录响应丢失后的重试只返回原结果，不认领新的补打任务；按新内容打开的打印页才能记录。
    await expect(recordPrintPage(stalePage, admin, baseUrl)).resolves.toBe('STALE');
    await expect(recordPrintPage(firstPage, admin, baseUrl)).resolves.toBe('MARKED');
    const reprint = await db.orderPrintJob.findFirstOrThrow({ where: { orderId: f.order.id, state: 'PENDING', printKind: 'REPRINT' } });
    expect(await db.orderPrintJob.count({ where: { requestJobId: reprint.id } })).toBe(0);
    const freshPage = await renderPage();
    expect(freshPage.contentKey).not.toBe(stalePage.contentKey);
    await expect(recordPrintPage(freshPage, admin, baseUrl)).resolves.toBe('MARKED');
    expect(await db.orderPrintJob.count({ where: { requestJobId: reprint.id, state: 'PRINTED' } })).toBe(1);
    // 本版本已打印后再打开的打印页记为 ALREADY_PRINTED 并入账；之后新建的手动补打任务，
    // 不会被这一页（或已记过的页）的重试认领，只有新打开的打印页才能记录它。
    const reopened = await renderPage();
    await expect(recordPrintPage(reopened, admin, baseUrl)).resolves.toBe('ALREADY_PRINTED');
    const manual = await createNextOrderPrintRequest({ orderId: f.order.id, workOrderVersion: freshPage.workOrderVersion, reason: '补打一份', idempotencyKey: randomUUID() }, admin);
    await expect(recordPrintPage(reopened, admin, baseUrl)).resolves.toBe('ALREADY_PRINTED');
    await expect(recordPrintPage(freshPage, admin, baseUrl)).resolves.toBe('MARKED');
    expect(await db.orderPrintJob.count({ where: { requestJobId: manual.jobId } })).toBe(0);
    await expect(recordPrintPage(await renderPage(), admin, baseUrl)).resolves.toBe('MARKED');
    expect(await db.orderPrintJob.count({ where: { requestJobId: manual.jobId, state: 'PRINTED' } })).toBe(1);
  });

  // 业主 2026-10-02 点打印即记已打印：批量打印文件按尝试整批记录，任一工单失败整批回滚（真实库事务）。
  it('records a batch print file atomically per attempt and rolls back the whole batch on failure', async () => {
    const baseUrl = 'http://localhost:3000';
    const factoryName = (await getSetting('factory_name')).name;
    const first = await assigned();
    const second = await assigned();
    const printed = await Promise.all([first.order.id, second.order.id].map(async (id) => {
      const order = (await getOrderForPrint(id, admin, baseUrl))!;
      return { id, key: orderPdfSnapshotKey(order, factoryName), version: order.workOrderVersion };
    }));
    printed.sort((a, b) => a.id.localeCompare(b.id));
    const ids = printed.map((order) => order.id);
    const artifactName = `${randomUUID()}.pdf`;
    await writePdfArtifact(artifactName, Buffer.from('%PDF-batch-record-test'));
    const job = await db.backgroundJob.create({ data: {
      type: BACKGROUND_JOB_TYPES.ORDER_BATCH_PDF, queue: 'HEAVY', dedupeKey: randomUUID(), status: 'SUCCEEDED',
      payload: { actorId: admin.id, baseUrl, orders: printed.map(({ id, key }) => ({ id, key })) },
      result: { completed: 2, issues: [], artifactName },
    } });
    const receipts = () => db.orderPrintJob.count({ where: { orderId: { in: ids }, state: 'PRINTED' } });

    const attemptKey = (attemptId: string, orderId: string) =>
      `batch-print:${createHash('sha256').update(`${job.id}:${attemptId}`).digest('hex').slice(0, 32)}:${orderId}`;
    // 第二张工单的尝试键已被别的工单占用：第一张记完后在第二张抛错，整批回滚。
    const failing = randomUUID();
    await db.orderPrintAttempt.create({ data: { attemptKey: attemptKey(failing, ids[1]), orderId: ids[0], workOrderVersion: 1, outcome: 'STALE', actorId: admin.id } });
    await expect(recordBatchPrint(admin.id, job.id, failing)).rejects.toMatchObject({ code: 'IDEMPOTENCY_CONFLICT' });
    expect(await receipts()).toBe(0);
    expect(await db.orderPrintAttempt.count({ where: { attemptKey: attemptKey(failing, ids[0]) } })).toBe(0);

    // 同一尝试的两个请求同时到达（前一次断连但仍在执行时重试）：按尝试串行，后到的重放前一次的结果。
    const attempt = randomUUID();
    await expect(Promise.all([recordBatchPrint(admin.id, job.id, attempt), recordBatchPrint(admin.id, job.id, attempt)]))
      .resolves.toEqual([{ marked: 2 }, { marked: 2 }]);
    expect(await receipts()).toBe(2);
    expect(await db.orderPrintAttempt.count({ where: { attemptKey: { in: ids.map((id) => attemptKey(attempt, id)) } } })).toBe(2);
    await expect(recordBatchPrint(admin.id, job.id, attempt)).resolves.toEqual({ marked: 2 });
    expect(await receipts()).toBe(2);
    // 记录成功后响应丢失、期间工单内容又变了：同一尝试的重试仍返回原结果，不当作首次记录失败。
    await db.order.update({ where: { id: ids[1] }, data: { remark: '记录后才改的备注' } });
    await expect(recordBatchPrint(admin.id, job.id, attempt)).resolves.toEqual({ marked: 2 });
    await db.order.update({ where: { id: ids[1] }, data: { remark: null } });
    // 同一文件之后再打开是新的尝试，会记录期间新建的补打任务；原尝试的重试不会。
    const reprint = await createNextOrderPrintRequest({ orderId: ids[0], workOrderVersion: printed[0].version, reason: '补打一份', idempotencyKey: randomUUID() }, admin);
    await expect(recordBatchPrint(admin.id, job.id, attempt)).resolves.toEqual({ marked: 2 });
    expect(await db.orderPrintJob.count({ where: { requestJobId: reprint.jobId } })).toBe(0);
    await expect(recordBatchPrint(admin.id, job.id, randomUUID())).resolves.toEqual({ marked: 1 });
    expect(await db.orderPrintJob.count({ where: { requestJobId: reprint.jobId, state: 'PRINTED' } })).toBe(1);

    // 另一个打印任务沿用同一尝试标识：尝试键绑定任务，查的是另一组键，不重放旧任务的结果。
    const otherJob = await db.backgroundJob.create({ data: {
      type: BACKGROUND_JOB_TYPES.ORDER_BATCH_PDF, queue: 'HEAVY', dedupeKey: randomUUID(), status: 'SUCCEEDED',
      payload: { actorId: admin.id, baseUrl, orders: printed.map(({ id, key }) => ({ id, key })) },
      result: { completed: 2, issues: [], artifactName },
    } });
    await expect(recordBatchPrint(admin.id, otherJob.id, attempt)).resolves.toEqual({ marked: 0 });
    const otherKey = (orderId: string) => `batch-print:${createHash('sha256').update(`${otherJob.id}:${attempt}`).digest('hex').slice(0, 32)}:${orderId}`;
    expect(await db.orderPrintAttempt.count({ where: { attemptKey: { in: ids.map(otherKey) }, outcome: 'ALREADY_PRINTED' } })).toBe(2);

    // 前一次请求还没提交时到达的重试（确定性复现）：外部连接先按尝试加锁；本请求锁前查账本为空、
    // 文件探测也因过期失败，然后在锁上等待；外部连接写入「前一次」的账本、改工单内容并提交。本请求
    // 拿到锁后必须重放原结果，不能按探测结果或首次核对报错。
    const waiting = randomUUID();
    const waitingAttempt = createHash('sha256').update(`${job.id}:${waiting}`).digest('hex').slice(0, 32);
    const holder = new Client({ connectionString: process.env.DATABASE_URL });
    await holder.connect();
    try {
      await holder.query('BEGIN');
      await holder.query('SELECT pg_advisory_xact_lock(hashtext($1))', [`batch-print-attempt:${waitingAttempt}`]);
      const holderPid = (await holder.query<{ pid: number }>('SELECT pg_backend_pid() AS pid')).rows[0].pid;
      const expired = new Date(Date.now() - 2 * 60 * 60_000);
      await utimes(join(process.env.PDF_ARTIFACT_DIR || join(tmpdir(), 'print-shop-erp-pdf-artifacts'), artifactName), expired, expired);
      const pending = recordBatchPrint(admin.id, job.id, waiting);
      // 只等「被本 holder 挡住」的连接，不受其他用例的锁等待干扰。
      await expect.poll(async () => (await holder.query<{ n: number }>(
        'SELECT count(*)::int AS n FROM pg_stat_activity WHERE $1 = ANY(pg_blocking_pids(pid))', [holderPid],
      )).rows[0].n, { timeout: 15_000 }).toBeGreaterThan(0);
      for (const id of ids) {
        await holder.query(
          `INSERT INTO "OrderPrintAttempt" (id, "attemptKey", "orderId", "workOrderVersion", outcome, "actorId") VALUES ($1, $2, $3, 1, 'ALREADY_PRINTED', $4)`,
          [randomUUID(), `batch-print:${waitingAttempt}:${id}`, id, admin.id],
        );
      }
      await holder.query(`UPDATE "Order" SET remark = '等待期间改的备注' WHERE id = $1`, [ids[1]]);
      await holder.query('COMMIT');
      await expect(pending).resolves.toEqual({ marked: 0 });
    } finally {
      await holder.end();
      await db.order.update({ where: { id: ids[1] }, data: { remark: null } });
    }
  });

  it('approves a quantity while held and reconciles completion only on resume', async () => {
    worker = await newWorker();
    const f = await assigned();
    await registerProductionCompletion({ ...completion(f.job, '990'), reason: '真实产量' }, worker);
    await holdFactoryOrder({ orderId: f.order.id, reasonCode: 'DESIGN_ERROR', reasonNote: '核对生产', affectedFigs: [], idempotencyKey: randomUUID() }, admin);
    const pending = await db.productionJob.findUniqueOrThrow({ where: { id: f.job.id } });
    await registerProductionCompletion({ ...completion(pending, '990'), mode: 'APPROVE', reason: '实际核定' }, admin);
    expect((await db.order.findUniqueOrThrow({ where: { id: f.order.id } })).status).toBe('ON_HOLD');
    const result = await resumeFactoryOrder({ orderId: f.order.id, recoveryEvidence: { production: '数量已核实' }, idempotencyKey: randomUUID() }, admin);
    expect(result.status).toBe('PACKING');
    expect((await db.productionWage.findFirstOrThrow({ where: { jobId: f.job.id } })).amount?.toString()).toBe('198');
  });

  it.each(['WITHDRAW', 'DENY'] as const)('backfills during pending cancellation and completes once after %s', async mode => {
    worker = await newWorker();
    const f = await assigned();
    const order = await db.order.findUniqueOrThrow({ where: { id: f.order.id } });
    const sales = { id: order.submitterId, role: 'SALES' as const };
    const request = await createOrderChangeRequest({ orderId: order.id, expectedRevision: order.revision, expectedWorkOrderVersion: order.workOrderVersion, type: 'CANCEL', reason: '先核实生产', items: [] }, sales);
    await expect(registerProductionCompletion(completion(f.job), worker)).rejects.toThrow('待审批');
    await registerProductionCompletion({ ...completion(f.job), mode: 'BACKFILL', workDate: todayShanghai(), reason: '已做忘记扫码' }, admin);
    expect((await db.order.findUniqueOrThrow({ where: { id: order.id } })).status).toBe('RELEASED');
    expect(vi.mocked(dispatchNotification).mock.calls.filter(([event, payload]) => event === 'ORDER_COMPLETED' && 'orderId' in payload && payload.orderId === order.id)).toHaveLength(0);
    if (mode === 'WITHDRAW') await withdrawOrderChangeRequest({ requestId: request.id }, sales);
    else await reviewOrderChangeRequest({ requestId: request.id, decision: 'DENY', reviewRemark: '已完成，继续交付', pendingChargeResolutions: [] }, admin);
    expect((await db.order.findUniqueOrThrow({ where: { id: order.id } })).status).toBe('PACKING');
    expect(vi.mocked(dispatchNotification).mock.calls.filter(([event, payload]) => event === 'ORDER_COMPLETED' && 'orderId' in payload && payload.orderId === order.id)).toHaveLength(1);
  });

  it('requires production evidence before cancelling and invalidates a preview after a changed verification', async () => {
    worker = await newWorker();
    const f = await assigned();
    const order = await db.order.findUniqueOrThrow({ where: { id: f.order.id } });
    const sales = { id: order.submitterId, role: 'SALES' as const };
    const request = await createOrderChangeRequest({ orderId: order.id, expectedRevision: order.revision, expectedWorkOrderVersion: order.workOrderVersion, type: 'CANCEL', reason: '尚未生产取消', items: [] }, sales);
    await expect(previewOrderCancellationSettlement({ requestId: request.id, producedQty: 0 }, admin)).rejects.toThrow('是否已生产');
    await reviewProductionFact({ jobId: f.job.id, jobRevision: f.job.revision, reviewRevision: -1, mode: 'UNPRODUCED', reason: '师傅确认尚未开工', notActuallyProduced: true }, admin);
    const preview = await previewOrderCancellationSettlement({ requestId: request.id, producedQty: 0 }, admin);
    const fact = await db.productionFactReview.findUniqueOrThrow({ where: { jobId: f.job.id } });
    await reviewProductionFact({ jobId: f.job.id, jobRevision: f.job.revision, reviewRevision: fact.revision, mode: 'UNPRODUCED', reason: '再次核对，未开工', notActuallyProduced: true }, admin);
    const approve = { requestId: request.id, decision: 'APPROVE' as const, reviewRemark: '管理员已核实生产', producedQty: 0, expectedPriceRevision: preview.priceRevision, expectedQuoteToken: preview.quoteToken, expectedProductionFactsToken: preview.productionFactsToken, pendingChargeResolutions: [] };
    await expect(reviewOrderChangeRequest(approve, admin)).rejects.toThrow('重新预览');
    const latest = await previewOrderCancellationSettlement({ requestId: request.id, producedQty: 0 }, admin);
    await reviewOrderChangeRequest({ ...approve, expectedProductionFactsToken: latest.productionFactsToken }, admin);
    expect((await db.order.findUniqueOrThrow({ where: { id: order.id } })).status).toBe('CANCELLED');
    expect((await db.productionJob.findUniqueOrThrow({ where: { id: f.job.id } })).status).toBe('CANCELLED');
    expect(await db.productionWage.count({ where: { jobId: f.job.id } })).toBe(0);
  });

  it('shows pending quantity even when that worker has no wage row', async () => {
    worker = await newWorker();
    const f = await assigned();
    await registerProductionCompletion({ ...completion(f.job, '990'), reason: '真实产量待核定' }, worker);
    const day = await getPieceworkSettlementDay({ workDate: todayShanghai(), reporterId: worker.id });
    expect(day.candidates).toHaveLength(1);
    expect(day.candidates[0].obligations).toEqual([expect.objectContaining({ id: f.job.id, orderId: f.order.id, status: 'REQUESTED' })]);
    expect(day.candidates[0].reportCount).toBe(0);
  });

  it('creates a real assigned rework through its public command, then records and ships it', async () => {
    worker = await newWorker();
    const f = await assigned(); await registerProductionCompletion(completion(f.job), worker);
    // Prepare a shipped source; the tested entry is real createReworkOrder (not manual materialization).
    await db.order.update({ where: { id: f.order.id }, data: { status: 'SHIPPED', shippedAt: new Date(), receiverName: '测试收件人', receiverPhone: '13800138000', receiverAddress: '广东省佛山市测试地址' } });
    const redo = await createReworkOrder({ sourceOrderId: f.order.id, cause: 'QUALITY', reason: '真实重做回归', items: [{ sourceOrderItemId: f.order.items[0].id, quantity: 200, craftIds: f.order.items[0].crafts }] }, admin);
    const order = await db.order.findUniqueOrThrow({ where: { id: redo.id }, include: { shipments: true } });
    expect(order.status).toBe('RELEASED'); expect(order.simpleProduction).toBe(true);
    const job = await db.productionJob.findFirstOrThrow({ where: { orderId: redo.id } });
    expect(job.workerId).toBe(worker.id); expect(job.manualPricing).toBe(true);
    expect(await db.orderPrintJob.count({ where: { orderId: redo.id } })).toBe(1);
    await registerProductionCompletion(completion(job, '200'), worker);
    expect((await db.order.findUniqueOrThrow({ where: { id: redo.id } })).status).toBe('PACKING');
    const ready = await db.order.findUniqueOrThrow({ where: { id: redo.id } });
    await registerShipment({ orderId: redo.id, shipmentId: order.shipments[0].id, expectedVersion: order.shipments[0].registrationVersion, expectedRevision: ready.revision, expectedEditVersion: ready.editVersion, expectedWorkOrderVersion: ready.workOrderVersion, expectedPriceRevision: ready.priceRevision, idempotencyKey: randomUUID(), trackingNo: 'TESTREWORK123', carrierCode: 'ZTO', carrierName: '', confirm: true }, admin);
    expect((await db.order.findUniqueOrThrow({ where: { id: redo.id } })).status).toBe('SETTLED');
    expect((await db.orderShipment.findUniqueOrThrow({ where: { id: order.shipments[0].id } })).status).toBe('SHIPPED');
    expect((await db.productionWage.findFirstOrThrow({ where: { jobId: f.job.id } })).amount?.toString()).toBe('200');
  });

  it('revises a real rework using its own production without inheriting the source a second time', async () => {
    worker = await newWorker();
    const source = await assigned();
    await registerProductionCompletion(completion(source.job), worker);
    await db.order.update({ where: { id: source.order.id }, data: { status: 'SHIPPED', shippedAt: new Date(), receiverName: '测试收件人', receiverPhone: '13800138000', receiverAddress: '广东省佛山市测试地址' } });
    const redo = await createReworkOrder({ sourceOrderId: source.order.id, cause: 'QUALITY', reason: '重做自身改版回归', items: [{ sourceOrderItemId: source.order.items[0].id, quantity: 200, craftIds: source.order.items[0].crafts }] }, admin);
    const item = await db.orderItem.findFirstOrThrow({ where: { orderId: redo.id } });
    const first = await db.productionJob.findFirstOrThrow({ where: { orderId: redo.id } });
    await registerProductionCompletion(completion(first, '200'), worker);
    for (const [version, quantity] of [[2, 200], [3, 300]] as const) {
      await db.$transaction(async tx => {
        await tx.orderItem.update({ where: { id: item.id }, data: { name: '重做款修改', quantity } });
        await tx.orderPackagingGroup.updateMany({ where: { orderId: redo.id }, data: { actualBagCount: quantity } });
        await tx.order.update({ where: { id: redo.id }, data: { workOrderVersion: version } });
        await activateProductionOperationsInTx(tx, redo.id, admin, undefined, { targetStatus: 'PACKING', allowVersionRematerialization: true });
        await activateProductionOperationsInTx(tx, redo.id, admin, undefined, { targetStatus: version === 2 ? 'PACKING' : 'RELEASED', allowVersionRematerialization: true });
      });
      const jobs = await db.productionJob.findMany({ where: { orderId: redo.id, workOrderVersion: version } });
      expect(jobs).toHaveLength(1);
      expect(jobs[0].workerId).toBe(worker.id);
      expect(jobs[0].manualPricing).toBe(true);
      expect(jobs[0].status).toBe(version === 2 ? 'CARRIED' : 'PENDING');
      expect(jobs[0].plannedQty.toString()).toBe(version === 2 ? '0' : '100');
    }
    expect(await db.productionWage.count({ where: { job: { orderId: redo.id } } })).toBe(1);
    expect((await db.productionWage.findFirstOrThrow({ where: { jobId: source.job.id } })).amount?.toString()).toBe('200');
    expect((await db.order.findUniqueOrThrow({ where: { id: source.order.id } })).status).toBe('SHIPPED');
  });

  it('records settled-day production separately from the frozen wage and protects correction without wage rows', async () => {
    worker = await newWorker();
    const paid = await assigned(); const forgotten = await assigned();
    await registerProductionCompletion(completion(paid.job), worker);
    const receipt = await lockPieceworkSettlement({ reporterId: worker.id, workDate: todayShanghai(), actor: admin, now: new Date(Date.now() + 86400000) });
    const before = await db.pieceworkSettlement.findUniqueOrThrow({ where: { id: receipt.id } });
    const backfill = { ...completion(forgotten.job), mode: 'BACKFILL' as const, workDate: todayShanghai(), reason: '核实原日已做，工资漏登记' };
    await expect(registerProductionCompletion(backfill, admin)).rejects.toThrow('原生产日工资已结算');
    await registerProductionCompletion({ ...backfill, confirmedSettledDay: true }, admin);
    await registerProductionCompletion({ ...backfill, confirmedSettledDay: true }, admin);
    const completed = await db.productionJob.findUniqueOrThrow({ where: { id: forgotten.job.id } });
    expect(completed.status).toBe('COMPLETED'); expect(completed.workerId).toBe(worker.id);
    expect((await db.order.findUniqueOrThrow({ where: { id: forgotten.order.id } })).status).toBe('PACKING');
    expect(await db.productionWage.count({ where: { jobId: forgotten.job.id } })).toBe(0);
    const obligation = await db.productionFactReview.findUniqueOrThrow({ where: { jobId: completed.id } });
    expect(obligation.status).toBe('WAGES_DUE');
    expect(await db.pieceworkSettlement.findUniqueOrThrow({ where: { id: receipt.id } })).toEqual(before);
    await expect(correctProductionRegistration({ jobId: completed.id, revision: completed.revision, requestKey: randomUUID(), reason: '不能绕过原日', notActuallyProduced: true }, admin)).rejects.toThrow('已结算');
    await expect(allocateProductionWages({ jobId: completed.id, requestKey: randomUUID(), reason: '不能改原日工资', allocations: [{ workerId: worker.id, amount: '200', expectedRevision: -1 }] }, admin)).rejects.toThrow('已结算');
    await expect(db.productionJob.update({ where: { id: completed.id }, data: { status: 'PENDING', revision: { increment: 1 }, completedQty: null, completedAt: null, workDate: null } })).rejects.toThrow();
    await reviewProductionFact({ jobId: completed.id, jobRevision: completed.revision, reviewRevision: obligation.revision, mode: 'DISMISS_WAGE', reason: '根据留存凭据确认此前已另行支付，无需补发' }, admin);
    expect((await db.productionFactReview.findUniqueOrThrow({ where: { jobId: completed.id } })).status).toBe('DISMISSED');
    expect((await db.productionJob.findUniqueOrThrow({ where: { id: completed.id } })).status).toBe('COMPLETED');
  });

  it('resuming with a pending cancellation does not notify until the last request closes', async () => {
    worker = await newWorker(); const f = await assigned();
    await holdFactoryOrder({ orderId: f.order.id, reasonCode: 'DESIGN_ERROR', reasonNote: '暂停核对', affectedFigs: [], idempotencyKey: randomUUID() }, admin);
    const order = await db.order.findUniqueOrThrow({ where: { id: f.order.id } }); const sales = { id: order.submitterId, role: 'SALES' as const };
    const request = await createOrderChangeRequest({ orderId: order.id, expectedRevision: order.revision, expectedWorkOrderVersion: order.workOrderVersion, type: 'CANCEL', reason: '先核实生产', items: [] }, sales);
    await registerProductionCompletion({ ...completion(f.job), mode: 'BACKFILL', workDate: todayShanghai(), reason: '暂停前已经生产' }, admin);
    await resumeFactoryOrder({ orderId: order.id, recoveryEvidence: { production: '实际数量已核定，取消待审批' }, idempotencyKey: randomUUID() }, admin);
    expect((await db.order.findUniqueOrThrow({ where: { id: order.id } })).status).toBe('RELEASED');
    expect((await db.order.findUniqueOrThrow({ where: { id: order.id } })).completedAt).toBeNull();
    await withdrawOrderChangeRequest({ requestId: request.id }, sales);
    expect((await db.order.findUniqueOrThrow({ where: { id: order.id } })).status).toBe('PACKING');
    expect(vi.mocked(dispatchNotification).mock.calls.filter(([event, payload]) => event === 'ORDER_COMPLETED' && 'orderId' in payload && payload.orderId === order.id)).toHaveLength(1);
  });

  it('metadata-only approvals retain the accepted 990, original completion time and one notification', async () => {
    worker = await newWorker(); const f = await assigned();
    await registerProductionCompletion({ ...completion(f.job, '990'), reason: '实际成品' }, worker);
    const pending = await db.productionJob.findUniqueOrThrow({ where: { id: f.job.id } });
    await registerProductionCompletion({ ...completion(pending, '990'), mode: 'APPROVE', reason: '核定完成' }, admin);
    const original = await db.order.findUniqueOrThrow({ where: { id: f.order.id } }); const sales = { id: original.submitterId, role: 'SALES' as const };
    for (const promisedDate of ['2026-10-03', '2026-10-04']) {
      const order = await db.order.findUniqueOrThrow({ where: { id: f.order.id } });
      const request = await createOrderChangeRequest({ orderId: order.id, expectedRevision: order.revision, expectedWorkOrderVersion: order.workOrderVersion, type: 'MODIFY', modifyKind: 'OTHER', reason: '交期协商', items: [], promisedDate: new Date(promisedDate) }, sales);
      const quote = await previewOrderChangeRequestPricing(request.id, admin);
      await reviewOrderChangeRequest({ requestId: request.id, decision: 'APPROVE', reviewRemark: '同意调整交期', expectedPriceRevision: quote.priceRevision, expectedProductionFactsToken: quote.productionFactsToken, pendingChargeResolutions: [] }, admin);
      const after = await db.order.findUniqueOrThrow({ where: { id: order.id } });
      expect(after.status).toBe('PACKING'); expect(after.completedAt).toEqual(original.completedAt);
      const task = await db.productionJob.findFirstOrThrow({ where: { orderId: order.id, workOrderVersion: after.workOrderVersion } });
      expect(task.status).toBe('CARRIED'); expect(task.plannedQty.toString()).toBe('0');
    }
    expect(await db.productionWage.count({ where: { job: { orderId: f.order.id } } })).toBe(1);
    expect(vi.mocked(dispatchNotification).mock.calls.filter(([event, payload]) => event === 'ORDER_COMPLETED' && 'orderId' in payload && payload.orderId === f.order.id)).toHaveLength(1);
  });

  it.each(['COMPLETE', 'BACKFILL'] as const)('continues unfinished physical work across metadata edits and pays once via %s', async mode => {
    worker = await newWorker(); const f = await assigned();
    const priorDay = new Date(`${todayShanghai()}T00:00:00Z`); priorDay.setUTCDate(priorDay.getUTCDate() - 1);
    await db.productionOperation.update({ where: { id: f.job.operationId! }, data: { createdAt: priorDay } });
    if (mode === 'BACKFILL') await historicalRate(worker.id, priorDay);
    // A scan means final completion: the 400 already physically made are still
    // part of the original 1,000-piece task, not an invented completed batch.
    const before = await db.order.findUniqueOrThrow({ where: { id: f.order.id } });
    const request = await createOrderChangeRequest({ orderId: before.id, expectedRevision: before.revision, expectedWorkOrderVersion: before.workOrderVersion, type: 'MODIFY', modifyKind: 'OTHER', reason: '已做部分、继续生产，仅调整交期', items: [], promisedDate: new Date('2026-10-05') }, { id: before.submitterId, role: 'SALES' });
    const quote = await previewOrderChangeRequestPricing(request.id, admin);
    await reviewOrderChangeRequest({ requestId: request.id, decision: 'APPROVE', reviewRemark: '继续原任务', expectedPriceRevision: quote.priceRevision, expectedProductionFactsToken: quote.productionFactsToken, pendingChargeResolutions: [] }, admin);
    const after = await db.order.findUniqueOrThrow({ where: { id: before.id } });
    const next = await db.productionJob.findFirstOrThrow({ where: { orderId: before.id, workOrderVersion: after.workOrderVersion } });
    expect(after.status).toBe('RELEASED'); expect(after.completedAt).toBeNull();
    expect(next.workerId).toBe(worker.id); expect(next.plannedQty.toString()).toBe('1000'); expect(next.manualPricing).toBe(false);
    expect(await db.productionWage.count({ where: { job: { orderId: before.id } } })).toBe(0);
    expect((await db.productionFactReview.findUniqueOrThrow({ where: { jobId: f.job.id } })).evidence).toMatchObject({ resolution: 'CONTINUED', nextJobId: next.id });
    const input = mode === 'BACKFILL' ? { ...completion(next), mode, workDate: priorDay.toISOString().slice(0, 10), reason: '原任务实际生产日补登记' } : completion(next);
    await registerProductionCompletion(input, mode === 'BACKFILL' ? admin : worker);
    await registerProductionCompletion(input, mode === 'BACKFILL' ? admin : worker);
    const wage = await db.productionWage.findFirstOrThrow({ where: { jobId: next.id } });
    expect(wage.amount?.toString()).toBe('200');
    expect(await db.productionWage.count({ where: { job: { orderId: before.id } } })).toBe(1);
    expect((await db.order.findUniqueOrThrow({ where: { id: before.id } })).status).toBe('PACKING');
  });

  it('preserves physical completion when a repriced reduction requires no new production', async () => {
    worker = await newWorker(); const f = await assigned();
    await registerProductionCompletion({ ...completion(f.job, '990'), reason: '实际成品' }, worker);
    const pending = await db.productionJob.findUniqueOrThrow({ where: { id: f.job.id } });
    await registerProductionCompletion({ ...completion(pending, '990'), mode: 'APPROVE', reason: '核定完成' }, admin);
    const before = await db.order.findUniqueOrThrow({ where: { id: f.order.id } });
    await db.$transaction(async tx => {
      await tx.orderItem.update({ where: { id: f.order.items[0].id }, data: { quantity: 995 } });
      await tx.orderPackagingGroup.updateMany({ where: { orderId: before.id }, data: { actualBagCount: 995 } });
      await tx.order.update({ where: { id: before.id }, data: { workOrderVersion: 2, completedAt: null } });
      await activateProductionOperationsInTx(tx, before.id, admin, undefined, { targetStatus: 'PACKING', allowVersionRematerialization: true });
      await preserveCarriedCompletionInTx(tx, before.id, before.completedAt);
      const completed = await reconcileProductionOrderInTx(tx, before.id, admin.id, new Date());
      expect(completed.notification).toBeUndefined();
    });
    expect((await db.order.findUniqueOrThrow({ where: { id: before.id } })).completedAt).toEqual(before.completedAt);
    expect(await db.productionWage.count({ where: { job: { orderId: before.id } } })).toBe(1);
  });

  it('recovers a cancelled old request from original quantities and reprices only the real 310-piece successor', async () => {
    worker = await newWorker(); const f = await assigned();
    // Simulate persisted legacy data, without disabling any database protection.
    await db.productionJob.update({ where: { id: f.job.id }, data: { status: 'CANCELLED', requestedQty: '990', requestReason: '旧申请被历史版本取消', requestedAt: new Date(), workDate: new Date(`${todayShanghai()}T00:00:00Z`) } });
    await db.$transaction(async tx => {
      await tx.orderItem.update({ where: { id: f.order.items[0].id }, data: { quantity: 1300 } });
      await tx.orderPackagingGroup.updateMany({ where: { orderId: f.order.id }, data: { actualBagCount: 1300 } });
      await tx.order.update({ where: { id: f.order.id }, data: { workOrderVersion: 2 } });
      await activateProductionOperationsInTx(tx, f.order.id, admin, undefined, { targetStatus: 'RELEASED', allowVersionRematerialization: true });
    });
    const next = await db.productionJob.findFirstOrThrow({ where: { orderId: f.order.id, workOrderVersion: 2 } });
    await reviewProductionFact({ jobId: f.job.id, jobRevision: f.job.revision, reviewRevision: -1, mode: 'OPEN', reason: '核对旧申请漏计工资' }, admin);
    await expect(registerProductionCompletion(completion(next, '1300'), worker)).rejects.toThrow('先核对');
    await reviewProductionFact({ jobId: next.id, jobRevision: next.revision, reviewRevision: -1, mode: 'UNPRODUCED', reason: '新版尚未开工', notActuallyProduced: true }, admin);
    const review = await db.productionFactReview.findUniqueOrThrow({ where: { jobId: f.job.id } });
    const recover = { ...completion(f.job, '990'), mode: 'RECOVER' as const, reviewRevision: review.revision, reason: '原日确实已生产 990' };
    await registerProductionCompletion(recover, admin); await registerProductionCompletion(recover, admin);
    const recovered = await db.productionJob.findUniqueOrThrow({ where: { id: f.job.id } });
    expect(recovered.completedQty?.toString()).toBe('990'); expect(recovered.workDate?.toISOString().slice(0, 10)).toBe(todayShanghai());
    expect((await db.productionWage.findFirstOrThrow({ where: { jobId: f.job.id } })).amount?.toString()).toBe('198');
    expect(await db.productionWage.count({ where: { jobId: f.job.id } })).toBe(1);
    const corrected = await db.productionJob.findUniqueOrThrow({ where: { id: next.id } });
    expect(corrected.plannedQty.toString()).toBe('310'); expect(corrected.manualPricing).toBe(true);
    await registerProductionCompletion(completion(corrected, '310'), worker);
    expect((await db.order.findUniqueOrThrow({ where: { id: f.order.id } })).status).toBe('PACKING');
    const wage = await db.productionWage.findFirstOrThrow({ where: { jobId: next.id } });
    expect(wage.amount).toBeNull();
    await expect(lockPieceworkSettlement({ reporterId: worker.id, workDate: todayShanghai(), actor: admin, now: new Date(Date.now() + 86400000) })).rejects.toThrow();
    await allocateProductionWages({ jobId: next.id, requestKey: randomUUID(), reason: '核定改版新增提成', allocations: [{ workerId: worker.id, amount: '62', expectedRevision: wage.revision }] }, admin);
    const receipt = await lockPieceworkSettlement({ reporterId: worker.id, workDate: todayShanghai(), actor: admin, now: new Date(Date.now() + 86400000) });
    expect((await db.pieceworkSettlement.findUniqueOrThrow({ where: { id: receipt.id } })).payableAmount.toString()).toBe('260');
  });

  it('blocks direct SQL loss or date rewrites of a requested quantity, then settles only after resolution', async () => {
    worker = await newWorker(); const f = await assigned();
    await registerProductionCompletion({ ...completion(f.job, '990'), reason: '实际数量' }, worker);
    for (const status of ['PENDING', 'CANCELLED'] as const) await expect(db.productionJob.update({ where: { id: f.job.id }, data: { status, revision: { increment: 1 }, requestedQty: null, workDate: null } })).rejects.toThrow();
    await expect(db.productionJob.update({ where: { id: f.job.id }, data: { workDate: new Date('2026-01-01T00:00:00Z') } })).rejects.toThrow();
    const pending = await db.productionJob.findUniqueOrThrow({ where: { id: f.job.id } });
    const results = await Promise.allSettled([
      registerProductionCompletion({ ...completion(pending, '990'), mode: 'APPROVE', reason: '原日核定实际完成' }, admin),
      lockPieceworkSettlement({ reporterId: worker.id, workDate: todayShanghai(), actor: admin, now: new Date(Date.now() + 86400000) }),
    ]);
    expect(results[0].status).toBe('fulfilled');
    await lockPieceworkSettlement({ reporterId: worker.id, workDate: todayShanghai(), actor: admin, now: new Date(Date.now() + 86400000) });
    expect(await db.pieceworkSettlement.count({ where: { reporterId: worker.id } })).toBe(1);
    expect(await db.productionWageEntry.count({ where: { wage: { jobId: f.job.id } } })).toBe(1);
  });

  it.each([true, false])('recovers only the dependent craft with unrelated carried production (old request=%s)', async withRequest => {
    worker = await newWorker(); const f = await fixture(); const fullWorker = await newWorker();
    await db.user.update({ where: { id: fullWorker.id }, data: { machineType: 'WINDMILL' } });
    const fullCraft = await db.craft.findUniqueOrThrow({ where: { code: 'FLAT_FOIL_SINGLE' } });
    const second = await db.orderItem.create({ data: { orderId: f.order.id, name: '独立专版款', sequence: 2, quantity: 1000, craft: 'FULL', pricingRoute: 'CUSTOM_SINGLE_FLAT_FOIL', productStructure: 'STANDARD_ENVELOPE', foilTechnique: 'FLAT', frontFoilColors: ['亚金'], crafts: [fullCraft.id], paperType: '珠光纸' } });
    await db.orderPackagingGroup.create({ data: { orderId: f.order.id, sequence: 2, mode: 'SINGLE_STYLE', actualBagCount: 1000, lines: { create: { orderItemId: second.id, unitsPerBag: 1 } } } });
    const { targets } = await currentDispatchTargets(db, f.order.id);
    await publishProductionDispatch({ requestKey: randomUUID(), orders: [{ ...f.request.orders[0], assignments: Object.fromEntries(targets.map(target => [target.key, target.operationType === 'FULL' ? fullWorker.id : worker.id])) }] }, admin);
    const old = await db.productionJob.findFirstOrThrow({ where: { orderId: f.order.id, workerId: worker.id } });
    const other = await db.productionJob.findFirstOrThrow({ where: { orderId: f.order.id, workerId: fullWorker.id } });
    await db.productionJob.update({ where: { id: old.id }, data: { status: 'CANCELLED', ...(withRequest ? { requestedQty: '990', workDate: new Date(`${todayShanghai()}T00:00:00Z`) } : {}) } });
    await registerProductionCompletion(completion(other), fullWorker);
    const otherWage = await db.productionWage.findFirstOrThrow({ where: { jobId: other.id } });
    await db.$transaction(async tx => {
      await tx.orderItem.update({ where: { id: f.order.items[0].id }, data: { quantity: 1300 } });
      await tx.orderPackagingGroup.updateMany({ where: { orderId: f.order.id, sequence: 1 }, data: { actualBagCount: 1300 } });
      await tx.order.update({ where: { id: f.order.id }, data: { workOrderVersion: 2 } });
      await activateProductionOperationsInTx(tx, f.order.id, admin, undefined, { targetStatus: 'RELEASED', allowVersionRematerialization: true });
    });
    const next = await db.productionJob.findFirstOrThrow({ where: { orderId: f.order.id, workOrderVersion: 2, workerId: worker.id } });
    const carried = await db.productionJob.findFirstOrThrow({ where: { orderId: f.order.id, workOrderVersion: 2, workerId: fullWorker.id } });
    expect(carried.status).toBe('CARRIED');
    if (!withRequest) await reviewProductionFact({ jobId: old.id, jobRevision: old.revision, reviewRevision: -1, mode: 'UNPRODUCED', reason: '先前误以为未生产', notActuallyProduced: true }, admin);
    const previous = await db.productionFactReview.findUnique({ where: { jobId: old.id } });
    await reviewProductionFact({ jobId: old.id, jobRevision: old.revision, reviewRevision: previous?.revision ?? -1, mode: 'OPEN', reason: '核实旧版实际生产' }, admin);
    await reviewProductionFact({ jobId: next.id, jobRevision: next.revision, reviewRevision: -1, mode: 'UNPRODUCED', reason: '后续该工序尚未做', notActuallyProduced: true }, admin);
    const review = await db.productionFactReview.findUniqueOrThrow({ where: { jobId: old.id } });
    await registerProductionCompletion({ ...completion(old, '990'), mode: 'RECOVER', workDate: todayShanghai(), reviewRevision: review.revision, reason: '原师傅实际做 990' }, admin);
    const updated = await db.productionJob.findUniqueOrThrow({ where: { id: next.id } });
    expect(updated.plannedQty.toString()).toBe('310'); expect(updated.workerId).toBe(worker.id); expect(updated.manualPricing).toBe(true);
    expect(await db.productionJob.findUniqueOrThrow({ where: { id: carried.id } })).toEqual(carried);
    expect(await db.productionWage.findUniqueOrThrow({ where: { id: otherWage.id } })).toEqual(otherWage);
    expect((await db.productionWage.findFirstOrThrow({ where: { jobId: old.id } })).amount?.toString()).toBe('198');
    await registerProductionCompletion(completion(updated, '310'), worker);
    expect((await db.order.findUniqueOrThrow({ where: { id: f.order.id } })).status).toBe('PACKING');
  });

  it('does not include two full old requests in one smaller later fact or reopen an included fact', async () => {
    worker = await newWorker(); const f = await assigned(); const oldJobs = [f.job];
    await db.productionJob.update({ where: { id: f.job.id }, data: { status: 'CANCELLED', requestedQty: '990', workDate: new Date(`${todayShanghai()}T00:00:00Z`) } });
    for (const version of [2, 3]) {
      await db.$transaction(async tx => {
        await tx.order.update({ where: { id: f.order.id }, data: { workOrderVersion: version } });
        await activateProductionOperationsInTx(tx, f.order.id, admin, undefined, { targetStatus: 'RELEASED', allowVersionRematerialization: true });
      });
      const next = await db.productionJob.findFirstOrThrow({ where: { orderId: f.order.id, workOrderVersion: version } });
      if (version === 2) { oldJobs.push(next); await db.productionJob.update({ where: { id: next.id }, data: { status: 'CANCELLED', requestedQty: '990', workDate: new Date(`${todayShanghai()}T00:00:00Z`) } }); }
      else await registerProductionCompletion(completion(next), worker);
    }
    const later = await db.productionJob.findFirstOrThrow({ where: { orderId: f.order.id, workOrderVersion: 3 } });
    for (const old of oldJobs) await reviewProductionFact({ jobId: old.id, jobRevision: old.revision, reviewRevision: -1, mode: 'OPEN', reason: '核对旧申请' }, admin);
    const input = { jobId: oldJobs[0].id, jobRevision: oldJobs[0].revision, reviewRevision: 0, mode: 'INCLUDED_LATER' as const, relatedJobId: later.id, quantity: '990', workDate: todayShanghai(), confirmedIncluded: true, reason: '全部含在此登记' };
    await reviewProductionFact(input, admin);
    await expect(reviewProductionFact({ ...input, jobId: oldJobs[1].id, jobRevision: oldJobs[1].revision }, admin)).rejects.toThrow('数量不足');
    const resolved = await db.productionFactReview.findUniqueOrThrow({ where: { jobId: oldJobs[0].id } });
    const first = await db.productionJob.findUniqueOrThrow({ where: { id: oldJobs[0].id } });
    await expect(reviewProductionFact({ jobId: first.id, jobRevision: first.revision, reviewRevision: resolved.revision, mode: 'OPEN', reason: '不能重复恢复' }, admin)).rejects.toThrow('不能作为独立');
    await expect(db.productionFactReview.update({ where: { id: resolved.id }, data: { status: 'OPEN', revision: { increment: 1 } } })).rejects.toThrow();
    const unresolved = await db.productionFactReview.findUniqueOrThrow({ where: { jobId: oldJobs[1].id } });
    await expect(db.productionFactReview.update({ where: { id: unresolved.id }, data: { status: 'RESOLVED', evidence: { resolution: 'INCLUDED_LATER', relatedJobId: later.id, quantity: '990' }, resolvedById: admin.id, resolvedAt: new Date(), revision: { increment: 1 } } })).rejects.toThrow();
    expect(await db.productionWage.count({ where: { job: { orderId: f.order.id } } })).toBe(1);
  });

  it.each(['INCLUDED_LATER', 'ADDITIONAL', 'ADDITIONAL_SETTLED'] as const)('resolves historical conflict via %s without rewriting later wages', async mode => {
    worker = await newWorker(); const f = await assigned();
    await db.productionJob.update({ where: { id: f.job.id }, data: { status: 'CANCELLED', requestedQty: '990', workDate: new Date(`${todayShanghai()}T00:00:00Z`) } });
    await db.$transaction(async tx => {
      await tx.order.update({ where: { id: f.order.id }, data: { workOrderVersion: 2 } });
      await activateProductionOperationsInTx(tx, f.order.id, admin, undefined, { targetStatus: 'RELEASED', allowVersionRematerialization: true });
    });
    const next = await db.productionJob.findFirstOrThrow({ where: { orderId: f.order.id, workOrderVersion: 2 } });
    await registerProductionCompletion(completion(next), worker);
    const receipt = mode === 'ADDITIONAL_SETTLED' ? await lockPieceworkSettlement({ reporterId: worker.id, workDate: todayShanghai(), actor: admin, now: new Date(Date.now() + 86400000) }) : null;
    const ledger = receipt ? await db.pieceworkSettlement.findUniqueOrThrow({ where: { id: receipt.id } }) : null;
    const paid = await db.productionWage.findFirstOrThrow({ where: { jobId: next.id } });
    await reviewProductionFact({ jobId: f.job.id, jobRevision: f.job.revision, reviewRevision: -1, mode: 'OPEN', reason: '旧任务可能漏登记，需复核' }, admin);
    await expect(registerProductionCompletion({ ...completion(f.job), mode: 'RECOVER', reviewRevision: 0, workDate: todayShanghai(), reason: '核实旧生产' }, admin)).rejects.toThrow('不能重复计产');
    expect((await db.productionFactReview.findUniqueOrThrow({ where: { jobId: f.job.id } })).status).toBe('CONFLICT');
    expect(await db.productionWage.findUniqueOrThrow({ where: { id: paid.id } })).toEqual(paid);
    expect(await db.productionWage.count({ where: { jobId: f.job.id } })).toBe(0);
    const review = await db.productionFactReview.findUniqueOrThrow({ where: { jobId: f.job.id } });
    if (mode === 'INCLUDED_LATER') {
      const input = { jobId: f.job.id, jobRevision: f.job.revision, reviewRevision: review.revision, mode: 'INCLUDED_LATER' as const, relatedJobId: next.id, quantity: '990', workDate: todayShanghai(), confirmedIncluded: true, reason: '凭原记录确认旧数量已含在后续完成中' };
      await expect(reviewProductionFact(input, worker)).rejects.toThrow('管理员');
      await expect(reviewProductionFact({ ...input, quantity: '500' }, admin)).rejects.toThrow('旧申请必须全部');
      await reviewProductionFact(input, admin); await reviewProductionFact(input, admin);
      expect((await db.productionJob.findUniqueOrThrow({ where: { id: f.job.id } })).status).toBe('CANCELLED');
      expect(await db.productionWage.count({ where: { jobId: f.job.id } })).toBe(0);
      expect((await db.productionFactReview.findUniqueOrThrow({ where: { jobId: f.job.id } })).evidence).toMatchObject({ resolution: 'INCLUDED_LATER', relatedJobId: next.id });
    } else {
      const input = { ...completion(f.job, '990'), mode: 'RECOVER' as const, reviewRevision: review.revision, workDate: todayShanghai(), reason: '凭原单核实另做过 990 个', confirmedAdditionalProduction: true, confirmedSettledDay: mode === 'ADDITIONAL_SETTLED' };
      await registerProductionCompletion(input, admin); await registerProductionCompletion(input, admin);
      const resolved = await db.productionFactReview.findUniqueOrThrow({ where: { jobId: f.job.id } });
      expect(resolved.status).toBe(mode === 'ADDITIONAL_SETTLED' ? 'WAGES_DUE' : 'RESOLVED');
      expect(resolved.evidence).toMatchObject({ resolution: 'ADDITIONAL_PRODUCTION', projectionPending: false });
      if (ledger) {
        expect(await db.productionWage.count({ where: { jobId: f.job.id } })).toBe(0);
        expect(await db.pieceworkSettlement.findUniqueOrThrow({ where: { id: ledger.id } })).toEqual(ledger);
      } else expect((await db.productionWage.findFirstOrThrow({ where: { jobId: f.job.id } })).amount?.toString()).toBe('198');
    }
    expect(await db.productionWage.findUniqueOrThrow({ where: { id: paid.id } })).toEqual(paid);
    expect(await db.productionFactReview.count({ where: { job: { orderId: f.order.id }, status: { in: ['OPEN', 'CONFLICT'] } } })).toBe(0);
  });

  it('completes a packing-only rework with no fake production wages and one completion event', async () => {
    worker = await newWorker(); const f = await assigned(); await registerProductionCompletion(completion(f.job), worker);
    await db.order.update({ where: { id: f.order.id }, data: { status: 'SHIPPED', shippedAt: new Date(), receiverName: '测试收件人', receiverPhone: '13800138000', receiverAddress: '广东省佛山市测试地址' } });
    const redo = await createReworkOrder({ sourceOrderId: f.order.id, cause: 'LOGISTICS_DAMAGE', reason: '仅重新入袋', items: [{ sourceOrderItemId: f.order.items[0].id, quantity: 200, craftIds: [] }] }, admin);
    expect((await db.order.findUniqueOrThrow({ where: { id: redo.id } })).status).toBe('PACKING');
    expect(await db.productionJob.count({ where: { orderId: redo.id } })).toBe(0);
    expect(await db.productionWage.count({ where: { job: { orderId: redo.id } } })).toBe(0);
    expect(vi.mocked(dispatchNotification).mock.calls.filter(([event, payload]) => event === 'ORDER_COMPLETED' && 'orderId' in payload && payload.orderId === redo.id)).toHaveLength(1);
  });

  it('recovers an existing scheduling rework without duplicating its tasks, print or source wages', async () => {
    worker = await newWorker(); const f = await assigned(); await registerProductionCompletion(completion(f.job), worker);
    await db.order.update({ where: { id: f.order.id }, data: { status: 'SHIPPED', shippedAt: new Date(), receiverName: '测试收件人', receiverPhone: '13800138000', receiverAddress: '广东省佛山市测试地址' } });
    const redo = await createReworkOrder({ sourceOrderId: f.order.id, cause: 'QUALITY', reason: '恢复夹具', items: [{ sourceOrderItemId: f.order.items[0].id, quantity: 200, craftIds: f.order.items[0].crafts }] }, admin);
    const old = await db.order.update({ where: { id: redo.id }, data: { status: 'SCHEDULING' } });
    const input = { orderId: old.id, revision: old.revision, version: old.workOrderVersion, mode: 'RELEASE_REWORK' as const, requestKey: randomUUID(), reason: '扫描确认旧版本未下发' };
    await expect(repairProductionMetadata(input, worker)).rejects.toThrow('管理员');
    await repairProductionMetadata(input, admin); await repairProductionMetadata(input, admin);
    expect((await db.order.findUniqueOrThrow({ where: { id: redo.id } })).status).toBe('RELEASED');
    expect(await db.orderPrintJob.count({ where: { orderId: redo.id } })).toBe(1);
    const job = await db.productionJob.findFirstOrThrow({ where: { orderId: redo.id } });
    await registerProductionCompletion(completion(job, '200'), worker);
    expect((await db.productionWage.findFirstOrThrow({ where: { jobId: f.job.id } })).amount?.toString()).toBe('200');
  });

  it('keeps first production automatic through an unproduced physical revision and repairs a legacy marker idempotently', async () => {
    worker = await newWorker(); const f = await assigned();
    await reviewProductionFact({ jobId: f.job.id, jobRevision: f.job.revision, reviewRevision: -1, mode: 'UNPRODUCED', reason: '确认未开工', notActuallyProduced: true }, admin);
    await db.$transaction(async tx => {
      await tx.orderItem.update({ where: { id: f.order.items[0].id }, data: { artworkVersion: '首次生产前改版' } });
      await tx.order.update({ where: { id: f.order.id }, data: { workOrderVersion: 2 } });
      await activateProductionOperationsInTx(tx, f.order.id, admin, undefined, { targetStatus: 'RELEASED', allowVersionRematerialization: true });
    });
    const next = await db.productionJob.findFirstOrThrow({ where: { orderId: f.order.id, workOrderVersion: 2 } });
    expect(next.manualPricing).toBe(false);
    await db.productionJob.update({ where: { id: next.id }, data: { manualPricing: true } });
    const order = await db.order.findUniqueOrThrow({ where: { id: f.order.id } });
    const repair = { orderId: order.id, revision: order.revision, version: 2, mode: 'FIX_FIRST_PRICING' as const, requestKey: randomUUID(), reason: '纠正旧版首次生产标记' };
    expect((await repairProductionMetadata(repair, admin)).replay).toBe(false);
    expect((await repairProductionMetadata(repair, admin)).replay).toBe(true);
    const corrected = await db.productionJob.findUniqueOrThrow({ where: { id: next.id } });
    await registerProductionCompletion(completion(corrected), worker);
    expect((await db.productionWage.findFirstOrThrow({ where: { jobId: next.id } })).amount?.toString()).toBe('200');
    const scan = await scanProductionRecovery();
    expect(scan.jobs.some(job => job.id === f.job.id)).toBe(true);
  });
});
