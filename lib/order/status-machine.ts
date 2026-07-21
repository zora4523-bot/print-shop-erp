import { OrderStatus } from '../../generated/prisma/enums';

// Thrown by `transitionOrder` when the requested change isn't in the allowed
// transition table. Callers (Server Actions) should catch and map to a
// field-free "invalid operation" message for the UI.
export class InvalidOrderTransitionError extends Error {
  readonly from: OrderStatus;
  readonly to: OrderStatus;
  constructor(from: OrderStatus, to: OrderStatus) {
    super(`工单状态不能从 ${from} 直接切到 ${to}`);
    this.name = 'InvalidOrderTransitionError';
    this.from = from;
    this.to = to;
  }
}

// Canonical transitions (SPEC §4.3):
//   DRAFT → SUBMITTED → SCHEDULING → IN_PRODUCTION → COMPLETED → SHIPPED → FINISHED
// Any non-terminal state can also transition to CANCELLED.
// FINISHED and CANCELLED are terminal — no outbound transitions.
export const ORDER_TRANSITIONS = {
  [OrderStatus.DRAFT]: [OrderStatus.SUBMITTED, OrderStatus.CANCELLED],
  [OrderStatus.SUBMITTED]: [OrderStatus.SCHEDULING, OrderStatus.CANCELLED],
  // Pure-outsource orders have no internal task to trigger IN_PRODUCTION;
  // receiving the last outsource order completes them directly.
  [OrderStatus.SCHEDULING]: [
    OrderStatus.IN_PRODUCTION,
    OrderStatus.COMPLETED,
    OrderStatus.CANCELLED,
  ],
  [OrderStatus.IN_PRODUCTION]: [OrderStatus.COMPLETED, OrderStatus.CANCELLED],
  [OrderStatus.COMPLETED]: [OrderStatus.SHIPPED, OrderStatus.CANCELLED],
  [OrderStatus.SHIPPED]: [OrderStatus.FINISHED, OrderStatus.CANCELLED],
  [OrderStatus.FINISHED]: [],
  [OrderStatus.CANCELLED]: [],
} as const satisfies Record<OrderStatus, readonly OrderStatus[]>;

// Pure guard — no side effects. Returns the target status on a valid move,
// throws InvalidOrderTransitionError otherwise. CLAUDE.md §4.5 requires
// every status write to go through this function so the transition table
// is the single source of truth. Never write `data: { status: 'XXX' }`
// directly in a Prisma update.
export function transitionOrder(from: OrderStatus, to: OrderStatus): OrderStatus {
  if (!canTransitionOrder(from, to)) {
    throw new InvalidOrderTransitionError(from, to);
  }
  return to;
}

export function canTransitionOrder(from: OrderStatus, to: OrderStatus): boolean {
  const allowed = ORDER_TRANSITIONS[from] as readonly OrderStatus[];
  return allowed.includes(to);
}

export function isTerminalOrderStatus(status: OrderStatus): boolean {
  return ORDER_TRANSITIONS[status].length === 0;
}

// Whether new outsource work can still be attached to an order in
// this status. Distinct from `isTerminalOrderStatus` because SHIPPED
// is non-terminal (it can still go to FINISHED) yet shouldn't accept
// new production work — the goods are already out the door.
// Production-active states only.
export function canAttachOutsource(status: OrderStatus): boolean {
  switch (status) {
    case OrderStatus.DRAFT:
    case OrderStatus.SUBMITTED:
    case OrderStatus.SCHEDULING:
    case OrderStatus.IN_PRODUCTION:
      return true;
    case OrderStatus.COMPLETED:
    case OrderStatus.SHIPPED:
    case OrderStatus.FINISHED:
    case OrderStatus.CANCELLED:
      return false;
  }
}
