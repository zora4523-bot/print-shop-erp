import { describe, expect, it } from 'vitest';
import {
  agentBillPeriodRange,
  assertClosedAgentBillPeriod,
  isAgentBillPeriod,
} from '../period';

describe('agent monthly bill Shanghai period', () => {
  it.each(['2026-01', '2026-12'])('accepts a strict month: %s', (period) => {
    expect(isAgentBillPeriod(period)).toBe(true);
  });

  it.each(['2026-00', '2026-13', '26-01', '2026-1'])('rejects %s', (period) => {
    expect(isAgentBillPeriod(period)).toBe(false);
  });

  it('uses the exact Shanghai [start,end) instant range', () => {
    expect(agentBillPeriodRange('2026-05')).toEqual({
      start: new Date('2026-04-30T16:00:00.000Z'),
      end: new Date('2026-05-31T16:00:00.000Z'),
    });
  });

  it('allows only completed Shanghai months', () => {
    const now = new Date('2026-06-01T00:00:00.000Z');
    expect(() => assertClosedAgentBillPeriod('2026-05', now)).not.toThrow();
    expect(() => assertClosedAgentBillPeriod('2026-06', now)).toThrow(
      '只能生成已结束的上海日历月账单',
    );
  });
});
