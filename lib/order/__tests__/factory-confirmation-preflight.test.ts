import { describe, expect, it } from 'vitest';
import { OrderPricingStatus, OrderStatus } from '@/generated/prisma/enums';
import { evaluateFactoryConfirmationPreflight } from '../factory-confirmation-preflight';

function facts(
  patch: Partial<
    Parameters<typeof evaluateFactoryConfirmationPreflight>[0]
  > = {},
) {
  return {
    status: OrderStatus.PENDING_FACTORY,
    itemQuantities: [1_000],
    pricingStatus: OrderPricingStatus.AUTO_CONFIRMED,
    confirmedFee: null,
    totalAmount: '120.00',
    pendingChangeRequestCount: 0,
    manualPricingPending: false,
    ...patch,
  };
}

describe('factory confirmation preflight', () => {
  it('shares an affirmative result for canonical and legacy pending rows', () => {
    expect(evaluateFactoryConfirmationPreflight(facts())).toEqual({
      ok: true,
      issues: [],
    });
    expect(
      evaluateFactoryConfirmationPreflight(
        facts({ status: OrderStatus.SUBMITTED }),
      ),
    ).toEqual({ ok: true, issues: [] });
  });

  it('returns every actionable missing fact instead of only the first one', () => {
    expect(
      evaluateFactoryConfirmationPreflight(
        facts({
          itemQuantities: [],
          pricingStatus: OrderPricingStatus.PENDING_ADMIN_CONFIRMATION,
          confirmedFee: null,
          totalAmount: null,
          pendingChangeRequestCount: 1,
        }),
      ),
    ).toEqual({
      ok: false,
      issues: [
        '存在待裁决变更申请',
        '款式或数量不完整',
        '仍有待人工核价项',
        '缺少可信的确认费用',
      ],
    });
  });
});
