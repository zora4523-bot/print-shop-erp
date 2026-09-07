import { describe, expect, it } from 'vitest';
import {
  calculateCreateOrderQuote,
  selectFullUnitPrice,
  selectPartialUnitPrice,
  selectPrintPerOrderPrice,
  type CreateOrderPriceSnapshot,
  type CreateOrderQuoteItemInput,
  type CreateOrderQuoteLine,
} from '../create-order';
import {
  CREATE_ORDER_GOLDEN_SNAPSHOT,
  RULE8_CARTON_GOLDEN_CASES,
  RULE8_FULL_GOLDEN_CASES,
  RULE8_GOLDEN_CASE_COUNT,
  RULE8_PARTIAL_GOLDEN_CASES,
  RULE8_PRINT_GOLDEN_CASES,
  RULE8_SHIPPING_GOLDEN_CASES,
  createGoldenOrderInput,
  createGoldenOrderItem,
} from './fixtures/create-order-golden-fixtures';

function quoteSingle(
  item: CreateOrderQuoteItemInput,
  options: Parameters<typeof createGoldenOrderInput>[1] = {},
) {
  return calculateCreateOrderQuote(
    createGoldenOrderInput([item], options),
    CREATE_ORDER_GOLDEN_SNAPSHOT,
  );
}

function itemLine(
  result: ReturnType<typeof quoteSingle>,
  code: string,
): CreateOrderQuoteLine {
  const line = result.items[0]?.lines.find((candidate) => candidate.code === code);
  expect(line, `missing item line ${code}`).toBeDefined();
  return line!;
}

function orderLine(
  result: ReturnType<typeof quoteSingle>,
  code: string,
): CreateOrderQuoteLine {
  const line = result.order.lines.find((candidate) => candidate.code === code);
  expect(line, `missing order line ${code}`).toBeDefined();
  return line!;
}

function packagingLine(result: ReturnType<typeof quoteSingle>) {
  const line = result.packagingGroups[0]?.line;
  expect(line, 'missing packaging group line').toBeDefined();
  return line!;
}

function fullItem(
  overrides: Partial<CreateOrderQuoteItemInput> = {},
): CreateOrderQuoteItemInput {
  return createGoldenOrderItem({
    craft: 'FULL',
    paperType: '珠光艳闪',
    paperWeightGsm: 160,
    specification: '大号封',
    pricingGroup: 'LARGE',
    quantity: 5_000,
    frontColors: ['哑金'],
    backColors: [],
    ...overrides,
  });
}

function printItem(
  overrides: Partial<CreateOrderQuoteItemInput> = {},
): CreateOrderQuoteItemInput {
  return createGoldenOrderItem({
    craft: 'PRINT',
    paperType: '铜版纸',
    paperWeightGsm: 200,
    specification: '大号封',
    quantity: 1_000,
    frontColors: [],
    backColors: [],
    printFoilMode: 'NONE',
    ...overrides,
  });
}

describe('calculateCreateOrderQuote · 局部烫金黄金用例', () => {
  it.each(RULE8_PARTIAL_GOLDEN_CASES)(
    '$caseId [$section] $label',
    ({ item, expected }) => {
      const result = quoteSingle(createGoldenOrderItem(item));
      const processing = (
        Number(expected.blank) + Number(expected.machine)
      ).toFixed(2);

      expect(result.items[0]).toMatchObject({
        status: 'QUOTED',
        unitPrice: '0.1300',
        processingAmount: processing,
        amount: processing,
      });
      expect(itemLine(result, 'PARTIAL_BLANK').amount).toBe(expected.blank);
      expect(itemLine(result, 'PARTIAL_MACHINE').amount).toBe(
        expected.machine,
      );
      expect(packagingLine(result).amount).toBe(expected.bagging);
    },
  );

  it('PARTIAL selector is an explicit SKU unit-price selector', () => {
    const item = createGoldenOrderItem();
    expect(
      selectPartialUnitPrice(item, CREATE_ORDER_GOLDEN_SNAPSHOT.partial),
    ).toMatchObject({ unitPrice: '0.1300' });
  });

  it('损坏快照中的空白封单价超过列上限时失败关闭', () => {
    const snapshot: CreateOrderPriceSnapshot = {
      ...CREATE_ORDER_GOLDEN_SNAPSHOT,
      partial: {
        ...CREATE_ORDER_GOLDEN_SNAPSHOT.partial,
        blankUnitPrices: CREATE_ORDER_GOLDEN_SNAPSHOT.partial.blankUnitPrices.map(
          (row) => ({ ...row, unitPrice: '1200000.0000' }),
        ),
      },
    };

    const result = calculateCreateOrderQuote(
      createGoldenOrderInput([createGoldenOrderItem({ quantity: 1 })]),
      snapshot,
    );

    expect(result).toMatchObject({ status: 'INVALID_INPUT', submittable: false });
    expect(result.items[0]).toMatchObject({ unitPrice: null, amount: null });
    expect(result.items[0]?.errors).toContain(
      '局部烫金空白封单价超过可保存上限',
    );
  });

  it('空白封组合缺价时返回 typed manual，不取相近纸张', () => {
    const result = quoteSingle(
      createGoldenOrderItem({ paperType: '不存在的纸张' }),
    );
    expect(result.items[0]).toMatchObject({
      status: 'MANUAL_PRICING_REQUIRED',
      amount: null,
      knownAmount: '0.00',
    });
    expect(result.manualReasons.map((reason) => reason.code)).toContain(
      'PARTIAL_BLANK_PRICE_NOT_FOUND',
    );
  });
});

