import { describe, expect, it } from 'vitest';
import {
  EXTERNAL_CREATE_ORDER_SERVER_OWNED_FIELDS,
  parseExternalCreateOrderCommand,
} from '../external-create-order-command';

function externalOrder(overrides: Record<string, unknown> = {}) {
  return {
    clientSubmissionId: '7f26a5c0-21b7-4eef-8f11-0ae59d2c2339',
    nextItemFig: 8,
    customName: '王总中秋信封',
    customerPartyId: null,
    customerRef: '王总',
    receiverName: '王先生',
    receiverPhone: '13800138000',
    receiverAddress: '上海市浦东新区测试路 1 号',
    destinationProvince: '上海',
    expressCode: null,
    packageRequirement: '按客户原话：每包十个',
    remark: null,
    promisedDate: null,
    isUrgent: false,
    isSfCollect: false,
    additionalShipments: [],
    packagingGroups: [
      {
        name: '第 7 款单款装',
        mode: 'SINGLE_STYLE',
        actualBagCount: 1,
        itemUnitsPerBag: [10],
      },
    ],
    items: [
      {
        fig: 7,
        name: '第 7 款',
        productId: 'product-1',
        pricingRoute: 'STOCK_BLANK',
        productStructure: 'STANDARD_ENVELOPE',
        specification: '西封中号',
        actualWidthMm: 110,
        actualHeightMm: 220,
        paperType: '艳红珠光纸',
        paperWeightGsm: 160,
        quantity: 1000,
        pack: 10,
        crafts: ['craft-1'],
        frontFoilColors: ['亚金'],
        backFoilColors: [],
        foilColors: ['亚金'],
        foilTechnique: 'FLAT',
        hasLocalFoil: true,
        lamination: 'NONE',
        printColors: [],
        isDoubleSided: false,
        isDoubleColor: false,
        remark: null,
      },
    ],
    ...overrides,
  };
}

function onlyItem(
  input: ReturnType<typeof externalOrder>,
  overrides: Record<string, unknown>,
) {
  return {
    ...input,
    items: [{ ...input.items[0], ...overrides }],
  };
}

