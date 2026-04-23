import { OutsourceStatus } from '../../generated/prisma/enums';

export class InvalidOutsourceTransitionError extends Error {
  readonly from: OutsourceStatus;
  readonly to: OutsourceStatus;
  constructor(from: OutsourceStatus, to: OutsourceStatus) {
    super(`外协单状态不能从 ${from} 直接切到 ${to}`);
    this.name = 'InvalidOutsourceTransitionError';
    this.from = from;
    this.to = to;
  }
}

// SPEC §4.3: SENT → IN_PROGRESS → RECEIVED; any non-terminal state →
// CANCELLED. IN_PROGRESS is an optional mid-step (supplier
// acknowledged but hasn't shipped back); the happy path can go
// SENT → RECEIVED directly when there's no tracking worth the extra
// state transition.
export const OUTSOURCE_TRANSITIONS = {
  [OutsourceStatus.SENT]: [
    OutsourceStatus.IN_PROGRESS,
    OutsourceStatus.RECEIVED,
    OutsourceStatus.CANCELLED,
  ],
  [OutsourceStatus.IN_PROGRESS]: [
    OutsourceStatus.RECEIVED,
    OutsourceStatus.CANCELLED,
  ],
  [OutsourceStatus.RECEIVED]: [],
  [OutsourceStatus.CANCELLED]: [],
} as const satisfies Record<OutsourceStatus, readonly OutsourceStatus[]>;

export function transitionOutsource(
  from: OutsourceStatus,
  to: OutsourceStatus,
): OutsourceStatus {
  if (!canTransitionOutsource(from, to)) {
    throw new InvalidOutsourceTransitionError(from, to);
  }
  return to;
}

export function canTransitionOutsource(
  from: OutsourceStatus,
  to: OutsourceStatus,
): boolean {
  return (OUTSOURCE_TRANSITIONS[from] as readonly OutsourceStatus[]).includes(to);
}

export function isTerminalOutsourceStatus(status: OutsourceStatus): boolean {
  return OUTSOURCE_TRANSITIONS[status].length === 0;
}
