import { OrderPricingStatus, OrderStatus } from '../../generated/prisma/enums';

/**
 * Both statuses mean "submitted, awaiting readiness checks or exception handling".
 * PENDING_FACTORY is canonical; SUBMITTED remains readable/writable during the
 * expand-migrate-contract window. Keeping this list shared prevents the admin
 * queue and the backlog notifier from counting different work orders.
 */
export const FACTORY_CONFIRMATION_PENDING_STATUSES = [
  OrderStatus.PENDING_FACTORY,
  OrderStatus.SUBMITTED,
] as const;

const FACTORY_CONFIRMATION_PENDING_STATUS_SET: ReadonlySet<OrderStatus> =
  new Set(FACTORY_CONFIRMATION_PENDING_STATUSES);

export function isAwaitingFactoryConfirmation(status: OrderStatus): boolean {
  return FACTORY_CONFIRMATION_PENDING_STATUS_SET.has(status);
}

export type FactoryConfirmationPreflightFacts = {
  status: OrderStatus;
  itemQuantities: readonly number[];
  pricingStatus: OrderPricingStatus;
  confirmedFee: unknown | null;
  totalAmount: unknown | null;
  pendingChangeRequestCount: number;
  manualPricingPending: boolean;
};

export type FactoryConfirmationPreflight = {
  ok: boolean;
  issues: string[];
};

/**
 * Shared, side-effect-free confirmation gate used by both the workspace read
 * model and the transactional command. The command still re-reads these
 * facts under the order lock; the UI result is guidance, never authorization.
 */
export function evaluateFactoryConfirmationPreflight(
  facts: FactoryConfirmationPreflightFacts,
  options: { allowConfirmed?: boolean } = {},
): FactoryConfirmationPreflight {
  const issues: string[] = [];

  if (!isAwaitingFactoryConfirmation(facts.status) && !(options.allowConfirmed && facts.status === OrderStatus.CONFIRMED)) {
    issues.push('当前不是待工厂确认状态');
  }
  if (facts.pendingChangeRequestCount > 0) {
    issues.push('存在待裁决变更申请');
  }
  if (
    facts.itemQuantities.length === 0 ||
    facts.itemQuantities.some((quantity) => quantity < 1)
  ) {
    issues.push('款式或数量不完整');
  }
  if (
    facts.pricingStatus === OrderPricingStatus.PENDING_ADMIN_CONFIRMATION ||
    facts.manualPricingPending
  ) {
    issues.push('仍有待人工核价项');
  }
  if (facts.confirmedFee === null && facts.totalAmount === null) {
    issues.push('缺少可信的确认费用');
  }

  return { ok: issues.length === 0, issues };
}