describe('parseExternalCreateOrderCommand', () => {
  it('maps the compatibility persistence shape to canonical create-order facts', () => {
    const result = parseExternalCreateOrderCommand(externalOrder());

    expect(result.success).toBe(true);
    if (!result.success) return;
    expect(result.facts).toMatchObject({
      customName: '王总中秋信封',
      packRaw: '按客户原话：每包十个',
      receiverName: '王先生',
      styles: [
        {
          fig: 7,
          craft: 'PARTIAL',
          paperType: '艳红珠光纸',
          weight: 160,
          specification: '西封中号',
          widthMm: 110,
          heightMm: 220,
          frontColors: ['亚金'],
          backColors: [],
          pack: 10,
        },
      ],
    });
    expect(result.data.items[0]).toMatchObject({
      fig: 7,
      pack: 10,
      unitPrice: null,
      suggestedSubtotal: null,
    });
  });

  // 客户名称/简称与关联客户已退役（业主 2026-09-27）：旧客户端仍可携带，严格入口不拒绝，
  // 但既不校验也不进入规范事实；是否写库由 createOrder 决定（一律写空）。
  it.each([
    ['省略', {}],
    ['为 null', { customerPartyId: null, customerRef: null }],
    ['超长', { customerPartyId: 'x'.repeat(200), customerRef: '客'.repeat(200) }],
  ])('accepts retired customer keys (%s) without mapping them into canonical facts', (_label, customer) => {
    const input: Record<string, unknown> = { ...externalOrder(), ...customer };
    if (!('customerRef' in customer)) {
      delete input.customerRef;
      delete input.customerPartyId;
    }
    const result = parseExternalCreateOrderCommand(input);
    expect(result.success).toBe(true);
    if (!result.success) return;
    expect(result.facts).not.toHaveProperty('customerRef');
    expect(result.facts).not.toHaveProperty('customerPartyId');
  });

  it.each(EXTERNAL_CREATE_ORDER_SERVER_OWNED_FIELDS.root)(
    'rejects root server-owned field %s even when explicitly null',
    (field) => {
      const result = parseExternalCreateOrderCommand(
        externalOrder({ [field]: null }),
      );
      expect(result).toMatchObject({
        success: false,
        issues: [{ path: [field], fig: null }],
      });
    },
  );

  it.each(EXTERNAL_CREATE_ORDER_SERVER_OWNED_FIELDS.item)(
    'rejects item server-owned field %s and preserves fig',
    (field) => {
      const input = externalOrder();
      const result = parseExternalCreateOrderCommand(
        onlyItem(input, { [field]: null }),
      );
      expect(result).toMatchObject({
        success: false,
        issues: [{ path: ['items', 0, field], fig: 7 }],
      });
    },
  );

  it.each(EXTERNAL_CREATE_ORDER_SERVER_OWNED_FIELDS.shipment)(
    'rejects additional-shipment server-owned field %s',
    (field) => {
      const result = parseExternalCreateOrderCommand(
        externalOrder({
          additionalShipments: [
            {
              receiverAddress: '北京市朝阳区测试路 2 号',
              itemQuantities: [100],
              [field]: null,
            },
          ],
        }),
      );
      expect(result).toMatchObject({
        success: false,
        issues: [
          { path: ['additionalShipments', 0, field], fig: null },
        ],
      });
    },
  );

  it('rejects FULL back-side colors at the item path and keeps the stable fig', () => {
    const input = externalOrder();
    const result = parseExternalCreateOrderCommand({
      ...onlyItem(input, {
        fig: 42,
        pricingRoute: 'CUSTOM_SINGLE_FLAT_FOIL',
        frontFoilColors: ['亚金'],
        backFoilColors: ['红色'],
        foilColors: ['亚金', '红色'],
        hasLocalFoil: false,
      }),
      nextItemFig: 43,
    });

    expect(result).toMatchObject({
      success: false,
      issues: [
        {
          path: ['items', 0, 'backFoilColors'],
          fig: 42,
          message: '专版烫金只允许正面',
        },
      ],
    });
  });

  // DECISIONS 2026-08-27：彩印反面烫金是合法事实，由计价引擎转人工核价。
  it('accepts PRINT + full-foil back-side colors as a legal fact for manual pricing', () => {
    const input = externalOrder();
    const result = parseExternalCreateOrderCommand(
      onlyItem(input, {
        pricingRoute: 'COLOR_PRINT',
        frontFoilColors: ['亚金'],
        backFoilColors: ['红色'],
        foilColors: ['亚金', '红色'],
        hasLocalFoil: false,
        printColors: ['C', 'M', 'Y', 'K'],
        isDoubleSided: true,
        isDoubleColor: true,
      }),
    );

    expect(result.success).toBe(true);
  });

  it('requires canonical pack and reports the item fig', () => {
    const input = externalOrder();
    const result = parseExternalCreateOrderCommand(
      onlyItem(input, { pack: null }),
    );

    expect(result).toMatchObject({
      success: false,
      issues: [
        {
          path: ['items', 0, 'pack'],
          fig: 7,
          message: '第 7 款请填写每包数量',
        },
      ],
    });
  });

  it.each([
    ['receiverName', null],
    ['receiverPhone', null],
    ['receiverAddress', null],
  ])('validates canonical address fact %s', (field, value) => {
    const result = parseExternalCreateOrderCommand(
      externalOrder({ [field]: value }),
    );
    expect(result.success).toBe(false);
    if (result.success) return;
    expect(result.issues.some((issue) => issue.path[0] === field)).toBe(true);
  });
});


describe('external extra delivery contacts', () => {
  const shipment = { receiverName: '李女士', receiverPhone: '13900139000', receiverAddress: '广东省广州市测试路2号', expressCode: null, destinationProvince: '广东', itemQuantities: [400] };
  it.each(['receiverName', 'receiverPhone'])('rejects a missing %s at the server boundary', (field) => {
    const result = parseExternalCreateOrderCommand(externalOrder({ additionalShipments: [{ ...shipment, [field]: '  ' }] }));
    expect(result).toMatchObject({ success: false, issues: [{ path: ['additionalShipments', 0, field] }] });
  });
  it('preserves complete extra contacts and the order note', () => {
    const result = parseExternalCreateOrderCommand(externalOrder({ remark: '先核对样稿\n再安排生产', additionalShipments: [shipment] }));
    expect(result).toMatchObject({ success: true, data: { remark: '先核对样稿\n再安排生产', additionalShipments: [shipment] } });
  });
  it('rejects an order note longer than 1000 characters', () => {
    expect(parseExternalCreateOrderCommand(externalOrder({ remark: '字'.repeat(1001) })).success).toBe(false);
  });
});

it.each([null, { amount: '0', reason: '伪造免单', factsKey: 'forged' }])('rejects SALES style and packaging admin price fields even when %j', (adminPrice) => {
  const input = externalOrder();
  expect(parseExternalCreateOrderCommand(onlyItem(input, { adminPrice })).success).toBe(false);
  expect(parseExternalCreateOrderCommand({ ...input, packagingGroups: [{ ...input.packagingGroups[0], adminPrice }] }).success).toBe(false);
});
