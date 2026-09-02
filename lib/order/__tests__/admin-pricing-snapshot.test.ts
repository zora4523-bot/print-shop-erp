import { describe, expect, it } from 'vitest';
import { isTrustedAdminPricingSnapshot } from '../admin-pricing-snapshot';

function confirmedSnapshot() {
  return {
    source: 'ADMIN_SNAPSHOT_CONFIRMATION',
    status: 'ADMIN_CONFIRMED',
    actual: {
      amount: '30.00',
      provisional: false,
      requiresAdminConfirmation: false,
      automatic: false,
    },
    confirmation: {
      actorId: 'admin-1',
      confirmedAt: '2026-09-02T02:00:00.000Z',
    },
  };
}

describe('isTrustedAdminPricingSnapshot', () => {
  it('accepts only a complete administrator confirmation envelope', () => {
    expect(isTrustedAdminPricingSnapshot(confirmedSnapshot())).toBe(true);
  });

  it.each([
    ['source marker only', { source: 'ADMIN_SNAPSHOT_CONFIRMATION' }],
    ['status marker only', { status: 'ADMIN_CONFIRMED' }],
    ['confirmation object only', { confirmation: { actorId: 'admin-1' } }],
    [
      'still provisional',
      {
        ...confirmedSnapshot(),
        actual: { ...confirmedSnapshot().actual, provisional: true },
      },
    ],
    [
      'missing actor',
      { ...confirmedSnapshot(), confirmation: { confirmedAt: '2026-09-02T02:00:00.000Z' } },
    ],
    [
      'invalid confirmation time',
      {
        ...confirmedSnapshot(),
        confirmation: { actorId: 'admin-1', confirmedAt: 'not-a-date' },
      },
    ],
  ])('rejects %s', (_label, snapshot) => {
    expect(isTrustedAdminPricingSnapshot(snapshot)).toBe(false);
  });
});
