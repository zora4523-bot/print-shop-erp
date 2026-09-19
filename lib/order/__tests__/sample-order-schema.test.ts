import { describe, expect, it } from 'vitest';
import { createBlankItem } from '../order-item-configuration';
import { createOrderSchema } from '../../auth/schemas';
import { parseExternalCreateOrderCommand } from '../external-create-order-command';
import { buildExternalCreateOrderPayload } from '../external-create-order-payload';

function facts() {
  return {
    purpose: 'SAMPLE_SHIPMENT',
    customerRef: null,
    receiverName: '测试',
    receiverPhone: '13800000000',
    receiverAddress: '浙江省测试地址',
    destinationProvince: '浙江',
    expressCode: null,
    packageRequirement: null,
    remark: null,
    isUrgent: false,
    isSfCollect: false,
    packagingGroups: [],
    additionalShipments: [],
    items: [
      {
        ...createBlankItem([]),
        name: '样品',
        pricingRoute: 'MANUAL_QUOTE',
        quantity: 2,
        crafts: [],
        frontFoilColors: [],
        backFoilColors: [],
        foilColors: [],
        foilTechnique: 'NONE',
        hasLocalFoil: null,
        pack: null,
      },
    ],
  };
}
describe('sample order creation boundary', () => {
  it('permits external sales to submit sample facts without invented production fields', () => {
    const parsed = createOrderSchema.parse(facts());
    expect(
      parseExternalCreateOrderCommand(buildExternalCreateOrderPayload(parsed))
        .success,
    ).toBe(true);
  });
  it.each([
    'confirmedFee',
    'settledFee',
    'pricingMode',
    'manualTotal',
    'purposeAmount',
  ])('rejects external pricing field %s even when null', (field) => {
    expect(
      parseExternalCreateOrderCommand({
        ...buildExternalCreateOrderPayload(createOrderSchema.parse(facts())),
        [field]: null,
      }).success,
    ).toBe(false);
  });
  it('does not admit sample-only item facts into standard or proof orders', () => {
    expect(
      createOrderSchema.safeParse({ ...facts(), purpose: 'STANDARD' }).success,
    ).toBe(false);
    expect(
      createOrderSchema.safeParse({ ...facts(), purpose: 'PROOF' }).success,
    ).toBe(false);
  });
  it('rejects fabricated zero quantity and production craft on a sample shipment', () => {
    const input = facts();
    expect(
      createOrderSchema.safeParse({
        ...input,
        items: [{ ...input.items[0], quantity: 0 }],
      }).success,
    ).toBe(false);
    expect(
      createOrderSchema.safeParse({
        ...input,
        items: [{ ...input.items[0], crafts: ['craft-1'] }],
      }).success,
    ).toBe(false);
  });
});
