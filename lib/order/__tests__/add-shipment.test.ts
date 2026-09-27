import Decimal from 'decimal.js';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { Role } from '@/generated/prisma/enums';
import { addOrderShipmentSchema } from '../add-shipment-schema';
import {
  buildTrustedAdminPackagingPricingSnapshot,
  hasAdminPricingConfirmationMarker,
  isTrustedAdminPackagingPricingSnapshot,
} from '../admin-pricing-snapshot';
vi.mock('server-only', () => ({}));
const mocks = vi.hoisted(() => ({
  transaction: vi.fn(),
  find: vi.fn(),
  quote: vi.fn(),
  revision: vi.fn(),
  create: vi.fn(),
  update: vi.fn(),
  line: vi.fn(),
  charge: vi.fn(),
  log: vi.fn(),
  remove: vi.fn(),
}));
vi.mock('@/lib/db', () => ({ db: { $transaction: mocks.transaction } }));
vi.mock('@/lib/price/order-charge-service', () => ({
  resolveExternalOrderChargesForFinalization: mocks.quote,
}));
vi.mock('../pricing-revision', () => ({
  appendOrderPricingRevisionInTx: mocks.revision,
}));
import { addOrderShipment } from '../add-shipment';
const input = () => ({
  orderId: 'order',
  sourceShipmentId: 'source',
  expectedRevision: 1,
  expectedEditVersion: 2,
  expectedWorkOrderVersion: 1,
  expectedPriceRevision: 1,
  receiverName: '李女士',
  receiverPhone: '13800138000',
  receiverAddress: '江西省南昌市测试路 1 号',
  destinationProvince: '江西',
  lines: [{ orderItemId: 'item', quantity: 40 }],
});
const actor = { id: 'admin', role: Role.ADMIN };
function fixture() {
  return {
    id: 'order',
    submitterId: 'sales',
    settlementType: 'EXTERNAL_SALES',
    status: 'SUBMITTED',
    revision: 1,
    editVersion: 2,
    workOrderVersion: 1,
    priceRevision: 1,
    totalAmount: new Decimal('130.10'),
    settledAt: null,
    settledFee: null,
    isSfCollect: false,
    packagingGroups: [],
    items: [
      {
        id: 'item',
        quantity: 100,
        paperWeightGsm: 150,
        paperType: '珠光纸',
        productStructure: 'ENVELOPE',
      },
    ],
    shipments: [
      {
        id: 'source',
        sequence: 1,
        status: 'PLANNED',
        trackingNo: null,
        weightKg: null,
        registrationVersion: 0,
        destinationProvince: '广东',
        lines: [{ orderItemId: 'item', quantity: 100 }],
      },
    ],
    customerCharges: [
      {
        id: 'shipping',
        shipmentId: 'source',
        businessKey: 'SHIPMENT:1:SHIPPING_FEE',
        category: { code: 'SHIPPING_FEE' },
        priceBookId: 'frozen-book',
        amount: new Decimal('20'),
        status: 'ESTIMATED',
        overrideReason: null,
      },
      {
        id: 'packing',
        shipmentId: 'source',
        businessKey: 'SHIPMENT:1:PACKING_MATERIAL',
        category: { code: 'PACKING_MATERIAL' },
        priceBookId: 'frozen-book',
        amount: new Decimal('10'),
        status: 'ESTIMATED',
        overrideReason: null,
      },
    ],
    _count: { changeRequests: 0 },
  };
}
const tx = {
  $executeRaw: vi.fn(),
  productionOperation: { count: vi.fn().mockResolvedValue(0) },
  orderPackagingGroup: { update: vi.fn() },
  order: { findUnique: mocks.find, update: mocks.update },
  orderShipment: { create: mocks.create, update: mocks.update },
  orderShipmentLine: { update: mocks.line, delete: mocks.remove },
  orderCustomerCharge: { update: mocks.charge, create: mocks.charge, aggregate: vi.fn() },
  orderLog: { create: mocks.log },
};
beforeEach(() => {
  vi.resetAllMocks();
  mocks.transaction.mockImplementation((work) => work(tx));
  mocks.find.mockResolvedValue(fixture());
  mocks.create.mockResolvedValue({ id: 'new-shipment' });
  mocks.revision.mockResolvedValue({ pricingRevisionId: 'new-revision' });
  mocks.quote.mockResolvedValue({
    totalAmount: '35.25',
    priceBook: { id: 'frozen-book' },
    charges: [1, 2].flatMap((sequence) =>
      ['SHIPPING_FEE', 'PACKING_MATERIAL'].map((code) => ({
        shipmentKey: String(sequence),
        categoryCode: code,
        categoryId: code,
        priceBookId: 'frozen-book',
        businessKey: `SHIPMENT:${sequence}:${code}`,
        amount:
          sequence === 1 ? '5.00' : code === 'SHIPPING_FEE' ? '20.00' : '5.25',
        status: 'ESTIMATED',
        pricingSnapshot: { quotedAt: new Date().toISOString() },
      })),
    ),
  });
});
describe('administrator adds a delivery with conserved allocations and frozen logistics prices', () => {
  it('previews without writes, uses independent shipment quantities and Decimal delta', async () => {
    const result = await addOrderShipment(input(), actor, 'preview');
    expect(result).toMatchObject({
      sequence: 2,
      oldTotal: '130.10',
      newTotal: '135.35',
      delta: '5.25',
    });
    expect(mocks.quote).toHaveBeenCalledWith(
      tx,
      expect.objectContaining({
        shipments: [
          expect.objectContaining({ shipmentKey: '1', itemQuantity: 60 }),
          expect.objectContaining({
            shipmentKey: '2',
            itemQuantity: 40,
            province: '江西',
          }),
        ],
      }),
      'frozen-book',
      expect.any(Date),
      { allowPending: true },
    );
    expect(mocks.create).not.toHaveBeenCalled();
    expect(mocks.update).not.toHaveBeenCalled();
    expect(mocks.revision).not.toHaveBeenCalled();
  });
  it('saves address, allocations, charges, fee lifecycle and audit atomically', async () => {
    const preview = await addOrderShipment(input(), actor, 'preview');
    await addOrderShipment(
      { ...input(), previewToken: preview!.token },
      actor,
      'save',
    );
    expect(mocks.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          orderId: 'order',
          sequence: 2,
          lines: { create: input().lines },
        }),
      }),
    );
    expect(mocks.line).toHaveBeenCalledWith(
      expect.objectContaining({ data: { quantity: 60 } }),
    );
    expect(mocks.charge).toHaveBeenCalledTimes(4);
    expect(mocks.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          totalAmount: '135.35',
          confirmedFee: null,
          settledFee: null,
        }),
      }),
    );
    expect(mocks.revision).toHaveBeenCalledWith(
      tx,
      expect.objectContaining({
        expectedPriceRevision: 1,
        incrementOrderRevision: true,
      }),
    );
    expect(mocks.log).toHaveBeenCalledOnce();
  });
  it.each([Role.WORKER])(
    'rejects unauthorized role %s before database access',
    async (role) => {
      await expect(
        addOrderShipment(input(), { id: 'other', role }, 'save'),
      ).rejects.toThrow('当前账号不能');
      expect(mocks.transaction).not.toHaveBeenCalled();
    },
  );
  it.each([
    ['stale version', { expectedEditVersion: 1 }, '已变化'],
    ['foreign shipment', { sourceShipmentId: 'foreign' }, '不属于'],
    [
      'foreign item',
      { lines: [{ orderItemId: 'foreign', quantity: 1 }] },
      '超出',
    ],
    [
      'over-allocation',
      { lines: [{ orderItemId: 'item', quantity: 101 }] },
      '超出',
    ],
    [
      'empty original',
      { lines: [{ orderItemId: 'item', quantity: 100 }] },
      '至少保留',
    ],
    ['missing quote', { previewToken: '' }, '重新预览'],
  ])('rejects %s without writes', async (_name, overrides, message) => {
    await expect(
      addOrderShipment({ ...input(), ...overrides }, actor, 'save'),
    ).rejects.toThrow(message);
    expect(mocks.create).not.toHaveBeenCalled();
  });
  it.each(['SHIPPED', 'SETTLED', 'CANCELLED'])(
    'rejects terminal %s',
    async (status) => {
      mocks.find.mockResolvedValue({ ...fixture(), status });
      await expect(addOrderShipment(input(), actor, 'preview')).rejects.toThrow(
        '不能添加',
      );
    },
  );
  it('rejects partial shipment, pending approval, registered weight and corrupt allocations', async () => {
    for (const order of [
      { ...fixture(), _count: { changeRequests: 1 } },
      {
        ...fixture(),
        shipments: [{ ...fixture().shipments[0], status: 'SHIPPED' }],
      },
      {
        ...fixture(),
        shipments: [{ ...fixture().shipments[0], weightKg: new Decimal(2) }],
      },
      { ...fixture(), items: [{ ...fixture().items[0], quantity: 110 }] },
    ]) {
      mocks.find.mockResolvedValue(order);
      await expect(
        addOrderShipment(input(), actor, 'preview'),
      ).rejects.toThrow();
    }
    expect(mocks.create).not.toHaveBeenCalled();
  });
  it('preserves confirmed source amounts and evidence', async () => {
    const order = fixture();
    order.customerCharges[0].status = 'FINAL';
    mocks.find.mockResolvedValue(order);
    const preview = await addOrderShipment(input(), actor, 'preview');
    expect(mocks.quote.mock.calls[0][1].shipments[0]).toMatchObject({
      shippingFee: '20',
      overrideReason: '新增地址分货，保留原地址已确认费用',
    });
    await addOrderShipment(
      { ...input(), previewToken: preview!.token },
      actor,
      'save',
    );
    expect(
      mocks.charge.mock.calls.some(([args]) => args.where?.id === 'shipping'),
    ).toBe(false);
  });
  it('uses SF waiver for every quote and rejects changed preview', async () => {
    mocks.find.mockResolvedValue({ ...fixture(), isSfCollect: true });
    const preview = await addOrderShipment(input(), actor, 'preview');
    expect(mocks.quote.mock.calls[0][1].isSfCollect).toBe(true);
    await expect(
      addOrderShipment(
        {
          ...input(),
          receiverAddress: '更改后的地址',
          previewToken: preview!.token,
        },
        actor,
        'save',
      ),
    ).rejects.toThrow('重新预览');
  });
  it('validates duplicate, fractional, empty and negative splits', () => {
    for (const lines of [
      [...input().lines, ...input().lines],
      [{ orderItemId: 'item', quantity: -1 }],
      [{ orderItemId: 'item', quantity: 0.5 }],
      [{ orderItemId: 'item', quantity: 0 }],
    ])
      expect(
        addOrderShipmentSchema.safeParse({ ...input(), lines }).success,
      ).toBe(false);
  });
});

