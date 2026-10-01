import Decimal from 'decimal.js';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { OrderStatus, Role } from '../../../generated/prisma/enums';

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
  return {
    tx,
    db: { $transaction: vi.fn(async (callback: (value: typeof tx) => unknown) => callback(tx)) },
    clock: vi.fn(),
    appendRevision: vi.fn(),
    resolveCharges: vi.fn(),
  };
});
vi.mock('@/lib/db', () => ({ db: mocks.db }));
vi.mock('@/lib/background-jobs/clock', () => ({ databaseClockNow: mocks.clock }));
vi.mock('@/lib/order/pricing-revision', () => ({ appendOrderPricingRevisionInTx: mocks.appendRevision }));
vi.mock('@/lib/price/order-charge-service', () => ({
  OrderCustomerChargeError: class extends Error {},
  resolveExternalOrderChargesForFinalization: mocks.resolveCharges,
}));

import {
  finalizeFulfillmentPricing,
  previewFulfillmentPricing,
  recordFulfillmentSfCollectChangeInTx,
  type FinalizeFulfillmentPricingCommand,
} from '../fulfillment-pricing';
import { FULFILLMENT_PRICING_STATUSES } from '../fulfillment-pricing-policy';
import { selectOrderCustomerFee } from '../customer-fee';

const admin = { id: 'admin-1', role: Role.ADMIN };
const sales = { id: 'sales-1', role: Role.SALES };
const now = new Date('2026-09-06T03:00:00.000Z');
const idempotencyKey = '7c111111-2222-4333-8444-555555555555';
const guard = {
  expectedOrderRevision: 10,
  expectedEditVersion: 20,
  expectedWorkOrderVersion: 3,
  expectedPriceRevision: 5,
  idempotencyKey,
};

function charge(id: string, code: string, amount: string) {
  return {
    id, orderId: 'order-1', shipmentId: code === 'PLATE_MAKING_FEE' ? null : 'shipment-1',
    businessKey: code === 'PLATE_MAKING_FEE' ? 'ORDER:PLATE' : `SHIPMENT:1:${code}`,
    categoryId: `category-${code}`, category: { code },
    priceBookId: code === 'PLATE_MAKING_FEE' ? null : 'original-logistics',
    sourceRuleId: 'old-rule', status: 'FINAL', quantity: new Decimal('2'), unit: 'kg',
    unitPrice: null, suggestedAmount: new Decimal(amount), amount: new Decimal(amount),
    overrideReason: '已审核费用', isAdjustment: false, approvalReference: null,
    pricingSnapshot: { source: 'ORIGINAL_SNAPSHOT' },
  };
}

function order(status: OrderStatus = OrderStatus.SHIPPED) {
  return {
    id: 'order-1', orderNo: 'GD-260906-001', submitterId: sales.id,
    settlementType: 'EXTERNAL_SALES', status, isSfCollect: false,
    revision: 10, editVersion: 20, workOrderVersion: 3, priceRevision: 5,
    pricingStatus: 'ADMIN_CONFIRMED', processingAmount: new Decimal('112'),
    packagingAmount: new Decimal('12'), totalAmount: new Decimal('155'),
    confirmedFee: new Decimal('155'), quotedFee: new Decimal('150'),
    quotedPricingRevisionId: 'quoted-original', settledFee: null, settledAt: null,
    items: [{ id: 'item-1', sequence: 1, quantity: 1000, unitPrice: new Decimal('0.09'),
      fixedFee: new Decimal('10'), subtotal: new Decimal('100'), pricingSnapshot: { source: 'MANUAL_LOCKED' } }],
    packagingGroups: [{ id: 'group-1', mode: 'SINGLE_STYLE', actualBagCount: 100,
      unitPrice: new Decimal('0.12'), subtotal: new Decimal('12'), pricingSnapshot: { source: 'PACKING_LOCKED' } }],
    customerCharges: [charge('shipping-1', 'SHIPPING_FEE', '8'), charge('packing-1', 'PACKING_MATERIAL', '5'), charge('plate-1', 'PLATE_MAKING_FEE', '30')],
    shipments: [{ id: 'shipment-1', sequence: 1, destinationProvince: '广东', weightKg: new Decimal('2'),
      lines: [{ orderItemId: 'item-1', quantity: 1000 }] }],
    _count: { changeRequests: 0 },
  };
}

