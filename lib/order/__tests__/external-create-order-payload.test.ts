import { describe, expect, it } from 'vitest';
import { createOrderSchema, type CreateOrderInput } from '@/lib/auth/schemas';
import {
  EXTERNAL_CREATE_ORDER_SERVER_OWNED_FIELDS,
  parseExternalCreateOrderCommand,
} from '../external-create-order-command';
import {
  buildExternalCreateOrderPayload,
  EXTERNAL_CREATE_PAYLOAD_SERVER_OWNED_FIELDS,
} from '../external-create-order-payload';

function formInput(): CreateOrderInput {
  return createOrderSchema.parse({
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
    quotedWeightKg: '12',
    shippingFee: '41.30',
    packingMaterialFee: '5.00',
    customerChargeOverrideReason: null,
    packageRequirement: '客户原话：每包一千个',
    remark: '请保留客户原话',
    promisedDate: null,
    isUrgent: false,
    isSfCollect: false,
    additionalShipments: [
      {
        receiverName: '李先生',
        receiverPhone: '13900139000',
        receiverAddress: '北京市朝阳区测试路 2 号',
        expressCode: null,
        destinationProvince: '北京',
        quotedWeightKg: '2',
        shippingFee: '15.00',
        packingMaterialFee: '2.00',
        customerChargeOverrideReason: null,
        itemQuantities: [100],
      },
    ],
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
        unitPrice: '0.25',
        fixedFee: '20.00',
        suggestedSubtotal: '270.00',
        priceOverrideReason: null,
        remark: null,
      },
    ],
  });
}

function withAllServerOwnedFields(input: CreateOrderInput): CreateOrderInput {
  const rootOwned = Object.fromEntries(
    EXTERNAL_CREATE_ORDER_SERVER_OWNED_FIELDS.root.map((field) => [field, null]),
  );
  const itemOwned = Object.fromEntries(
    EXTERNAL_CREATE_ORDER_SERVER_OWNED_FIELDS.item.map((field) => [field, null]),
  );
  const shipmentOwned = Object.fromEntries(
    EXTERNAL_CREATE_ORDER_SERVER_OWNED_FIELDS.shipment.map((field) => [
      field,
      null,
    ]),
  );

  return {
    ...input,
    ...rootOwned,
    items: input.items.map((item) => ({
      ...item,
      ...itemOwned,
      craft: 'PARTIAL',
    })),
    additionalShipments: input.additionalShipments.map((shipment) => ({
      ...shipment,
      ...shipmentOwned,
    })),
    shipments: [
      {
        receiverName: '王先生',
        receiverAddress: '上海市浦东新区测试路 1 号',
        ...shipmentOwned,
      },
    ],
    shipment: {
      receiverName: '王先生',
      receiverAddress: '上海市浦东新区测试路 1 号',
      ...shipmentOwned,
    },
  } as unknown as CreateOrderInput;
}

function expectFieldsAbsent(
  value: Record<string, unknown>,
  fields: readonly string[],
) {
  for (const field of fields) {
    expect(value).not.toHaveProperty(field);
    expect(Object.hasOwn(value, field)).toBe(false);
  }
}

describe('buildExternalCreateOrderPayload', () => {
  it('stays aligned with the strict command boundary field lists', () => {
    expect(EXTERNAL_CREATE_PAYLOAD_SERVER_OWNED_FIELDS).toEqual(
      EXTERNAL_CREATE_ORDER_SERVER_OWNED_FIELDS,
    );
  });

  it('omits every server-owned field while retaining canonical B facts', () => {
    const source = withAllServerOwnedFields(formInput());
    const payload = buildExternalCreateOrderPayload(source);
    const raw = payload as unknown as Record<string, unknown>;

    expectFieldsAbsent(
      raw,
      EXTERNAL_CREATE_ORDER_SERVER_OWNED_FIELDS.root,
    );
    expectFieldsAbsent(
      payload.items[0] as unknown as Record<string, unknown>,
      EXTERNAL_CREATE_ORDER_SERVER_OWNED_FIELDS.item,
    );
    expectFieldsAbsent(
      payload.additionalShipments[0] as unknown as Record<string, unknown>,
      EXTERNAL_CREATE_ORDER_SERVER_OWNED_FIELDS.shipment,
    );
    expectFieldsAbsent(
      (raw.shipments as Array<Record<string, unknown>>)[0],
      EXTERNAL_CREATE_ORDER_SERVER_OWNED_FIELDS.shipment,
    );
    expectFieldsAbsent(
      raw.shipment as Record<string, unknown>,
      EXTERNAL_CREATE_ORDER_SERVER_OWNED_FIELDS.shipment,
    );

    expect(payload).toMatchObject({
      clientSubmissionId: '7f26a5c0-21b7-4eef-8f11-0ae59d2c2339',
      nextItemFig: 8,
      customName: '王总中秋信封',
      customerRef: '王总',
      receiverName: '王先生',
      receiverPhone: '13800138000',
      receiverAddress: '上海市浦东新区测试路 1 号',
      packageRequirement: '客户原话：每包一千个',
      items: [
        {
          fig: 7,
          pack: 10,
          craft: 'PARTIAL',
          pricingRoute: 'STOCK_BLANK',
          crafts: ['craft-1'],
          quantity: 1000,
        },
      ],
      additionalShipments: [
        {
          receiverName: '李先生',
          receiverPhone: '13900139000',
          receiverAddress: '北京市朝阳区测试路 2 号',
          destinationProvince: '北京',
          itemQuantities: [100],
        },
      ],
      packagingGroups: [
        {
          mode: 'SINGLE_STYLE',
          actualBagCount: 1,
          itemUnitsPerBag: [10],
        },
      ],
    });

    expect(parseExternalCreateOrderCommand(payload).success).toBe(true);
  });

  it('does not mutate the form input or nested records', () => {
    const source = withAllServerOwnedFields(formInput());
    const originalItem = source.items[0] as unknown as Record<string, unknown>;
    const originalShipment = source.additionalShipments[0] as unknown as Record<
      string,
      unknown
    >;

    buildExternalCreateOrderPayload(source);

    expect(Object.hasOwn(source, 'shippingFee')).toBe(true);
    expect(Object.hasOwn(originalItem, 'unitPrice')).toBe(true);
    expect(Object.hasOwn(originalShipment, 'quotedWeightKg')).toBe(true);
  });
});
