import { describe, expect, it } from 'vitest';
import {
  calculateExternalOrderCharges,
  CARTON_PRICE_SOURCE,
  DEFAULT_EXTERNAL_ORDER_CHARGE_RULES,
  getZtoTariff,
  type ExternalOrderChargeRule,
  ZTO_PRICE_SOURCE,
} from '../external-order-charges';

function oneShipment(
  overrides: Partial<{
    shipmentKey: string;
    province: string | null;
    billableWeightKg: string | null;
    itemQuantity: number;
  }> = {},
) {
  return {
    shipmentKey: 'shipment-1',
    province: '广东',
    billableWeightKg: '1',
    itemQuantity: 500,
    ...overrides,
  };
}

describe('getZtoTariff', () => {
  it.each([
    ['广东', '2.80', '1', '1.50'],
    ['江西', '2.80', '1', '2.80'],
    ['江苏', '2.80', '1', '2.80'],
    ['安徽', '2.80', '1', '2.80'],
    ['湖南', '2.80', '1', '2.80'],
    ['湖北', '2.80', '1', '2.80'],
    ['广西', '2.80', '1', '2.80'],
    ['浙江', '2.80', '1', '2.80'],
    ['福建', '2.80', '1', '2.80'],
    ['天津', '2.80', '1', '3.50'],
    ['上海', '2.80', '1', '3.50'],
    ['北京', '2.80', '1', '3.50'],
    ['河南', '2.80', '1', '3.50'],
    ['河北', '2.80', '1', '3.50'],
    ['四川', '2.80', '1', '3.50'],
    ['重庆', '2.80', '1', '3.50'],
    ['贵州', '2.80', '1', '3.50'],
    ['山东', '2.80', '1', '3.50'],
    ['云南', '2.80', '1', '4.50'],
    ['山西', '2.80', '1', '4.50'],
    ['陕西', '2.80', '1', '4.50'],
    ['黑龙江', '2.80', '1', '4.50'],
    ['吉林', '2.80', '1', '4.50'],
    ['辽宁', '2.80', '1', '4.50'],
    ['海南', '2.80', '1', '4.50'],
    ['新疆', '12.00', '0.5', '5.30'],
    ['西藏', '12.00', '0.5', '5.30'],
    ['甘肃', '10.00', '0.5', '5.30'],
    ['青海', '10.00', '0.5', '5.30'],
    ['宁夏', '10.00', '0.5', '5.30'],
    ['内蒙古', '10.00', '0.5', '5.30'],
  ])(
    '覆盖报价表中的省级地区：%s',
    (province, firstFee, additionalUnitKg, additionalUnitFee) => {
      expect(getZtoTariff(province)).toMatchObject({
        province,
        firstWeightKg: '1',
        firstFee,
        additionalUnitKg,
        additionalUnitFee,
      });
    },
  );

  it.each([
    ['广东省', '广东'],
    ['北京市', '北京'],
    ['内蒙古自治区', '内蒙古'],
    ['广西壮族自治区', '广西'],
    ['新疆维吾尔自治区', '新疆'],
    ['宁夏回族自治区', '宁夏'],
    ['西藏自治区', '西藏'],
  ])('只接受结构化省份的精确别名：%s', (alias, province) => {
    expect(getZtoTariff(`  ${alias}  `)?.province).toBe(province);
  });

  it.each(['', '广东路', '香港', '广西省', '北京省'])(
    '不从自由文本或错误行政区后缀猜测地区：%j',
    (province) => {
      expect(getZtoTariff(province)).toBeNull();
    },
  );
});

