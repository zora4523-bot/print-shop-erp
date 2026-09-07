import { describe, expect, it } from 'vitest';
import {
  ADMIN_SNAPSHOT_CONFIRMATION_SOURCE,
  buildTrustedAdminChargePricingSnapshot,
  buildTrustedAdminItemPricingSnapshot,
  buildTrustedAdminPackagingPricingSnapshot,
  buildTrustedAdminPricingSnapshot,
  isTrustedAdminChargePricingSnapshot,
  isTrustedAdminItemPricingSnapshot,
  isTrustedAdminPackagingPricingSnapshot,
  isTrustedAdminPricingSnapshot,
} from '../admin-pricing-snapshot';

function confirmedSnapshot() {
  return {
    source: 'ADMIN_SNAPSHOT_CONFIRMATION',
    status: 'ADMIN_CONFIRMED',
    previousPriceRevision: 7,
    actual: {
      amount: '30.00',
      provisional: false,
      requiresAdminConfirmation: false,
      automatic: false,
    },
    confirmation: {
      actorId: 'admin-1',
      confirmedAt: '2026-09-02T02:00:00.000Z',
    },
  };
}

describe('isTrustedAdminPricingSnapshot', () => {
  it('builds the complete trusted envelope while retaining prior evidence', () => {
    const snapshot = buildTrustedAdminPricingSnapshot({
      previous: {
        priceBook: { id: 'price-book-7' },
        actual: {
          suggestedAmount: '20.00',
          provisional: true,
          requiresAdminConfirmation: true,
          automatic: true,
        },
        confirmation: { actorId: 'stale-admin' },
      },
      now: new Date('2026-09-02T02:00:00.000Z'),
      actorId: 'admin-1',
      previousPriceRevision: 7,
      manualQuoteReason: '超出自动价表范围',
      actual: {
        amount: '30.00',
        overrideReason: '  按承运方报价  ',
      },
    });

    expect(snapshot).toEqual({
      priceBook: { id: 'price-book-7' },
      source: ADMIN_SNAPSHOT_CONFIRMATION_SOURCE,
      status: 'ADMIN_CONFIRMED',
      previousPriceRevision: 7,
      manualQuoteReason: '超出自动价表范围',
      actual: {
        suggestedAmount: '20.00',
        amount: '30.00',
        overrideReason: '  按承运方报价  ',
        provisional: false,
        requiresAdminConfirmation: false,
        automatic: false,
      },
      confirmation: {
        actorId: 'admin-1',
        confirmedAt: '2026-09-02T02:00:00.000Z',
        reason: '按承运方报价',
      },
    });
    expect(isTrustedAdminPricingSnapshot(snapshot)).toBe(true);
  });

  it('handles an absent previous snapshot and records a null reason', () => {
    const snapshot = buildTrustedAdminPricingSnapshot({
      previous: null,
      now: new Date('2026-09-02T02:00:00.000Z'),
      actorId: 'admin-1',
      previousPriceRevision: 0,
      actual: { amount: '0.00' },
    });

    expect(snapshot).toMatchObject({
      source: ADMIN_SNAPSHOT_CONFIRMATION_SOURCE,
      status: 'ADMIN_CONFIRMED',
      previousPriceRevision: 0,
      confirmation: { reason: null },
    });
    expect(isTrustedAdminPricingSnapshot(snapshot)).toBe(true);
  });

  it('accepts only a complete administrator confirmation envelope', () => {
    expect(isTrustedAdminPricingSnapshot(confirmedSnapshot())).toBe(true);
  });

  it.each([
    ['source marker only', { source: 'ADMIN_SNAPSHOT_CONFIRMATION' }],
    ['status marker only', { status: 'ADMIN_CONFIRMED' }],
    ['confirmation object only', { confirmation: { actorId: 'admin-1' } }],
    [
      'still provisional',
      {
        ...confirmedSnapshot(),
        actual: { ...confirmedSnapshot().actual, provisional: true },
      },
    ],
    [
      'missing actor',
      { ...confirmedSnapshot(), confirmation: { confirmedAt: '2026-09-02T02:00:00.000Z' } },
    ],
    [
      'invalid confirmation time',
      {
        ...confirmedSnapshot(),
        confirmation: { actorId: 'admin-1', confirmedAt: 'not-a-date' },
      },
    ],
  ])('rejects %s', (_label, snapshot) => {
    expect(isTrustedAdminPricingSnapshot(snapshot)).toBe(false);
  });
});