function revision(value: Omit<ReturnType<typeof order>, 'confirmedFee'> & { confirmedFee: Decimal | null }, revisionNumber = 5, status = 'ADMIN_CONFIRMED', source = 'FACTORY_CONFIRM_CURRENT_PUBLISHED') {
  return {
    id: `revision-${revisionNumber}`, orderId: value.id, revision: revisionNumber, status, source, createdById: admin.id,
    snapshot: {
      order: { id: value.id, processingAmount: value.processingAmount.toString(), packagingAmount: value.packagingAmount.toString(), totalAmount: value.totalAmount.toString(), confirmedFee: value.confirmedFee?.toString() ?? null, quotedFee: value.quotedFee.toString() },
      items: value.items.map((item) => ({ ...item, unitPrice: item.unitPrice.toString(), fixedFee: item.fixedFee.toString(), subtotal: item.subtotal.toString() })),
      packagingGroups: value.packagingGroups.map((group) => ({ ...group, unitPrice: group.unitPrice.toString(), subtotal: group.subtotal.toString() })),
      customerCharges: value.customerCharges.map((item) => ({ ...item, categoryCode: item.category.code, amount: item.amount.toString() })),
    },
  };
}

function setup(value = order()) {
  mocks.tx.order.findUnique.mockResolvedValue(value);
  mocks.tx.orderPricingRevision.findMany.mockResolvedValue([revision(value)]);
  return value;
}

async function confirm(input = { orderId: 'order-1', isSfCollect: true }, key = idempotencyKey) {
  const preview = await previewFulfillmentPricing(input, admin);
  return finalizeFulfillmentPricing({ ...input, ...guard, previewToken: preview.previewToken, idempotencyKey: key }, admin);
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.clock.mockResolvedValue(now);
  mocks.tx.orderLog.findFirst.mockResolvedValue(null);
  mocks.tx.orderLog.findMany.mockResolvedValue([]);
  mocks.tx.orderCostEntry.aggregate.mockResolvedValue({ _sum: { amount: null } });
  mocks.appendRevision.mockResolvedValue({ priceRevision: 6, orderRevision: 11, pricingRevisionId: 'revision-6' });
  setup();
});

