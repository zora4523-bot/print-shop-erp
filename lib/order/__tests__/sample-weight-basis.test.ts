import Decimal from 'decimal.js';
import { describe, expect, it } from 'vitest';
import {
  reconcileSampleWeightBasis,
  SAMPLE_FIRST_WEIGHT_DEFAULT,
  sampleDefaultWeightKg,
  sampleFirstWeightDefaultMarker,
} from '../sample-weight-basis';

const marked = { source: 'SAMPLE_ORDER_QUOTE', ...sampleFirstWeightDefaultMarker('1.000') };
const suspended = { source: 'SF', suspendedSampleDefaultWeightKg: '1' };
const prepaid = (weightKg: Decimal.Value | null | undefined) => ({ weightKg, sfCollect: false });
const sfCollect = (weightKg: Decimal.Value | null | undefined) => ({ weightKg, sfCollect: true });
const markerFields = { weightBasis: SAMPLE_FIRST_WEIGHT_DEFAULT, defaultWeightKg: '1' };

describe('sample first-weight default marker', () => {
  it('records the default weight it was written with', () => {
    expect(sampleFirstWeightDefaultMarker(new Decimal('1.000'))).toEqual(markerFields);
    expect(sampleDefaultWeightKg(marked)?.toString()).toBe('1');
    expect(sampleDefaultWeightKg(suspended)?.toString()).toBe('1');
  });

  it('reads no default from unmarked, malformed or non-object snapshots', () => {
    expect(sampleDefaultWeightKg({ source: 'X' })).toBeNull();
    expect(sampleDefaultWeightKg({ weightBasis: SAMPLE_FIRST_WEIGHT_DEFAULT })).toBeNull();
    expect(sampleDefaultWeightKg({ weightBasis: SAMPLE_FIRST_WEIGHT_DEFAULT, defaultWeightKg: 'abc' })).toBeNull();
    expect(sampleDefaultWeightKg({ suspendedSampleDefaultWeightKg: 'abc' })).toBeNull();
    expect(sampleDefaultWeightKg(null)).toBeNull();
    expect(sampleDefaultWeightKg(['x'])).toBeNull();
  });

  it('keeps the marker while a prepaid parcel is still billed at the default (the shipping form re-sends the stored 1 kg)', () => {
    for (const weight of ['1', '1.000', new Decimal(1)]) {
      expect(reconcileSampleWeightBasis(marked, { source: 'FINAL' }, prepaid(weight)))
        .toEqual({ source: 'FINAL', ...markerFields });
    }
  });

  it('revokes the default for good once a different weight is recorded, prepaid or SF collect', () => {
    for (const recorded of [prepaid('2'), prepaid('0.5'), sfCollect('2')]) {
      for (const previous of [marked, suspended]) {
        expect(reconcileSampleWeightBasis(previous, { source: 'NEXT', ...markerFields, suspendedSampleDefaultWeightKg: '1' }, recorded))
          .toEqual({ source: 'NEXT' });
      }
    }
  });

  it('parks the default without the marker while SF collect keeps the default or no weight, and restores it at the same weight', () => {
    for (const weight of ['1', null, undefined, '']) {
      expect(reconcileSampleWeightBasis(marked, { source: 'SF', ...markerFields }, sfCollect(weight)))
        .toEqual({ source: 'SF', suspendedSampleDefaultWeightKg: '1' });
    }
    expect(reconcileSampleWeightBasis(suspended, { source: 'PREPAID' }, prepaid('1.000')))
      .toEqual({ source: 'PREPAID', ...markerFields });
  });

  it('never revives a default from the next snapshot: a restored original prepaid snapshot carries a stale marker', () => {
    const restored = { source: 'RESTORED', ...markerFields };
    expect(reconcileSampleWeightBasis({ source: 'SF' }, restored, prepaid('1'))).toEqual({ source: 'RESTORED' });
    expect(reconcileSampleWeightBasis(suspended, restored, prepaid('1'))).toEqual(restored);
  });

  it('reads the default of an older marked snapshot from its own quote line only when billable equals first weight', () => {
    const legacy = (billableWeightKg: string) => ({
      weightBasis: SAMPLE_FIRST_WEIGHT_DEFAULT,
      line: { basis: { billableWeightKg, firstWeightKg: '1' } },
    });
    expect(sampleDefaultWeightKg(legacy('1.000'))?.toString()).toBe('1');
    expect(sampleDefaultWeightKg(legacy('2'))).toBeNull();
    expect(reconcileSampleWeightBasis(legacy('1'), { source: 'FINAL' }, prepaid('1')))
      .toEqual({ source: 'FINAL', ...markerFields });
    expect(reconcileSampleWeightBasis(legacy('1'), { source: 'FINAL' }, prepaid('2'))).toEqual({ source: 'FINAL' });
  });
});
