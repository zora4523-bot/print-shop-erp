import { randomUUID } from 'node:crypto';
import { beforeAll, describe, expect, it, vi } from 'vitest';
import { db } from '@/lib/db';
import { lockPieceworkSettlement } from '@/lib/salary/piecework-settlement';
import { todayShanghai } from '@/lib/dashboard/shanghai-clock';
import { shipOrder } from '@/lib/order';
import { runAdminOrderBatch } from '@/lib/order/admin-batch';
import { registerShipment } from '@/lib/order/shipment-registration';
import { publishProductionDispatch } from '../dispatch';
import { currentDispatchTargets } from '../dispatch-targets';
import { registerProductionCompletion } from '../completion-registration';
import { completeOrderProductionAtPlan } from '../planned-completion';

vi.mock('server-only', () => ({}));
vi.mock('@/lib/notification/dispatch', () => ({ dispatchNotification: vi.fn() }));
const url = process.env.DATABASE_URL;
const isolated = !!url && url === process.env.E2E_DATABASE_URL && new URL(url).pathname.slice(1) === process.env.E2E_DATABASE_CONFIRM_DATABASE && /_e2e_/.test(new URL(url).pathname);
const pg = isolated ? describe : describe.skip;
const prefix = `planned_${randomUUID().replaceAll('-', '')}`;
const admin = { id: `${prefix}_admin`, role: 'ADMIN' as const, displayName: '完工管理员', username: `${prefix}_admin` };

async function newWorker(displayName = '生产师傅') {
  const id = `worker_${randomUUID()}`;
  await db.user.create({ data: { id, username: id, password: 'not-a-login-hash', displayName, role: 'WORKER', workerType: 'MACHINE', machineType: 'HAND_PRESS' } });
  return { id, role: 'WORKER' as const };
}

/** A released single-owner order with one assigned job; `addresses` shipments split the quantity. */
async function released(worker: { id: string }, options: { addresses?: number; noCharge?: boolean } = {}) {
  const quantity = 1000;
  const craft = await db.craft.findUniqueOrThrow({ where: { code: 'FLAT_FOIL_PARTIAL' } });
  const order = await db.order.create({ data: { orderNo: `PLANNED-${randomUUID()}`, customName: '按计划完工验收', submitterId: `${prefix}_sales`, createdById: admin.id, submitterRole: 'SALES',
    settlementType: 'EXTERNAL_SALES', pricingStatus: 'ADMIN_CONFIRMED', pricingConfirmedAt: new Date(), pricingConfirmedById: admin.id, confirmedFee: '100', totalAmount: '100',
    status: 'CONFIRMED',
    items: { create: { name: '验收款', sequence: 1, quantity, craft: 'PARTIAL', pricingRoute: 'CUSTOM_SINGLE_FLAT_FOIL', productStructure: 'STANDARD_ENVELOPE', foilTechnique: 'FLAT', frontFoilColors: ['亚金'], crafts: [craft.id], paperType: '珠光纸' } } }, include: { items: true } });
  await db.orderPackagingGroup.create({ data: { orderId: order.id, sequence: 1, mode: 'SINGLE_STYLE', actualBagCount: quantity, lines: { create: { orderItemId: order.items[0].id, unitsPerBag: 1 } } } });
  const addresses = options.addresses ?? 1;
  for (let sequence = 1; sequence <= addresses; sequence++) {
    await db.orderShipment.create({ data: { orderId: order.id, sequence, receiverName: `收件人${sequence}`, receiverPhone: '13800138000', receiverAddress: `测试地址${sequence}`,
      lines: { create: { orderItemId: order.items[0].id, quantity: quantity / addresses } } } });
  }
  const { targets } = await currentDispatchTargets(db, order.id);
  await publishProductionDispatch({ requestKey: randomUUID(), orders: [{ id: order.id, revision: order.revision, version: order.workOrderVersion,
    assignments: Object.fromEntries(targets.map(target => [target.key, worker.id])) }] }, admin);
  if (options.noCharge) {
    // Full shipping of a chargeable order also needs finalized logistics charges;
    // a free redo ships without them (same shape as dispatch-completion's redo case).
    const source = await db.order.create({ data: { orderNo: `PLANNED-SRC-${randomUUID()}`, submitterId: `${prefix}_sales`, createdById: admin.id, submitterRole: 'SALES', settlementType: 'EXTERNAL_SALES', status: 'SHIPPED', shippedAt: new Date() } });
    await db.$transaction(async tx => {
      await tx.order.update({ where: { id: order.id }, data: { kind: 'REWORK', sourceOrderId: source.id, settlementType: 'NO_CHARGE', billingMode: 'NO_CHARGE', pricingStatus: 'AUTO_CONFIRMED', pricingConfirmedById: null, confirmedFee: '0', totalAmount: '0' } });
      await tx.orderItem.update({ where: { id: order.items[0].id }, data: { pricingSnapshot: { source: 'FREE_REWORK', version: 1, sourceOrderId: source.id, sourceOrderItemId: order.items[0].id } } });
    });
  }
  const current = await db.order.findUniqueOrThrow({ where: { id: order.id }, include: { shipments: { orderBy: { sequence: 'asc' } } } });
  const job = await db.productionJob.findFirstOrThrow({ where: { orderId: order.id } });
  return { order: current, job };
}

