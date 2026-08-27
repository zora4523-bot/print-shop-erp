import { describe, expect, it } from 'vitest';
import {
  calculateCartonCharge,
  calculateExternalOrderChargeCalculation,
  calculateOrderBillableWeight,
  calculateZtoShippingCharge,
  DEFAULT_EXTERNAL_ORDER_CHARGE_CALCULATION_CONFIG,
  type ExternalOrderChargeCalculationConfig,
  type ExternalOrderChargeItemInput,
} from '../external-order-charge-calculation';

function standardItem(
  overrides: Partial<ExternalOrderChargeItemInput> = {},
): ExternalOrderChargeItemInput {
  return {
    key: 'style-1',
    quantity: 2_000,
    paperWeightGsm: 160,
    productStructure: 'STANDARD_ENVELOPE',
    ...overrides,
  };
}

describe('calculateCartonCharge', () => {
  it.each([
    [500, '1.00'],
    [1_000, '3.00'],
    [2_000, '5.00'],
    [3_000, '7.00'],
    [5_000, '8.00'],
    [5_001, '9.00'],
    [6_000, '11.00'],
    [8_000, '15.00'],
    [10_000, '16.00'],
    [12_000, '21.00'],
    [20_000, '32.00'],
  ])('整单 %i 个的纸箱费为 ¥%s', (quantity, amount) => {
    expect(calculateCartonCharge(quantity)).toMatchObject({
      status: 'CALCULATED',
      amount,
      totalQuantity: quantity,
    });
  });

  it('先汇总所有款式，再按 5000 段和余量计一次纸箱费', () => {
    const result = calculateExternalOrderChargeCalculation({
      items: Array.from({ length: 6 }, (_, index) =>
        standardItem({ key: `style-${index + 1}`, quantity: 1_000 }),
      ),
      destinationProvince: '广东',
      isSfCollect: false,
    });

    expect(result.quantity).toEqual({
      status: 'CALCULATED',
      totalQuantity: 6_000,
    });
    expect(result.carton).toMatchObject({
      status: 'CALCULATED',
      amount: '11.00',
      fullSegmentCount: 1,
      remainderQuantity: 1_000,
    });
  });

  it.each([0, -1, 1.5, Number.NaN])(
    '无效整单数量 %s 不会得到兜底金额',
    (quantity) => {
      expect(calculateCartonCharge(quantity)).toMatchObject({
        status: 'MANUAL_REQUIRED',
        amount: null,
        reasonCode: 'INVALID_QUANTITY',
      });
    },
  );
});

describe('calculateOrderBillableWeight', () => {
  it.each([
    [160, 2_000, '12000', '12'],
    [180, 2_000, '13500', '14'],
    [120, 1, '4.5', '1'],
    [150, 1_000, '6000', '6'],
    [200, 1_000, '8000', '8'],
    [230, 1_000, '10000', '10'],
  ])(
    '%ig × %i 个得到净重 %sg、计费重 %skg',
    (paperWeightGsm, quantity, netWeightGrams, billableWeightKg) => {
      expect(
        calculateOrderBillableWeight([
          standardItem({ paperWeightGsm, quantity }),
        ]),
      ).toMatchObject({
        status: 'CALCULATED',
        netWeightGrams,
        billableWeightKg,
      });
    },
  );

  it('万元封固定按 10g/个，不依赖纸张克重', () => {
    const result = calculateOrderBillableWeight([
      standardItem({
        quantity: 1_000,
        paperWeightGsm: null,
        productStructure: 'TEN_THOUSAND_ENVELOPE',
      }),
    ]);

    expect(result).toMatchObject({
      status: 'CALCULATED',
      netWeightGrams: '10000',
      billableWeightKg: '10',
      lines: [
        {
          gramsPerItem: '10',
          source: 'PRODUCT_STRUCTURE',
        },
      ],
    });
  });

  it('未配置的纸张克重明确转人工，不使用相邻克重兜底', () => {
    const result = calculateOrderBillableWeight([
      standardItem({ paperWeightGsm: 170 }),
    ]);

    expect(result).toMatchObject({
      status: 'MANUAL_REQUIRED',
      netWeightGrams: null,
      billableWeightKg: null,
      reasonCode: 'UNSUPPORTED_PAPER_WEIGHT',
      itemKey: 'style-1',
    });
    expect(
      result.status === 'MANUAL_REQUIRED' ? result.reason : '',
    ).toContain('170g');
  });
});

