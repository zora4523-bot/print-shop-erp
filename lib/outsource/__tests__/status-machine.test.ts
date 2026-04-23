import { describe, it, expect } from 'vitest';
import { OutsourceStatus } from '../../../generated/prisma/enums';
import {
  OUTSOURCE_TRANSITIONS,
  InvalidOutsourceTransitionError,
  canTransitionOutsource,
  isTerminalOutsourceStatus,
  transitionOutsource,
} from '../status-machine';

describe('OUTSOURCE_TRANSITIONS', () => {
  it('allows SENT → IN_PROGRESS → RECEIVED happy path', () => {
    expect(OUTSOURCE_TRANSITIONS[OutsourceStatus.SENT]).toContain(
      OutsourceStatus.IN_PROGRESS,
    );
    expect(OUTSOURCE_TRANSITIONS[OutsourceStatus.IN_PROGRESS]).toContain(
      OutsourceStatus.RECEIVED,
    );
  });

  it('allows SENT → RECEIVED shortcut (no IN_PROGRESS middle)', () => {
    // Short-path for suppliers who don't confirm receipt separately.
    expect(OUTSOURCE_TRANSITIONS[OutsourceStatus.SENT]).toContain(
      OutsourceStatus.RECEIVED,
    );
  });

  it('allows CANCELLED from every non-terminal state', () => {
    expect(OUTSOURCE_TRANSITIONS[OutsourceStatus.SENT]).toContain(
      OutsourceStatus.CANCELLED,
    );
    expect(OUTSOURCE_TRANSITIONS[OutsourceStatus.IN_PROGRESS]).toContain(
      OutsourceStatus.CANCELLED,
    );
  });

  it('RECEIVED and CANCELLED are terminal', () => {
    expect(OUTSOURCE_TRANSITIONS[OutsourceStatus.RECEIVED]).toEqual([]);
    expect(OUTSOURCE_TRANSITIONS[OutsourceStatus.CANCELLED]).toEqual([]);
  });
});

describe('transitionOutsource', () => {
  it('returns the target on valid moves', () => {
    expect(
      transitionOutsource(OutsourceStatus.SENT, OutsourceStatus.RECEIVED),
    ).toBe(OutsourceStatus.RECEIVED);
  });

  it('throws on reverse move (RECEIVED → SENT)', () => {
    expect(() =>
      transitionOutsource(OutsourceStatus.RECEIVED, OutsourceStatus.SENT),
    ).toThrow(InvalidOutsourceTransitionError);
  });

  it('rejects self-transitions', () => {
    for (const s of Object.values(OutsourceStatus)) {
      expect(() => transitionOutsource(s, s)).toThrow(
        InvalidOutsourceTransitionError,
      );
    }
  });
});

describe('canTransitionOutsource / isTerminalOutsourceStatus', () => {
  it('canTransition returns false without throwing', () => {
    expect(
      canTransitionOutsource(OutsourceStatus.CANCELLED, OutsourceStatus.SENT),
    ).toBe(false);
  });

  it('flags terminal states correctly', () => {
    expect(isTerminalOutsourceStatus(OutsourceStatus.SENT)).toBe(false);
    expect(isTerminalOutsourceStatus(OutsourceStatus.IN_PROGRESS)).toBe(false);
    expect(isTerminalOutsourceStatus(OutsourceStatus.RECEIVED)).toBe(true);
    expect(isTerminalOutsourceStatus(OutsourceStatus.CANCELLED)).toBe(true);
  });
});
