import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  OrderFoilTechnique,
  OrderItemPricingRoute,
  OrderLamination,
  OrderPackagingMode,
  OrderProductStructure,
  OrderSettlementType,
} from '../../../generated/prisma/enums';
import { calculateExternalOrderCharges } from '../../price/external-order-charges';
import {
  DEFAULT_EXTERNAL_ORDER_CHARGE_RULES,
  DEFAULT_EXTERNAL_ORDER_LOGISTICS_POLICY,
} from '../../price/__tests__/fixtures/external-order-charge-fixtures';

const mocks = vi.hoisted(() => ({
  transaction: vi.fn(),
  readSnapshot: vi.fn(),
  quoteItems: vi.fn(),
  quotePackaging: vi.fn(),
  quoteLogistics: vi.fn(),
}));

vi.mock('@/lib/db', () => ({
  db: { $transaction: mocks.transaction },
}));
vi.mock('@/lib/order/create-order-price-snapshot', () => ({
  readExternalCreateOrderPriceSnapshot: mocks.readSnapshot,
}));
vi.mock('@/lib/price/quote-service', () => ({
  quoteOrderItems: mocks.quoteItems,
}));
vi.mock('@/lib/price/order-packaging-quote', () => ({
  quoteOrderPackagingGroups: mocks.quotePackaging,
}));
vi.mock('@/lib/price/order-charge-service', () => ({
  quoteExternalOrderChargesInTransaction: mocks.quoteLogistics,
}));

import {
  quoteExternalCreateOrder,
  type CreateOrderQuoteInput,
} from '../create-order-quote-service';

const PROCESSING_HASH = 'a'.repeat(64);
const LOGISTICS_HASH = 'b'.repeat(64);
const now = new Date('2026-08-28T05:00:00.000Z');
const tx = { name: 'one-shared-transaction' };

const priceVersion = {
  processing: {
    purpose: 'PROCESSING' as const,
    id: 'processing-v12',
    code: 'PROCESSING',
    name: '加工价目',
    version: 12,
    sourceSha256: PROCESSING_HASH,
  },
  logistics: {
    purpose: 'LOGISTICS' as const,
    id: 'logistics-v8',
    code: 'LOGISTICS',
    name: '物流价目',
    version: 8,
    sourceSha256: LOGISTICS_HASH,
  },
};

const item = {
  productId: 'product-1',
  pricingRoute: OrderItemPricingRoute.CUSTOM_SINGLE_FLAT_FOIL,
  productStructure: OrderProductStructure.STANDARD_ENVELOPE,
  artworkVersion: null,
  plateGroupId: null,
  pricingGroup: null,
  manualQuoteReason: null,
  specification: '大号',
  actualWidthMm: 210,
  actualHeightMm: 105,
  paperType: '160g触感纸',
  paperWeightGsm: 160,
  quantity: 2_000,
  crafts: ['craft-foil'],
  frontFoilColors: ['哑金'],
  backFoilColors: [],
  foilColors: ['哑金'],
  foilTechnique: OrderFoilTechnique.FLAT,
  hasLocalFoil: false,
  lamination: OrderLamination.NONE,
  printColors: [],
  isDoubleSided: false,
  isDoubleColor: false,
};

function itemQuote(amount: string | null, complete: boolean) {
  return {
    components: [],
    suggestedUnitPrice: complete ? '0.0500' : null,
    suggestedFixedFee: null,
    suggestedSubtotal: amount,
    complete,
    errors: complete ? [] : ['该组合需要工厂核价'],
    snapshot: {
      version: 1 as const,
      quotedAt: now.toISOString(),
      priceBook: {
        id: priceVersion.processing.id,
        code: priceVersion.processing.code,
        name: priceVersion.processing.name,
        version: priceVersion.processing.version,
        sourceName: '加工价目.xlsx',
        sourceSha256: PROCESSING_HASH,
      },
      input: {},
      base: {},
      appliedAdjustments: [],
      components: [],
      suggestedUnitPrice: complete ? '0.0500' : null,
      suggestedFixedFee: null,
      suggestedSubtotal: amount,
      complete,
      errors: complete ? [] : ['该组合需要工厂核价'],
    },
  };
}

