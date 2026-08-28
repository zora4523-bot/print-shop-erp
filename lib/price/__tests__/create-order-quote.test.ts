import { describe, expect, it } from 'vitest';
import {
  calculateCreateOrderQuote,
  selectFullUnitPrice,
  selectPartialUnitPrice,
  selectPrintPerOrderPrice,
  type CreateOrderQuoteItemInput,
  type CreateOrderQuoteLine,
} from '../create-order';
import {
  CREATE_ORDER_GOLDEN_SNAPSHOT,
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
    packRaw: '6个装',
    pack: 6,
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
  it.each([
    {
      label: '999 个正1色',
      quantity: 999,
      frontColors: ['哑金'],
      backColors: [] as string[],
      blank: '129.87',
      machine: '40.00',
      bagging: '10.00',
      total: '179.87',
    },
    {
      label: '1000 个正1色',
      quantity: 1_000,
      frontColors: ['哑金'],
      backColors: [] as string[],
      blank: '130.00',
      machine: '40.00',
      bagging: '10.00',
      total: '180.00',
    },
    {
      label: '1000 个正2色',
      quantity: 1_000,
      frontColors: ['哑金', '红金'],
      backColors: [] as string[],
      blank: '130.00',
      machine: '80.00',
      bagging: '10.00',
      total: '220.00',
    },
    {
      label: '1000 个正1反1，同色也是两次过版',
      quantity: 1_000,
      frontColors: ['哑金'],
      backColors: ['哑金'],
      blank: '130.00',
      machine: '80.00',
      bagging: '10.00',
      total: '220.00',
    },
    {
      label: '1000 个正3色',
      quantity: 1_000,
      frontColors: ['哑金', '红金', '银'],
      backColors: [] as string[],
      blank: '130.00',
      machine: '120.00',
      bagging: '10.00',
      total: '260.00',
    },
  ])('$label', ({ quantity, frontColors, backColors, blank, machine, bagging, total }) => {
    const result = quoteSingle(
      createGoldenOrderItem({ quantity, frontColors, backColors }),
    );

    expect(result.items[0]).toMatchObject({
      status: 'QUOTED',
      unitPrice: '0.1300',
      processingAmount: `${Number(blank) + Number(machine)}`.includes('.')
        ? (Number(blank) + Number(machine)).toFixed(2)
        : `${Number(blank) + Number(machine)}.00`,
      baggingAmount: bagging,
      amount: total,
    });
    expect(itemLine(result, 'PARTIAL_BLANK').amount).toBe(blank);
    expect(itemLine(result, 'PARTIAL_MACHINE').amount).toBe(machine);
    expect(itemLine(result, 'BAGGING').amount).toBe(bagging);
  });

  it('PARTIAL selector is an explicit SKU unit-price selector', () => {
    const item = createGoldenOrderItem();
    expect(
      selectPartialUnitPrice(item, CREATE_ORDER_GOLDEN_SNAPSHOT.partial),
    ).toMatchObject({ unitPrice: '0.1300' });
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
  it('珠光160大号 5000 个单色为 0.22/个', () => {
    const result = quoteSingle(fullItem());
    expect(result.items[0]).toMatchObject({
      unitPrice: '0.2200',
      processingAmount: '1100.00',
      baggingAmount: '83.40',
      amount: '1183.40',
    });
  });

  it('触感200在 0.22 上叠加 0.10/个', () => {
    const result = quoteSingle(
      fullItem({ paperType: '触感纸', paperWeightGsm: 200 }),
    );
    expect(result.items[0]).toMatchObject({
      unitPrice: '0.3200',
      processingAmount: '1600.00',
      amount: '1683.40',
    });
    expect(itemLine(result, 'FULL_PAPER_SURCHARGE').amount).toBe('500.00');
  });

  it('浮雕叠加 0.05/个，调版费 90 元整款只收一次', () => {
    const result = quoteSingle(fullItem({ specialEffect: 'RELIEF' }));
    expect(result.items[0]).toMatchObject({
      unitPrice: '0.2700',
      processingAmount: '1440.00',
      amount: '1523.40',
    });
    expect(result.items[0]?.lines.filter((line) => line.code === 'FULL_SETUP')).toHaveLength(1);
    expect(itemLine(result, 'FULL_SETUP').amount).toBe('90.00');
  });

  it('三色返回 typed manual，该款全部金额不计入 knownTotal', () => {
    const result = quoteSingle(
      fullItem({
        quantity: 1_000,
        frontColors: ['哑金', '红金', '银'],
      }),
    );
    expect(result.items[0]).toMatchObject({
      status: 'MANUAL_PRICING_REQUIRED',
      amount: null,
      knownAmount: '0.00',
    });
    expect(result.excludedManualItemKeys).toEqual(['style-1']);
    expect(result.manualReasons.map((reason) => reason.code)).toContain(
      'FULL_THREE_OR_MORE_COLORS',
    );
    expect(itemLine(result, 'BAGGING')).toMatchObject({
      amount: '16.70',
      status: 'EXCLUDED_MANUAL',
      includedInKnownTotal: false,
    });
    // 1000 个的纸箱 3.00 + 上海 6kg 快递 20.30；不含人工款、入袋与版费。
    expect(result.knownTotal).toBe('23.30');
  });

  it.each([
    [1, 'LARGE', '0.5200'],
    [750, 'LARGE', '0.5200'],
    [751, 'LARGE', '0.3250'],
    [4_500, 'LARGE', '0.2450'],
    [4_501, 'LARGE', '0.2200'],
    [7_500, 'LARGE', '0.2200'],
    [7_501, 'LARGE', '0.2000'],
    [25_000, 'LARGE', '0.1900'],
    [25_001, 'LARGE', '0.1900'],
    [40_000, 'LARGE', '0.1900'],
    [40_001, 'LARGE', '0.1800'],
    [40_000, 'MID', '0.1700'],
    [40_001, 'MID', '0.1600'],
  ] as const)(
    '实际数量 %i、%s 组命中 %s（无起订量）',
    (quantity, pricingGroup, expected) => {
      const item = fullItem({ quantity, pricingGroup });
      const selected = selectFullUnitPrice(
        item,
        CREATE_ORDER_GOLDEN_SNAPSHOT.full,
      );
      expect(selected?.unitPrice).toBe(expected);
      expect(quoteSingle(item).items[0]?.unitPrice).toBe(expected);
    },
  );

  it.each([
    ['CUSTOM_PAPER', { customPaper: true }],
    ['MANUAL_PAPER_WEIGHT', { paperWeightSource: 'MANUAL' as const }],
    ['RESIZED', { isResized: true }],
    [
      'FULL_TEN_THOUSAND_ENVELOPE',
      { productStructure: 'TEN_THOUSAND_ENVELOPE' as const },
    ],
  ] as const)('%s 原因均是 typed manual', (code, overrides) => {
    const result = quoteSingle(fullItem(overrides));
    expect(result.items[0]?.amount).toBeNull();
    expect(result.manualReasons.map((reason) => reason.code)).toContain(code);
  });
});

describe('calculateCreateOrderQuote · 彩印 PER_ORDER 黄金用例', () => {
  it('1000 个总价 310，不乘数量', () => {
    const result = quoteSingle(printItem());
    expect(result.items[0]).toMatchObject({
      unitPrice: null,
      processingAmount: '310.00',
    });
    expect(itemLine(result, 'PRINT_PER_ORDER')).toMatchObject({
      amount: '310.00',
      basis: {
        pricingModel: 'PER_ORDER',
        actualQuantity: 1_000,
        tierQuantity: 1_000,
      },
    });
  });

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

  it('冰白160中号 2000 档配置为空，不向下偷取 1000 档', () => {
    const result = quoteSingle(
      printItem({
        paperType: '冰白纸',
        paperWeightGsm: 160,
        specification: '中号封',
        quantity: 2_000,
      }),
    );
    expect(result.items[0]?.amount).toBeNull();
    expect(result.manualReasons.map((reason) => reason.code)).toContain(
      'PRINT_PRICE_NOT_FOUND',
    );
  });
});

describe('calculateCreateOrderQuote · 入袋、纸箱与快递', () => {
  it('pack 为 null 时入袋金额和款级总额均为 null，不按 0 计', () => {
    const result = quoteSingle(
      createGoldenOrderItem({ packRaw: '客户未说', pack: null }),
    );
    expect(result.items[0]).toMatchObject({
      status: 'PARTIAL',
      processingAmount: '170.00',
      baggingAmount: null,
      amount: null,
      knownAmount: '170.00',
    });
    expect(itemLine(result, 'BAGGING')).toMatchObject({
      status: 'PENDING',
      amount: null,
      basis: { pack: null, displayAmount: '—' },
    });
  });

  it('混装按 0.2 元/袋，常规按 0.1 元/袋', () => {
    const standard = quoteSingle(createGoldenOrderItem());
    const mixed = quoteSingle(
      createGoldenOrderItem({ packagingMode: 'MIXED' }),
    );
    expect(itemLine(standard, 'BAGGING').amount).toBe('10.00');
    expect(itemLine(mixed, 'BAGGING').amount).toBe('20.00');
  });

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
  ] as const)('整单 %i 个的纸箱费为 %s', (quantity, expected) => {
    const result = quoteSingle(createGoldenOrderItem({ quantity }));
    expect(orderLine(result, 'CARTON')).toMatchObject({
      amount: expected,
      basis: { granularity: 'PER_ORDER', totalQuantity: quantity },
    });
  });

  it.each([
    ['广东', '19.30'],
    ['上海', '41.30'],
    ['云南', '52.30'],
    ['甘肃', '126.60'],
    ['新疆', '128.60'],
  ] as const)('2000 个 160g 服务端推导 12kg，%s 运费 %s', (province, expected) => {
    const result = quoteSingle(
      createGoldenOrderItem({ quantity: 2_000 }),
      { province },
    );
    expect(orderLine(result, 'SHIPPING:primary')).toMatchObject({
      amount: expected,
      status: 'QUOTED',
      basis: {
        billableWeightKg: '12',
        weightSource: 'SERVER_ESTIMATE',
      },
    });
  });

  it('2000 个 180g 净重 13.5kg，向上计 14kg，上海 48.30', () => {
    const result = quoteSingle(
      createGoldenOrderItem({
        quantity: 2_000,
        paperWeightGsm: 180,
      }),
      { province: '上海' },
    );
    expect(orderLine(result, 'SHIPPING:primary')).toMatchObject({
      amount: '48.30',
      basis: {
        netWeightGrams: '13500',
        billableWeightKg: '14',
      },
    });
  });

  it('qty=2001 走物流，快递费待定，纸箱仍计算', () => {
    const result = quoteSingle(createGoldenOrderItem({ quantity: 2_001 }));
    expect(orderLine(result, 'SHIPPING:primary')).toMatchObject({
      amount: null,
      status: 'PENDING',
    });
    expect(orderLine(result, 'SHIPPING:primary').errors.join('；')).toContain(
      '改走物流',
    );
    expect(orderLine(result, 'CARTON').amount).toBe('7.00');
    expect(result.status).toBe('PARTIAL');
  });

  it('顺丰到付快递为 0，纸箱照收', () => {
    const result = quoteSingle(
      createGoldenOrderItem({ quantity: 2_000 }),
      { isSfCollect: true },
    );
    expect(orderLine(result, 'SHIPPING:primary')).toMatchObject({
      amount: '0.00',
      status: 'QUOTED',
      basis: { isSfCollect: true },
    });
    expect(orderLine(result, 'CARTON').amount).toBe('5.00');
  });

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

  it('制烫金版费永返回待定，但不阻塞其他已知总额', () => {
    const result = quoteSingle(createGoldenOrderItem());
    expect(orderLine(result, 'PLATE_FEE')).toMatchObject({
      status: 'PENDING',
      amount: null,
      includedInKnownTotal: false,
      basis: { displayAmount: '待定', granularity: 'PER_ORDER' },
    });
    expect(result.status).toBe('QUOTED');
    expect(result.total).toBe(result.knownTotal);
    expect(result.pendingLineCodes).toContain('PLATE_FEE');
  });
});

describe('calculateCreateOrderQuote · 纯函数与层级契约', () => {
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

  it('款级明细和订单级明细不混层', () => {
    const result = quoteSingle(createGoldenOrderItem());
    expect(result.items[0]?.lines.every((line) => line.layer === 'ITEM')).toBe(true);
    expect(result.order.lines.every((line) => line.layer === 'ORDER')).toBe(true);
    expect(result.items[0]?.lines.map((line) => line.code)).toEqual([
      'PARTIAL_BLANK',
      'PARTIAL_MACHINE',
      'BAGGING',
    ]);
    expect(result.order.lines.map((line) => line.code)).toEqual([
      'CARTON',
      'SHIPPING:primary',
      'PLATE_FEE',
    ]);
  });
});
