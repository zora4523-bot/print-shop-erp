import { describe, expect, it } from 'vitest';
import { adminOrderCraftTags, adminOrderDueHint } from '../admin-list-presentation';

describe('admin order list presentation', () => {
  it('deduplicates canonical crafts in a stable order and ignores unknown legacy values', () => {
    expect(adminOrderCraftTags(['PRINT', null, 'PARTIAL', 'FULL', 'PARTIAL', undefined, 'custom-id'])).toEqual(['局部烫金', '专版烫金', '彩印']);
    expect(adminOrderCraftTags([])).toEqual([]);
    expect(adminOrderCraftTags([null, '专版烫金'])).toEqual([]);
  });
  it.each([[0, '今天到期'], [1, '明天到期'], [2, '剩 2 天'], [3, '剩 3 天']] as const)('labels imminent delivery at %i days', (days, label) => {
    expect(adminOrderDueHint({ kind: 'due-soon', days })).toBe(label);
  });
  it('keeps overdue alerts but omits countdowns when the server returns no alert', () => {
    expect(adminOrderDueHint({ kind: 'overdue', days: 4 })).toBe('逾期 4 天');
    expect(adminOrderDueHint(null)).toBeNull();
  });
});
