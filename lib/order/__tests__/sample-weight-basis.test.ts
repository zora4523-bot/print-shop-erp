import Decimal from 'decimal.js';
import { describe, expect, it } from 'vitest';
import {
  reconcileSampleWeightBasis,
  SAMPLE_FIRST_WEIGHT_DEFAULT,
  sampleDefaultWeightKg,
  sampleFirstWeightDefaultMarker,
} from '../sample-weight-basis';

const marked = { source: 'SAMPLE_ORDER_QUOTE', ...sampleFirstWeightDefaultMarker('1.000') };

describe('sample first-weight default marker', () => {
  it('records the default weight it was written with', () => {
    expect(sampleFirstWeightDefaultMarker(new Decimal('1.000'))).toEqual({
      weightBasis: SAMPLE_FIRST_WEIGHT_DEFAULT,
      defaultWeightKg: '1',
    });
    expect(sampleDefaultWeightKg(marked)?.toString()).toBe('1');
  });

  it('reads no default from unmarked, malformed or non-object snapshots', () => {
    expect(sampleDefaultWeightKg({ source: 'X' })).toBeNull();
    expect(sampleDefaultWeightKg({ weightBasis: SAMPLE_FIRST_WEIGHT_DEFAULT })).toBeNull();
    expect(sampleDefaultWeightKg({ weightBasis: SAMPLE_FIRST_WEIGHT_DEFAULT, defaultWeightKg: 'abc' })).toBeNull();
    expect(sampleDefaultWeightKg(null)).toBeNull();
    expect(sampleDefaultWeightKg(['x'])).toBeNull();
  });

  it('keeps the marker while the final weight still equals the default (the shipping form re-sends the stored 1 kg)', () => {
    for (const weight of ['1', '1.000', new Decimal(1)]) {
      expect(reconcileSampleWeightBasis(marked, { source: 'FINAL' }, weight)).toEqual({
        source: 'FINAL', weightBasis: SAMPLE_FIRST_WEIGHT_DEFAULT, defaultWeightKg: '1',
      });
    }
  });

  it('drops the marker once the weight was corrected, cleared or the parcel became SF collect', () => {
    for (const weight of ['2', '0.5', null, undefined, '']) {
      expect(reconcileSampleWeightBasis(marked, { source: 'FINAL', weightBasis: SAMPLE_FIRST_WEIGHT_DEFAULT, defaultWeightKg: '1' }, weight))
        .toEqual({ source: 'FINAL' });
    }
  });

  it('falls back to the marker of the restored snapshot when the previous one carried none (prepaid → SF collect → prepaid)', () => {
    const restored = { source: 'RESTORED', ...sampleFirstWeightDefaultMarker('1') };
    expect(reconcileSampleWeightBasis({ source: 'SF' }, restored, '1')).toEqual(restored);
    expect(reconcileSampleWeightBasis({ source: 'SF' }, restored, '2')).toEqual({ source: 'RESTORED' });
    expect(reconcileSampleWeightBasis({ source: 'SF' }, restored, null)).toEqual({ source: 'RESTORED' });
  });

  it('strips a marker that records no usable default weight', () => {
    expect(reconcileSampleWeightBasis({ source: 'X' }, { source: 'Y', weightBasis: SAMPLE_FIRST_WEIGHT_DEFAULT }, '1'))
      .toEqual({ source: 'Y' });
  });

  it('reads the default of an older marked snapshot from its own quote line only when billable equals first weight', () => {
    const legacy = (billableWeightKg: string) => ({
      weightBasis: SAMPLE_FIRST_WEIGHT_DEFAULT,
      line: { basis: { billableWeightKg, firstWeightKg: '1' } },
    });
    expect(sampleDefaultWeightKg(legacy('1.000'))?.toString()).toBe('1');
    expect(sampleDefaultWeightKg(legacy('2'))).toBeNull();
    expect(reconcileSampleWeightBasis(legacy('1'), { source: 'FINAL' }, '1')).toEqual({
      source: 'FINAL', weightBasis: SAMPLE_FIRST_WEIGHT_DEFAULT, defaultWeightKg: '1',
    });
    expect(reconcileSampleWeightBasis(legacy('1'), { source: 'FINAL' }, '2')).toEqual({ source: 'FINAL' });
  });
});