it.each([
  ['NO_CHARGE', 'SUBMITTED', 'UNCHANGED'],
  ['EXTERNAL_SALES', 'DRAFT', 'ON_SUBMIT'],
])(
  'preserves the existing charge lifecycle for %s %s',
  async (settlementType, status, pricingMode) => {
    mocks.find.mockResolvedValue({
      ...fixture(),
      settlementType,
      status,
      customerCharges: [],
    });
    const preview = await addOrderShipment(input(), actor, 'preview');
    expect(preview).toMatchObject({
      pricingMode,
      oldTotal: '130.10',
      newTotal: '130.10',
      charges: [],
    });
    await addOrderShipment(
      { ...input(), previewToken: preview!.token },
      actor,
      'save',
    );
    expect(mocks.quote).not.toHaveBeenCalled();
    expect(mocks.create).toHaveBeenCalledOnce();
    expect(mocks.revision).not.toHaveBeenCalled();
  },
);
it('keeps 补录 logistics rows (priceBookId null) on the unchanged path for free rework orders', async () => {
  const order = fixture();
  mocks.find.mockResolvedValue({
    ...order,
    settlementType: 'NO_CHARGE',
    status: 'SUBMITTED',
    customerCharges: order.customerCharges.map((charge) => ({ ...charge, priceBookId: null })),
  });
  const preview = await addOrderShipment(input(), actor, 'preview');
  expect(preview).toMatchObject({ pricingMode: 'UNCHANGED', charges: [] });
  expect(mocks.quote).not.toHaveBeenCalled();
});
it('requires a manual fee reason and refuses nonzero SF freight', async () => {
  expect(
    addOrderShipmentSchema.safeParse({ ...input(), shippingFee: '12.34' })
      .success,
  ).toBe(false);
  mocks.find.mockResolvedValue({ ...fixture(), isSfCollect: true });
  await expect(
    addOrderShipment(
      { ...input(), shippingFee: '12.34', overrideReason: '实报运费' },
      actor,
      'preview',
    ),
  ).rejects.toThrow('顺丰到付');
});
it('quotes explicit manual new-address fees without replacing source confirmed facts', async () => {
  await addOrderShipment(
    {
      ...input(),
      shippingFee: '12.34',
      packingMaterialFee: '5',
      overrideReason: '偏远地区实报',
    },
    actor,
    'preview',
  );
  expect(mocks.quote.mock.calls[0][1].shipments[1]).toMatchObject({
    shippingFee: '12.34',
    packingMaterialFee: '5',
    overrideReason: '偏远地区实报',
  });
});

