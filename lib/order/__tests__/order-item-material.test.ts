import { describe, expect, it } from 'vitest';
import { isCoatedOrderPaper } from '../order-item-material';

describe('coated-paper business identity', () => {
  it.each([
    '铜版纸',
    '200g铜版纸',
    'COATED',
    '200gCOATED',
    ' 200 克 tbz ',
    'Coated Paper',
  ])('recognizes %s', (label) => {
    expect(isCoatedOrderPaper(label)).toBe(true);
  });
  it.each([
    null,
    undefined,
    '',
    'uncoated',
    '160g珠光纸',
    'NOTCOATED',
    'TBZOther',
  ])('does not infer coated paper from %s', (label) => {
    expect(isCoatedOrderPaper(label)).toBe(false);
  });
});