describe('isTrustedAdminChargePricingSnapshot', () => {
  const shipmentCharge = {
    orderId: 'order-1',
    businessKey: 'SHIPMENT:1:SHIPPING_FEE',
    shipmentId: 'shipment-1',
    category: { code: 'SHIPPING_FEE' },
    status: 'ESTIMATED',
    priceBookId: 'logistics-v2',
    sourceRuleId: 'shipping-rule-1',
    quantity: '2.000',
    unit: 'kg',
    unitPrice: '15.0000',
    suggestedAmount: '30.00',
    amount: '30.00',
    isAdjustment: false,
    approvalReference: null,
    overrideReason: '按承运方报价',
  };

  it('构造并信任与发货收费身份、金额和理由完整绑定的快照', () => {
    const snapshot = buildTrustedAdminChargePricingSnapshot({
      previous: null,
      now: new Date('2026-09-02T02:00:00.000Z'),
      actorId: 'admin-1',
      previousPriceRevision: 7,
      charge: {
        orderId: ' order-1 ',
        businessKey: ' shipment:1:shipping_fee ',
        shipmentId: ' shipment-1 ',
        categoryCode: ' shipping_fee ',
        status: ' estimated ',
        priceBookId: ' logistics-v2 ',
        sourceRuleId: ' shipping-rule-1 ',
        quantity: '2',
        unit: ' kg ',
        unitPrice: '15',
        suggestedAmount: '30',
        amount: '30',
        isAdjustment: false,
        approvalReference: null,
        overrideReason: ' 按承运方报价 ',
      },
    });

    expect(snapshot).toMatchObject({
      actual: {
        orderId: 'order-1',
        businessKey: 'SHIPMENT:1:SHIPPING_FEE',
        shipmentId: 'shipment-1',
        categoryCode: 'SHIPPING_FEE',
        status: 'ESTIMATED',
        priceBookId: 'logistics-v2',
        sourceRuleId: 'shipping-rule-1',
        quantity: '2.000',
        unit: 'kg',
        unitPrice: '15.0000',
        suggestedAmount: '30.00',
        amount: '30.00',
        isAdjustment: false,
        approvalReference: null,
        overrideReason: '按承运方报价',
      },
    });
    expect(
      isTrustedAdminChargePricingSnapshot(snapshot, shipmentCharge),
    ).toBe(true);
  });

  it.each([
    ['order', { orderId: 'order-2' }],
    ['business key', { businessKey: 'SHIPMENT:2:SHIPPING_FEE' }],
    ['shipment', { shipmentId: 'shipment-2' }],
    ['category', { category: { code: 'PACKING_MATERIAL' } }],
    ['status', { status: 'PENDING_AMOUNT' }],
    ['price book', { priceBookId: 'logistics-v3' }],
    ['source rule', { sourceRuleId: 'shipping-rule-2' }],
    ['quantity', { quantity: '3.000' }],
    ['unit', { unit: '票' }],
    ['unit price', { unitPrice: '16.0000' }],
    ['suggested amount', { suggestedAmount: '31.00' }],
    ['amount', { amount: '31.00' }],
    ['adjustment flag', { isAdjustment: true }],
    ['approval reference', { approvalReference: 'approval-2' }],
    ['reason', { overrideReason: '另一份报价' }],
  ] as const)('拒绝复用到不同 %s 的收费快照', (_label, mismatch) => {
    const snapshot = buildTrustedAdminChargePricingSnapshot({
      previous: null,
      now: new Date('2026-09-02T02:00:00.000Z'),
      actorId: 'admin-1',
      previousPriceRevision: 7,
      charge: {
        ...shipmentCharge,
        categoryCode: shipmentCharge.category.code,
      },
    });

    expect(
      isTrustedAdminChargePricingSnapshot(snapshot, {
        ...shipmentCharge,
        ...mismatch,
      }),
    ).toBe(false);
  });

  it('对订单级制版费显式绑定 shipmentId=null', () => {
    const plateCharge = {
      orderId: 'order-1',
      businessKey: 'ORDER:PLATE_MAKING_FEE:PENDING',
      shipmentId: null,
      category: { code: 'PLATE_MAKING_FEE' },
      status: 'ESTIMATED',
      priceBookId: null,
      sourceRuleId: null,
      quantity: null,
      unit: null,
      unitPrice: null,
      suggestedAmount: null,
      amount: '80.00',
      isAdjustment: false,
      approvalReference: null,
      overrideReason: '工厂确认制版成本',
    };
    const snapshot = buildTrustedAdminChargePricingSnapshot({
      previous: null,
      now: new Date('2026-09-02T02:00:00.000Z'),
      actorId: 'admin-1',
      previousPriceRevision: 7,
      charge: {
        ...plateCharge,
        categoryCode: plateCharge.category.code,
      },
    });

    expect(isTrustedAdminChargePricingSnapshot(snapshot, plateCharge)).toBe(true);
    expect(
      isTrustedAdminChargePricingSnapshot(snapshot, {
        ...plateCharge,
        shipmentId: 'shipment-1',
      }),
    ).toBe(false);
  });

  it('拒绝缺少收费身份绑定的旧快照', () => {
    expect(
      isTrustedAdminChargePricingSnapshot(confirmedSnapshot(), shipmentCharge),
    ).toBe(false);
  });
});