it('rejects an eleventh address and inconsistent charge ownership', async () => {
  const order = fixture();
  mocks.find.mockResolvedValue({
    ...order,
    shipments: Array.from({ length: 10 }, (_, i) => ({
      ...order.shipments[0],
      id: `shipment-${i}`,
      sequence: i + 1,
    })),
  });
  await expect(addOrderShipment(input(), actor, 'preview')).rejects.toThrow(
    '最多 10',
  );
  order.customerCharges[0].shipmentId = 'foreign';
  mocks.find.mockResolvedValue(order);
  await expect(addOrderShipment(input(), actor, 'preview')).rejects.toThrow(
    '物流收费与地址不一致',
  );
  expect(mocks.create).not.toHaveBeenCalled();
});
it('does not create a receivable for a no-charge rework order', async () => {
  mocks.find.mockResolvedValue({
    ...fixture(),
    billingMode: 'NO_CHARGE',
    customerCharges: [],
  });
  const preview = await addOrderShipment(input(), actor, 'preview');
  expect(preview).toMatchObject({ pricingMode: 'UNCHANGED', delta: '0.00' });
  expect(mocks.quote).not.toHaveBeenCalled();
});

it('replaces a pending null amount even when it has a note', async () => {
  const order = fixture();
  mocks.find.mockResolvedValue({
    ...order,
    customerCharges: order.customerCharges.map((charge) =>
      charge.id === 'shipping'
        ? { ...charge, amount: null, overrideReason: '待核价' }
        : charge,
    ),
  });
  const preview = await addOrderShipment(input(), actor, 'preview');
  await addOrderShipment(
    { ...input(), previewToken: preview!.token },
    actor,
    'save',
  );
  expect(
    mocks.charge.mock.calls.some(([args]) => args.where?.id === 'shipping'),
  ).toBe(true);
});

