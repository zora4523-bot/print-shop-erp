import { describe, expect, it } from 'vitest';
import {
  localOrderFormDraftStorageKey,
  parseLocalOrderFormDraft,
  resolveNextOrderItemFig,
  serializeLocalOrderFormDraft,
} from '../order-form-local-draft';

function formValues() {
  return {
    nextItemFig: 7,
    customerRef: '星河礼品',
    promisedDate: new Date('2026-09-01T00:00:00.000Z'),
    isUrgent: false,
    isSfCollect: false,
    shippingFee: '18.00',
    packingMaterialFee: '3.00',
    customerChargeOverrideReason: '旧物流改价',
    items: [
      {
        name: '外盒',
        productId: 'product-1',
        pricingRoute: 'CUSTOM_SINGLE_FLAT_FOIL',
        productStructure: 'WESTERN_ENVELOPE',
        artworkVersion: '第 3 版',
        plateGroupId: 'plate-a',
        pricingGroup: 'pricing-a',
        manualQuoteReason: '已切回自动路线的旧原因',
        specification: '220 × 110 mm',
        actualWidthMm: 220,
        actualHeightMm: 110,
        paperType: '胶版纸',
        paperWeightGsm: 120,
        quantity: 8_000,
        crafts: ['foil'],
        frontFoilColors: ['哑金', '红金'],
        backFoilColors: ['哑金'],
        foilColors: ['金'],
        foilTechnique: 'FLAT',
        hasLocalFoil: true,
        printColors: ['C', 'M'],
        isDoubleSided: false,
        isDoubleColor: true,
        unitPrice: '0.2500',
        fixedFee: '20.00',
        suggestedSubtotal: '2020.00',
        priceOverrideReason: '旧人工改价',
        designFile: new Blob(['image'], { type: 'image/png' }),
      },
    ],
    additionalShipments: [
      {
        receiverAddress: '广东省广州市',
        destinationProvince: '广东',
        quotedWeightKg: '12',
        shippingFee: '10.00',
        packingMaterialFee: '2.00',
        customerChargeOverrideReason: '旧分票改价',
        itemQuantities: [1_000],
      },
    ],
    packagingGroups: [
      {
        name: '混装 A',
        mode: 'MIXED_STYLE',
        actualBagCount: 100,
        itemUnitsPerBag: [80],
        uploadMetadata: { shouldNotPersist: true },
      },
    ],
    pendingDesigns: {
      row: [new Blob(['image'], { type: 'image/png' })],
    },
  };
}

