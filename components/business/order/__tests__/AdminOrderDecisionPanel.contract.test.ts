import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const source = readFileSync(
  'components/business/order/AdminOrderDecisionPanel.tsx',
  'utf8',
);

describe('admin order decision reason contract', () => {
  it('limits REJECT to paper/design while PRICE_PENDING remains HOLD-only', () => {
    const rejectReasons = source.match(
      /const REJECT_REASONS = \[([\s\S]*?)\] as const;/,
    )?.[1];
    const holdReasons = source.match(
      /const HOLD_REASONS = \[([\s\S]*?)\] as const;/,
    )?.[1];

    expect(rejectReasons).toContain('PAPER_OUT');
    expect(rejectReasons).toContain('DESIGN_ERROR');
    expect(rejectReasons).not.toContain('PRICE_PENDING');
    expect(holdReasons).toContain('PRICE_PENDING');
  });
});