describe('calculateCreateOrderQuote · 专版烫金黄金用例', () => {
  it.each(RULE8_FULL_GOLDEN_CASES)(
    '$caseId [$section] $label',
    ({ item: overrides, expected }) => {
      const item = fullItem(overrides);
      const selected = selectFullUnitPrice(
        item,
        CREATE_ORDER_GOLDEN_SNAPSHOT.full,
      );
      const result = quoteSingle(item, { unitsPerBag: 6 });

      expect(result.items[0]?.status).toBe(expected.status);
      if ('manualReason' in expected) {
        expect(result.items[0]?.amount).toBeNull();
        expect(result.manualReasons.map((reason) => reason.code)).toContain(
          expected.manualReason,
        );
        return;
      }
      expect(result.items[0]?.unitPrice).toBe(expected.unitPrice);
      if ('processing' in expected) {
        expect(result.items[0]?.processingAmount).toBe(expected.processing);
      }
      if ('tierCode' in expected) {
        expect(selected?.tierCode).toBe(expected.tierCode);
      }
    },
  );

  it.each([
    ['MID', '中号封', 40_000, 'FULL_30000', '0.1700', '6800.00'],
    ['MID', '中号封', 40_001, 'FULL_50000', '0.1600', '6400.16'],
    ['MID', '中号封', 100_000, 'FULL_50000', '0.1600', '16000.00'],
    ['LARGE', '大号封', 40_000, 'FULL_30000', '0.1900', '7600.00'],
    ['LARGE', '大号封', 40_001, 'FULL_50000', '0.1800', '7200.18'],
    ['LARGE', '大号封', 100_000, 'FULL_50000', '0.1800', '18000.00'],
  ] as const)(
    '5万档 %s %s %i 个命中 %s / %s',
    (pricingGroup, specification, quantity, tierCode, unitPrice, processing) => {
      const item = fullItem({ pricingGroup, specification, quantity });
      const selected = selectFullUnitPrice(
        item,
        CREATE_ORDER_GOLDEN_SNAPSHOT.full,
      );
      const result = quoteSingle(item);

      expect(selected).toMatchObject({ tierCode, unitPrice });
      expect(result.items[0]).toMatchObject({
        status: 'QUOTED',
        unitPrice,
        processingAmount: processing,
      });
    },
  );

  it('纸张与浮雕分项独立，调版费整款只收一次', () => {
    const paper = quoteSingle(
      fullItem({ paperType: '触感纸', paperWeightGsm: 200 }),
      { unitsPerBag: 6 },
    );
    expect(itemLine(paper, 'FULL_PAPER_SURCHARGE').amount).toBe('500.00');

    const relief = quoteSingle(fullItem({ specialEffect: 'RELIEF' }), {
      unitsPerBag: 6,
    });
    expect(
      relief.items[0]?.lines.filter((line) => line.code === 'FULL_SETUP'),
    ).toHaveLength(1);
    expect(itemLine(relief, 'FULL_SETUP').amount).toBe('90.00');
  });

  it('三色返回 typed manual，对应包装组也不计入 knownTotal', () => {
    const result = quoteSingle(
      fullItem({ quantity: 1_000, frontColors: ['哑金', '红金', '银'] }),
      { unitsPerBag: 6 },
    );
    expect(result.excludedManualItemKeys).toEqual(['style-1']);
    expect(packagingLine(result)).toMatchObject({
      amount: '16.70',
      status: 'EXCLUDED_MANUAL',
      includedInKnownTotal: false,
    });
    expect(result.knownTotal).toBe('23.30');
  });

  it.each([
    [
      'CUSTOM_PAPER',
      { configuration: { paper: 'CUSTOM' as const } },
    ],
    [
      'MANUAL_PAPER_WEIGHT',
      { configuration: { paperWeight: 'MANUAL' as const } },
    ],
    [
      'RESIZED',
      { configuration: { specification: 'RESIZED' as const } },
    ],
    [
      'CUSTOM_CRAFT',
      { configuration: { craft: 'CUSTOM' as const } },
    ],
    [
      'FULL_TEN_THOUSAND_ENVELOPE',
      { productStructure: 'TEN_THOUSAND_ENVELOPE' as const },
    ],
  ] as const)('%s 原因均是 typed manual', (code, overrides) => {
    const base = fullItem();
    const configuration =
      'configuration' in overrides
        ? { ...base.configuration, ...overrides.configuration }
        : base.configuration;
    const result = quoteSingle(fullItem({ ...overrides, configuration }));
    expect(result.items[0]?.amount).toBeNull();
    expect(result.manualReasons.map((reason) => reason.code)).toContain(code);
  });
});

