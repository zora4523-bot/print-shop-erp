import { describe, expect, it } from 'vitest';
import {
  employmentCoversDate,
  employmentOverlapsDateRange,
} from '../employment';

describe('salary employment boundaries', () => {
  const employment = {
    employmentStartDate: new Date('2026-05-10T00:00:00.000Z'),
    employmentEndDate: new Date('2026-06-20T00:00:00.000Z'),
  };

  it('includes both exact boundary dates', () => {
    expect(
      employmentCoversDate(
        new Date('2026-05-10T00:00:00.000Z'),
        employment,
      ),
    ).toBe(true);
    expect(
      employmentCoversDate(
        new Date('2026-06-20T00:00:00.000Z'),
        employment,
      ),
    ).toBe(true);
    expect(
      employmentCoversDate(
        new Date('2026-05-09T00:00:00.000Z'),
        employment,
      ),
    ).toBe(false);
    expect(
      employmentCoversDate(
        new Date('2026-06-21T00:00:00.000Z'),
        employment,
      ),
    ).toBe(false);
  });

  it('recognizes cross-month overlap and wholly disjoint months', () => {
    expect(
      employmentOverlapsDateRange(
        new Date('2026-05-01T00:00:00.000Z'),
        new Date('2026-06-01T00:00:00.000Z'),
        employment,
      ),
    ).toBe(true);
    expect(
      employmentOverlapsDateRange(
        new Date('2026-04-01T00:00:00.000Z'),
        new Date('2026-05-01T00:00:00.000Z'),
        employment,
      ),
    ).toBe(false);
    expect(
      employmentOverlapsDateRange(
        new Date('2026-07-01T00:00:00.000Z'),
        new Date('2026-08-01T00:00:00.000Z'),
        employment,
      ),
    ).toBe(false);
  });
});
