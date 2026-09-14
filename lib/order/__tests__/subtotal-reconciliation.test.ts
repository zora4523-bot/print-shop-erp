import { describe, expect, it } from 'vitest';
import { subtotalReconciles } from '../subtotal-reconciliation';

describe('subtotalReconciles', () => {
  it.each(['0', '0.005', '0.01', '-0.005', '-0.01'])('允许差额 %s', (difference) => {
    expect(subtotalReconciles(difference, '0')).toBe(true);
  });
  it.each(['0.011', '0.02', '-0.011', '-0.02'])('拒绝差额 %s', (difference) => {
    expect(subtotalReconciles(difference, '0')).toBe(false);
  });
});
