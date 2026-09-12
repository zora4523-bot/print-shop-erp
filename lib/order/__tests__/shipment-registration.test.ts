import { beforeEach, describe, expect, it, vi } from 'vitest';
import sharp from 'sharp';
import { Decimal } from '@/generated/prisma/internal/prismaNamespace';
import { Role } from '@/generated/prisma/enums';
const mocks = vi.hoisted(() => ({ tx: { $executeRaw: vi.fn(), order: { findUnique: vi.fn(), findUniqueOrThrow: vi.fn(), update: vi.fn() }, orderShipment: { update: vi.fn() }, orderShipmentLabel: { create: vi.fn() }, orderLog: { findFirst: vi.fn(), create: vi.fn() } }, ship: vi.fn(), settle: vi.fn(), ready: vi.fn() }));
vi.mock('@/lib/notification/dispatch', () => ({ dispatchNotification: vi.fn() }));
vi.mock('@/lib/db', () => ({ db: { $transaction: (work: (tx: typeof mocks.tx) => unknown) => work(mocks.tx) } }));
vi.mock('@/lib/order', () => ({ OrderInvariantError: class extends Error {}, shipOrder: mocks.ship, assertShipOrderReadinessInTx: mocks.ready }));
vi.mock('@/lib/order/admin-workflow', () => ({ settleFactoryOrder: mocks.settle }));
vi.mock('@/lib/background-jobs/mode', () => ({ backgroundJobsMode: () => 'durable' }));
import { registerShipment, normalizeShipmentImage } from '../shipment-registration';
import { shipmentRegistrationSchema } from '../shipment-registration-schema';
const actor = { id: 'admin', role: Role.ADMIN };
const input = { orderId: 'order', shipmentId: 's1', expectedVersion: 0, expectedRevision: 1, expectedEditVersion: 1, expectedWorkOrderVersion: 1, expectedPriceRevision: 1, idempotencyKey: '5d5cd706-2c98-40ce-b260-535cd76ebc90', trackingNo: 'ZTO123', carrierCode: 'ZTO' as const, carrierName: '', confirm: true };
const row = { id: 's1', sequence: 1, registrationVersion: 0, status: 'PLANNED', carrierCode: null, carrierName: null, trackingNo: null, weightKg: null };
beforeEach(() => {
  vi.resetAllMocks();
  mocks.tx.order.findUnique.mockResolvedValue({ id: 'order', orderNo: 'GD1', shipments: [row], status: 'PACKING', pricingStatus: 'AUTO_CONFIRMED', confirmedFee: new Decimal(25), revision: 1, editVersion: 1, workOrderVersion: 1, priceRevision: 1 });
  mocks.tx.order.findUniqueOrThrow.mockResolvedValue({ revision: 2, workOrderVersion: 1, confirmedFee: new Decimal(25) });
  mocks.tx.orderShipment.update.mockImplementation(({ data }) => ({ ...row, ...data }));
});
describe('shipment registration', () => {
  it('rejects non administrators before accessing data', async () => {
    await expect(registerShipment(input, { ...actor, role: Role.SALES })).rejects.toThrow();
    expect(mocks.tx.order.findUnique).not.toHaveBeenCalled();
  });
  it('requires tracking and carrier on confirmation', () => {
    expect(shipmentRegistrationSchema.safeParse({ ...input, trackingNo: '' }).success).toBe(false);
    expect(shipmentRegistrationSchema.safeParse({ ...input, carrierCode: 'OTHER' }).success).toBe(false);
  });
  it('saves a draft without shipping or settling', async () => {
    await registerShipment({ ...input, confirm: false }, actor);
    expect(mocks.ship).not.toHaveBeenCalled(); expect(mocks.settle).not.toHaveBeenCalled();
    expect(mocks.tx.orderShipment.update.mock.calls[0][0].data.status).toBeUndefined();
  });
  it('keeps the order open when another address is pending', async () => {
    const order = await mocks.tx.order.findUnique();
    mocks.tx.order.findUnique.mockResolvedValue({ ...order, shipments: [row, { ...row, id: 's2', sequence: 2 }] });
    await registerShipment(input, actor);
    expect(mocks.ready).toHaveBeenCalled(); expect(mocks.ship).not.toHaveBeenCalled(); expect(mocks.settle).not.toHaveBeenCalled();
  });
  it('ships and settles on the final address using the same transaction', async () => {
    const result = await registerShipment(input, actor);
    expect(result.completed).toBe(true);
    expect(mocks.ship.mock.calls[0][4]).toBe(mocks.tx);
    expect(mocks.settle.mock.calls[0][2]).toBe(mocks.tx);
    expect(mocks.tx.$executeRaw.mock.invocationCallOrder[0]).toBeLessThan(mocks.tx.order.findUnique.mock.invocationCallOrder[0]);
  });
  it('rejects stale and cross-order shipment ids', async () => {
    await expect(registerShipment({ ...input, expectedRevision: 2 }, actor)).rejects.toThrow('已被修改');
    await expect(registerShipment({ ...input, shipmentId: 'foreign' }, actor)).rejects.toThrow('找不到');
    expect(mocks.tx.orderShipment.update).not.toHaveBeenCalled();
  });
  it('does not settle when final shipping changes the confirmed charge', async () => {
    mocks.tx.order.findUniqueOrThrow.mockResolvedValue({ revision: 2, workOrderVersion: 1, confirmedFee: new Decimal(30) });
    await expect(registerShipment(input, actor)).rejects.toThrow('物流费用有变化');
    expect(mocks.settle).not.toHaveBeenCalled();
  });
  it('rejects uncompleted production and pending price confirmation', async () => {
    const order = await mocks.tx.order.findUnique();
    mocks.tx.order.findUnique.mockResolvedValue({ ...order, status: 'RELEASED' });
    await expect(registerShipment(input, actor)).rejects.toThrow('尚未完工');
    mocks.tx.order.findUnique.mockResolvedValue({ ...order, pricingStatus: 'PENDING_ADMIN_CONFIRMATION' });
    await expect(registerShipment(input, actor)).rejects.toThrow('费用尚未确认');
  });
  it('does not write shipment when production readiness fails', async () => {
    mocks.ready.mockRejectedValue(new Error('pending change'));
    await expect(registerShipment(input, actor)).rejects.toThrow('pending change');
    expect(mocks.tx.orderShipment.update).not.toHaveBeenCalled();
  });
  it('replays the identical command without writing or settling twice', async () => {
    await registerShipment(input, actor);
    const changedFields = mocks.tx.orderLog.create.mock.calls[0][0].data.changedFields;
    mocks.tx.orderLog.findFirst.mockResolvedValue({ changedFields });
    mocks.tx.orderShipment.update.mockClear(); mocks.settle.mockClear();
    expect((await registerShipment(input, actor)).replay).toBe(true);
    expect(mocks.tx.orderShipment.update).not.toHaveBeenCalled(); expect(mocks.settle).not.toHaveBeenCalled();
    await expect(registerShipment({ ...input, trackingNo: 'CHANGED' }, actor)).rejects.toThrow('提交内容已变化');
  });
  it('rejects malformed and oversized photos and normalizes valid images', async () => {
    await expect(normalizeShipmentImage(new Uint8Array(600_000))).rejects.toThrow('图片过大');
    await expect(normalizeShipmentImage(new TextEncoder().encode('<svg/>'))).rejects.toThrow('图片无法读取');
    const png = await sharp({ create: { width: 20, height: 20, channels: 3, background: 'white' } }).png().toBuffer();
    const jpg = await normalizeShipmentImage(png);
    expect((await sharp(jpg).metadata()).format).toBe('jpeg');
  });
});