describe('calculateExternalOrderCharges · 中通计费重量', () => {
  it.each([
    ['广东', '1', '2.80'],
    ['广东', '2', '4.30'],
    ['广东', '3', '5.80'],
    ['江西', '2', '5.60'],
    ['北京', '2', '6.30'],
    ['云南', '2', '7.30'],
    ['新疆', '1', '12.00'],
    ['新疆', '1.5', '17.30'],
    ['新疆', '2', '22.60'],
    ['甘肃', '1', '10.00'],
    ['甘肃', '1.5', '15.30'],
    ['甘肃', '2', '20.60'],
  ])('%s 计费重量 %skg ¥%s', (province, weight, expected) => {
    const result = calculateExternalOrderCharges({
      isSfCollect: false,
      shipments: [oneShipment({ province, billableWeightKg: weight })],
    });

    expect(result.complete).toBe(true);
    expect(result.suggestedShippingTotal).toBe(expected);
    expect(result.shipments[0]?.shipping).toMatchObject({
      amount: expected,
      complete: true,
      advisory: false,
      waived: false,
      errors: [],
      source: expect.objectContaining({
        fileName: ZTO_PRICE_SOURCE.fileName,
        sha256: ZTO_PRICE_SOURCE.sha256,
      }),
    });
  });

  it.each([
    ['广东', '0.5', '2.80'],
    ['广东', '1.001', '4.30'],
    ['广东', '1.5', '4.30'],
    ['新疆', '1.001', '17.30'],
    ['新疆', '1.25', '17.30'],
    ['新疆', '1.501', '22.60'],
  ])(
    '按报价续重单位向上进位：%s %skg => ¥%s',
    (province, billableWeightKg, expected) => {
      const result = calculateExternalOrderCharges({
        isSfCollect: false,
        shipments: [oneShipment({ province, billableWeightKg })],
      });

      expect(result.complete).toBe(true);
      expect(result.suggestedShippingTotal).toBe(expected);
      expect(result.shipments[0]?.shipping).toMatchObject({
        amount: expected,
        complete: true,
        basis: expect.objectContaining({ billableWeightKg }),
      });
    },
  );

  it.each([null, '0'])('缺少有效重量时失败关闭：%s', (billableWeightKg) => {
    const result = calculateExternalOrderCharges({
      isSfCollect: false,
      shipments: [oneShipment({ billableWeightKg })],
    });

    expect(result.complete).toBe(false);
    expect(result.suggestedShippingTotal).toBeNull();
    expect(result.suggestedTotal).toBeNull();
    expect(result.shipments[0]?.shipping.amount).toBeNull();
    expect(result.errors.join('；')).toContain('缺少有效的系统计费重量');
  });

  it('fails closed for an unknown province while retaining the independent carton suggestion', () => {
    const result = calculateExternalOrderCharges({
      isSfCollect: false,
      shipments: [oneShipment({ province: '香港' })],
    });

    expect(result).toMatchObject({
      complete: false,
      suggestedShippingTotal: null,
      suggestedPackagingTotal: '1.00',
      suggestedTotal: null,
    });
    expect(result.shipments[0]?.shipping.errors).toContain(
      '计费地区不在中通报价表内，请人工确认',
    );
  });

  it('fails closed before a calculated fee can overflow the stored money column', () => {
    const result = calculateExternalOrderCharges({
      isSfCollect: false,
      shipments: [
        oneShipment({
          province: '云南',
          billableWeightKg: '9999999999999',
        }),
      ],
    });

    expect(result.complete).toBe(false);
    expect(result.shipments[0]?.shipping.errors).toContain(
      '快递费超过系统可保存上限，请人工确认',
    );
  });
});

describe('calculateExternalOrderCharges · 整单纸箱费', () => {
  it.each([
    [1, '1.00'],
    [500, '1.00'],
    [501, '3.00'],
    [1_000, '3.00'],
    [1_001, '5.00'],
    [2_000, '5.00'],
    [2_001, '7.00'],
    [3_000, '7.00'],
    [3_001, '8.00'],
    [5_000, '8.00'],
    [5_001, '9.00'],
    [6_000, '11.00'],
    [8_000, '15.00'],
    [10_000, '16.00'],
    [12_000, '21.00'],
    [20_000, '32.00'],
  ])('整单 %i 个纸箱费 %s', (itemQuantity, expected) => {
    const result = calculateExternalOrderCharges({
      isSfCollect: false,
      shipments: [oneShipment({ itemQuantity })],
    });

    expect(result.shipments[0]?.packaging).toMatchObject({
      amount: expected,
      complete: true,
      advisory: false,
      waived: false,
      basis: expect.objectContaining({
        orderTotalQuantity: itemQuantity,
        granularity: 'PER_ORDER',
        allocatedToPrimaryShipment: true,
      }),
      source: expect.objectContaining({
        fileName: CARTON_PRICE_SOURCE.fileName,
        sha256: CARTON_PRICE_SOURCE.sha256,
      }),
    });
  });

  it.each([0, -1, 1.5, Number.MAX_SAFE_INTEGER + 1])(
    '拒绝非法整单数量：%s',
    (itemQuantity) => {
      const result = calculateExternalOrderCharges({
        isSfCollect: false,
        shipments: [oneShipment({ itemQuantity })],
      });

      expect(result.complete).toBe(false);
      expect(result.suggestedPackagingTotal).toBeNull();
      expect(result.shipments[0]?.packaging.errors).toContain(
        '整单总数量必须是大于 0 的安全整数',
      );
    },
  );

  it('整单超过 2000 个时物流待定，纸箱费仍自动计算', () => {
    const result = calculateExternalOrderCharges({
      isSfCollect: false,
      shipments: [oneShipment({ itemQuantity: 2_001 })],
    });

    expect(result).toMatchObject({
      complete: false,
      suggestedShippingTotal: null,
      suggestedPackagingTotal: '7.00',
      suggestedTotal: null,
    });
    expect(result.shipments[0]?.shipping).toMatchObject({
      amount: null,
      complete: false,
      name: '物流运费待定',
      errors: ['整单总数量超过 2000 个，改走物流，运费待定'],
    });
  });
});

