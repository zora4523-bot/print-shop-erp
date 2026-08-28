import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  CustomerPriceBookPurpose,
  OrderSettlementType,
} from '../../../generated/prisma/enums';

const { dbMock } = vi.hoisted(() => ({
  dbMock: {
    $executeRaw: vi.fn(),
    customerPriceBook: { findMany: vi.fn() },
  },
}));

import {
  resolveExternalOrderChargesForFinalization,
  resolveExternalOrderChargesForProvisionalCreation,
} from '../order-charge-service';
import type { ExternalOrderChargeInput } from '../external-order-charges';

const now = new Date('2026-08-08T00:00:00.000Z');
const input = {
  isSfCollect: false,
  shipments: [
    {
      shipmentKey: '1',
      province: '广东',
      billableWeightKg: '1',
      itemQuantity: 1_000,
    },
  ],
};

const estimatePolicyNotes = {
  ruleVersion: '2026-08-27',
  shipping: {
    billableWeightInput: 'SERVER_ESTIMATE_WITH_ACTUAL_OVERRIDE',
    weightResolutionOrder: [
      'ACTUAL_FULFILLMENT_WEIGHT',
      'SERVER_ESTIMATE',
    ],
    maxOrderQuantity: 2_000,
    billableWeightRounding: 'CEIL_KG',
    minimumBillableWeightKg: 1,
    gramsPerItemByPaperWeightGsm: {
      120: 4.5,
      150: 6,
      160: 6,
      180: 6.75,
      200: 8,
      230: 10,
    },
    tenThousandEnvelopeGramsPerItem: 10,
  },
} as const;

function activeBook({
  version,
  shippingFee,
  packingFee,
  shippingProvince = '广东',
  shippingIncrementFee = '1.50',
}: {
  version: number;
  shippingFee: string;
  packingFee: string;
  shippingProvince?: string;
  shippingIncrementFee?: string;
}) {
  return {
    id: `logistics-book-${version}`,
    code: `EXTERNAL_LOGISTICS_V${version}`,
    name: `外部销售物流价目簿 v${version}`,
    version,
    sourceName: '物流价目簿.xlsx',
    sourceSha256: `hash-${version}`,
    notes: estimatePolicyNotes,
    rules: [
      {
        id: `shipping-rule-${version}`,
        code: 'ZTO_GUANGDONG',
        amount: shippingFee,
        includedUnits: '1',
        incrementUnits: '1',
        incrementAmount: shippingIncrementFee,
        minQty: null,
        maxQty: null,
        triggerCondition: {
          carrierCode: 'ZTO',
          provinces: [shippingProvince],
        },
        sourceSheet: '中通',
        sourceRange: 'A3:D3',
        sourceName: '物流价目簿.xlsx',
        sourceSha256: `hash-${version}`,
        blocksAutomaticQuote: false,
        category: { id: 'shipping-category', code: 'SHIPPING_FEE' },
      },
      {
        id: `packing-rule-${version}`,
        code: 'CARTON_Q1_1000',
        amount: packingFee,
        includedUnits: null,
        incrementUnits: null,
        incrementAmount: null,
        minQty: 1,
        maxQty: 1_000,
        triggerCondition: null,
        sourceSheet: 'Sheet1',
        sourceRange: 'A3:B3',
        sourceName: '纸箱价格表.xlsx',
        sourceSha256: `hash-${version}`,
        blocksAutomaticQuote: false,
        category: { id: 'packing-category', code: 'PACKING_MATERIAL' },
      },
    ],
  };
}

beforeEach(() => {
  dbMock.$executeRaw.mockReset().mockResolvedValue(0);
  dbMock.customerPriceBook.findMany
    .mockReset()
    .mockResolvedValue([
      activeBook({ version: 1, shippingFee: '2.80', packingFee: '3.00' }),
    ]);
});

