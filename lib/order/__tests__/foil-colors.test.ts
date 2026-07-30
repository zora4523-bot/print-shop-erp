import { describe, expect, it } from 'vitest';
import { formatFoilColors } from '../foil-colors';

describe('formatFoilColors', () => {
  it('joins multiple colors with a CJK list separator', () => {
    expect(formatFoilColors(['哑金', '红金', '古铜金'])).toBe(
      '哑金、红金、古铜金',
    );
  });

  it('uses the requested empty fallback', () => {
    expect(formatFoilColors([], '-')).toBe('-');
    expect(formatFoilColors(undefined)).toBe('—');
  });
});
