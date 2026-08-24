import { describe, expect, it } from 'vitest';
import {
  localOrderFormDraftStorageKey,
  parseLocalOrderFormDraft,
  serializeLocalOrderFormDraft,
} from '../order-form-local-draft';

function formValues() {
  return {
    customerRef: '星河礼品',
    promisedDate: new Date('2026-09-01T00:00:00.000Z'),
    isUrgent: false,
    isSfCollect: false,
    items: [
      {
        name: '外盒',
        productId: 'product-1',
        quantity: 8_000,
        crafts: ['foil'],
        foilColors: [],
        fixedFee: '20.00',
        designFile: new Blob(['image'], { type: 'image/png' }),
      },
    ],
    additionalShipments: [],
    pendingDesigns: {
      row: [new Blob(['image'], { type: 'image/png' })],
    },
  };
}

describe('order form local draft', () => {
  it('keeps only serializable RHF fields and never persists design files', () => {
    const serialized = serializeLocalOrderFormDraft(
      formValues(),
      new Date('2026-08-24T03:00:00.000Z'),
    );

    expect(serialized).not.toBeNull();
    expect(serialized).not.toContain('pendingDesigns');
    expect(serialized).not.toContain('designFile');
    const parsed = parseLocalOrderFormDraft(serialized!);
    expect(parsed?.savedAt).toBe('2026-08-24T03:00:00.000Z');
    expect(parsed?.values.promisedDate).toBe('2026-09-01');
    expect(parsed?.values.items).toEqual([
      expect.objectContaining({ name: '外盒', fixedFee: '20.00' }),
    ]);
  });

  it('fails closed for corrupt, obsolete, or structurally invalid drafts', () => {
    expect(parseLocalOrderFormDraft('{')).toBeNull();
    expect(
      parseLocalOrderFormDraft(
        JSON.stringify({ version: 2, savedAt: new Date().toISOString(), values: {} }),
      ),
    ).toBeNull();
    expect(
      parseLocalOrderFormDraft(
        JSON.stringify({
          version: 1,
          savedAt: 'not-a-date',
          values: { items: [], additionalShipments: [] },
        }),
      ),
    ).toBeNull();
  });

  it('isolates drafts by signed-in user and settlement path', () => {
    expect(localOrderFormDraftStorageKey('user/1', true)).not.toBe(
      localOrderFormDraftStorageKey('user/2', true),
    );
    expect(localOrderFormDraftStorageKey('user/1', true)).not.toBe(
      localOrderFormDraftStorageKey('user/1', false),
    );
  });
});
