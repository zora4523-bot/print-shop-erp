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

  it('keeps transitions pending for the full request and handles rejected promises', () => {
    expect(source).toContain('startTransition(async () =>');
    expect(source).toContain('finish(await task())');
    expect(source).toContain("setMessage('操作未完成，请刷新工单后重试。')");
    expect(source).not.toContain('void task().then(finish)');
  });

  it('routes directly to assignment without a standalone release action', () => {
    expect(source).not.toContain('confirmFactoryOrderAction');
    expect(source).not.toContain('确认并锁定金额');
    expect(source).not.toContain('releaseFactoryOrderAction');
    expect(source).toContain('/orders/production?ids=');
    expect(source).toContain('expectedRevision: order.revision');
    expect(source).toContain('expectedWorkOrderVersion: order.workOrderVersion');
  });
});
