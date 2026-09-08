import { describe, expect, it } from 'vitest';
import {
  orderNoFromHash,
} from '../order-detail-hash';

describe('orderNoFromHash', () => {
  it('reads and decodes the #wo deep-link contract', () => {
    expect(orderNoFromHash('#wo=GD-260902-001')).toBe('GD-260902-001');
    expect(orderNoFromHash('wo=%E6%B5%8B%E8%AF%95-1')).toBe('测试-1');
  });

  it('ignores unrelated, empty and oversized hashes', () => {
    expect(orderNoFromHash('#section=fees')).toBeNull();
    expect(orderNoFromHash('#wo=')).toBeNull();
    expect(orderNoFromHash(`#wo=${'x'.repeat(129)}`)).toBeNull();
  });
});
