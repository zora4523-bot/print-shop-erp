import { describe, it, expect } from 'vitest';
import { OrderStatus } from '../../../generated/prisma/enums';
import {
  transitionOrder,
  canTransitionOrder,
  canAttachOutsource,
  isTerminalOrderStatus,
  InvalidOrderTransitionError,
  ORDER_TRANSITIONS,
} from '../status-machine';

describe('ORDER_TRANSITIONS shape', () => {
  it('covers every OrderStatus as a source', () => {
    for (const s of Object.values(OrderStatus)) {
      expect(ORDER_TRANSITIONS[s], `missing source ${s}`).toBeDefined();
    }
  });

  it('main happy-path sequence is fully linked', () => {
    const chain = [
      OrderStatus.DRAFT,
      OrderStatus.PENDING_FACTORY,
      OrderStatus.SCHEDULING,
      OrderStatus.IN_PRODUCTION,
      OrderStatus.COMPLETED,
      OrderStatus.SHIPPED,
      OrderStatus.FINISHED,
    ] as const;
    for (let i = 0; i < chain.length - 1; i++) {
      expect(canTransitionOrder(chain[i], chain[i + 1]), `${chain[i]} → ${chain[i + 1]}`).toBe(
        true,
      );
    }
  });

  it('every non-terminal state can transition to CANCELLED', () => {
    for (const s of Object.values(OrderStatus)) {
      if (isTerminalOrderStatus(s)) continue;
      expect(canTransitionOrder(s, OrderStatus.CANCELLED), s).toBe(true);
    }
  });

  it('FINISHED and CANCELLED are terminal', () => {
    expect(isTerminalOrderStatus(OrderStatus.FINISHED)).toBe(true);
    expect(isTerminalOrderStatus(OrderStatus.CANCELLED)).toBe(true);
    for (const target of Object.values(OrderStatus)) {
      expect(canTransitionOrder(OrderStatus.FINISHED, target), `FINISHED → ${target}`).toBe(
        false,
      );
      expect(canTransitionOrder(OrderStatus.CANCELLED, target), `CANCELLED → ${target}`).toBe(
        false,
      );
    }
  });
});

describe('canAttachOutsource', () => {
  it('accepts both the new pending-factory state and legacy SUBMITTED', () => {
    expect(canAttachOutsource(OrderStatus.PENDING_FACTORY)).toBe(true);
    expect(canAttachOutsource(OrderStatus.SUBMITTED)).toBe(true);
  });

  it('rejects post-production and terminal states', () => {
    for (const status of [
      OrderStatus.COMPLETED,
      OrderStatus.SHIPPED,
      OrderStatus.FINISHED,
      OrderStatus.CANCELLED,
    ]) {
      expect(canAttachOutsource(status), `status=${status}`).toBe(false);
    }
  });
});

describe('transitionOrder', () => {
  it('returns target on a valid move', () => {
    expect(transitionOrder(OrderStatus.DRAFT, OrderStatus.PENDING_FACTORY)).toBe(
      OrderStatus.PENDING_FACTORY,
    );
  });

  it('keeps DRAFT → SUBMITTED valid for legacy callers', () => {
    expect(transitionOrder(OrderStatus.DRAFT, OrderStatus.SUBMITTED)).toBe(
      OrderStatus.SUBMITTED,
    );
  });

  it('throws InvalidOrderTransitionError with from/to on an invalid move', () => {
    try {
      transitionOrder(OrderStatus.DRAFT, OrderStatus.COMPLETED);
      throw new Error('should have thrown');
    } catch (err) {
      expect(err).toBeInstanceOf(InvalidOrderTransitionError);
      if (err instanceof InvalidOrderTransitionError) {
        expect(err.from).toBe(OrderStatus.DRAFT);
        expect(err.to).toBe(OrderStatus.COMPLETED);
      }
    }
  });

  it('rejects same-status "transitions" (callers must only invoke on real changes)', () => {
    expect(() => transitionOrder(OrderStatus.SUBMITTED, OrderStatus.SUBMITTED)).toThrow(
      InvalidOrderTransitionError,
    );
  });

  it('rejects backward transitions (SUBMITTED → DRAFT)', () => {
    expect(() => transitionOrder(OrderStatus.SUBMITTED, OrderStatus.DRAFT)).toThrow(
      InvalidOrderTransitionError,
    );
  });

  it('rejects skipping forward (DRAFT → SCHEDULING)', () => {
    expect(() => transitionOrder(OrderStatus.DRAFT, OrderStatus.SCHEDULING)).toThrow(
      InvalidOrderTransitionError,
    );
  });

  it('rejects transitions out of terminal states', () => {
    expect(() => transitionOrder(OrderStatus.FINISHED, OrderStatus.SHIPPED)).toThrow(
      InvalidOrderTransitionError,
    );
    expect(() => transitionOrder(OrderStatus.CANCELLED, OrderStatus.DRAFT)).toThrow(
      InvalidOrderTransitionError,
    );
  });
});

describe('canTransitionOrder spot-checks per SPEC §4.3', () => {
  it.each([
    [OrderStatus.DRAFT, OrderStatus.PENDING_FACTORY, true],
    [OrderStatus.DRAFT, OrderStatus.SUBMITTED, true],
    [OrderStatus.PENDING_FACTORY, OrderStatus.SCHEDULING, true],
    [OrderStatus.SUBMITTED, OrderStatus.SCHEDULING, true],
    [OrderStatus.SCHEDULING, OrderStatus.IN_PRODUCTION, true],
    [OrderStatus.SCHEDULING, OrderStatus.COMPLETED, true],
    [OrderStatus.IN_PRODUCTION, OrderStatus.COMPLETED, true],
    [OrderStatus.COMPLETED, OrderStatus.SHIPPED, true],
    [OrderStatus.SHIPPED, OrderStatus.FINISHED, true],
    [OrderStatus.DRAFT, OrderStatus.IN_PRODUCTION, false],
    [OrderStatus.PENDING_FACTORY, OrderStatus.COMPLETED, false],
    [OrderStatus.SUBMITTED, OrderStatus.COMPLETED, false],
    [OrderStatus.COMPLETED, OrderStatus.IN_PRODUCTION, false],
  ] as const)('%s → %s = %s', (from, to, expected) => {
    expect(canTransitionOrder(from, to)).toBe(expected);
  });
});
