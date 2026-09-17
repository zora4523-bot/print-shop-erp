import { describe, expect, it } from 'vitest';
import { isRetiredPaper } from '../paper-availability';

describe('retired paper availability for new business', () => {
  it.each([{ weight: 120 }, { name: '120g珠光艳闪' }, { paperType: '120 G艳闪' }, { specification: '120克' }])('blocks %j', (paper) => {
    expect(isRetiredPaper(paper)).toBe(true);
  });
  it.each([{ weight: 160 }, { name: '160g珠光艳闪' }, { specification: '西封中号80×120' }, { name: '1200g纸' }, {}])('preserves %j', (paper) => {
    expect(isRetiredPaper(paper)).toBe(false);
  });
});
