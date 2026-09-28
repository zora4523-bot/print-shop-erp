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

// Canonical work-order transitions:
//   DRAFT → PENDING_FACTORY → CONFIRMED → RELEASED → FOILING → PACKING
//         → SHIPPED → SETTLED
// ON_HOLD restores the prior state, then reconciles actual production. Assigned
// production may reopen PACKING/FOILING only with verified remaining work.
// SUBMITTED / SCHEDULING / IN_PRODUCTION / COMPLETED / FINISHED remain only
// as expand-migration compatibility states; they are deliberately retained
// until a later audited contract migration.
export const ORDER_TRANSITIONS = {
  [OrderStatus.DRAFT]: [
    OrderStatus.PENDING_FACTORY,
    OrderStatus.SUBMITTED,
    OrderStatus.CANCELLED,
  ],
  [OrderStatus.PENDING_FACTORY]: [
    OrderStatus.REJECTED,
    OrderStatus.CONFIRMED,
    OrderStatus.SCHEDULING,
    OrderStatus.CANCELLED,
  ],
  [OrderStatus.REJECTED]: [
    OrderStatus.PENDING_FACTORY,
    OrderStatus.CANCELLED,
  ],
  [OrderStatus.CONFIRMED]: [
    OrderStatus.ON_HOLD,
    OrderStatus.RELEASED,
    OrderStatus.CANCELLED,
  ],
  [OrderStatus.ON_HOLD]: [
    OrderStatus.CONFIRMED,
    OrderStatus.RELEASED,
    OrderStatus.FOILING,
    OrderStatus.PACKING,
    OrderStatus.CANCELLED,
  ],
  [OrderStatus.RELEASED]: [
    OrderStatus.ON_HOLD,
    OrderStatus.FOILING,
    OrderStatus.PACKING,
    OrderStatus.CANCELLED,
  ],
  [OrderStatus.FOILING]: [
    OrderStatus.RELEASED,
    OrderStatus.ON_HOLD,
    OrderStatus.PACKING,
    OrderStatus.CANCELLED,
  ],
  [OrderStatus.PACKING]: [
    OrderStatus.RELEASED,
    OrderStatus.ON_HOLD,
    OrderStatus.SHIPPED,
    OrderStatus.CANCELLED,
  ],
  [OrderStatus.SETTLED]: [],
  [OrderStatus.SUBMITTED]: [
    OrderStatus.CONFIRMED,
    OrderStatus.SCHEDULING,
    OrderStatus.CANCELLED,
  ],
  // Pure-outsource orders have no internal task to trigger IN_PRODUCTION;
  // receiving the last outsource order completes them directly.
  [OrderStatus.SCHEDULING]: [
    OrderStatus.RELEASED,
    OrderStatus.IN_PRODUCTION,
    OrderStatus.COMPLETED,
    OrderStatus.CANCELLED,
  ],
  [OrderStatus.IN_PRODUCTION]: [
    OrderStatus.FOILING,
    OrderStatus.PACKING,
    OrderStatus.COMPLETED,
    OrderStatus.CANCELLED,
  ],
  [OrderStatus.COMPLETED]: [
    OrderStatus.PACKING,
    OrderStatus.SHIPPED,
    OrderStatus.CANCELLED,
  ],
  [OrderStatus.SHIPPED]: [
    OrderStatus.SETTLED,
    OrderStatus.FINISHED,
    OrderStatus.CANCELLED,
  ],
  [OrderStatus.FINISHED]: [],
  [OrderStatus.CANCELLED]: [],
} as const satisfies Record<OrderStatus, readonly OrderStatus[]>;

// Pure guard — no side effects. Returns the target status on a valid move,
// throws InvalidOrderTransitionError otherwise. CLAUDE.md §4.5 requires
// every status write to go through this function so the transition table
// is the single source of truth. Never write `data: { status: 'XXX' }`
// directly in a Prisma update.
type ProductionReopenEvidence = { remainingAssignedProduction: true };

export function transitionOrder(from: OrderStatus, to: OrderStatus, evidence?: ProductionReopenEvidence): OrderStatus {
  if (!canTransitionOrder(from, to, evidence)) {
    throw new InvalidOrderTransitionError(from, to);
  }
  return to;
}

export function canTransitionOrder(from: OrderStatus, to: OrderStatus, evidence?: ProductionReopenEvidence): boolean {
  if (to === OrderStatus.RELEASED && (from === OrderStatus.PACKING || from === OrderStatus.FOILING) && !evidence?.remainingAssignedProduction) return false;
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
    case OrderStatus.PENDING_FACTORY:
    case OrderStatus.REJECTED:
    case OrderStatus.CONFIRMED:
    case OrderStatus.ON_HOLD:
    case OrderStatus.RELEASED:
    case OrderStatus.FOILING:
    case OrderStatus.PACKING:
    case OrderStatus.SUBMITTED:
    case OrderStatus.SCHEDULING:
    case OrderStatus.IN_PRODUCTION:
      return true;
    case OrderStatus.COMPLETED:
    case OrderStatus.SHIPPED:
    case OrderStatus.FINISHED:
    case OrderStatus.SETTLED:
    case OrderStatus.CANCELLED:
      return false;
  }
}