describe('fulfilment charge confirmation', () => {
  it.each(FULFILLMENT_PRICING_STATUSES)('confirms SF waiver while preserving production and non-shipping facts in %s', async (status) => {
    setup(order(status));
    const result = await confirm();
    expect(result).toMatchObject({ confirmedFee: '147.00', status, revision: 11, priceRevision: 6, idempotentReplay: false });
    expect(mocks.tx.orderCustomerCharge.update).toHaveBeenCalledTimes(1);
    expect(mocks.tx.orderCustomerCharge.update).toHaveBeenCalledWith(expect.objectContaining({ where: { id: 'shipping-1' }, data: expect.objectContaining({ amount: '0.00', status: 'WAIVED' }) }));
    const data = mocks.tx.order.update.mock.calls[0]![0].data;
    expect(data).toMatchObject({ totalAmount: '147.00', confirmedFee: '147.00' });
    for (const field of ['status', 'workOrderVersion', 'processingAmount', 'packagingAmount', 'quotedFee', 'quotedPricingRevisionId', 'settledFee']) {
      expect(data).not.toHaveProperty(field);
    }
    expect(mocks.resolveCharges).not.toHaveBeenCalled();
    expect(mocks.appendRevision).toHaveBeenCalledWith(mocks.tx, expect.objectContaining({ status: 'ADMIN_CONFIRMED', incrementOrderRevision: true }));
  });

  it.each(['revision', 'editVersion', 'workOrderVersion', 'priceRevision'] as const)('returns a read-only server preview and rejects confirmations after %s changes', async (version) => {
    const preview = await previewFulfillmentPricing({ orderId: 'order-1', isSfCollect: true }, admin);
    expect(preview).toMatchObject({ oldTotal: '155.00', newTotal: '147.00', delta: '-8.00', canConfirm: true });
    expect(mocks.tx.order.update).not.toHaveBeenCalled();
    const changed = order();
    changed[version] += 1;
    mocks.tx.order.findUnique.mockResolvedValue(changed);
    await expect(finalizeFulfillmentPricing({ orderId: 'order-1', isSfCollect: true, ...guard, previewToken: preview.previewToken }, admin)).rejects.toThrow(/版本/);
    expect(mocks.tx.order.update).not.toHaveBeenCalled();
  });

  it.each([OrderStatus.SETTLED, OrderStatus.FINISHED, OrderStatus.CANCELLED, OrderStatus.PENDING_FACTORY])('rejects confirmation in %s, including a settlement winning the lock', async (status) => {
    setup(order(status));
    await expect(confirm()).rejects.toThrow(/履约/);
    expect(mocks.tx.order.update).not.toHaveBeenCalled();
  });

  it('rejects sales previews and confirmation without revealing prices', async () => {
    await expect(previewFulfillmentPricing({ orderId: 'order-1', isSfCollect: true }, sales)).rejects.toThrow(/管理员/);
    expect(mocks.db.$transaction).not.toHaveBeenCalled();
  });

  it('rejects a waiver when historical shipping costs are nonzero', async () => {
    mocks.tx.orderCostEntry.aggregate.mockResolvedValue({ _sum: { amount: new Decimal('1') } });
    await expect(confirm()).rejects.toThrow(/物流成本/);
  });

  it('does not accept pending orders without a contiguous SF-only source chain', async () => {
    const value = { ...order(), pricingStatus: 'PENDING_ADMIN_CONFIRMATION', confirmedFee: null };
    mocks.tx.order.findUnique.mockResolvedValue(value);
    mocks.tx.orderPricingRevision.findMany.mockResolvedValue([revision(order(), 5, 'PENDING_ADMIN_CONFIRMATION', 'OTHER_PENDING')]);
    await expect(confirm()).rejects.toThrow(/来源|审计/);
    expect(mocks.tx.order.update).not.toHaveBeenCalled();
  });

  it('recovers a same-value SF pending order only with matching historical financial and log evidence', async () => {
    const current = { ...order(), pricingStatus: 'PENDING_ADMIN_CONFIRMATION', confirmedFee: null, isSfCollect: true };
    current.customerCharges[0]!.amount = new Decimal('0');
    current.customerCharges[0]!.status = 'WAIVED';
    current.totalAmount = new Decimal('147');
    mocks.tx.order.findUnique.mockResolvedValue(current);
    mocks.tx.orderPricingRevision.findMany.mockResolvedValue([
      revision(current, 5, 'PENDING_ADMIN_CONFIRMATION', 'SF_COLLECT_CHANGED_PENDING'),
      revision(order(), 4),
    ]);
    mocks.tx.orderLog.findMany.mockResolvedValue([{ changedFields: { isSfCollect: { before: false, after: true }, priceRevision: { before: 4, after: 5 } } }]);
    await expect(confirm()).resolves.toMatchObject({ confirmedFee: '147.00' });
    expect(mocks.tx.orderCustomerCharge.update).toHaveBeenCalledTimes(1);
  });

  it('refuses to restore after a non-logistics amount changed outside the proven correction', async () => {
    const value = order();
    setup(value);
    mocks.tx.orderPricingRevision.findMany.mockResolvedValue([revision(order())]);
    value.customerCharges[2]!.amount = new Decimal('99');
    await expect(confirm()).rejects.toThrow(/已审核|审计/);
  });

  it('rejects address identity mismatch and duplicate addresses before pricing', async () => {
    const correction = { shipmentId: 'other-order-shipment', destinationProvince: '广东', weightKg: '2', shippingFee: '8', customerChargeOverrideReason: '物流实际报价' };
    await expect(previewFulfillmentPricing({ orderId: 'order-1', isSfCollect: false, shipments: [correction] }, admin)).rejects.toThrow(/不属于/);
    correction.shipmentId = 'shipment-1';
    await expect(previewFulfillmentPricing({ orderId: 'order-1', isSfCollect: false, shipments: [correction, correction] }, admin)).rejects.toThrow(/重复/);
  });

  it('uses an explicit administrator freight amount without repricing packing or needing a new price book', async () => {
    const input = { orderId: 'order-1', isSfCollect: false, shipments: [{ shipmentId: 'shipment-1', destinationProvince: '广东', weightKg: '2', shippingFee: '19.50', customerChargeOverrideReason: '承运商实际账单' }] };
    await expect(confirm(input)).resolves.toMatchObject({ confirmedFee: '166.50' });
    expect(mocks.resolveCharges).not.toHaveBeenCalled();
    expect(mocks.tx.orderCustomerCharge.update).toHaveBeenCalledTimes(1);
  });

  // DECISIONS 2026-09-30 寄样首重默认：手填运费时新快照沿用旧快照，会把默认标记带过来；
  // 重量已更正必须去掉，只改运费、重量仍是默认首重才保留（Codex 审查 P2）。
  it.each([
    ['drops the sample first-weight default marker when the weight is corrected with a manual fee', '2', false],
    ['keeps the marker when only the fee changes and the default weight stays', '1', true],
  ] as const)('%s', async (_label, weightKg, keepsDefault) => {
    const value = order();
    value.shipments[0]!.weightKg = new Decimal('1');
    value.customerCharges[0]!.pricingSnapshot = {
      source: 'SAMPLE_ORDER_QUOTE',
      ...{ weightBasis: 'SAMPLE_FIRST_WEIGHT_DEFAULT', defaultWeightKg: '1' },
    };
    setup(value);
    const input = { orderId: 'order-1', isSfCollect: false, shipments: [{ shipmentId: 'shipment-1', destinationProvince: '广东', weightKg, shippingFee: '9.00', customerChargeOverrideReason: '承运商实际账单' }] };
    await expect(confirm(input)).resolves.toMatchObject({ confirmedFee: '156.00' });
    const snapshot = mocks.tx.orderCustomerCharge.update.mock.calls
      .map(([args]) => args)
      .find((args) => args.where.id === 'shipping-1')!.data.pricingSnapshot;
    if (keepsDefault) expect(snapshot).toMatchObject({ weightBasis: 'SAMPLE_FIRST_WEIGHT_DEFAULT', defaultWeightKg: '1' });
    else {
      expect(snapshot).not.toHaveProperty('weightBasis');
      expect(JSON.stringify(snapshot)).not.toMatch(/"weightBasis":"SAMPLE_FIRST_WEIGHT_DEFAULT","defaultWeightKg":"1"}$/);
    }
  });

  it.each([true, false])('restores the prior manual freight through an SF pending chain (current SF=%s), never the lower tariff', async (isSfCollect) => {
    const original = order();
    original.customerCharges[0]!.amount = new Decimal('19.50');
    original.customerCharges[0]!.pricingSnapshot = {
      source: 'ORIGINAL_SNAPSHOT',
      ...{ quote: { basis: { province: '广东', billableWeightKg: '2' } } },
    };
    original.totalAmount = new Decimal('166.50');
    original.confirmedFee = new Decimal('166.50');
    const current = { ...order(), pricingStatus: 'PENDING_ADMIN_CONFIRMATION', confirmedFee: null, isSfCollect };
    current.customerCharges[0]!.amount = new Decimal(isSfCollect ? '0' : '19.50');
    current.customerCharges[0]!.status = isSfCollect ? 'WAIVED' : 'ESTIMATED';
    current.totalAmount = new Decimal(isSfCollect ? '147' : '166.50');
    mocks.tx.order.findUnique.mockResolvedValue(current);
    mocks.tx.orderPricingRevision.findMany.mockResolvedValue([
      revision(current, 5, 'PENDING_ADMIN_CONFIRMATION', 'SF_COLLECT_CHANGED_PENDING'), revision(original, 4),
    ]);
    mocks.tx.orderLog.findMany.mockResolvedValue([{ changedFields: {
      isSfCollect: { before: !isSfCollect, after: isSfCollect }, priceRevision: { before: 4, after: 5 },
    } }]);
    const input = { orderId: current.id, isSfCollect: false, shipments: [{
      shipmentId: 'shipment-1', destinationProvince: '广东', weightKg: '2',
      shippingFee: null, customerChargeOverrideReason: null,
    }] };
    await expect(confirm(input)).resolves.toMatchObject({ confirmedFee: '166.50' });
    expect(mocks.resolveCharges).not.toHaveBeenCalled();
    expect(mocks.tx.orderCustomerCharge.update).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ amount: '19.50' }) }));
  });

  // Codex 审查 P2：寄付 → 到付 → 恢复寄付，恢复的是原寄付快照；到付那一版已去掉标记，
  // 不能因此把仍然有效的默认首重依据删掉。往返期间重量改过则恢复不成立，要人工填运费。
  it.each([
    ['keeps the first-weight default marker when restoring the original prepaid freight after SF collect', '1', true],
    ['does not restore the default freight once the weight changed during the round trip', '2', false],
  ] as const)('%s', async (_label, weightKg, restores) => {
    const markedSnapshot = {
      source: 'SAMPLE_ORDER_QUOTE',
      quote: { basis: { province: '广东', billableWeightKg: '1' } },
      weightBasis: 'SAMPLE_FIRST_WEIGHT_DEFAULT', defaultWeightKg: '1',
    };
    const original = order();
    original.shipments[0]!.weightKg = new Decimal('1');
    original.customerCharges[0]!.pricingSnapshot = markedSnapshot;
    const current = { ...order(), pricingStatus: 'PENDING_ADMIN_CONFIRMATION', confirmedFee: null, isSfCollect: true };
    current.shipments[0]!.weightKg = new Decimal('1');
    current.customerCharges[0]!.amount = new Decimal('0');
    current.customerCharges[0]!.status = 'WAIVED';
    current.totalAmount = new Decimal('147');
    mocks.tx.order.findUnique.mockResolvedValue(current);
    mocks.tx.orderPricingRevision.findMany.mockResolvedValue([
      revision(current, 5, 'PENDING_ADMIN_CONFIRMATION', 'SF_COLLECT_CHANGED_PENDING'), revision(original, 4),
    ]);
    mocks.tx.orderLog.findMany.mockResolvedValue([{ changedFields: {
      isSfCollect: { before: false, after: true }, priceRevision: { before: 4, after: 5 },
    } }]);
    const input = { orderId: current.id, isSfCollect: false, shipments: [{
      shipmentId: 'shipment-1', destinationProvince: '广东', weightKg,
      shippingFee: null, customerChargeOverrideReason: null,
    }] };
    if (!restores) {
      await expect(previewFulfillmentPricing(input, admin)).resolves.toMatchObject({ canConfirm: false });
      return;
    }
    await expect(confirm(input)).resolves.toMatchObject({ confirmedFee: '155.00' });
    const snapshot = mocks.tx.orderCustomerCharge.update.mock.calls
      .map(([args]) => args)
      .find((args) => args.where.id === 'shipping-1')!.data.pricingSnapshot;
    expect(snapshot).toMatchObject({ weightBasis: 'SAMPLE_FIRST_WEIGHT_DEFAULT', defaultWeightKg: '1' });
  });

  it('requires manual confirmation instead of guessing when old freight has no billing-fact evidence', async () => {
    const current = { ...order(), pricingStatus: 'PENDING_ADMIN_CONFIRMATION', confirmedFee: null, isSfCollect: true };
    current.customerCharges[0]!.amount = new Decimal('0');
    current.customerCharges[0]!.status = 'WAIVED';
    current.totalAmount = new Decimal('147');
    mocks.tx.order.findUnique.mockResolvedValue(current);
    mocks.tx.orderPricingRevision.findMany.mockResolvedValue([
      revision(current, 5, 'PENDING_ADMIN_CONFIRMATION', 'SF_COLLECT_CHANGED_PENDING'), revision(order(), 4),
    ]);
    mocks.tx.orderLog.findMany.mockResolvedValue([{ changedFields: { isSfCollect: { before: false, after: true }, priceRevision: { before: 4, after: 5 } } }]);
    const preview = await previewFulfillmentPricing({ orderId: current.id, isSfCollect: false }, admin);
    expect(preview).toMatchObject({ canConfirm: false, newTotal: null, delta: null });
    expect(preview.issues.join()).toMatch(/依据不足/);
    expect(mocks.resolveCharges).not.toHaveBeenCalled();
  });

  it.each([false, true])('uses only the original logistics book and never its new packing output (unknown freight=%s)', async (unknown) => {
    const value = order(OrderStatus.COMPLETED);
    value.isSfCollect = true;
    value.customerCharges[0]!.amount = new Decimal('0');
    value.customerCharges[0]!.status = 'WAIVED';
    value.totalAmount = new Decimal('147');
    value.confirmedFee = new Decimal('147');
    setup(value);
    mocks.resolveCharges.mockResolvedValue({ priceBook: { id: 'original-logistics' }, charges: [{
      categoryCode: 'SHIPPING_FEE', categoryId: 'category-SHIPPING_FEE',
      businessKey: 'SHIPMENT:1:SHIPPING_FEE', sourceRuleId: 'original-rule',
      suggestedAmount: unknown ? null : '8.00', amount: unknown ? '0.00' : '8.00',
      pricingSnapshot: { actual: { provisional: unknown, requiresAdminConfirmation: unknown } },
    }, { categoryCode: 'PACKING_MATERIAL', amount: '999.00' }] });
    const input = { orderId: value.id, isSfCollect: false };
    const preview = await previewFulfillmentPricing(input, admin);
    expect(mocks.resolveCharges).toHaveBeenCalledWith(mocks.tx, expect.anything(), 'original-logistics', now, { allowPending: true });
    if (unknown) {
      expect(preview).toMatchObject({ canConfirm: false, newTotal: null, delta: null });
      await expect(finalizeFulfillmentPricing({ ...input, ...guard, previewToken: preview.previewToken }, admin)).rejects.toThrow(/待确认/);
      expect(mocks.tx.order.update).not.toHaveBeenCalled();
      await recordFulfillmentSfCollectChangeInTx(mocks.tx as never, { ...input, ...guard }, sales);
      expect(mocks.tx.order.update).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ quotedFee: '147.00', quotedFeeCompleteness: 'EXCLUDES_MANUAL_ITEMS', quotedPricingRevisionId: 'revision-6' }) }));
    } else {
      await expect(finalizeFulfillmentPricing({ ...input, ...guard, previewToken: preview.previewToken }, admin)).resolves.toMatchObject({ confirmedFee: '155.00' });
      expect(mocks.tx.orderCustomerCharge.update).toHaveBeenCalledTimes(1);
      expect(mocks.tx.orderCustomerCharge.update).toHaveBeenCalledWith(expect.objectContaining({ where: { id: 'shipping-1' }, data: expect.objectContaining({ amount: '8.00' }) }));
    }
  });

  it('records a versioned sales switch as pending without trusting supplied amounts', async () => {
    const value = order(OrderStatus.COMPLETED);
    setup(value);
    const result = await recordFulfillmentSfCollectChangeInTx(mocks.tx as never, { orderId: value.id, isSfCollect: true, ...guard }, sales);
    expect(result.changed).toBe(true);
    expect(mocks.tx.order.update).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ confirmedFee: null }) }));
    expect(mocks.appendRevision).toHaveBeenCalledWith(mocks.tx, expect.objectContaining({ status: 'PENDING_ADMIN_CONFIRMATION' }));
    const update = Object.assign({}, ...mocks.tx.order.update.mock.calls.map(([call]) => call.data));
    expect(selectOrderCustomerFee({ ...value, ...update })).toEqual({ amount: '147.00', source: 'QUOTED', estimated: true });
    expect(mocks.tx.order.update).toHaveBeenLastCalledWith(expect.objectContaining({ data: { quotedFee: '147.00', quotedFeeCompleteness: 'COMPLETE', quotedPricingRevisionId: 'revision-6' } }));
    expect(mocks.appendRevision).toHaveBeenCalledWith(mocks.tx, expect.objectContaining({ orderFeeSnapshot: { quotedFee: '147.00', confirmedFee: null, settledFee: null } }));
  });

  it('keeps every update valid when a legacy fulfilled order has no quote tuple', async () => {
    const value = setup(order(OrderStatus.COMPLETED));
    mocks.tx.order.findUnique.mockResolvedValue({ ...value, quotedFee: null, quotedPricingRevisionId: null });
    const quote: Record<string, unknown> = { quotedFee: null, quotedFeeCompleteness: null, quotedPricingRevisionId: null };
    mocks.tx.order.update.mockImplementation(async ({ data }) => {
      Object.assign(quote, data);
      const present = ['quotedFee', 'quotedFeeCompleteness', 'quotedPricingRevisionId'].map((key) => quote[key] !== null);
      expect(present.every(Boolean) || present.every((value) => !value)).toBe(true);
      return { id: value.id };
    });
    await recordFulfillmentSfCollectChangeInTx(mocks.tx as never, { orderId: value.id, isSfCollect: true, ...guard }, sales);
    expect(quote).toMatchObject({ quotedFee: '147.00', quotedPricingRevisionId: 'revision-6' });
  });

  it('replays the same confirmed operation without applying another correction, but rejects different content', async () => {
    const preview = await previewFulfillmentPricing({ orderId: 'order-1', isSfCollect: true }, admin);
    const input: FinalizeFulfillmentPricingCommand = { orderId: 'order-1', isSfCollect: true, ...guard, previewToken: preview.previewToken };
    await finalizeFulfillmentPricing(input, admin);
    const written = mocks.tx.orderLog.create.mock.calls.at(-1)![0].data;
    mocks.tx.orderLog.findFirst.mockResolvedValue(written);
    mocks.tx.order.update.mockClear();
    await expect(finalizeFulfillmentPricing(input, admin)).resolves.toMatchObject({ idempotentReplay: true, confirmedFee: '147.00' });
    expect(mocks.tx.order.update).not.toHaveBeenCalled();
    await expect(finalizeFulfillmentPricing({ ...input, isSfCollect: false }, admin)).rejects.toThrow(/标识|重复/);
  });
});
