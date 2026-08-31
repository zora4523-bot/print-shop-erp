import { describe, expect, it } from 'vitest';
import { txReasonLabel } from '../material-labels';

describe('material transaction reason labels', () => {
  it('uses business labels without exposing an unknown reason token', () => {
    expect(txReasonLabel('PRODUCTION_USE')).toBe('生产领用');
    expect(txReasonLabel('RAW_REASON_TYPE')).toBe('未识别出入库原因');
  });
});