it('sales can preview and save own split with automatic pricing', async () => {
  const sales = { id: 'sales', role: Role.SALES };
  const preview = await addOrderShipment(input(), sales, 'preview');
  await addOrderShipment({ ...input(), previewToken: preview!.token }, sales, 'save');
  expect(mocks.create).toHaveBeenCalledOnce();
});
it('sales cannot split another owner order', async () => {
  await expect(addOrderShipment(input(), { id: 'foreign', role: Role.SALES }, 'preview')).rejects.toThrow('自己创建');
  expect(mocks.create).not.toHaveBeenCalled();
});
it('sales cannot forge manual charges', async () => {
  await expect(addOrderShipment({ ...input(), shippingFee: '1', overrideReason: '低价' }, { id: 'sales', role: Role.SALES }, 'preview')).rejects.toThrow('人工物流费用');
  expect(mocks.transaction).not.toHaveBeenCalled();
});

it('allows sales to split its own order through the existing quote protocol', async () => {
  const order = fixture();
  order.submitterId = 'sales-own';
  mocks.find.mockResolvedValue(order);
  const cs = { id: 'sales-own', role: Role.SALES };
  const preview = await addOrderShipment(input(), cs, 'preview');
  expect(mocks.create).not.toHaveBeenCalled();
  await addOrderShipment({ ...input(), previewToken: preview!.token }, cs, 'save');
  expect(mocks.create).toHaveBeenCalledOnce();
});
it('rejects sales editing another submitter order', async () => {
  await expect(addOrderShipment(input(), { id: 'sales-own', role: Role.SALES }, 'preview')).rejects.toThrow('自己创建');
  expect(mocks.create).not.toHaveBeenCalled();
});
it('rejects sales manual pricing before the transaction', async () => {
  await expect(addOrderShipment({ ...input(), packingMaterialFee: '1', overrideReason: '测试' }, { id: 'sales-own', role: Role.SALES }, 'preview')).rejects.toThrow('人工物流费用');
  expect(mocks.transaction).not.toHaveBeenCalled();
});