describe('order form local draft', () => {
  it('keeps only serializable RHF fields and never persists design files', () => {
    const serialized = serializeLocalOrderFormDraft(
      formValues(),
      'internal',
      new Date('2026-08-24T03:00:00.000Z'),
    );

    expect(serialized).not.toBeNull();
    expect(serialized).not.toContain('pendingDesigns');
    expect(serialized).not.toContain('designFile');
    const parsed = parseLocalOrderFormDraft(serialized!, 'internal');
    const internalItem = (
      parsed?.values.items as Array<Record<string, unknown>>
    )[0];
    expect(parsed?.savedAt).toBe('2026-08-24T03:00:00.000Z');
    expect(parsed?.values.promisedDate).toBe('2026-09-01');
    expect(parsed?.values.nextItemFig).toBe(7);
    expect(parsed?.values.items).toEqual([
      expect.objectContaining({
        name: '外盒',
        pricingRoute: 'CUSTOM_SINGLE_FLAT_FOIL',
        productStructure: 'WESTERN_ENVELOPE',
        artworkVersion: '第 3 版',
        plateGroupId: 'plate-a',
        pricingGroup: 'pricing-a',
        specification: '220 × 110 mm',
        actualWidthMm: 220,
        actualHeightMm: 110,
        paperType: '胶版纸',
        paperWeightGsm: 120,
        frontFoilColors: ['哑金', '红金'],
        backFoilColors: ['哑金'],
        foilColors: ['金'],
        foilTechnique: 'FLAT',
        hasLocalFoil: true,
        printColors: ['C', 'M'],
        manualQuoteReason: '已切回自动路线的旧原因',
      }),
    ]);
    expect(parsed?.values.packagingGroups).toEqual([
      {
        name: '混装 A',
        mode: 'MIXED_STYLE',
        actualBagCount: 100,
        itemUnitsPerBag: [80],
      },
    ]);
    expect(parsed?.values).not.toHaveProperty('shippingFee');
    expect(parsed?.values).not.toHaveProperty('packingMaterialFee');
    expect(parsed?.values).not.toHaveProperty('customerChargeOverrideReason');
    expect(internalItem).not.toHaveProperty('unitPrice');
    expect(internalItem).not.toHaveProperty('fixedFee');
    expect(internalItem).not.toHaveProperty('suggestedSubtotal');
    expect(internalItem).not.toHaveProperty('priceOverrideReason');
    expect(
      (parsed?.values.additionalShipments as Array<Record<string, unknown>>)[0],
    ).not.toHaveProperty('shippingFee');
  });

  it('removes every hidden price authority field from external-sales drafts', () => {
    const serialized = serializeLocalOrderFormDraft(
      formValues(),
      'external-sales',
      new Date('2026-08-24T03:00:00.000Z'),
    );

    expect(serialized).not.toBeNull();
    const parsed = parseLocalOrderFormDraft(serialized!, 'external-sales');
    const item = (parsed?.values.items as Array<Record<string, unknown>>)[0];
    const shipment = (
      parsed?.values.additionalShipments as Array<Record<string, unknown>>
    )[0];

    expect(parsed?.pricingScope).toBe('external-sales');
    expect(parsed?.values).not.toHaveProperty('shippingFee');
    expect(parsed?.values).not.toHaveProperty('packingMaterialFee');
    expect(parsed?.values).not.toHaveProperty('customerChargeOverrideReason');
    expect(item).not.toHaveProperty('unitPrice');
    expect(item).not.toHaveProperty('fixedFee');
    expect(item).not.toHaveProperty('suggestedSubtotal');
    expect(item).not.toHaveProperty('priceOverrideReason');
    expect(item).not.toHaveProperty('manualQuoteReason');
    expect(shipment).not.toHaveProperty('shippingFee');
    expect(shipment).not.toHaveProperty('packingMaterialFee');
    expect(shipment).not.toHaveProperty('customerChargeOverrideReason');
  });

  it('rejects an obsolete manual-quote draft instead of restoring a hidden route', () => {
    const values = formValues();
    values.items[0]!.pricingRoute = 'MANUAL_QUOTE';
    values.items[0]!.manualQuoteReason = '客户来样无标准规格';
    const serialized = serializeLocalOrderFormDraft(values, 'external-sales');
    expect(serialized).toBeNull();
  });

  it('fails closed for corrupt, obsolete, or structurally invalid drafts', () => {
    expect(parseLocalOrderFormDraft('{', 'internal')).toBeNull();
    expect(
      parseLocalOrderFormDraft(
        JSON.stringify({
          version: 1,
          savedAt: new Date().toISOString(),
          values: {},
        }),
        'internal',
      ),
    ).toBeNull();
    expect(
      parseLocalOrderFormDraft(
        JSON.stringify({
          version: 3,
          pricingScope: 'internal',
          savedAt: 'not-a-date',
          values: { items: [], additionalShipments: [], packagingGroups: [] },
        }),
        'internal',
      ),
    ).toBeNull();
  });

  it('rejects a draft restored under a different pricing scope', () => {
    const serialized = serializeLocalOrderFormDraft(formValues(), 'internal');

    expect(serialized).not.toBeNull();
    expect(parseLocalOrderFormDraft(serialized!, 'external-sales')).toBeNull();
  });

  it('isolates drafts by signed-in user and settlement path', () => {
    expect(localOrderFormDraftStorageKey('user/1', true)).toContain(':v4:');
    expect(localOrderFormDraftStorageKey('user/1', true)).not.toBe(
      localOrderFormDraftStorageKey('user/2', true),
    );
    expect(localOrderFormDraftStorageKey('user/1', true)).not.toBe(
      localOrderFormDraftStorageKey('user/1', false),
    );
  });

  it('keeps a monotonic fig counter even after the highest card was deleted', () => {
    expect(
      resolveNextOrderItemFig({
        nextItemFig: 8,
        items: [{ fig: 1 }, { fig: 3 }],
      }),
    ).toBe(8);
    expect(
      resolveNextOrderItemFig({
        nextItemFig: 2,
        items: [{ fig: 1 }, { fig: 3 }],
      }),
    ).toBe(4);
  });
});
