import { describe, it, expect } from 'vitest';
import { SalaryPeriodStatus } from '../../../../generated/prisma/enums';
import {
  CS_PERIOD_TRANSITIONS,
  InvalidCsPeriodTransitionError,
  canTransitionCsPeriod,
  isTerminalCsPeriodStatus,
  transitionCsPeriod,
} from '../status-machine';

describe('CS_PERIOD_TRANSITIONS', () => {
  it('only IN_PROGRESS → SETTLED is allowed', () => {
    expect(CS_PERIOD_TRANSITIONS[SalaryPeriodStatus.IN_PROGRESS]).toEqual([
      SalaryPeriodStatus.SETTLED,
    ]);
  });

  it('SETTLED is terminal', () => {
    expect(CS_PERIOD_TRANSITIONS[SalaryPeriodStatus.SETTLED]).toEqual([]);
    expect(isTerminalCsPeriodStatus(SalaryPeriodStatus.SETTLED)).toBe(true);
  });

  it('IN_PROGRESS is not terminal', () => {
    expect(isTerminalCsPeriodStatus(SalaryPeriodStatus.IN_PROGRESS)).toBe(false);
  });
});

describe('transitionCsPeriod', () => {
  it('returns SETTLED on the happy path', () => {
    expect(
      transitionCsPeriod(SalaryPeriodStatus.IN_PROGRESS, SalaryPeriodStatus.SETTLED),
    ).toBe(SalaryPeriodStatus.SETTLED);
  });

  it('throws on re-settle attempt', () => {
    expect(() =>
      transitionCsPeriod(SalaryPeriodStatus.SETTLED, SalaryPeriodStatus.SETTLED),
    ).toThrow(InvalidCsPeriodTransitionError);
  });

  it('throws on SETTLED → IN_PROGRESS (cannot reopen)', () => {
    expect(() =>
      transitionCsPeriod(SalaryPeriodStatus.SETTLED, SalaryPeriodStatus.IN_PROGRESS),
    ).toThrow(InvalidCsPeriodTransitionError);
  });

  it('throws on self-transition from IN_PROGRESS', () => {
    expect(() =>
      transitionCsPeriod(
        SalaryPeriodStatus.IN_PROGRESS,
        SalaryPeriodStatus.IN_PROGRESS,
      ),
    ).toThrow(InvalidCsPeriodTransitionError);
  });
});

describe('canTransitionCsPeriod', () => {
  it('returns true for valid move without throwing', () => {
    expect(
      canTransitionCsPeriod(
        SalaryPeriodStatus.IN_PROGRESS,
        SalaryPeriodStatus.SETTLED,
      ),
    ).toBe(true);
  });

  it('returns false for illegal move without throwing', () => {
    expect(
      canTransitionCsPeriod(
        SalaryPeriodStatus.SETTLED,
        SalaryPeriodStatus.IN_PROGRESS,
      ),
    ).toBe(false);
  });
});