describe('split boxed deliveries', () => {
  function boxes() {
    const order = fixture();
    return { ...order, settlementType: 'EXTERNAL_SALES', processingAmount: new Decimal('83.03'),
      packagingAmount: new Decimal('29.90'), totalAmount: new Decimal('83.03'),
      customerCharges: [], items: [{ ...order.items[0], quantity: 101 }],
      shipments: [{ ...order.shipments[0], lines: [{ orderItemId: 'item', quantity: 101 }] }],
      packagingGroups: [{ id: 'box', sequence: 1, mode: 'BOX_TACTILE', actualBagCount: 13,
        unitPrice: new Decimal('2.3'), subtotal: new Decimal('29.9'), pricingSnapshot: { source: 'INTERNAL_CREATE_AUTO' },
        lines: [{ orderItemId: 'item', unitsPerBag: 8 }],
      }],
    };
  }
  it('updates box count, processing and receivable amounts with a pricing revision', async () => {
    const order = boxes(); mocks.find.mockResolvedValue({ ...order, customerCharges: fixture().customerCharges });
    tx.productionOperation.count.mockResolvedValue(0);
    const split = { ...input(), lines: [{ orderItemId: 'item', quantity: 3 }] };
    const preview = await addOrderShipment(split, actor, 'preview');
    expect(preview).toMatchObject({ packaging: [{ boxCount: 14, subtotal: '32.20' }] });
    await addOrderShipment({ ...split, previewToken: preview!.token }, actor, 'save');
    expect(tx.orderPackagingGroup.update).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ actualBagCount: 14, subtotal: '32.20' }) }));
    expect(mocks.update).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ packagingAmount: '32.20', processingAmount: '85.33' }) }));
    expect(mocks.revision).toHaveBeenCalled();
  });
  it('管理员议定盒价分货后沿用原单价与原因，保留管理员标记转待重新确认，不当作自动价', async () => {
    const order = boxes();
    const group = order.packagingGroups[0]!;
    const agreed = { ...group, orderId: 'order', priceOverrideReason: '老客户议价' };
    const snapshot = buildTrustedAdminPackagingPricingSnapshot({
      previous: { source: 'INTERNAL_CREATE_AUTO' }, now: new Date('2026-09-01T00:00:00.000Z'),
      actorId: 'admin', previousPriceRevision: 0, group: agreed,
    });
    Object.assign(group, { priceOverrideReason: '老客户议价', pricingSnapshot: snapshot });
    expect(isTrustedAdminPackagingPricingSnapshot(snapshot, agreed)).toBe(true);
    mocks.find.mockResolvedValue({ ...order, customerCharges: fixture().customerCharges }); tx.productionOperation.count.mockResolvedValue(0);
    const split = { ...input(), lines: [{ orderItemId: 'item', quantity: 3 }] };
    const preview = await addOrderShipment(split, actor, 'preview');
    await addOrderShipment({ ...split, previewToken: preview!.token }, actor, 'save');

    const data = tx.orderPackagingGroup.update.mock.calls[0]![0].data;
    expect(data).toMatchObject({ actualBagCount: 14, subtotal: '32.20', priceOverrideReason: '老客户议价' });
    expect(hasAdminPricingConfirmationMarker(data.pricingSnapshot)).toBe(true);
    expect(isTrustedAdminPackagingPricingSnapshot(data.pricingSnapshot, {
      ...agreed, actualBagCount: 14, subtotal: '32.20',
    })).toBe(false);
    expect(data.pricingSnapshot).toMatchObject({
      pendingReason: expect.stringContaining('重新确认'),
      shipmentSplit: { actual: { actualBagCount: 14, unitPrice: '2.3000', subtotal: '32.20' } },
    });
  });
  it('updates free rework box quantities without reopening price confirmation or erasing free snapshots', async () => {
    const order = boxes();
    Object.assign(order, { billingMode: 'NO_CHARGE', settlementType: 'NO_CHARGE', packagingAmount: new Decimal(0), processingAmount: new Decimal(0), totalAmount: new Decimal(0) });
    Object.assign(order.packagingGroups[0], { unitPrice: new Decimal(0), subtotal: new Decimal(0), pricingSnapshot: { source: 'FREE_REWORK' } });
    mocks.find.mockResolvedValue(order); tx.productionOperation.count.mockResolvedValue(0);
    const split = { ...input(), lines: [{ orderItemId: 'item', quantity: 3 }] };
    const preview = await addOrderShipment(split, actor, 'preview');
    expect(preview).toMatchObject({ requiresPriceReview: false, newTotal: '0.00' });
    await addOrderShipment({ ...split, previewToken: preview!.token }, actor, 'save');
    expect(tx.orderPackagingGroup.update).toHaveBeenCalledWith({ where: { id: 'box' }, data: { actualBagCount: 14 } });
    expect(mocks.revision).not.toHaveBeenCalled();
  });
  it('requires a versioned change after production is released when counts change', async () => {
    mocks.find.mockResolvedValue(boxes()); tx.productionOperation.count.mockResolvedValue(1);
    await expect(addOrderShipment({ ...input(), lines: [{ orderItemId: 'item', quantity: 3 }] }, actor, 'preview')).rejects.toThrow('工单修改申请');
    expect(mocks.create).not.toHaveBeenCalled();
  });
  it('keeps both boxed destinations pending until actual freight is known', async () => {
    const order = boxes();
    mocks.find.mockResolvedValue({ ...order, customerCharges: fixture().customerCharges });
    tx.productionOperation.count.mockResolvedValue(0);
    const quote = await mocks.quote();
    quote.charges = quote.charges.map((charge: Record<string, unknown>) => ({ ...charge, suggestedAmount: null, amount: '0.00', overrideReason: null, pricingSnapshot: { actual: { requiresAdminConfirmation: true } } }));
    mocks.quote.mockResolvedValue(quote);
    const split = { ...input(), lines: [{ orderItemId: 'item', quantity: 3 }] };
    const preview = await addOrderShipment(split, actor, 'preview');
    expect(mocks.quote.mock.calls.at(-1)?.[1].shipments.every((shipment: { requiresActualWeight: boolean }) => shipment.requiresActualWeight)).toBe(true);
    expect(preview!.charges.every((charge) => charge.shippingFee === null)).toBe(true);
    await addOrderShipment({ ...split, previewToken: preview!.token }, actor, 'save');
    expect(mocks.charge).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ amount: null, status: 'PENDING_AMOUNT' }) }));
  });
});