describe('calculateZtoShippingCharge', () => {
  it.each([
    ['广东', '19.30', 'A'],
    ['上海', '41.30', 'C'],
    ['云南', '52.30', 'D'],
    ['甘肃', '126.60', 'E'],
    ['新疆', '128.60', 'F'],
  ])('2000 个、12kg 发往%s的中通费为 ¥%s', (province, amount, band) => {
    expect(
      calculateZtoShippingCharge({
        destinationProvince: province,
        totalQuantity: 2_000,
        billableWeightKg: '12',
        isSfCollect: false,
      }),
    ).toMatchObject({
      status: 'CALCULATED',
      amount,
      province,
      band,
    });
  });

  it('180g 的 2000 个先将 13.5kg 进位为 14kg，再计算上海运费', () => {
    const result = calculateExternalOrderChargeCalculation({
      items: [standardItem({ paperWeightGsm: 180 })],
      destinationProvince: '上海',
      isSfCollect: false,
    });

    expect(result.weight).toMatchObject({
      status: 'CALCULATED',
      netWeightGrams: '13500',
      billableWeightKg: '14',
    });
    expect(result.shipping).toMatchObject({
      status: 'CALCULATED',
      amount: '48.30',
    });
  });

  it.each([
    ['广东', '1.2', '4.30', '1'],
    ['新疆', '1.2', '17.30', '1'],
    ['新疆', '1.6', '22.60', '2'],
  ])(
    '%s 的 %skg 按对应整 kg / 0.5kg 续重单位进位',
    (destinationProvince, billableWeightKg, amount, additionalUnits) => {
      expect(
        calculateZtoShippingCharge({
          destinationProvince,
          totalQuantity: 1_000,
          billableWeightKg,
          isSfCollect: false,
        }),
      ).toMatchObject({
        status: 'CALCULATED',
        amount,
        additionalUnits,
      });
    },
  );

  it('总数量超过 2000 时不要求省份或重量，直接返回物流待定', () => {
    const result = calculateExternalOrderChargeCalculation({
      items: [standardItem({ quantity: 2_001, paperWeightGsm: 170 })],
      destinationProvince: null,
      isSfCollect: false,
    });

    expect(result.carton).toMatchObject({
      status: 'CALCULATED',
      amount: '7.00',
    });
    expect(result.shipping).toMatchObject({
      status: 'LOGISTICS_PENDING',
      carrier: 'LOGISTICS',
      amount: null,
      totalQuantity: 2_001,
    });
  });

  it('顺丰到付快递费为 0，仍独立计算整单纸箱费', () => {
    const result = calculateExternalOrderChargeCalculation({
      items: [standardItem({ quantity: 6_000, paperWeightGsm: 170 })],
      destinationProvince: null,
      isSfCollect: true,
    });

    expect(result.carton).toMatchObject({
      status: 'CALCULATED',
      amount: '11.00',
    });
    expect(result.shipping).toEqual({
      status: 'WAIVED',
      carrier: 'SF_COLLECT',
      amount: '0.00',
      reason: '顺丰到付，本单快递费为 0',
    });
  });

  it('接受结构化省份的正式行政区名称', () => {
    expect(
      calculateZtoShippingCharge({
        destinationProvince: '新疆维吾尔自治区',
        totalQuantity: 1_000,
        billableWeightKg: '1',
        isSfCollect: false,
      }),
    ).toMatchObject({
      status: 'CALCULATED',
      province: '新疆',
      band: 'F',
      amount: '12.00',
    });
  });
});

describe('configuration injection', () => {
  it('纸箱、单重和运费数字都可由版本化配置替换', () => {
    const defaults = DEFAULT_EXTERNAL_ORDER_CHARGE_CALCULATION_CONFIG;
    const config: ExternalOrderChargeCalculationConfig = {
      cartonTiers: defaults.cartonTiers.map((tier) =>
        tier.maximumQuantity === 500 ? { ...tier, amount: '9' } : tier,
      ),
      weight: {
        ...defaults.weight,
        gramsPerItemByPaperWeightGsm: {
          ...defaults.weight.gramsPerItemByPaperWeightGsm,
          160: '7',
        },
      },
      zto: {
        ...defaults.zto,
        ratesByBand: {
          ...defaults.zto.ratesByBand,
          A: {
            ...defaults.zto.ratesByBand.A,
            additionalUnitFee: '2',
          },
        },
      },
    };

    const result = calculateExternalOrderChargeCalculation(
      {
        items: [standardItem({ quantity: 500 })],
        destinationProvince: '广东',
        isSfCollect: false,
      },
      config,
    );

    expect(result.carton).toMatchObject({ amount: '9.00' });
    expect(result.weight).toMatchObject({
      netWeightGrams: '3500',
      billableWeightKg: '4',
    });
    expect(result.shipping).toMatchObject({ amount: '8.80' });
  });
});
