import { describe, expect, it } from 'vitest';
import { OrderStatus } from '../../../generated/prisma/enums';
import {
  canTransitionOrder,
  isTerminalOrderStatus,
} from '../status-machine';

describe('11-state work-order lifecycle', () => {
  it('links the canonical factory-to-settlement path', () => {
    const chain = [
      OrderStatus.DRAFT,
      OrderStatus.PENDING_FACTORY,
      OrderStatus.CONFIRMED,
      OrderStatus.RELEASED,
      OrderStatus.FOILING,
      OrderStatus.PACKING,
      OrderStatus.SHIPPED,
      OrderStatus.SETTLED,
    ] as const;

    for (let index = 0; index < chain.length - 1; index += 1) {
      expect(
        canTransitionOrder(chain[index]!, chain[index + 1]!),
        `${chain[index]} → ${chain[index + 1]}`,
      ).toBe(true);
    }
  });

  it('supports reject/resubmit and explicit hold/resume destinations', () => {
    expect(
      canTransitionOrder(OrderStatus.PENDING_FACTORY, OrderStatus.REJECTED),
    ).toBe(true);
    expect(
      canTransitionOrder(OrderStatus.REJECTED, OrderStatus.PENDING_FACTORY),
    ).toBe(true);
    expect(
      canTransitionOrder(OrderStatus.FOILING, OrderStatus.ON_HOLD),
    ).toBe(true);
    expect(
      canTransitionOrder(OrderStatus.ON_HOLD, OrderStatus.FOILING),
    ).toBe(true);
  });

  it('keeps SETTLED and CANCELLED terminal', () => {
    expect(isTerminalOrderStatus(OrderStatus.SETTLED)).toBe(true);
    expect(isTerminalOrderStatus(OrderStatus.CANCELLED)).toBe(true);
  });
});
