import { randomUUID } from 'node:crypto';
import { beforeAll, describe, expect, it, vi } from 'vitest';
import { db } from '@/lib/db';
import { publishProductionDispatch } from '../dispatch';
import { currentDispatchTargets } from '../dispatch-targets';
import { registerProductionCompletion } from '../completion-registration';
import { allocateProductionWages } from '@/lib/salary/production-wages';
import { lockPieceworkSettlement } from '@/lib/salary/piecework-settlement';
import { activateProductionOperationsInTx } from '../operation-materialization-service';
import { markOrderPrintRequestPrinted } from '@/lib/order/print-jobs';
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
  it('rejects a changed approval quantity and allows a reasoned rejection to retry', async () => {
    const f = await assigned(); await registerProductionCompletion({ ...completion(f.job, '990'), reason: '实际数量待核对' }, worker);
    const pending = await db.productionJob.findUniqueOrThrow({ where: { id: f.job.id } });
    await expect(lockPieceworkSettlement({ reporterId: worker.id, workDate: todayShanghai(), actor: admin, now: new Date(Date.now() + 86400000) })).rejects.toThrow('数量待审批');
    await expect(registerProductionCompletion({ ...completion(pending, '999'), mode: 'APPROVE', reason: '审批' }, admin)).rejects.toThrow('申请不一致');
    await registerProductionCompletion({ ...completion(pending, '990'), mode: 'REJECT', reason: '数量未核实' }, admin);
    const reset = await db.productionJob.findUniqueOrThrow({ where: { id: f.job.id } });
    expect(reset.status).toBe('PENDING'); expect(reset.workDate).toBeNull();
    expect(await db.productionWage.count({ where: { jobId: f.job.id } })).toBe(0);
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
    await db.$transaction(async tx => { await expect(assertShipOrderReadinessInTx(tx, { orderId: redo.order.id, workOrderVersion: 1, settlementType: 'NO_CHARGE', isVersionedCommand: false, hasSubmittedShipmentDetails: true, simpleProduction: true })).resolves.toHaveLength(1); });
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
    const print = await db.orderPrintJob.findFirstOrThrow({ where: { orderId: f.order.id, state: 'PENDING' } });
    await markOrderPrintRequestPrinted({ requestJobId: print.id, idempotencyKey: randomUUID() }, admin);
    const current = await db.order.findUniqueOrThrow({ where: { id: f.order.id } });
    const newOwner = await newWorker();
    const request = { requestKey: randomUUID(), orders: [{ ...f.request.orders[0], revision: current.revision, assignments: Object.fromEntries(Object.keys(f.request.orders[0].assignments).map(key => [key, newOwner.id])) }] };
    await publishProductionDispatch(request, admin); await publishProductionDispatch(request, admin);
    expect((await db.productionJob.findUniqueOrThrow({ where: { id: f.job.id } })).workerId).toBe(newOwner.id);
    expect(await db.orderPrintJob.count({ where: { orderId: f.order.id, state: 'PENDING', printKind: 'REPRINT' } })).toBe(1);
  });

});
