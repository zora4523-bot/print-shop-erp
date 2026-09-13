import { describe, expect, it } from 'vitest';
import {
  localOrderFormDraftStorageKey,
  parseLocalOrderFormDraft,
  resolveNextOrderItemFig,
  serializeLocalOrderFormDraft,
  listLocalWorkbenchDrafts,
  needsOrderItemLaminationSelection,
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
  it.each([undefined, null, 'foil', [5]])(
    'rejects structurally corrupt craft lists: %j',
    (crafts) => {
      const values = formValues();
      const serialized = JSON.stringify({
        version: 5,
        pricingScope: 'internal',
        savedAt: '2026-09-13T01:00:00Z',
        values: { ...values, items: [{ ...values.items[0], crafts }] },
      });
      expect(parseLocalOrderFormDraft(serialized, 'internal')).toBeNull();
    },
  );
  it.each(['internal', 'external-sales'] as const)(
    'retains every finishing fact after repeated %s draft saves',
    (scope) => {
      for (const lamination of [
        'NONE',
        'MATTE',
        'SOFT_TOUCH',
        'NEW_GLOSS',
        'LASER',
      ]) {
        const values = formValues();
        const item = {
          ...values.items[0],
          pricingRoute: 'COLOR_PRINT',
          paperType: '200g铜版纸',
          lamination,
        };
        const first = serializeLocalOrderFormDraft(
          { ...values, items: [item] },
          scope,
        )!;
        const restored = parseLocalOrderFormDraft(first, scope)!;
        const second = parseLocalOrderFormDraft(
          serializeLocalOrderFormDraft(restored.values, scope)!,
          scope,
        )!;
        expect(second.values.items).toEqual([
          expect.objectContaining({ lamination, printColors: ['C', 'M'] }),
        ]);
        expect(second.values.items).not.toEqual([
          expect.objectContaining({ unitPrice: '0.2500' }),
        ]);
      }
    },
  );

  it.each([4, 5])(
    'restores version %s missing finishing as an explicit selection gap without discarding other work',
    (version) => {
      const values = formValues();
      values.items[0]!.pricingRoute = 'COLOR_PRINT';
      values.items[0]!.paperType = '200gCOATED';
      const raw = JSON.stringify({
        version,
        pricingScope: 'external-sales',
        savedAt: '2026-09-13T01:00:00Z',
        values,
      });
      const restored = parseLocalOrderFormDraft(raw, 'external-sales')!;
      const item = (
        restored.values.items as Array<Record<string, unknown>>
      )[0]!;
      expect(item).toMatchObject({
        name: '外盒',
        quantity: 8000,
        lamination: null,
      });
      expect(needsOrderItemLaminationSelection(item)).toBe(true);
      expect(
        needsOrderItemLaminationSelection({
          ...item,
          lamination: 'SOFT_TOUCH',
        }),
      ).toBe(false);
      expect(restored.values.customerRef).toBe(values.customerRef);
      expect(restored.values.packagingGroups).toEqual([
        expect.objectContaining({ actualBagCount: 100 }),
      ]);
    },
  );

  it('discovers only valid transfer drafts in the current account and pricing scope, newest first', () => {
    const base = localOrderFormDraftStorageKey('sales-1', true);
    const ids = ['a', 'b', 'c'].map(
      (letter) => `${letter.repeat(8)}-1111-1111-1111-111111111111`,
    );
    const raw = (
      date: string,
      scope: 'internal' | 'external-sales' = 'external-sales',
    ) =>
      serializeLocalOrderFormDraft(
        { ...formValues(), customName: '待继续工单' },
        scope,
        new Date(date),
      )!;
    const entries = new Map([
      [base, raw('2026-09-13')],
      [`${base}:workbench:${ids[0]}`, raw('2026-09-12')],
      [`${base}:workbench:${ids[1]}`, raw('2026-09-13')],
      [`${base}:workbench:${ids[2]}`, raw('2026-09-14', 'internal')],
      [`${base}:workbench:../invalid`, raw('2026-09-14')],
      [`${base}:workbench:${'d'.repeat(36)}`, 'invalid json'],
      [
        `${localOrderFormDraftStorageKey('sales-2', true)}:workbench:${ids[0]}`,
        raw('2026-09-15'),
      ],
    ]);
    const storage = {
      length: entries.size,
      key: (index: number) => [...entries.keys()][index] ?? null,
      getItem: (key: string) => entries.get(key) ?? null,
    };
    expect(listLocalWorkbenchDrafts(storage, base, 'external-sales')).toEqual([
      { id: ids[1], name: '待继续工单', savedAt: '2026-09-13T00:00:00.000Z' },
      { id: ids[0], name: '待继续工单', savedAt: '2026-09-12T00:00:00.000Z' },
    ]);
  });
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
    expect(parsed?.values.isUrgent).toBe(false);
    expect(parsed?.values.items).toEqual([
      expect.objectContaining({
        name: '外盒',
        pricingRoute: 'CUSTOM_SINGLE_FLAT_FOIL',
        productStructure: 'WESTERN_ENVELOPE',
        artworkVersion: '第 3 版',
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

  it.each([true, false])('round-trips the urgent flag as %s', (isUrgent) => {
    const values = formValues();
    values.isUrgent = isUrgent;

    const serialized = serializeLocalOrderFormDraft(values, 'internal');
    const parsed = parseLocalOrderFormDraft(serialized!, 'internal');

    expect(parsed?.values.isUrgent).toBe(isUrgent);
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

it('preserves multiline order remarks in local drafts', () => {
  const remark = '先核对样稿\n再安排生产';
  const saved = serializeLocalOrderFormDraft(
    { ...formValues(), remark },
    'external-sales',
  );
  expect(
    parseLocalOrderFormDraft(saved!, 'external-sales')?.values.remark,
  ).toBe(remark);
});

it('preserves the admin recipient and drops retired group inputs from old drafts', () => {
  const values = { ...formValues(), externalSalesUserId: 'sales-2' };
  const draft = parseLocalOrderFormDraft(
    serializeLocalOrderFormDraft(values, 'internal')!,
    'internal',
  )!;
  expect(draft.values.externalSalesUserId).toBe('sales-2');
  expect(JSON.stringify(draft.values.items)).not.toMatch(
    /plateGroupId|pricingGroup/,
  );
  const external = parseLocalOrderFormDraft(
    serializeLocalOrderFormDraft(values, 'external-sales')!,
    'external-sales',
  )!;
  expect(external.values).not.toHaveProperty('externalSalesUserId');
});