describe('calculateCreateOrderQuote · 彩印 PER_ORDER 黄金用例', () => {
  it.each(RULE8_PRINT_GOLDEN_CASES)(
    '$caseId [$section] $label',
    ({ item: overrides, expected }) => {
      const result = quoteSingle(printItem(overrides));
      expect(result.items[0]?.status).toBe(expected.status);
      if ('manualReason' in expected) {
        expect(result.items[0]?.amount).toBeNull();
        expect(result.manualReasons.map((reason) => reason.code)).toContain(
          expected.manualReason,
        );
        return;
      }
      expect(result.items[0]).toMatchObject({
        unitPrice: null,
        processingAmount: expected.processing,
      });
      expect(itemLine(result, 'PRINT_PER_ORDER')).toMatchObject({
        amount: expected.processing,
        basis: {
          pricingModel: 'PER_ORDER',
          actualQuantity: overrides.quantity,
          tierQuantity: expected.tierQuantity,
        },
      });
    },
  );

  it.each([
    [4_999, 4_000, '700.00'],
    [5_000, 5_000, '870.00'],
    [5_001, 5_000, '870.00'],
    [6_000, 5_000, '870.00'],
    [7_000, 5_000, '870.00'],
    [7_001, 10_000, '1520.00'],
    [14_999, 10_000, '1520.00'],
    [15_000, 20_000, '2580.00'],
    [20_000, 20_000, '2580.00'],
  ] as const)(
    '实际数量 %i 选 %i 档，整单金额 %s',
    (quantity, tierQuantity, amount) => {
      const item = printItem({ quantity });
      const selected = selectPrintPerOrderPrice(
        item,
        CREATE_ORDER_GOLDEN_SNAPSHOT.print,
      );
      expect(selected).toMatchObject({ tierQuantity, amount });
      const result = quoteSingle(item);
      expect(itemLine(result, 'PRINT_PER_ORDER').amount).toBe(amount);
    },
  );

  it('20001 个转人工核价', () => {
    const result = quoteSingle(printItem({ quantity: 20_001 }));
    expect(result.items[0]).toMatchObject({
      status: 'MANUAL_PRICING_REQUIRED',
      amount: null,
    });
    expect(result.manualReasons.map((reason) => reason.code)).toContain(
      'PRINT_QUANTITY_OVER_LIMIT',
    );
  });

  it.each([
    [
      '配置外说明',
      () =>
        printItem({
          frontColors: ['哑金'],
          printFoilMode: 'PARTIAL',
          manualPricingReason: '异形制作',
        }),
      'CONFIGURATION_OUTSIDE_NOTE',
    ],
    [
      '非默认覆膜',
      () =>
        printItem({
          frontColors: ['哑金'],
          printFoilMode: 'PARTIAL',
          printFinishing: 'TACTILE',
        }),
      'PRINT_FINISHING_PRICE_NOT_FOUND',
    ],
    [
      '超过自动报价数量',
      () =>
        printItem({
          frontColors: ['哑金'],
          printFoilMode: 'PARTIAL',
          quantity: 20_001,
        }),
      'PRINT_QUANTITY_OVER_LIMIT',
    ],
    [
      '彩印基础价缺档',
      () =>
        printItem({
          frontColors: ['哑金'],
          printFoilMode: 'PARTIAL',
          paperType: '未配置纸张',
        }),
      'PRINT_PRICE_NOT_FOUND',
    ],
    [
      '自定义纸张',
      () => {
        const item = printItem({
          frontColors: ['哑金'],
          printFoilMode: 'PARTIAL',
        });
        return {
          ...item,
          configuration: { ...item.configuration, paper: 'CUSTOM' as const },
        };
      },
      'CUSTOM_PAPER',
    ],
  ] as const)(
    '彩印烫金因%s转人工时统一声明整款价含制版费',
    (_label, createItem, triggeringReason) => {
      const result = quoteSingle(createItem());
      const policyReasons = result.manualReasons.filter(
        (reason) =>
          reason.code === 'PRINT_FOIL_MANUAL_PRICE_INCLUDES_PLATE',
      );

      expect(result.items[0]).toMatchObject({
        status: 'MANUAL_PRICING_REQUIRED',
        amount: null,
      });
      expect(result.manualReasons.map((reason) => reason.code)).toContain(
        triggeringReason,
      );
      expect(policyReasons).toHaveLength(1);
      expect(policyReasons[0]).toMatchObject({
        code: 'PRINT_FOIL_MANUAL_PRICE_INCLUDES_PLATE',
        message:
          '彩印烫金款的人工整款价必须包含制烫金版费，不再另收独立制版费',
      });
      expect(result.order.lines.map((line) => line.code)).not.toContain(
        'PLATE_FEE',
      );
    },
  );

  it.each([
    ['常规报价', {}],
    ['配置外人工报价', { manualPricingReason: '异形制作' }],
  ] as const)(
    '%s不能放过有烫金模式但没有颜色的非法事实',
    (_label, overrides) => {
      const result = quoteSingle(
        printItem({
          ...overrides,
          frontColors: [],
          backColors: [],
          printFoilMode: 'PARTIAL',
        }),
      );

      expect(result.items[0]).toMatchObject({
        status: 'INVALID_INPUT',
        amount: null,
        manualReasons: [],
        errors: ['彩印叠加烫金时必须选择至少一种烫金颜色'],
      });
    },
  );

});