async function resolveProvisional(
  facts: ExternalOrderChargeInput = input,
  at: Date = now,
) {
  return resolveExternalOrderChargesForProvisionalCreation(
    dbMock as never,
    {
      isSfCollect: facts.isSfCollect,
      shipments: facts.shipments.map((shipment) => ({
        shipmentKey: shipment.shipmentKey,
        province: shipment.province,
        billableWeightKg:
          shipment.billableWeightKg === null
            ? null
            : String(shipment.billableWeightKg),
        weightItems: shipment.weightItems,
        itemQuantity: shipment.itemQuantity,
        shippingFee: null,
        packingMaterialFee: null,
        overrideReason: null,
      })),
    },
    at,
  );
}

describe('external order charge persistence', () => {
  it('reads the current active LOGISTICS book under the shared snapshot lock', async () => {
    const resolved = await resolveProvisional();

    expect(dbMock.$executeRaw).toHaveBeenCalledTimes(1);
    expect(dbMock.customerPriceBook.findMany).toHaveBeenCalledWith({
      where: {
        settlementType: OrderSettlementType.EXTERNAL_SALES,
        purpose: CustomerPriceBookPurpose.LOGISTICS,
        isActive: true,
        effectiveFrom: { lte: now },
        OR: [{ effectiveTo: null }, { effectiveTo: { gt: now } }],
      },
      select: expect.any(Object),
      orderBy: [{ effectiveFrom: 'desc' }, { version: 'desc' }],
      take: 2,
    });
    expect(
      dbMock.customerPriceBook.findMany.mock.invocationCallOrder[0],
    ).toBeGreaterThan(dbMock.$executeRaw.mock.invocationCallOrder[0]!);
    expect(resolved.totalAmount).toBe('5.80');
    expect(resolved.requiresAdminConfirmation).toBe(false);
  });

  it('keeps automatic shipping and carton charges confirmed', async () => {
    const resolved = await resolveExternalOrderChargesForProvisionalCreation(
      dbMock as never,
      {
        isSfCollect: false,
        shipments: [
          {
            ...input.shipments[0]!,
            shippingFee: null,
            packingMaterialFee: null,
            overrideReason: null,
          },
        ],
      },
      now,
    );

    expect(resolved.requiresAdminConfirmation).toBe(false);
    const byCode = new Map(
      resolved.charges.map((charge) => [charge.categoryCode, charge]),
    );
    expect(
      (
        byCode.get('SHIPPING_FEE')!.pricingSnapshot.actual as {
          provisional: boolean;
        }
      ).provisional,
    ).toBe(false);
    expect(
      (
        byCode.get('PACKING_MATERIAL')!.pricingSnapshot.actual as {
          provisional: boolean;
        }
      ).provisional,
    ).toBe(false);
  });

  it('uses an updated active price book on the next request, not bundled defaults', async () => {
    const beforeUpdate = await resolveProvisional(input, now);
    dbMock.customerPriceBook.findMany.mockResolvedValueOnce([
      activeBook({ version: 2, shippingFee: '6.60', packingFee: '4.50' }),
    ]);

    const afterUpdate = await resolveProvisional(
      input,
      new Date('2026-08-09T00:00:00.000Z'),
    );

    expect(beforeUpdate.totalAmount).toBe('5.80');
    expect(afterUpdate.totalAmount).toBe('11.10');
    expect(afterUpdate.priceBook.sourceSha256).toBe('hash-2');
    expect(dbMock.customerPriceBook.findMany).toHaveBeenCalledTimes(2);
  });

  it('2,000 个 160g 纸张估算为 12kg，按上海中通价目收取 41.30 元', async () => {
    dbMock.customerPriceBook.findMany.mockResolvedValueOnce([
      activeBook({
        version: 1,
        shippingFee: '2.80',
        packingFee: '3.00',
        shippingProvince: '上海',
        shippingIncrementFee: '3.50',
      }),
    ]);

    const resolved = await resolveProvisional(
      {
        isSfCollect: false,
        shipments: [
          {
            shipmentKey: '1',
            province: '上海',
            billableWeightKg: null,
            itemQuantity: 2_000,
            weightItems: [
              {
                itemKey: 'style-1',
                quantity: 2_000,
                paperWeightGsm: 160,
                paperType: '160g触感纸',
                productStructure: 'STANDARD_ENVELOPE',
              },
            ],
          },
        ],
      },
      now,
    );

    const shipping = resolved.charges.find(
      (charge) => charge.categoryCode === 'SHIPPING_FEE',
    );
    expect(shipping?.amount).toBe('41.30');
    expect(shipping?.pricingSnapshot.priceBook).toEqual(
      expect.objectContaining({
        policy: expect.objectContaining({
          ruleVersion: '2026-08-27',
          maxOrderQuantity: 2_000,
        }),
      }),
    );
    expect(
      (shipping?.pricingSnapshot.quote as { basis: unknown }).basis,
    ).toMatchObject({
      weightSource: 'SERVER_ESTIMATE',
      netWeightGrams: '12000',
      billableWeightKg: '12',
    });
  });

  it.each([
    {
      label: '缺少 notes',
      notes: null,
      expected: '物流价目簿缺少版本化重量策略',
    },
    {
      label: '缺少规则版本',
      notes: { ...estimatePolicyNotes, ruleVersion: '' },
      expected: '物流价目簿缺少规则版本',
    },
    {
      label: '错误的重量来源',
      notes: {
        ...estimatePolicyNotes,
        shipping: {
          ...estimatePolicyNotes.shipping,
          billableWeightInput: 'BROWSER_WEIGHT',
        },
      },
      expected: '物流价目簿的重量来源策略无效',
    },
    {
      label: '错误的决议顺序',
      notes: {
        ...estimatePolicyNotes,
        shipping: {
          ...estimatePolicyNotes.shipping,
          weightResolutionOrder: ['SERVER_ESTIMATE'],
        },
      },
      expected: '物流价目簿的重量决议顺序无效',
    },
    {
      label: '非法数量边界',
      notes: {
        ...estimatePolicyNotes,
        shipping: { ...estimatePolicyNotes.shipping, maxOrderQuantity: 0 },
      },
      expected: '物流价目簿的数量边界无效',
    },
    {
      label: '错误的进位方式',
      notes: {
        ...estimatePolicyNotes,
        shipping: {
          ...estimatePolicyNotes.shipping,
          billableWeightRounding: 'ROUND_HALF_UP',
        },
      },
      expected: '物流价目簿的重量进位策略无效',
    },
    {
      label: '未配置的纸张单重',
      notes: {
        ...estimatePolicyNotes,
        shipping: {
          ...estimatePolicyNotes.shipping,
          gramsPerItemByPaperWeightGsm: {},
        },
      },
      expected: '物流价目簿缺少纸张单重策略',
    },
    {
      label: '非法纸张单重',
      notes: {
        ...estimatePolicyNotes,
        shipping: {
          ...estimatePolicyNotes.shipping,
          gramsPerItemByPaperWeightGsm: { 160: 0 },
        },
      },
      expected: '物流价目簿规则160g 纸张单重必须大于 0',
    },
    {
      label: '非法最低重量',
      notes: {
        ...estimatePolicyNotes,
        shipping: {
          ...estimatePolicyNotes.shipping,
          minimumBillableWeightKg: 0,
        },
      },
      expected: '物流价目簿规则最低计费重量必须大于 0',
    },
    {
      label: '非法万元封单重',
      notes: {
        ...estimatePolicyNotes,
        shipping: {
          ...estimatePolicyNotes.shipping,
          tenThousandEnvelopeGramsPerItem: 0,
        },
      },
      expected: '物流价目簿规则万元封单个重量必须大于 0',
    },
  ])('当前价目簿$label时失败关闭', async ({ notes, expected }) => {
    const malformed = activeBook({
      version: 1,
      shippingFee: '2.80',
      packingFee: '3.00',
    });
    malformed.notes = notes as typeof malformed.notes;
    dbMock.customerPriceBook.findMany.mockResolvedValueOnce([malformed]);

    await expect(resolveProvisional(input, now)).rejects.toThrow(expected);
  });

  it('新工单临时费用不允许退回历史 CARRIER_CONFIRMED 策略', async () => {
    const legacy = activeBook({
      version: 1,
      shippingFee: '2.80',
      packingFee: '3.00',
    });
    legacy.notes = {
      ruleVersion: '2026-08-26',
      shipping: {
        billableWeightInput: 'CARRIER_CONFIRMED',
        ztoMaximumOrderQuantity: 2_000,
      },
    } as unknown as typeof legacy.notes;
    dbMock.customerPriceBook.findMany.mockResolvedValueOnce([legacy]);

    await expect(resolveProvisional(input, now)).rejects.toThrow(
      '当前物流价目簿不支持服务端重量估算',
    );
  });

  it('显式加载的冻结 v2 可使用 CARRIER_CONFIRMED 实际重量', async () => {
    const legacy = activeBook({
      version: 1,
      shippingFee: '2.80',
      packingFee: '3.00',
    });
    legacy.notes = {
      ruleVersion: '2026-08-26',
      shipping: {
        billableWeightInput: 'CARRIER_CONFIRMED',
        ztoMaximumOrderQuantity: 2_000,
      },
    } as unknown as typeof legacy.notes;
    dbMock.customerPriceBook.findMany.mockResolvedValueOnce([legacy]);

    const resolved = await resolveExternalOrderChargesForFinalization(
      dbMock as never,
      {
        isSfCollect: false,
        shipments: [
          {
            ...input.shipments[0]!,
            shippingFee: null,
            packingMaterialFee: null,
            overrideReason: null,
          },
        ],
      },
      legacy.id,
      now,
    );

    expect(resolved.requiresAdminConfirmation).toBe(false);
    expect(resolved.priceBook.policy.billableWeightInput).toBe(
      'CARRIER_CONFIRMED',
    );
  });

  it('filters disabled rules and categories when reloading a frozen book', async () => {
    await resolveExternalOrderChargesForFinalization(
      dbMock as never,
      {
        isSfCollect: false,
        shipments: [
          {
            shipmentKey: '1',
            province: '广东',
            billableWeightKg: '1',
            itemQuantity: 1_000,
            shippingFee: null,
            packingMaterialFee: '3.00',
            overrideReason: null,
          },
        ],
      },
      'logistics-book-1',
      now,
    );

    expect(dbMock.customerPriceBook.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          settlementType: OrderSettlementType.EXTERNAL_SALES,
          purpose: CustomerPriceBookPurpose.LOGISTICS,
          id: 'logistics-book-1',
        },
        select: expect.objectContaining({
          rules: expect.objectContaining({
            where: {
              isActive: true,
              category: {
                isActive: true,
                code: { in: ['SHIPPING_FEE', 'PACKING_MATERIAL'] },
              },
            },
          }),
        }),
      }),
    );
  });

  it('精确历史 v1 显式加载时自动兼容 blocked 纸箱档', async () => {
    const historical = activeBook({
      version: 1,
      shippingFee: '2.80',
      packingFee: '3.00',
    });
    Object.assign(historical, {
      id: 'cpb_external_sales_logistics_202608_v1',
      code: 'EXTERNAL_SALES_LOGISTICS_202608',
      sourceSha256:
        '7d3d0b6dddb2ee910046b3bc80f1d7fc8e35aa94dd25d5cf14f23c58a6ab8a69',
      notes: null,
    });
    historical.rules[1]!.blocksAutomaticQuote = true;
    dbMock.customerPriceBook.findMany.mockResolvedValueOnce([historical]);

    const resolved = await resolveExternalOrderChargesForFinalization(
      dbMock as never,
      {
        isSfCollect: false,
        shipments: [
          {
            ...input.shipments[0]!,
            shippingFee: null,
            packingMaterialFee: null,
            overrideReason: null,
          },
        ],
      },
      historical.id,
      now,
    );

    expect(resolved.requiresAdminConfirmation).toBe(false);
    expect(resolved.charges).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          categoryCode: 'SHIPPING_FEE',
          amount: '2.80',
          quantity: '1',
        }),
        expect.objectContaining({
          categoryCode: 'PACKING_MATERIAL',
          amount: '3.00',
          quantity: '1000',
        }),
      ]),
    );
    expect(resolved.priceBook.policy).toEqual({
      ruleVersion: 'historical:EXTERNAL_SALES_LOGISTICS_202608:v1',
      billableWeightInput: 'CARRIER_CONFIRMED',
      weightResolutionOrder: ['ACTUAL_FULFILLMENT_WEIGHT'],
      maxOrderQuantity: 2_000,
    });
  });

  it('伪造历史指纹的 blocked 纸箱档仍失败关闭', async () => {
    const forgedHistorical = activeBook({
      version: 1,
      shippingFee: '2.80',
      packingFee: '3.00',
    });
    Object.assign(forgedHistorical, {
      id: 'cpb_external_sales_logistics_202608_v1',
      code: 'EXTERNAL_SALES_LOGISTICS_202608',
      sourceSha256: 'wrong-fingerprint',
    });
    forgedHistorical.rules[1]!.blocksAutomaticQuote = true;
    dbMock.customerPriceBook.findMany.mockResolvedValueOnce([
      forgedHistorical,
    ]);

    await expect(
      resolveExternalOrderChargesForFinalization(
        dbMock as never,
        {
          isSfCollect: false,
          shipments: [
            {
              ...input.shipments[0]!,
              shippingFee: null,
              packingMaterialFee: null,
              overrideReason: null,
            },
          ],
        },
        forgedHistorical.id,
        now,
      ),
    ).rejects.toThrow('纸箱费规则必须是可自动计算的连续数量档');
  });

  it('不会将伪造的无 notes 价目簿当成历史快照', async () => {
    const forgedHistorical = activeBook({
      version: 1,
      shippingFee: '2.80',
      packingFee: '3.00',
    });
    Object.assign(forgedHistorical, {
      id: 'cpb_external_sales_logistics_202608_v1',
      code: 'EXTERNAL_SALES_LOGISTICS_202608',
      sourceSha256: 'wrong-fingerprint',
      notes: null,
    });
    dbMock.customerPriceBook.findMany.mockResolvedValueOnce([forgedHistorical]);

    await expect(
      resolveExternalOrderChargesForFinalization(
        dbMock as never,
        {
          isSfCollect: false,
          shipments: [
            {
              ...input.shipments[0]!,
              shippingFee: null,
              packingMaterialFee: null,
              overrideReason: null,
            },
          ],
        },
        forgedHistorical.id,
        now,
      ),
    ).rejects.toThrow('物流价目簿缺少版本化重量策略');
  });

  it('历史快照无实际重量时可仅为未发货回退保留 provisional', async () => {
    const historical = activeBook({
      version: 1,
      shippingFee: '2.80',
      packingFee: '3.00',
    });
    Object.assign(historical, {
      id: 'cpb_external_sales_logistics_202608_v1',
      code: 'EXTERNAL_SALES_LOGISTICS_202608',
      sourceSha256:
        '7d3d0b6dddb2ee910046b3bc80f1d7fc8e35aa94dd25d5cf14f23c58a6ab8a69',
      notes: null,
    });
    dbMock.customerPriceBook.findMany.mockResolvedValueOnce([historical]);

    const resolved = await resolveExternalOrderChargesForFinalization(
      dbMock as never,
      {
        isSfCollect: false,
        shipments: [
          {
            ...input.shipments[0]!,
            billableWeightKg: null,
            shippingFee: null,
            packingMaterialFee: null,
            overrideReason: null,
          },
        ],
      },
      historical.id,
      now,
      { allowPending: true },
    );

    const shipping = resolved.charges.find(
      (charge) => charge.categoryCode === 'SHIPPING_FEE',
    );
    expect(resolved.requiresAdminConfirmation).toBe(true);
    expect(shipping).toMatchObject({
      status: 'ESTIMATED',
      amount: '0.00',
      suggestedAmount: null,
    });
    expect(shipping?.pricingSnapshot.actual).toMatchObject({
      provisional: true,
      requiresAdminConfirmation: true,
    });
  });

  it('keeps administrator-confirmed final amounts and their reason', async () => {
    const resolved = await resolveExternalOrderChargesForFinalization(
      dbMock as never,
      {
        isSfCollect: false,
        shipments: [
          {
            ...input.shipments[0]!,
            shippingFee: '3.10',
            packingMaterialFee: '4.25',
            overrideReason: '承运商与包材实际结算金额',
          },
        ],
      },
      'logistics-book-1',
      now,
    );

    const byCode = new Map(
      resolved.charges.map((charge) => [charge.categoryCode, charge]),
    );
    expect(byCode.get('SHIPPING_FEE')).toMatchObject({
      suggestedAmount: '2.80',
      amount: '3.10',
      overrideReason: '承运商与包材实际结算金额',
    });
    expect(byCode.get('PACKING_MATERIAL')).toMatchObject({
      suggestedAmount: '3.00',
      amount: '4.25',
      overrideReason: '承运商与包材实际结算金额',
    });
    expect(resolved.totalAmount).toBe('7.35');
  });

  it('keeps an administrator note when the confirmed amount equals the suggestion', async () => {
    const resolved = await resolveExternalOrderChargesForFinalization(
      dbMock as never,
      {
        isSfCollect: false,
        shipments: [
          {
            ...input.shipments[0]!,
            shippingFee: '2.80',
            packingMaterialFee: '3.00',
            overrideReason: '已核对承运商与包材凭证',
          },
        ],
      },
      'logistics-book-1',
      now,
    );

    expect(resolved.charges).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          categoryCode: 'SHIPPING_FEE',
          amount: '2.80',
          overrideReason: '已核对承运商与包材凭证',
        }),
        expect.objectContaining({
          categoryCode: 'PACKING_MATERIAL',
          amount: '3.00',
          overrideReason: '已核对承运商与包材凭证',
        }),
      ]),
    );
  });

  it('fails closed when no active LOGISTICS book exists', async () => {
    dbMock.customerPriceBook.findMany.mockResolvedValueOnce([]);

    await expect(resolveProvisional(input, now)).rejects.toThrow(
      '当前没有生效的外部销售快递/耗材价目簿，请联系管理员',
    );
  });

  it('fails closed when multiple LOGISTICS books overlap', async () => {
    dbMock.customerPriceBook.findMany.mockResolvedValueOnce([
      activeBook({ version: 1, shippingFee: '2.80', packingFee: '3.00' }),
      activeBook({ version: 2, shippingFee: '6.60', packingFee: '4.50' }),
    ]);

    await expect(resolveProvisional(input, now)).rejects.toThrow(
      '同时存在多个生效的外部销售快递/耗材价目簿，请管理员修正有效期',
    );
  });

  it('价目簿异常时不在业务错误中暴露规则编号', async () => {
    const malformed = activeBook({
      version: 1,
      shippingFee: '2.80',
      packingFee: '3.00',
    });
    malformed.rules[1]!.code = malformed.rules[0]!.code;
    dbMock.customerPriceBook.findMany.mockResolvedValueOnce([malformed]);

    let visibleMessage = '';
    try {
      await resolveProvisional(input, now);
    } catch (error) {
      visibleMessage = error instanceof Error ? error.message : String(error);
    }

    expect(visibleMessage).toBe('物流价目簿中存在重复的收费规则');
    expect(visibleMessage).not.toContain('ZTO_GUANGDONG');
    expect(visibleMessage).not.toContain('SHIPPING_FEE');
  });

  it('fails closed on a zero weight increment instead of undercharging', async () => {
    const malformed = activeBook({
      version: 1,
      shippingFee: '2.80',
      packingFee: '3.00',
    });
    malformed.rules[0]!.incrementUnits = '0';
    dbMock.customerPriceBook.findMany.mockResolvedValueOnce([malformed]);

    await expect(resolveProvisional(input, now)).rejects.toThrow(
      '物流价目簿规则续重单位必须大于 0',
    );
  });

  it('fails closed when a packaging suggestion exceeds the money column', async () => {
    dbMock.customerPriceBook.findMany.mockResolvedValueOnce([
      activeBook({
        version: 1,
        shippingFee: '2.80',
        packingFee: '10000000000.00',
      }),
    ]);

    const resolved = await resolveProvisional(input, now);
    const packaging = resolved.charges.find(
      (charge) => charge.categoryCode === 'PACKING_MATERIAL',
    );

    expect(resolved.requiresAdminConfirmation).toBe(true);
    expect(packaging?.suggestedAmount).toBeNull();
    expect(packaging?.amount).toBe('0.00');
    expect(
      (packaging?.pricingSnapshot.quote as { errors: string[] }).errors.join(
        '；',
      ),
    ).toContain('纸箱数量档必须从 1 开始连续覆盖且金额有效');
  });
});