describe('calculateExternalOrderCharges · 多地址与顺丰到付', () => {
  it('每个地址分别收首重，纸箱按整单数量仅归集到主地址', () => {
    const result = calculateExternalOrderCharges({
      isSfCollect: false,
      shipments: [
        oneShipment({
          shipmentKey: 'primary',
          province: '广东',
          billableWeightKg: '1',
          itemQuantity: 500,
        }),
        oneShipment({
          shipmentKey: 'extra',
          province: '新疆',
          billableWeightKg: '1.5',
          itemQuantity: 501,
        }),
      ],
    });

    expect(result).toMatchObject({
      complete: true,
      suggestedShippingTotal: '20.10',
      suggestedPackagingTotal: '5.00',
      suggestedTotal: '25.10',
    });
    expect(result.components.map((component) => [
      component.shipmentKey,
      component.categoryCode,
      component.amount,
    ])).toEqual([
      ['primary', 'SHIPPING', '2.80'],
      ['primary', 'PACKAGING', '5.00'],
      ['extra', 'SHIPPING', '17.30'],
      ['extra', 'PACKAGING', '0.00'],
    ]);
    expect(result.shipments[1]?.packaging).toMatchObject({
      name: '纸箱费已计入主地址',
      ruleCode: null,
      basis: expect.objectContaining({
        granularity: 'PER_ORDER',
        allocatedToPrimaryShipment: false,
      }),
    });
  });

  it('两票各收一次首重，但纸箱数量先合并且只收一次', () => {
    const result = calculateExternalOrderCharges({
      isSfCollect: false,
      shipments: [
        oneShipment({ shipmentKey: 'a', itemQuantity: 250 }),
        oneShipment({ shipmentKey: 'b', itemQuantity: 250 }),
      ],
    });

    expect(result.suggestedShippingTotal).toBe('5.60');
    expect(result.suggestedPackagingTotal).toBe('1.00');
    expect(result.suggestedTotal).toBe('6.60');
  });

  it('顺丰到付不要求中通地区或重量，但仍按整单收取纸箱费', () => {
    const result = calculateExternalOrderCharges({
      isSfCollect: true,
      shipments: [
        oneShipment({
          shipmentKey: 'primary',
          province: null,
          billableWeightKg: null,
          itemQuantity: 500,
        }),
        oneShipment({
          shipmentKey: 'extra',
          province: '香港',
          billableWeightKg: '1.001',
          itemQuantity: 501,
        }),
      ],
    });

    expect(result).toMatchObject({
      complete: true,
      suggestedShippingTotal: '0.00',
      suggestedPackagingTotal: '5.00',
      suggestedTotal: '5.00',
      errors: [],
    });
    expect(result.shipments.map((shipment) => shipment.shipping)).toEqual([
      expect.objectContaining({
        amount: '0.00',
        complete: true,
        waived: true,
        source: null,
      }),
      expect.objectContaining({
        amount: '0.00',
        complete: true,
        waived: true,
        source: null,
      }),
    ]);
  });

  it('任一票不完整时总建议失败关闭，不把部分金额冒充完整总价', () => {
    const result = calculateExternalOrderCharges({
      isSfCollect: false,
      shipments: [
        oneShipment({ shipmentKey: 'valid' }),
        oneShipment({
          shipmentKey: 'invalid',
          province: '广东',
          billableWeightKg: null,
        }),
      ],
    });

    expect(result.complete).toBe(false);
    expect(result.suggestedShippingTotal).toBeNull();
    expect(result.suggestedPackagingTotal).toBe('3.00');
    expect(result.suggestedTotal).toBeNull();
    expect(result.errors).toEqual([
      expect.stringContaining('发货记录 invalid·快递费'),
    ]);
  });

  it.each([
    { shipments: [], expected: '至少需要一个发货地址' },
    {
      shipments: [oneShipment({ shipmentKey: '' })],
      expected: '发货记录标识不能为空',
    },
    {
      shipments: [
        oneShipment({ shipmentKey: 'duplicate' }),
        oneShipment({ shipmentKey: 'duplicate' }),
      ],
      expected: '发货记录标识重复：duplicate',
    },
  ])('拒绝无法建立逐票快照的输入', ({ shipments, expected }) => {
    const result = calculateExternalOrderCharges({
      isSfCollect: false,
      shipments,
    });

    expect(result).toMatchObject({
      complete: false,
      suggestedShippingTotal: null,
      suggestedPackagingTotal: null,
      suggestedTotal: null,
      components: [],
    });
    expect(result.errors.join('；')).toContain(expected);
  });
});

