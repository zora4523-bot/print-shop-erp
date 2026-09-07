import Decimal from 'decimal.js';
import { expect, it, vi } from 'vitest';
import { Role } from '../../../generated/prisma/enums';

const mocks = vi.hoisted(() => {
  const tx = {
    $executeRaw: vi.fn(),
    order: { findUnique: vi.fn(), update: vi.fn() },
    orderPricingRevision: { findMany: vi.fn() },
    orderLog: { findFirst: vi.fn(), findMany: vi.fn(), create: vi.fn() },
    orderCustomerCharge: { update: vi.fn() },
    orderShipment: { update: vi.fn() },
    orderCostEntry: { aggregate: vi.fn() },
  };
  return { tx, append: vi.fn() };
});
vi.mock('@/lib/db', () => ({ db: { $transaction: (callback: (tx: typeof mocks.tx) => unknown) => callback(mocks.tx) } }));
vi.mock('@/lib/background-jobs/clock', () => ({ databaseClockNow: async () => new Date('2026-09-06T03:00:00Z') }));
vi.mock('@/lib/order/pricing-revision', () => ({ appendOrderPricingRevisionInTx: mocks.append }));
vi.mock('@/lib/order/change-request', () => ({ OrderChangeRequestError: class extends Error {}, confirmOrderPricingAtCurrentPublishedVersionInTx: vi.fn() }));
vi.mock('@/lib/production/operation-materialization-service', () => ({ activateProductionOperationsInTx: vi.fn() }));
vi.mock('@/lib/order/print-jobs', () => ({ createOrderPrintRequestInTx: vi.fn() }));
vi.mock('@/lib/notification/dispatch', () => ({ dispatchNotification: vi.fn() }));
vi.mock('@/lib/notification/transactional-outbox', () => ({ enqueueNotificationInTransaction: vi.fn() }));
vi.mock('@/lib/production-completion', () => ({ maybeCompleteProductionOrder: vi.fn(), dispatchProductionCompletionNotification: vi.fn() }));

import { previewFulfillmentPricing, finalizeFulfillmentPricing } from '../fulfillment-pricing';
import { settleFactoryOrder } from '../admin-workflow';

