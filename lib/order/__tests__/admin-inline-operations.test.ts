import { beforeEach, describe, expect, it, vi } from 'vitest';
import Decimal from 'decimal.js';
import { OrderPricingStatus, OrderSettlementType, OrderStatus, Role } from '@/generated/prisma/enums';
import type { AdminOrderWorkspaceRow } from '../admin-workspace';

const { findFirst } = vi.hoisted(() => ({ findFirst: vi.fn() }));
vi.mock('server-only', () => ({}));
vi.mock('@/lib/db', () => ({ db: { order: { findFirst } } }));
import { getAdminOrderInlineOperations } from '../admin-inline-operations';

const actor = { id: 'admin', role: Role.ADMIN };
const order = {
  id: 'order', revision: 4, editVersion: 3, workOrderVersion: 2, status: OrderStatus.PACKING,
  pendingChangeRequest: null, capabilities: { ship: true },
} as AdminOrderWorkspaceRow;
function record() {
  return {
    revision: 4, editVersion: 3, workOrderVersion: 2, priceRevision: 7,
    status: OrderStatus.PACKING, settlementType: OrderSettlementType.EXTERNAL_SALES,
    pricingStatus: OrderPricingStatus.ADMIN_CONFIRMED, isSfCollect: false,
    settledAt: null, settledFee: null,
    shipments: [{ id: 'shipment', sequence: 1, receiverName: '张先生', receiverAddress: '浙江杭州', trackingNo: null, weightKg: new Decimal('12.50'), destinationProvince: '浙江' }],
    customerCharges: [{ shipmentId: 'shipment', category: { code: 'SHIPPING_FEE' }, amount: new Decimal('18.20'), overrideReason: '物流报价' }],
  };
}
beforeEach(() => { vi.clearAllMocks(); findFirst.mockResolvedValue(record()); });

describe('administrator inline-operation DTO', () => {
  it('rejects a non-administrator before reading addresses or money', async () => {
    await expect(getAdminOrderInlineOperations({ id: 'sales', role: Role.SALES }, order)).rejects.toThrow('仅管理员');
    expect(findFirst).not.toHaveBeenCalled();
  });
  it('does not attach editable forms to a stale or pending-change drawer', async () => {
    findFirst.mockResolvedValue(null);
    expect(await getAdminOrderInlineOperations(actor, order)).toBeNull();
    expect(findFirst).toHaveBeenCalledWith(expect.objectContaining({ where: { id: 'order', revision: 4, editVersion: 3, workOrderVersion: 2, status: OrderStatus.PACKING, changeRequests: { none: { status: 'PENDING' } } } }));
    findFirst.mockClear();
    expect(await getAdminOrderInlineOperations(actor, { ...order, pendingChangeRequest: { id: 'change', type: 'CANCEL', reason: '取消', createdAt: '' } })).toBeNull();
    expect(findFirst).not.toHaveBeenCalled();
  });
  it('serializes exact version guards and shipment charges for the existing form', async () => {
    const data = await getAdminOrderInlineOperations(actor, order);
    expect(data?.shipping).toMatchObject({ expectedRevision: 4, expectedEditVersion: 3, expectedWorkOrderVersion: 2, expectedPriceRevision: 7, shipments: [{ weightKg: '12.5', shippingFee: '18.2', customerChargeOverrideReason: '物流报价' }] });
    expect(JSON.parse(JSON.stringify(data))).toEqual(data);
    expect(data?.pricing).toBeNull();
  });
  it('routes pending fulfillment prices to logistics review and blocks shipping', async () => {
    findFirst.mockResolvedValue({ ...record(), pricingStatus: OrderPricingStatus.PENDING_ADMIN_CONFIRMATION });
    const data = await getAdminOrderInlineOperations(actor, order);
    expect(data?.pricing).toBe('fulfillment');
    expect(data?.shipping).toBeNull();
    expect(data?.fulfillment?.shipments[0].weightKg).toBe('12.5');
  });
  it('keeps logistics review out of the to-do panel until the order is released (owner 2026-10-01)', async () => {
    findFirst.mockResolvedValue({ ...record(), status: OrderStatus.CONFIRMED, pricingStatus: OrderPricingStatus.PENDING_ADMIN_CONFIRMATION });
    const awaitingRelease = { ...order, status: OrderStatus.CONFIRMED, capabilities: { ...order.capabilities, ship: false, release: true } } as AdminOrderWorkspaceRow;
    const before = await getAdminOrderInlineOperations(actor, awaitingRelease);
    expect(before?.pricing).toBeNull();
    expect(before?.fulfillment).toBeNull();
    findFirst.mockResolvedValue({ ...record(), status: OrderStatus.RELEASED, pricingStatus: OrderPricingStatus.PENDING_ADMIN_CONFIRMATION });
    const released = { ...awaitingRelease, status: OrderStatus.RELEASED, capabilities: { ...awaitingRelease.capabilities, release: false } } as AdminOrderWorkspaceRow;
    expect((await getAdminOrderInlineOperations(actor, released))?.pricing).toBe('fulfillment');
  });
  it('uses the pre-production pricing form only for chargeable pending prices', async () => {
    findFirst.mockResolvedValue({ ...record(), status: OrderStatus.PENDING_FACTORY, pricingStatus: OrderPricingStatus.PENDING_ADMIN_CONFIRMATION });
    expect((await getAdminOrderInlineOperations(actor, { ...order, capabilities: { ...order.capabilities, ship: false } }))?.pricing).toBe('factory');
    findFirst.mockResolvedValue({ ...record(), settlementType: OrderSettlementType.NO_CHARGE, pricingStatus: OrderPricingStatus.PENDING_ADMIN_CONFIRMATION });
    expect((await getAdminOrderInlineOperations(actor, order))?.pricing).toBeNull();
  });
});