describe('bound administrator pricing snapshots', () => {
  const item = {
    id: 'item-1',
    orderId: 'order-1',
    productId: 'product-1',
    pricingRoute: 'CUSTOM_SINGLE_FLAT_FOIL',
    craft: null,
    productStructure: 'STANDARD_ENVELOPE',
    plateGroupId: 'plate-group-1',
    pricingGroup: 'MID',
    manualQuoteReason: '特殊工艺需人工核价',
    specification: '中号封',
    actualWidthMm: '90',
    actualHeightMm: '165',
    paperType: '珠光纸',
    paperWeightGsm: 160,
    quantity: 1_000,
    pack: 100,
    crafts: ['craft-foil', 'craft-cut'],
    frontFoilColors: ['哑金'],
    backFoilColors: ['亮金'],
    foilColors: ['亮金', '哑金'],
    foilTechnique: 'FLAT',
    hasLocalFoil: true,
    lamination: 'MATTE',
    printColors: ['CMYK'],
    printColorsKnown: true,
    isDoubleSided: true,
    isDoubleColor: false,
    quoteDisposition: 'MANUAL_PRICING_REQUIRED',
    unitPrice: '0.25',
    fixedFee: '20',
    subtotal: '270',
    priceOverrideReason: '特殊工艺人工核价',
  };
  const group = {
    id: 'group-1',
    orderId: 'order-1',
    mode: 'MIXED_STYLE',
    actualBagCount: 100,
    unitPrice: '0.25',
    subtotal: '25',
    priceOverrideReason: '人工确认入袋费',
    lines: [
      { orderItemId: 'item-2', unitsPerBag: 2 },
      { orderItemId: 'item-1', unitsPerBag: 1 },
    ],
  };

  it('binds an item confirmation to identity, pricing facts, state, amounts, and reason', () => {
    const snapshot = buildTrustedAdminItemPricingSnapshot({
      previous: null,
      now: new Date('2026-09-02T02:00:00.000Z'),
      actorId: 'admin-1',
      previousPriceRevision: 7,
      item,
    });

    expect(isTrustedAdminItemPricingSnapshot(snapshot, item)).toBe(true);
    for (const mismatch of [
      { orderId: 'order-2' },
      { id: 'item-2' },
      { productId: 'product-2' },
      { pricingRoute: 'COLOR_PRINT' },
      { productStructure: 'WESTERN_ENVELOPE' },
      { specification: '大号封' },
      { actualWidthMm: '91' },
      { paperType: '铜版纸' },
      { paperWeightGsm: 180 },
      { quantity: 1_001 },
      { crafts: ['craft-foil'] },
      { frontFoilColors: ['亮金'] },
      { foilTechnique: 'RELIEF' },
      { lamination: 'NONE' },
      { printColors: ['专红'] },
      { plateGroupId: 'plate-group-2' },
      { pricingGroup: 'LARGE' },
      { manualQuoteReason: '另一人工原因' },
      { quoteDisposition: 'PRICED' },
      { unitPrice: '0.2600' },
      { fixedFee: '21.00' },
      { subtotal: '271.00' },
      { priceOverrideReason: '另一份报价' },
    ]) {
      expect(
        isTrustedAdminItemPricingSnapshot(snapshot, {
          ...item,
          ...mismatch,
        }),
      ).toBe(false);
    }
  });

  it('binds a packaging confirmation to identity, mode, members, amounts, and reason', () => {
    const snapshot = buildTrustedAdminPackagingPricingSnapshot({
      previous: null,
      now: new Date('2026-09-02T02:00:00.000Z'),
      actorId: 'admin-1',
      previousPriceRevision: 7,
      group,
    });

    expect(isTrustedAdminPackagingPricingSnapshot(snapshot, group)).toBe(true);
    expect(
      isTrustedAdminPackagingPricingSnapshot(snapshot, {
        ...group,
        lines: [...group.lines].reverse(),
      }),
    ).toBe(true);
    for (const mismatch of [
      { orderId: 'order-2' },
      { id: 'group-2' },
      { mode: 'SINGLE_STYLE' },
      { lines: [{ orderItemId: 'item-1', unitsPerBag: 1 }] },
      {
        lines: [
          { orderItemId: 'item-1', unitsPerBag: 2 },
          { orderItemId: 'item-2', unitsPerBag: 2 },
        ],
      },
      { actualBagCount: 101 },
      { unitPrice: '0.2600' },
      { subtotal: '26.00' },
      { priceOverrideReason: '另一份报价' },
    ]) {
      expect(
        isTrustedAdminPackagingPricingSnapshot(snapshot, {
          ...group,
          ...mismatch,
        }),
      ).toBe(false);
    }
  });

  it('rejects legacy trusted markers that do not contain bound row facts', () => {
    expect(
      isTrustedAdminItemPricingSnapshot(confirmedSnapshot(), {
        ...item,
        priceOverrideReason: null,
      }),
    ).toBe(false);
    expect(
      isTrustedAdminPackagingPricingSnapshot(confirmedSnapshot(), {
        ...group,
        priceOverrideReason: null,
      }),
    ).toBe(false);
  });
});
