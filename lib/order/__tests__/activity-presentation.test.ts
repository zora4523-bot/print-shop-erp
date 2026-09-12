import { describe, expect, it } from 'vitest';
import { presentActivityChanges } from '../activity-presentation';

describe('activity presentation', () => {
  it('suppresses precise equal amounts without suppressing cleared or changed money', () => {
    const result = presentActivityChanges({
      totalAmount: { before: '466.320', after: '466.32' },
      confirmedFee: { before: '454.32', after: '466.32' },
      quotedFee: { before: '454.32', after: '454.3200' },
      settledFee: { before: '100.00', after: null },
      priceRevision: { before: 2, after: 3 },
    });
    expect(result.primary).toEqual([{ field: 'confirmedFee', label: '确认金额', before: '¥ 454.32', after: '¥ 466.32' }]);
    expect(result.details.map(row => row.field)).toEqual(['settledFee', 'priceRevision']);
    expect(result.details[0]?.after).toBe('已清空');
    expect(result.unavailable).toBe(false);
  });
  it('never determines equality from rounded display strings', () => {
    expect(presentActivityChanges({ totalAmount: { before: '1.001', after: '1.002' } }).primary).toHaveLength(1);
  });
  it('keeps unknown history visible as an unavailable detail without exposing raw objects', () => {
    const result = presentActivityChanges({ secret: { before: { token: 'private' }, after: { token: 'other' } }, status: { before: 'DRAFT', after: 'SUBMITTED' } });
    expect(result.unavailable).toBe(true);
    expect(JSON.stringify(result)).not.toContain('private');
    expect(result.primary[0]?.after).toBe('已提交');
  });
  it('omits unchanged scalar values and internal references, preserving removals', () => {
    const result = presentActivityChanges({ quotedPricingRevisionId: { before: 'secret-id', after: 'new-id' }, priceRevision: { before: 3, after: 3 }, remark: { before: '原备注', after: null } });
    expect(result.details).toEqual([{ field: 'remark', label: '工单备注', before: '原备注', after: '已清空' }]);
    expect(result.unavailable).toBe(false);
  });
  it('handles absent, invalid and malformed amounts', () => {
    expect(presentActivityChanges(null)).toEqual({ primary: [], details: [], unavailable: false });
    expect(presentActivityChanges({ totalAmount: { before: 'invalid', after: '1' } }).unavailable).toBe(true);
    expect(presentActivityChanges({ totalAmount: { before: 'invalid', after: 'invalid' } }).unavailable).toBe(true);
  });
});