describe('calculateCreateOrderQuote · 规则结构与 no-fallback 契约', () => {
  it('专版西封独立叠加 0.06/个并输出明细行', () => {
    const result = quoteSingle(
      fullItem({
        productStructure: 'WESTERN_ENVELOPE',
        specification: '西封大号',
      }),
      { unitsPerBag: 6 },
    );
    expect(result.items[0]).toMatchObject({
      status: 'QUOTED',
      unitPrice: '0.2800',
      processingAmount: '1400.00',
    });
    expect(itemLine(result, 'FULL_WEST_ENVELOPE')).toMatchObject({
      amount: '300.00',
      basis: { unitSurcharge: '0.0600' },
    });
  });

  it('专版双色独立叠加 0.09/个', () => {
    const result = quoteSingle(
      fullItem({ frontColors: ['哑金', '红金'] }),
      { unitsPerBag: 6 },
    );
    expect(result.items[0]?.unitPrice).toBe('0.3100');
    expect(itemLine(result, 'FULL_SECOND_COLOR').amount).toBe('450.00');
  });

  it('激凸与浮雕同价：0.05/个 + 90 元调版费', () => {
    const result = quoteSingle(fullItem({ specialEffect: 'RAISED' }), {
      unitsPerBag: 6,
    });
    expect(result.items[0]).toMatchObject({
      unitPrice: '0.2700',
      processingAmount: '1440.00',
    });
    expect(itemLine(result, 'FULL_SPECIAL_EFFECT').amount).toBe('250.00');
    expect(itemLine(result, 'FULL_SETUP').amount).toBe('90.00');
  });

  it.each([
    ['杂色珠光', 160, '0.2500', '150.00'],
    ['莱尼纹', 150, '0.2550', '175.00'],
    ['红卡', 180, '0.2450', '125.00'],
    ['红卡', 230, '0.2600', '200.00'],
    ['金葱', 230, '0.3200', '500.00'],
    ['触感纸', 200, '0.3200', '500.00'],
  ] as const)(
    '非基准纸 %s %ig 命中唯一加价行',
    (paperType, paperWeightGsm, unitPrice, surchargeAmount) => {
      const result = quoteSingle(
        fullItem({ paperType, paperWeightGsm }),
        { unitsPerBag: 6 },
      );
      expect(result.items[0]?.unitPrice).toBe(unitPrice);
      expect(itemLine(result, 'FULL_PAPER_SURCHARGE').amount).toBe(
        surchargeAmount,
      );
    },
  );

  it('非基准纸缺加价行转人工，不默认为 0', () => {
    const result = quoteSingle(
      fullItem({ paperType: '冰白纸', paperWeightGsm: 160 }),
      { unitsPerBag: 6 },
    );
    expect(result.items[0]?.status).toBe('MANUAL_PRICING_REQUIRED');
    expect(result.manualReasons.map((reason) => reason.code)).toContain(
      'FULL_PAPER_SURCHARGE_NOT_FOUND',
    );
  });

  it('缺失西封加价时转人工，不吞掉西封分项', () => {
    const snapshot: CreateOrderPriceSnapshot = {
      ...CREATE_ORDER_GOLDEN_SNAPSHOT,
      full: {
        ...CREATE_ORDER_GOLDEN_SNAPSHOT.full,
        westEnvelopeUnitSurcharge: null,
      },
    };
    const result = calculateCreateOrderQuote(
      createGoldenOrderInput([
        fullItem({
          productStructure: 'WESTERN_ENVELOPE',
          specification: '西封大号',
        }),
      ]),
      snapshot,
    );
    expect(result.items[0]?.status).toBe('MANUAL_PRICING_REQUIRED');
    expect(result.manualReasons.map((reason) => reason.code)).toContain(
      'FULL_WEST_ENVELOPE_SURCHARGE_NOT_FOUND',
    );
  });

  it('配置空格与显式 0 元语义不同', () => {
    const baseRow = CREATE_ORDER_GOLDEN_SNAPSHOT.partial.blankUnitPrices[0]!;
    const blankSnapshot: CreateOrderPriceSnapshot = {
      ...CREATE_ORDER_GOLDEN_SNAPSHOT,
      partial: {
        ...CREATE_ORDER_GOLDEN_SNAPSHOT.partial,
        blankUnitPrices: [{ ...baseRow, unitPrice: null }],
      },
    };
    const zeroSnapshot: CreateOrderPriceSnapshot = {
      ...CREATE_ORDER_GOLDEN_SNAPSHOT,
      partial: {
        ...CREATE_ORDER_GOLDEN_SNAPSHOT.partial,
        blankUnitPrices: [{ ...baseRow, unitPrice: '0' }],
      },
    };
    const input = createGoldenOrderInput([createGoldenOrderItem()]);
    const blank = calculateCreateOrderQuote(input, blankSnapshot);
    const zero = calculateCreateOrderQuote(input, zeroSnapshot);

    expect(blank.items[0]?.status).toBe('MANUAL_PRICING_REQUIRED');
    expect(blank.items[0]?.amount).toBeNull();
    expect(zero.items[0]).toMatchObject({
      status: 'QUOTED',
      unitPrice: '0.0000',
      processingAmount: '40.00',
    });
    expect(itemLine(zero, 'PARTIAL_BLANK').amount).toBe('0.00');
  });

  it('重复的唯一键规则行转人工，不取第一条', () => {
    const first = CREATE_ORDER_GOLDEN_SNAPSHOT.partial.blankUnitPrices[0]!;
    const snapshot: CreateOrderPriceSnapshot = {
      ...CREATE_ORDER_GOLDEN_SNAPSHOT,
      partial: {
        ...CREATE_ORDER_GOLDEN_SNAPSHOT.partial,
        blankUnitPrices: [first, { ...first, unitPrice: '9.9999' }],
      },
    };
    const result = calculateCreateOrderQuote(
      createGoldenOrderInput([createGoldenOrderItem()]),
      snapshot,
    );
    expect(result.items[0]?.status).toBe('MANUAL_PRICING_REQUIRED');
    expect(result.items[0]?.amount).toBeNull();
  });

  it('基准纸与加价纸规则冲突时转人工，不重复叠加', () => {
    const snapshot: CreateOrderPriceSnapshot = {
      ...CREATE_ORDER_GOLDEN_SNAPSHOT,
      full: {
        ...CREATE_ORDER_GOLDEN_SNAPSHOT.full,
        paperSurcharges: [
          ...CREATE_ORDER_GOLDEN_SNAPSHOT.full.paperSurcharges,
          {
            paperType: '珠光艳闪',
            paperWeightGsm: 160,
            unitSurcharge: '9.9999',
          },
        ],
      },
    };

    const result = calculateCreateOrderQuote(
      createGoldenOrderInput([fullItem()]),
      snapshot,
    );

    expect(result.items[0]).toMatchObject({
      status: 'MANUAL_PRICING_REQUIRED',
      amount: null,
    });
    expect(result.manualReasons.map((reason) => reason.code)).toContain(
      'FULL_PAPER_SURCHARGE_NOT_FOUND',
    );
  });

  it('专版基础价与纸张加价之和超过单价列上限时失败关闭', () => {
    const snapshot: CreateOrderPriceSnapshot = {
      ...CREATE_ORDER_GOLDEN_SNAPSHOT,
      full: {
        ...CREATE_ORDER_GOLDEN_SNAPSHOT.full,
        unitPrices: [
          {
            tierCode: 'UNIT_OVERFLOW_BASE',
            pricingGroup: 'LARGE',
            minQuantity: 1,
            maxQuantity: null,
            unitPrice: '600000.0000',
          },
        ],
        paperSurcharges: [
          {
            paperType: '触感纸',
            paperWeightGsm: 200,
            unitSurcharge: '600000.0000',
          },
        ],
      },
    };

    const result = calculateCreateOrderQuote(
      createGoldenOrderInput([
        fullItem({
          quantity: 1,
          paperType: '触感纸',
          paperWeightGsm: 200,
        }),
      ]),
      snapshot,
    );

    expect(result).toMatchObject({ status: 'INVALID_INPUT', submittable: false });
    expect(result.items[0]).toMatchObject({
      status: 'INVALID_INPUT',
      unitPrice: null,
      amount: null,
    });
    expect(result.items[0]?.errors).toContain(
      '专版烫金组合单价超过可保存上限',
    );
  });

  it('专版阶梯端点非法时转人工，不把负起点当有效区间', () => {
    const snapshot: CreateOrderPriceSnapshot = {
      ...CREATE_ORDER_GOLDEN_SNAPSHOT,
      full: {
        ...CREATE_ORDER_GOLDEN_SNAPSHOT.full,
        unitPrices: [
          {
            tierCode: 'BROKEN_RANGE',
            pricingGroup: 'LARGE',
            minQuantity: -1,
            maxQuantity: null,
            unitPrice: '0.01',
          },
        ],
      },
    };

    const result = calculateCreateOrderQuote(
      createGoldenOrderInput([fullItem()]),
      snapshot,
    );

    expect(result.items[0]).toMatchObject({
      status: 'MANUAL_PRICING_REQUIRED',
      amount: null,
    });
    expect(result.manualReasons.map((reason) => reason.code)).toContain(
      'FULL_PRICE_NOT_FOUND',
    );
  });

  it('彩印烫金含版费套餐与基础价合计越界时失败关闭', () => {
    const target = CREATE_ORDER_GOLDEN_SNAPSHOT.print.foilPerOrderPrices.find(
      (row) =>
        row.mode === 'PARTIAL' &&
        row.foilPassCount === 1 &&
        row.tierQuantity === 1_000,
    )!;
    const snapshot: CreateOrderPriceSnapshot = {
      ...CREATE_ORDER_GOLDEN_SNAPSHOT,
      print: {
        ...CREATE_ORDER_GOLDEN_SNAPSHOT.print,
        perOrderPrices: CREATE_ORDER_GOLDEN_SNAPSHOT.print.perOrderPrices.map(
          (row) =>
            row.paperType === '铜版纸' && row.tierQuantity === 1_000
              ? { ...row, amount: '6000000000.00' }
              : row,
        ),
        foilPerOrderPrices:
          CREATE_ORDER_GOLDEN_SNAPSHOT.print.foilPerOrderPrices.map((row) =>
            row === target ? { ...row, amount: '6000000000.00' } : row,
          ),
      },
    };

    const result = calculateCreateOrderQuote(
      createGoldenOrderInput([
        printItem({ frontColors: ['哑金'], printFoilMode: 'PARTIAL' }),
      ]),
      snapshot,
    );

    expect(result).toMatchObject({ status: 'INVALID_INPUT', submittable: false });
    expect(result.items[0]).toMatchObject({
      status: 'INVALID_INPUT',
      amount: null,
      knownAmount: '0.00',
    });
    expect(result.items[0]?.errors).toEqual([
      '彩印加工费合计超过可保存上限',
    ]);
  });

  it('多款金额各自可保存但整单已知合计越界时不可提交', () => {
    const snapshot: CreateOrderPriceSnapshot = {
      ...CREATE_ORDER_GOLDEN_SNAPSHOT,
      print: {
        ...CREATE_ORDER_GOLDEN_SNAPSHOT.print,
        perOrderPrices: CREATE_ORDER_GOLDEN_SNAPSHOT.print.perOrderPrices.map(
          (row) =>
            row.paperType === '铜版纸' && row.tierQuantity === 1_000
              ? { ...row, amount: '6000000000.00' }
              : row,
        ),
      },
      bagging: { standardPerBag: '0', mixedPerBag: '0' },
    };
    const first = printItem({ itemKey: 'style-1', fig: 1 });
    const second = printItem({ itemKey: 'style-2', fig: 2 });

    const result = calculateCreateOrderQuote(
      {
        ...createGoldenOrderInput([first, second], { isSfCollect: true }),
        includeOrderCharges: false,
      },
      snapshot,
    );

    expect(result).toMatchObject({
      status: 'INVALID_INPUT',
      submittable: false,
      total: null,
    });
    expect(result.errors).toContain('整单已知金额合计超过可保存上限');
  });

  it('损坏快照中的入袋费率超过列上限时失败关闭', () => {
    const snapshot: CreateOrderPriceSnapshot = {
      ...CREATE_ORDER_GOLDEN_SNAPSHOT,
      bagging: {
        standardPerBag: '1200000.0000',
        mixedPerBag: '1200000.0000',
      },
    };
    const result = calculateCreateOrderQuote(
      createGoldenOrderInput([createGoldenOrderItem()]),
      snapshot,
    );

    expect(result).toMatchObject({ status: 'INVALID_INPUT', submittable: false });
    expect(result.packagingGroups[0]).toMatchObject({
      status: 'INVALID_INPUT',
      amount: null,
      errors: ['入袋费率超过可保存上限'],
    });
  });

  it('彩印单色烫金命中明确档位时按含版费原子套餐计价，不再生成独立制版费', () => {
    const result = quoteSingle(
      printItem({
        frontColors: ['哑金'],
        printFoilMode: 'PARTIAL',
      }),
    );
    expect(result.items[0]).toMatchObject({
      status: 'QUOTED',
      processingAmount: '510.00',
      amount: '510.00',
      knownAmount: '510.00',
    });
    expect(itemLine(result, 'PRINT_FOIL_PER_ORDER')).toMatchObject({
      amount: '200.00',
      includedInKnownTotal: true,
      basis: {
        pricingPolicy: 'ATOMIC_BUNDLE_INCLUDES_PLATE',
        plateTreatment: 'INCLUDED_IN_ATOMIC_BUNDLE',
        passCount: 1,
        tierQuantity: 1_000,
      },
    });
    expect(result.manualReasons).toEqual([]);
    expect(result.order.lines.map((line) => line.code)).not.toContain(
      'PLATE_FEE',
    );
    expect(result.pendingReasons.map((reason) => reason.code)).not.toContain(
      'PLATE_AMOUNT_PENDING',
    );
  });

  it('彩印原子套餐与普通烫金混合时，只为普通烫金生成一条独立制版费', () => {
    const printBundle = printItem({
      itemKey: 'print-bundle',
      fig: 1,
      frontColors: ['哑金'],
      printFoilMode: 'PARTIAL',
    });
    const partial = createGoldenOrderItem({
      itemKey: 'partial-foil',
      fig: 2,
    });

    const result = calculateCreateOrderQuote(
      createGoldenOrderInput([printBundle, partial]),
      CREATE_ORDER_GOLDEN_SNAPSHOT,
    );

    expect(
      result.items
        .flatMap((item) => item.lines)
        .filter((line) => line.code === 'PRINT_FOIL_PER_ORDER'),
    ).toHaveLength(1);
    expect(
      result.order.lines.filter((line) => line.code === 'PLATE_FEE'),
    ).toHaveLength(1);
    expect(result.pendingReasons).toContainEqual(
      expect.objectContaining({ code: 'PLATE_AMOUNT_PENDING' }),
    );
  });

  it('彩印烫金套餐明确 0 元可报价，空值或缺少 policy 则转人工且不伪造制版费', () => {
    const target = CREATE_ORDER_GOLDEN_SNAPSHOT.print.foilPerOrderPrices.find(
      (row) =>
        row.mode === 'PARTIAL' &&
        row.foilPassCount === 1 &&
        row.tierQuantity === 1_000,
    )!;
    const otherRows = CREATE_ORDER_GOLDEN_SNAPSHOT.print.foilPerOrderPrices.filter(
      (row) => row !== target,
    );
    const snapshotFor = (amount: string | null): CreateOrderPriceSnapshot => ({
      ...CREATE_ORDER_GOLDEN_SNAPSHOT,
      print: {
        ...CREATE_ORDER_GOLDEN_SNAPSHOT.print,
        foilPerOrderPrices: [...otherRows, { ...target, amount }],
      },
    });
    const input = createGoldenOrderInput([
      printItem({ frontColors: ['哑金'], printFoilMode: 'PARTIAL' }),
    ]);
    const zero = calculateCreateOrderQuote(input, snapshotFor('0'));
    const blank = calculateCreateOrderQuote(input, snapshotFor(null));
    const legacyWithoutPolicy = calculateCreateOrderQuote(input, {
      ...snapshotFor('200.00'),
      print: {
        ...snapshotFor('200.00').print,
        foilPricingPolicy: undefined,
      },
    } as unknown as CreateOrderPriceSnapshot);
    expect(zero.items[0]).toMatchObject({
      status: 'QUOTED',
      amount: '310.00',
    });
    expect(itemLine(zero, 'PRINT_FOIL_PER_ORDER').amount).toBe('0.00');
    expect(blank.items[0]?.status).toBe('MANUAL_PRICING_REQUIRED');
    expect(legacyWithoutPolicy.items[0]?.status).toBe(
      'MANUAL_PRICING_REQUIRED',
    );
    for (const quote of [zero, blank, legacyWithoutPolicy]) {
      expect(quote.order.lines.map((line) => line.code)).not.toContain(
        'PLATE_FEE',
      );
    }
    expect(blank.manualReasons).toContainEqual(
      expect.objectContaining({ code: 'PRINT_FOIL_PRICE_NOT_FOUND' }),
    );
    expect(legacyWithoutPolicy.manualReasons).toContainEqual(
      expect.objectContaining({ code: 'PRINT_FOIL_PRICE_NOT_FOUND' }),
    );
  });

  it('触感纸方形、万元封局部烫金均不会偷取相近 SKU', () => {
    const tactileSquare = quoteSingle(
      createGoldenOrderItem({
        paperType: '触感纸',
        paperWeightGsm: 200,
        specification: '方形封',
      }),
    );
    const tenThousand = quoteSingle(
      createGoldenOrderItem({ productStructure: 'TEN_THOUSAND_ENVELOPE' }),
    );
    expect(tactileSquare.items[0]?.status).toBe('MANUAL_PRICING_REQUIRED');
    expect(tenThousand.manualReasons.map((reason) => reason.code)).toContain(
      'PARTIAL_TEN_THOUSAND_ENVELOPE',
    );
  });

  it('彩印非默认覆膜加价待定，转人工不兜底', () => {
    const result = quoteSingle(printItem({ printFinishing: 'TACTILE' }));
    expect(result.items[0]?.status).toBe('MANUAL_PRICING_REQUIRED');
    expect(result.manualReasons.map((reason) => reason.code)).toContain(
      'PRINT_FINISHING_PRICE_NOT_FOUND',
    );
  });

  it('150g 莱尼纹物流重量按版本化的 6g/个计算', () => {
    const result = quoteSingle(
      fullItem({
        quantity: 2_000,
        paperType: '莱尼纹',
        paperWeightGsm: 150,
      }),
      { province: '上海', unitsPerBag: 6 },
    );
    expect(orderLine(result, 'SHIPPING:primary').basis).toMatchObject({
      netWeightGrams: '12000',
      billableWeightKg: '12',
      weightSource: 'SERVER_ESTIMATE',
    });
  });
});

