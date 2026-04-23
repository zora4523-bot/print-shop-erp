import { SalaryPeriodStatus } from '../../../generated/prisma/enums';

export class InvalidCsPeriodTransitionError extends Error {
  readonly from: SalaryPeriodStatus;
  readonly to: SalaryPeriodStatus;
  constructor(from: SalaryPeriodStatus, to: SalaryPeriodStatus) {
    super(`业绩周期状态不能从 ${from} 直接切到 ${to}`);
    this.name = 'InvalidCsPeriodTransitionError';
    this.from = from;
    this.to = to;
  }
}

// SPEC §4.3: IN_PROGRESS → SETTLED (only). SETTLED is terminal. There
// is no CANCELLED for salary periods — a period either runs to its
// periodEnd and settles, or (in pre-MVP data) gets a new row added in
// front to correct historical state.
export const CS_PERIOD_TRANSITIONS = {
  [SalaryPeriodStatus.IN_PROGRESS]: [SalaryPeriodStatus.SETTLED],
  [SalaryPeriodStatus.SETTLED]: [],
} as const satisfies Record<SalaryPeriodStatus, readonly SalaryPeriodStatus[]>;

export function transitionCsPeriod(
  from: SalaryPeriodStatus,
  to: SalaryPeriodStatus,
): SalaryPeriodStatus {
  if (!canTransitionCsPeriod(from, to)) {
    throw new InvalidCsPeriodTransitionError(from, to);
  }
  return to;
}

export function canTransitionCsPeriod(
  from: SalaryPeriodStatus,
  to: SalaryPeriodStatus,
): boolean {
  return (CS_PERIOD_TRANSITIONS[from] as readonly SalaryPeriodStatus[]).includes(to);
}

export function isTerminalCsPeriodStatus(status: SalaryPeriodStatus): boolean {
  return CS_PERIOD_TRANSITIONS[status].length === 0;
}