describe('calculateExternalOrderCharges · 规则注入与快照', () => {
  it('导出默认工作簿规则，便于 DB 价目簿归一化到同一计算边界', () => {
    expect(
      DEFAULT_EXTERNAL_ORDER_CHARGE_RULES.filter(
        (rule) => rule.kind === 'SHIPPING',
      ),
    ).toHaveLength(6);
    expect(
      DEFAULT_EXTERNAL_ORDER_CHARGE_RULES.filter(
        (rule) => rule.kind === 'PACKAGING',
      ),
    ).toHaveLength(5);
  });

  it('可选接收已归一化规则，并在组件与快照中保留 rule code 和来源', () => {
    const customSource = {
      fileName: '数据库版本价目簿.xlsx',
      sha256: 'c'.repeat(64),
      sheetName: '外部收费',
      sourceRange: 'B2:F2',
    };
    const rules: readonly ExternalOrderChargeRule[] = [
      {
        kind: 'SHIPPING',
        code: 'CUSTOM_ZTO_GD_V2',
        provinces: ['广东'],
        firstWeightKg: '1',
        firstFee: '9',
        additionalUnitKg: '1',
        additionalUnitFee: '2',
        source: customSource,
      },
      {
        kind: 'PACKAGING',
        code: 'CUSTOM_CARTON_V2',
        minQty: 1,
        maxQty: 1_000,
        amount: '6',
        advisory: false,
        source: { ...customSource, sourceRange: 'B3:F3' },
      },
    ];

    const result = calculateExternalOrderCharges(
      {
        isSfCollect: false,
        shipments: [
          oneShipment({ billableWeightKg: '2', itemQuantity: 500 }),
        ],
      },
      rules,
    );

    expect(result).toMatchObject({
      complete: true,
      suggestedShippingTotal: '11.00',
      suggestedPackagingTotal: '6.00',
      suggestedTotal: '17.00',
    });
    expect(result.components).toEqual([
      expect.objectContaining({
        categoryCode: 'SHIPPING',
        ruleCode: 'CUSTOM_ZTO_GD_V2',
        amount: '11.00',
        source: customSource,
      }),
      expect.objectContaining({
        categoryCode: 'PACKAGING',
        ruleCode: 'CUSTOM_CARTON_V2',
        amount: '6.00',
        source: { ...customSource, sourceRange: 'B3:F3' },
      }),
    ]);
    expect(result.snapshot).toEqual({
      version: 1,
      input: {
        isSfCollect: false,
        shipments: [
          {
            shipmentKey: 'shipment-1',
            province: '广东',
            billableWeightKg: '2',
            itemQuantity: 500,
          },
        ],
      },
      suggestedShippingTotal: '11.00',
      suggestedPackagingTotal: '6.00',
      suggestedTotal: '17.00',
      components: result.components,
      complete: true,
      errors: [],
    });
  });

  it('注入的规则重叠时失败关闭，不依赖数组顺序选一条', () => {
    const rules: readonly ExternalOrderChargeRule[] = [
      ...DEFAULT_EXTERNAL_ORDER_CHARGE_RULES,
      {
        kind: 'PACKAGING',
        code: 'CONFLICTING_CARTON',
        minQty: 1,
        maxQty: 500,
        amount: '99',
        advisory: false,
        source: {
          ...CARTON_PRICE_SOURCE,
          sourceRange: 'Z1:Z1',
        },
      },
    ];

    const result = calculateExternalOrderCharges(
      { isSfCollect: false, shipments: [oneShipment()] },
      rules,
    );

    expect(result.complete).toBe(false);
    expect(result.suggestedPackagingTotal).toBeNull();
    expect(result.suggestedTotal).toBeNull();
    expect(result.shipments[0]?.packaging.errors).toContain(
      '纸箱数量档必须从 1 开始连续覆盖且金额有效',
    );
  });
});