describe('calculateCreateOrderQuote · 入袋、纸箱与快递', () => {
  it('包装组 unitsPerBag 为 null 时入袋待定，已知加工费不当 0', () => {
    const result = quoteSingle(createGoldenOrderItem(), {
      unitsPerBag: null,
    });
    expect(result.items[0]).toMatchObject({
      status: 'QUOTED',
      processingAmount: '170.00',
      amount: '170.00',
      knownAmount: '170.00',
    });
    expect(packagingLine(result)).toMatchObject({
      status: 'PENDING_AMOUNT',
      amount: null,
      basis: { bagCount: null, displayAmount: '—' },
    });
    expect(result.status).toBe('PARTIAL');
    expect(result.pendingReasons.map((reason) => reason.code)).toContain(
      'BAGGING_INPUT_PENDING',
    );
  });

  it('混装按 0.2 元/袋，常规按 0.1 元/袋', () => {
    const standard = quoteSingle(createGoldenOrderItem());
    const first = createGoldenOrderItem({ itemKey: 'style-1', fig: 1 });
    const second = createGoldenOrderItem({ itemKey: 'style-2', fig: 2 });
    const mixed = calculateCreateOrderQuote(
      createGoldenOrderInput([first, second], {
        packagingGroups: [
          {
            groupKey: 'mixed-1',
            mode: 'MIXED_STYLE',
            items: [
              { itemKey: 'style-1', unitsPerBag: 10 },
              { itemKey: 'style-2', unitsPerBag: 10 },
            ],
          },
        ],
      }),
      CREATE_ORDER_GOLDEN_SNAPSHOT,
    );
    expect(packagingLine(standard).amount).toBe('10.00');
    expect(mixed.packagingGroups[0]?.line.amount).toBe('20.00');
  });

  it.each(RULE8_CARTON_GOLDEN_CASES)(
    '$caseId [$section] $label',
    ({ quantity, amount }) => {
    const result = quoteSingle(createGoldenOrderItem({ quantity }));
    expect(orderLine(result, 'CARTON')).toMatchObject({
      amount,
      basis: { granularity: 'PER_ORDER', totalQuantity: quantity },
    });
    },
  );

  it.each(RULE8_SHIPPING_GOLDEN_CASES)(
    '$caseId [$section] $label',
    ({ kind, province, amount }) => {
    const item =
      kind === 'WEIGHT_180'
        ? createGoldenOrderItem({
            quantity: 2_000,
            paperType: '红卡',
            paperWeightGsm: 180,
          })
        : createGoldenOrderItem({
            quantity: kind === 'FREIGHT_PENDING' ? 2_001 : 2_000,
          });
    const result = quoteSingle(
      item,
      { province, isSfCollect: kind === 'SF_COLLECT' },
    );
    expect(orderLine(result, 'SHIPPING:primary')).toMatchObject({
      amount,
      status: kind === 'FREIGHT_PENDING' ? 'PENDING_AMOUNT' : 'QUOTED',
    });
    if (kind === 'REGION') {
      expect(orderLine(result, 'SHIPPING:primary').basis).toMatchObject({
        billableWeightKg: '12',
        weightSource: 'SERVER_ESTIMATE',
      });
    } else if (kind === 'WEIGHT_180') {
      expect(orderLine(result, 'SHIPPING:primary').basis).toMatchObject({
        netWeightGrams: '13500',
        billableWeightKg: '14',
      });
    } else if (kind === 'FREIGHT_PENDING') {
      expect(orderLine(result, 'SHIPPING:primary').errors.join('；')).toContain(
        '改走物流',
      );
      expect(orderLine(result, 'CARTON').amount).toBe('7.00');
      expect(result.pendingReasons.map((reason) => reason.code)).toContain(
        'FREIGHT_QUOTE_PENDING',
      );
    } else {
      expect(orderLine(result, 'SHIPPING:primary').basis).toMatchObject({
        isSfCollect: true,
      });
      expect(orderLine(result, 'CARTON').amount).toBe('5.00');
    }
    },
  );

  it('多款订单只生成一条纸箱、一条制版待定，快递按 shipment 计一次', () => {
    const first = createGoldenOrderItem({
      itemKey: 'style-1',
      fig: 1,
      quantity: 500,
    });
    const second = createGoldenOrderItem({
      itemKey: 'style-2',
      fig: 2,
      quantity: 500,
    });
    const result = calculateCreateOrderQuote(
      createGoldenOrderInput([first, second]),
      CREATE_ORDER_GOLDEN_SNAPSHOT,
    );
    expect(result.order.lines.filter((line) => line.code === 'CARTON')).toHaveLength(1);
    expect(result.order.lines.filter((line) => line.code === 'PLATE_FEE')).toHaveLength(1);
    expect(result.order.lines.filter((line) => line.code.startsWith('SHIPPING:'))).toHaveLength(1);
    expect(result.order.lines.find((line) => line.code === 'CARTON')?.amount).toBe('3.00');
  });

  it('6 款 × 1000 个的纸箱按整单 6000 个计 11 元，不按款重复', () => {
    const items = Array.from({ length: 6 }, (_, index) =>
      createGoldenOrderItem({
        itemKey: `style-${index + 1}`,
        fig: index + 1,
        quantity: 1_000,
      }),
    );
    const result = calculateCreateOrderQuote(
      createGoldenOrderInput(items),
      CREATE_ORDER_GOLDEN_SNAPSHOT,
    );
    expect(result.order.lines.filter((line) => line.code === 'CARTON')).toHaveLength(1);
    expect(orderLine(result, 'CARTON')).toMatchObject({
      amount: '11.00',
      basis: { totalQuantity: 6_000 },
    });
  });

  it('制烫金版费待定时保留已知合计，但阻断完整总价', () => {
    const result = quoteSingle(createGoldenOrderItem());
    expect(orderLine(result, 'PLATE_FEE')).toMatchObject({
      status: 'PENDING_AMOUNT',
      amount: null,
      includedInKnownTotal: false,
      basis: { displayAmount: '待定', granularity: 'PER_ORDER' },
    });
    expect(result.status).toBe('PARTIAL');
    expect(result.total).toBeNull();
    expect(Number(result.knownTotal)).toBeGreaterThan(0);
    expect(result.pendingLineCodes).toContain('PLATE_FEE');
    expect(result.pendingReasons.map((reason) => reason.code)).toContain(
      'PLATE_AMOUNT_PENDING',
    );
  });

  it('纯彩印无烫金事实时不生成制版费，也不因此阻断完整总价', () => {
    const result = quoteSingle(printItem());

    expect(result.items[0]?.status).toBe('QUOTED');
    expect(result.order.lines.some((line) => line.code === 'PLATE_FEE')).toBe(
      false,
    );
    expect(result.pendingLineCodes).not.toContain('PLATE_FEE');
    expect(result.pendingReasons.map((reason) => reason.code)).not.toContain(
      'PLATE_AMOUNT_PENDING',
    );
    expect(result.status).toBe('QUOTED');
    expect(result.total).toBe(result.knownTotal);
  });

  it('即使历史快照携带制版费规则金额也始终转管理员人工核价', () => {
    const legacySnapshot = {
      ...CREATE_ORDER_GOLDEN_SNAPSHOT,
      plate: {
        ...CREATE_ORDER_GOLDEN_SNAPSHOT.plate,
        configuredRule: {
          code: 'LEGACY_PLATE_FEE_PER_ORDER',
          amount: '999.99',
        },
      },
    } as unknown as CreateOrderPriceSnapshot;
    const snapshotBeforeQuote = JSON.stringify(legacySnapshot);
    const input = createGoldenOrderInput([createGoldenOrderItem()]);
    const baseline = calculateCreateOrderQuote(
      input,
      CREATE_ORDER_GOLDEN_SNAPSHOT,
    );
    const result = calculateCreateOrderQuote(input, legacySnapshot);

    expect(orderLine(result, 'PLATE_FEE')).toMatchObject({
      status: 'PENDING_AMOUNT',
      amount: null,
      includedInKnownTotal: false,
      basis: {
        displayAmount: '待定',
        granularity: 'PER_ORDER',
        pricingPolicy: 'ADMIN_MANUAL_ONLY',
      },
    });
    expect(result.knownTotal).toBe(baseline.knownTotal);
    expect(result.pendingReasons).toContainEqual({
      code: 'PLATE_AMOUNT_PENDING',
      message: '制烫金版费金额待管理员人工核价',
    });
    expect(JSON.stringify(legacySnapshot)).toBe(snapshotBeforeQuote);
  });

  it('多款整单数量超出安全整数时直接拒绝', () => {
    const first = createGoldenOrderItem({
      itemKey: 'style-1',
      fig: 1,
      quantity: Number.MAX_SAFE_INTEGER,
    });
    const second = createGoldenOrderItem({
      itemKey: 'style-2',
      fig: 2,
      quantity: Number.MAX_SAFE_INTEGER,
    });
    const zeroSnapshot: CreateOrderPriceSnapshot = {
      ...CREATE_ORDER_GOLDEN_SNAPSHOT,
      partial: {
        ...CREATE_ORDER_GOLDEN_SNAPSHOT.partial,
        blankUnitPrices:
          CREATE_ORDER_GOLDEN_SNAPSHOT.partial.blankUnitPrices.map((row) => ({
            ...row,
            unitPrice: '0',
          })),
        machineFee: {
          ...CREATE_ORDER_GOLDEN_SNAPSHOT.partial.machineFee,
          perPiecePerPass: '0',
        },
      },
      bagging: { standardPerBag: '0', mixedPerBag: '0' },
    };

    const result = calculateCreateOrderQuote(
      createGoldenOrderInput([first, second], { isSfCollect: true }),
      zeroSnapshot,
    );

    expect(result).toMatchObject({ status: 'INVALID_INPUT', submittable: false });
    expect(result.errors).toContain('整单总数量必须是大于 0 的安全整数');
  });
});