function input(overrides: Partial<CreateOrderQuoteInput> = {}): CreateOrderQuoteInput {
  return {
    factsKey: 'facts:item-count=1;shipping=shanghai',
    settlementType: OrderSettlementType.EXTERNAL_SALES,
    items: [item],
    orderItemCount: 1,
    packagingGroups: [
      {
        groupKey: 'bag-1',
        mode: OrderPackagingMode.SINGLE_STYLE,
        actualBagCount: 20,
      },
    ],
    logistics: {
      isSfCollect: false,
      items: [
        {
          itemKey: 'forged-logistics-fact',
          quantity: 2_000,
          paperWeightGsm: 160,
          paperType: '160g触感纸',
          productStructure: OrderProductStructure.STANDARD_ENVELOPE,
        },
      ],
      shipments: [
        {
          shipmentKey: 'shipment-1',
          province: '上海',
          billableWeightKg: '1',
          itemQuantity: 2_000,
          itemQuantities: [2_000],
        },
      ],
    },
    ...overrides,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.transaction.mockImplementation(async (run) => run(tx));
  mocks.readSnapshot.mockResolvedValue(priceVersion);
  mocks.quoteItems.mockResolvedValue([itemQuote('100.00', true)]);
  mocks.quotePackaging.mockResolvedValue({
    priceBook: {
      id: priceVersion.processing.id,
      code: priceVersion.processing.code,
      name: priceVersion.processing.name,
      version: priceVersion.processing.version,
      sourceName: '加工价目.xlsx',
      sourceSha256: PROCESSING_HASH,
    },
    groups: [
      {
        groupKey: 'bag-1',
        complete: true,
        errors: [],
        suggestedUnitPrice: '0.5000',
        suggestedSubtotal: '10.00',
        snapshot: {},
      },
    ],
    suggestedTotal: '10.00',
    requiresAdminConfirmation: false,
    errors: [],
  });
  mocks.quoteLogistics.mockImplementation(async (_tx, chargeInput) => ({
    priceBook: {
      id: priceVersion.logistics.id,
      code: priceVersion.logistics.code,
      name: priceVersion.logistics.name,
      version: priceVersion.logistics.version,
      sourceName: '物流价目.xlsx',
      sourceSha256: LOGISTICS_HASH,
      policy: DEFAULT_EXTERNAL_ORDER_LOGISTICS_POLICY,
    },
    quote: calculateExternalOrderCharges(
      chargeInput,
      DEFAULT_EXTERNAL_ORDER_CHARGE_RULES,
      DEFAULT_EXTERNAL_ORDER_LOGISTICS_POLICY,
    ),
  }));
});

describe('quoteExternalCreateOrder', () => {
  it('一次事务内共享加工/物流双版本，并传递真实 orderItemCount', async () => {
    const result = await quoteExternalCreateOrder(input(), now);

    expect(mocks.transaction).toHaveBeenCalledTimes(1);
    expect(mocks.readSnapshot).toHaveBeenCalledWith(tx, { now });
    expect(mocks.quoteItems).toHaveBeenCalledWith(
      [item],
      OrderSettlementType.EXTERNAL_SALES,
      now,
      tx,
      { orderItemCount: 1 },
    );
    expect(mocks.quotePackaging).toHaveBeenCalledWith(
      expect.any(Array),
      OrderSettlementType.EXTERNAL_SALES,
      now,
      tx,
      { snapshotLockHeld: true },
    );
    expect(mocks.quoteLogistics).toHaveBeenCalledWith(
      tx,
      expect.any(Object),
      now,
      { snapshotLockHeld: true },
    );
    expect(result.priceVersion).toEqual(priceVersion);
  });

  it('擦除浏览器重量，用 2000 个 160g 款式服务端估算上海 12kg / ¥41.30', async () => {
    const result = await quoteExternalCreateOrder(input(), now);
    const chargeInput = mocks.quoteLogistics.mock.calls[0]?.[1];

    expect(chargeInput.shipments[0]).toMatchObject({
      billableWeightKg: null,
      itemQuantity: 2_000,
      weightItems: [
        expect.objectContaining({ quantity: 2_000, paperWeightGsm: 160 }),
      ],
    });
    expect(result.logistics.suggestedShippingTotal).toBe('41.30');
    expect(result.logistics.shipments[0]?.shipping.basis).toMatchObject({
      weightSource: 'SERVER_ESTIMATE',
      netWeightGrams: '12000',
      billableWeightKg: '12',
    });
    expect(result.knownTotal).toBe('156.30');
    expect(result.total).toBe('156.30');
    expect(result.plateFee).toEqual({
      status: 'PENDING',
      amount: null,
      displayAmount: '待定',
      label: '制版费',
    });
  });

  it('manual 款不清空其他已知费用，合计明确为部分金额', async () => {
    mocks.quoteItems.mockResolvedValueOnce([itemQuote(null, false)]);

    const result = await quoteExternalCreateOrder(input(), now);

    expect(result).toMatchObject({
      knownTotal: '56.30',
      total: null,
      hasManualPricing: true,
      totalSemantics: 'EXCLUDES_MANUAL_ITEMS',
    });
  });

  it('相同规范化事实、版本与结果生成稳定 token，客户端重量不参与 token', async () => {
    const first = await quoteExternalCreateOrder(input(), now);
    const second = await quoteExternalCreateOrder(
      input({
        factsKey: 'another-browser-request-key',
        packagingGroups: [
          {
            groupKey: 'temporary-group-99',
            mode: OrderPackagingMode.SINGLE_STYLE,
            actualBagCount: 20,
          },
        ],
        logistics: {
          ...input().logistics,
          shipments: [
            {
              ...input().logistics.shipments[0]!,
              billableWeightKg: '999',
            },
          ],
        },
      }),
      now,
    );

    expect(first.quoteToken).toMatch(/^create-order-quote-v2:[a-f\d]{64}$/);
    expect(second.quoteToken).toBe(first.quoteToken);
    expect(second.factsKey).toBe('another-browser-request-key');
  });
});