function shipmentInput(order: Awaited<ReturnType<typeof released>>['order'], index = 0) {
  const shipment = order.shipments[index];
  return { orderId: order.id, shipmentId: shipment.id, expectedVersion: shipment.registrationVersion, expectedRevision: order.revision, expectedEditVersion: order.editVersion,
    expectedWorkOrderVersion: order.workOrderVersion, expectedPriceRevision: order.priceRevision, idempotencyKey: randomUUID(), trackingNo: `ZT${Date.now()}${index}`,
    carrierCode: 'ZTO' as const, carrierName: '', confirm: true };
}

async function wageOf(jobId: string) {
  return db.productionWage.findFirst({ where: { jobId } });
}

pg.sequential('planned completion (batch / ship implies completion) · real PostgreSQL', { timeout: 30_000 }, () => {
  beforeAll(async () => {
    if (!isolated) throw new Error('Disposable database required');
    await db.user.create({ data: { ...admin, password: 'not-a-login-hash' } });
    await db.user.create({ data: { id: `${prefix}_sales`, username: `${prefix}_sales`, displayName: '验收销售', role: 'SALES', password: 'not-a-login-hash' } });
  });

  it('batch-completes at plan with a priced wage dated today, then refuses a replay', async () => {
    const worker = await newWorker();
    const { order, job } = await released(worker);
    const result = await runAdminOrderBatch({ requestId: randomUUID(), command: 'COMPLETE_PRODUCTION', items: [{ orderId: order.id, expectedRevision: order.revision, expectedWorkOrderVersion: order.workOrderVersion }] }, admin);
    expect(result.items).toEqual([{ orderId: order.id, status: 'success', code: 'OK' }]);
    const done = await db.productionJob.findUniqueOrThrow({ where: { id: job.id } });
    expect(done).toMatchObject({ status: 'COMPLETED', recordSource: 'ADMIN_BATCH' });
    expect(done.completedQty?.toString()).toBe('1000');
    const wage = await wageOf(job.id);
    expect(wage?.workDate.toISOString().slice(0, 10)).toBe(todayShanghai());
    expect(wage?.amount).not.toBeNull();
    expect((wage?.snapshot as { completedQty?: string }).completedQty).toBe('1000');
    expect((await db.order.findUniqueOrThrow({ where: { id: order.id } })).status).toBe('PACKING');
    const log = await db.orderLog.findFirstOrThrow({ where: { orderId: order.id, action: 'PRODUCTION_REGISTERED' } });
    expect((log.changedFields as { source?: string }).source).toBe('ADMIN_BATCH');
    // The reviewed revision is now stale; a second batch never double-counts.
    const again = await runAdminOrderBatch({ requestId: randomUUID(), command: 'COMPLETE_PRODUCTION', items: [{ orderId: order.id, expectedRevision: order.revision, expectedWorkOrderVersion: order.workOrderVersion }] }, admin);
    expect(again.items[0]).toMatchObject({ status: 'skipped' });
    expect(await db.productionWage.count({ where: { jobId: job.id } })).toBe(1);
  });

  it('skips an order with a pending quantity request and leaves the other orders completed', async () => {
    const worker = await newWorker();
    const blocked = await released(worker);
    const ok = await released(worker);
    await registerProductionCompletion({ jobId: blocked.job.id, revision: blocked.job.revision, quantity: '990', mode: 'COMPLETE', reason: '少了 10 个' }, worker);
    const reread = await db.order.findUniqueOrThrow({ where: { id: blocked.order.id } });
    const result = await runAdminOrderBatch({ requestId: randomUUID(), command: 'COMPLETE_PRODUCTION', items: [
      { orderId: blocked.order.id, expectedRevision: reread.revision, expectedWorkOrderVersion: reread.workOrderVersion },
      { orderId: ok.order.id, expectedRevision: ok.order.revision, expectedWorkOrderVersion: ok.order.workOrderVersion },
    ] }, admin);
    expect(result.items[0]).toMatchObject({ status: 'skipped', code: 'QUANTITY_PENDING' });
    expect(result.items[1]).toMatchObject({ status: 'success' });
    expect((await db.productionJob.findUniqueOrThrow({ where: { id: blocked.job.id } })).status).toBe('REQUESTED');
    expect(await db.productionWage.count({ where: { jobId: blocked.job.id } })).toBe(0);
  });

  it('refuses a worker who is not employed today and asks to reassign', async () => {
    const worker = await newWorker('已离职师傅');
    const { order, job } = await released(worker);
    await db.user.update({ where: { id: worker.id }, data: { employmentEndDate: new Date('2020-01-01T00:00:00.000Z') } });
    await expect(completeOrderProductionAtPlan({ orderId: order.id, expectedRevision: order.revision, expectedWorkOrderVersion: order.workOrderVersion }, admin))
      .rejects.toMatchObject({ code: 'WORKER_UNAVAILABLE', message: expect.stringContaining('已离职师傅') });
    expect((await db.productionJob.findUniqueOrThrow({ where: { id: job.id } })).status).toBe('PENDING');
  });

  it.each([{ isActive: false }, { role: 'SALES' as const }])('rejects an unavailable worker account %j without recording wages', async data => {
    const worker = await newWorker('待改派师傅');
    const { order, job } = await released(worker);
    await db.user.update({ where: { id: worker.id }, data });
    await expect(completeOrderProductionAtPlan({ orderId: order.id, expectedRevision: order.revision, expectedWorkOrderVersion: order.workOrderVersion }, admin))
      .rejects.toMatchObject({ code: 'WORKER_UNAVAILABLE' });
    expect((await db.productionJob.findUniqueOrThrow({ where: { id: job.id } })).status).toBe('PENDING');
    expect(await wageOf(job.id)).toBeNull();
  });

  it('rolls back planned completion and shipment when required outsourcing is missing', async () => {
    const worker = await newWorker();
    const { order, job } = await released(worker);
    const current = await db.order.update({ where: { id: order.id }, data: { requiresOutsource: true }, include: { shipments: { orderBy: { sequence: 'asc' } } } });
    await expect(registerShipment(shipmentInput(current), admin)).rejects.toThrow(/外协/);
    expect((await db.productionJob.findUniqueOrThrow({ where: { id: job.id } })).status).toBe('PENDING');
    expect(await wageOf(job.id)).toBeNull();
    expect((await db.orderShipment.findUniqueOrThrow({ where: { id: order.shipments[0].id } })).status).toBe('PLANNED');
    expect((await db.order.findUniqueOrThrow({ where: { id: order.id } })).revision).toBe(current.revision);
  });

  it('requires explicit settled-day handling and rolls back proxy completion and shipment', async () => {
    const worker = await newWorker();
    const paid = await released(worker);
    const pending = await released(worker, { noCharge: true });
    await registerProductionCompletion({ jobId: paid.job.id, revision: paid.job.revision, quantity: '1000', mode: 'COMPLETE', reason: '' }, worker);
    const receipt = await lockPieceworkSettlement({ reporterId: worker.id, workDate: todayShanghai(), actor: admin, now: new Date(Date.now() + 86400000) });
    const frozen = await db.pieceworkSettlement.findUniqueOrThrow({ where: { id: receipt.id } });
    await expect(completeOrderProductionAtPlan({ orderId: pending.order.id, expectedRevision: pending.order.revision, expectedWorkOrderVersion: pending.order.workOrderVersion }, admin))
      .rejects.toMatchObject({ code: 'REGISTRATION_FAILED', message: expect.stringContaining('工资已结算') });
    await expect(registerShipment(shipmentInput(pending.order), admin)).rejects.toThrow('工资已结算');
    expect((await db.productionJob.findUniqueOrThrow({ where: { id: pending.job.id } })).status).toBe('PENDING');
    expect((await db.orderShipment.findUniqueOrThrow({ where: { id: pending.order.shipments[0].id } })).status).toBe('PLANNED');
    expect(await db.productionWage.count({ where: { jobId: pending.job.id } })).toBe(0);
    expect(await db.productionFactReview.count({ where: { jobId: pending.job.id } })).toBe(0);
    expect(await db.pieceworkSettlement.findUniqueOrThrow({ where: { id: receipt.id } })).toEqual(frozen);
  });

  it('confirming the first of two addresses registers production at plan; the order waits for the second address', async () => {
    const worker = await newWorker();
    const { order, job } = await released(worker, { addresses: 2 });
    expect(order.status).toBe('RELEASED');
    await registerShipment(shipmentInput(order, 0), admin);
    const done = await db.productionJob.findUniqueOrThrow({ where: { id: job.id } });
    expect(done).toMatchObject({ status: 'COMPLETED', recordSource: 'SHIPMENT_AUTO' });
    expect((await wageOf(job.id))?.amount).not.toBeNull();
    const after = await db.order.findUniqueOrThrow({ where: { id: order.id }, include: { shipments: { orderBy: { sequence: 'asc' } } } });
    expect(after.status).toBe('PACKING');
    expect(after.shipments.map(row => row.status)).toEqual(['SHIPPED', 'PLANNED']);
  });

  it('rolls back the whole shipment when a job still needs approval', async () => {
    const worker = await newWorker();
    const { order, job } = await released(worker);
    await registerProductionCompletion({ jobId: job.id, revision: job.revision, quantity: '990', mode: 'COMPLETE', reason: '少了 10 个' }, worker);
    const current = await db.order.findUniqueOrThrow({ where: { id: order.id }, include: { shipments: { orderBy: { sequence: 'asc' } } } });
    await expect(registerShipment(shipmentInput(current), admin)).rejects.toThrow('数量待审批');
    expect((await db.orderShipment.findUniqueOrThrow({ where: { id: current.shipments[0].id } })).status).toBe('PLANNED');
    expect(await db.productionWage.count({ where: { jobId: job.id } })).toBe(0);
  });

  it('ships a released single-address order in one step and is idempotent on retry', async () => {
    const worker = await newWorker();
    const { order, job } = await released(worker, { noCharge: true });
    const input = shipmentInput(order);
    await registerShipment(input, admin);
    await registerShipment(input, admin);
    expect(await db.productionWage.count({ where: { jobId: job.id } })).toBe(1);
    expect((await db.productionJob.findUniqueOrThrow({ where: { id: job.id } })).recordSource).toBe('SHIPMENT_AUTO');
    expect(['SHIPPED', 'SETTLED']).toContain((await db.order.findUniqueOrThrow({ where: { id: order.id } })).status);
  });

  it('whole-order ship command completes production at plan and replays with the original request', async () => {
    const worker = await newWorker();
    const { order, job } = await released(worker, { noCharge: true });
    const command = { expectedRevision: order.revision, expectedEditVersion: order.editVersion, expectedWorkOrderVersion: order.workOrderVersion,
      expectedPriceRevision: order.priceRevision, idempotencyKey: randomUUID(), trackingNo: 'ZTWHOLE1',
      shipments: [{ shipmentId: order.shipments[0].id, trackingNo: 'ZTWHOLE1', weightKg: null }] };
    const shipped = await shipOrder(order.id, admin, command);
    expect(shipped.status).toBe('SHIPPED');
    expect((await db.productionJob.findUniqueOrThrow({ where: { id: job.id } })).recordSource).toBe('SHIPMENT_AUTO');
    await expect(shipOrder(order.id, admin, command)).resolves.toMatchObject({ idempotentReplay: true });
    expect(await db.productionWage.count({ where: { jobId: job.id } })).toBe(1);
  });
  it('reports no pending jobs honestly and leaves an unreconciled released order unshipped', async () => {
    const order = await db.order.create({ data: { orderNo: `PLANNED-EMPTY-${randomUUID()}`, submitterId: `${prefix}_sales`, createdById: admin.id,
      submitterRole: 'SALES', settlementType: 'EXTERNAL_SALES', simpleProduction: true, status: 'RELEASED',
      pricingStatus: 'ADMIN_CONFIRMED', pricingConfirmedAt: new Date(), pricingConfirmedById: admin.id, confirmedFee: '100', totalAmount: '100',
      shipments: { create: { sequence: 1, receiverName: '测试', receiverPhone: '13800138000', receiverAddress: '测试地址' } } }, include: { shipments: true } });
    await expect(shipOrder(order.id, admin, { expectedRevision: order.revision, expectedEditVersion: order.editVersion,
      expectedWorkOrderVersion: order.workOrderVersion, expectedPriceRevision: order.priceRevision, idempotencyKey: randomUUID(),
      trackingNo: 'ZTEMPTY', shipments: [{ shipmentId: order.shipments[0].id, trackingNo: 'ZTEMPTY', weightKg: null }] }))
      .rejects.toThrow('没有待登记的生产任务，工单仍未完工，暂不能发货');
    expect((await db.order.findUniqueOrThrow({ where: { id: order.id } })).status).toBe('RELEASED');
    expect(await db.productionWage.count({ where: { job: { orderId: order.id } } })).toBe(0);
    expect((await db.orderShipment.findUniqueOrThrow({ where: { id: order.shipments[0].id } })).shippedAt).toBeNull();
  });

});