describe('calculateCreateOrderQuote · 纯函数与层级契约', () => {
  it('最新真值文档 §8 共 42 个唯一 caseId', () => {
    const allCases = [
      ...RULE8_PARTIAL_GOLDEN_CASES,
      ...RULE8_FULL_GOLDEN_CASES,
      ...RULE8_PRINT_GOLDEN_CASES,
      ...RULE8_CARTON_GOLDEN_CASES,
      ...RULE8_SHIPPING_GOLDEN_CASES,
    ];
    expect(RULE8_GOLDEN_CASE_COUNT).toBe(42);
    expect(new Set(allCases.map((fixture) => fixture.caseId)).size).toBe(42);
    expect(allCases.every((fixture) => fixture.section === '§8')).toBe(true);
  });

  it('同一 input + snapshot 重复执行产生完全相同的结果', () => {
    const input = createGoldenOrderInput([createGoldenOrderItem()]);
    const first = calculateCreateOrderQuote(
      input,
      CREATE_ORDER_GOLDEN_SNAPSHOT,
    );
    const second = calculateCreateOrderQuote(
      input,
      CREATE_ORDER_GOLDEN_SNAPSHOT,
    );
    expect(second).toEqual(first);
    expect(JSON.stringify(second)).not.toContain('quotedAt');
  });

  it('输出保留 processing/logistics 双版本证据，不压成单字符串', () => {
    const result = quoteSingle(createGoldenOrderItem());
    expect(result.priceVersion).toEqual(
      CREATE_ORDER_GOLDEN_SNAPSHOT.priceVersion,
    );
    expect(result.priceVersion.processing.id).not.toBe(
      result.priceVersion.logistics.id,
    );
    expect(result.priceVersion.processing.sourceSha256).toMatch(/^[a-f\d]{64}$/u);
    expect(result.priceVersion.logistics.sourceSha256).toMatch(/^[a-f\d]{64}$/u);
  });

  it('未归入包装组的款式显式返回入袋待定', () => {
    const result = calculateCreateOrderQuote(
      {
        ...createGoldenOrderInput([createGoldenOrderItem()]),
        packagingGroups: [],
      },
      CREATE_ORDER_GOLDEN_SNAPSHOT,
    );
    expect(result.packagingGroups[0]).toMatchObject({
      groupKey: 'UNASSIGNED:style-1',
      status: 'PENDING_AMOUNT',
      amount: null,
    });
    expect(result.status).toBe('PARTIAL');
  });

  it('款级明细和订单级明细不混层', () => {
    const result = quoteSingle(createGoldenOrderItem());
    expect(result.items[0]?.lines.every((line) => line.layer === 'ITEM')).toBe(true);
    expect(result.order.lines.every((line) => line.layer === 'ORDER')).toBe(true);
    expect(
      result.packagingGroups.every(
        (group) => group.line.layer === 'PACKAGING_GROUP',
      ),
    ).toBe(true);
    expect(result.items[0]?.lines.map((line) => line.code)).toEqual([
      'PARTIAL_BLANK',
      'PARTIAL_MACHINE',
    ]);
    expect(result.packagingGroups.map((group) => group.line.code)).toEqual([
      'BAGGING',
    ]);
    expect(result.order.lines.map((line) => line.code)).toEqual([
      'CARTON',
      'SHIPPING:primary',
      'PLATE_FEE',
    ]);
  });
});