it('historical shipped SF-only pending recovery can proceed through the real settlement service', async () => {
  const tx = mocks.tx;
  const admin = { id: 'admin-1', role: Role.ADMIN };
  const shipping = {
    id: 'shipping-1', orderId: 'order-1', shipmentId: 'shipment-1',
    businessKey: 'SHIPMENT:1:SHIPPING_FEE', categoryId: 'shipping-category', category: { code: 'SHIPPING_FEE' },
    priceBookId: 'original-book', sourceRuleId: null, status: 'WAIVED', amount: new Decimal(0),
    suggestedAmount: new Decimal(0), quantity: null, unit: 'kg', unitPrice: null,
    overrideReason: '顺丰到付', pricingSnapshot: { source: 'SF_COLLECT' }, isAdjustment: false, approvalReference: null,
  };
  const value = {
    id: 'order-1', orderNo: 'GD-RECOVERY', submitterId: 'sales-1',
    settlementType: 'EXTERNAL_SALES', status: 'SHIPPED', billingMode: 'CHARGE', isSfCollect: true,
    revision: 11, editVersion: 20, workOrderVersion: 3, priceRevision: 6,
    pricingStatus: 'PENDING_ADMIN_CONFIRMATION', processingAmount: new Decimal(100), packagingAmount: new Decimal(0),
    totalAmount: new Decimal(100), confirmedFee: null as Decimal | null,
    quotedFee: new Decimal(108), quotedPricingRevisionId: 'original-quote', settledFee: null, settledAt: null,
    items: [{ id: 'item-1', quantity: 1000, unitPrice: new Decimal('0.10'), fixedFee: new Decimal(0), subtotal: new Decimal(100), pricingSnapshot: { source: 'APPROVED' } }],
    packagingGroups: [], customerCharges: [shipping],
    shipments: [{ id: 'shipment-1', sequence: 1, destinationProvince: '浙江', weightKg: new Decimal(2), lines: [{ orderItemId: 'item-1', quantity: 1000 }] }],
    _count: { changeRequests: 0 },
  };
  const snapshot = {
    order: { id: value.id, processingAmount: '100', packagingAmount: '0', totalAmount: '100', confirmedFee: null },
    items: value.items, packagingGroups: [],
    customerCharges: [{ ...shipping, categoryCode: 'SHIPPING_FEE' }],
  };
  tx.order.findUnique.mockImplementation(async () => value);
  tx.order.update.mockImplementation(async ({ data }) => {
    Object.assign(value, data, {
      ...(typeof data.totalAmount === 'string' ? { totalAmount: new Decimal(data.totalAmount) } : {}),
      ...(typeof data.confirmedFee === 'string' ? { confirmedFee: new Decimal(data.confirmedFee) } : {}),
      ...(typeof data.revision === 'object' ? { revision: value.revision + data.revision.increment } : {}),
    });
    return { id: value.id };
  });
  tx.orderPricingRevision.findMany.mockResolvedValue([
    { id: 'pending-6', orderId: value.id, revision: 6, status: value.pricingStatus, source: 'SF_COLLECT_CHANGED_PENDING', snapshot },
    { id: 'confirmed-5', orderId: value.id, revision: 5, status: 'ADMIN_CONFIRMED', source: 'FACTORY_CONFIRM_CURRENT_PUBLISHED', snapshot: {
      ...snapshot,
      order: { ...snapshot.order, totalAmount: '108', confirmedFee: '108' },
      customerCharges: [{ ...snapshot.customerCharges[0], amount: new Decimal(8), status: 'FINAL' }],
    } },
  ]);
  tx.orderLog.findFirst.mockResolvedValue(null);
  tx.orderLog.findMany.mockResolvedValue([{ changedFields: { priceRevision: { before: 5, after: 6 }, isSfCollect: { before: false, after: true } } }]);
  tx.orderCostEntry.aggregate.mockResolvedValue({ _sum: { amount: null } });
  mocks.append.mockImplementation(async (_tx, input) => {
    value.pricingStatus = input.status;
    value.priceRevision += 1;
    value.revision += 1;
    return { priceRevision: value.priceRevision, orderRevision: value.revision, pricingRevisionId: 'confirmed-7' };
  });

  await expect(settleFactoryOrder({ orderId: value.id, expectedRevision: 11, expectedWorkOrderVersion: 3 }, admin)).rejects.toThrow('缺少已确认费用');
  expect(tx.order.update).not.toHaveBeenCalled();
  const input = { orderId: value.id, isSfCollect: true };
  const preview = await previewFulfillmentPricing(input, admin);
  const recovered = await finalizeFulfillmentPricing({ ...input,
    expectedOrderRevision: preview.expectedOrderRevision,
    expectedEditVersion: preview.expectedEditVersion,
    expectedWorkOrderVersion: preview.expectedWorkOrderVersion,
    expectedPriceRevision: preview.expectedPriceRevision,
    previewToken: preview.previewToken,
    idempotencyKey: '7c111111-2222-4333-8444-555555555555',
  }, admin);
  expect(recovered).toMatchObject({ confirmedFee: '100.00', status: 'SHIPPED', revision: 12 });
  expect(value.settledFee).toBeNull();
  expect(value.settledAt).toBeNull();
  tx.$executeRaw.mockClear();
  const result = await settleFactoryOrder({ orderId: value.id, expectedRevision: recovered.revision, expectedWorkOrderVersion: 3 }, admin);
  expect(result).toMatchObject({ status: 'SETTLED', settledFee: recovered.confirmedFee, idempotentReplay: false });
  expect(value.workOrderVersion).toBe(3);
  expect((tx.$executeRaw.mock.calls[0]![0] as TemplateStringsArray).join('?')).toContain('pg_advisory_xact_lock_shared');
});
