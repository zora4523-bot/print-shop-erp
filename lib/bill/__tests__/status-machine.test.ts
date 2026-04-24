import { describe, it, expect } from 'vitest';
import { BillStatus } from '../../../generated/prisma/enums';
import {
  BILL_TRANSITIONS,
  InvalidBillTransitionError,
  canTransitionBill,
  isTerminalBillStatus,
  transitionBill,
} from '../status-machine';

describe('BILL_TRANSITIONS', () => {
  it('DRAFT → ISSUED is the only outbound from DRAFT', () => {
    expect(BILL_TRANSITIONS[BillStatus.DRAFT]).toEqual([BillStatus.ISSUED]);
  });

  it('ISSUED → {PARTIAL_PAID, FULLY_PAID}', () => {
    expect(BILL_TRANSITIONS[BillStatus.ISSUED]).toContain(
      BillStatus.PARTIAL_PAID,
    );
    expect(BILL_TRANSITIONS[BillStatus.ISSUED]).toContain(BillStatus.FULLY_PAID);
  });

  it('PARTIAL_PAID → FULLY_PAID only (no backwards)', () => {
    expect(BILL_TRANSITIONS[BillStatus.PARTIAL_PAID]).toEqual([
      BillStatus.FULLY_PAID,
    ]);
  });

  it('FULLY_PAID is terminal', () => {
    expect(BILL_TRANSITIONS[BillStatus.FULLY_PAID]).toEqual([]);
    expect(isTerminalBillStatus(BillStatus.FULLY_PAID)).toBe(true);
  });

  it('every enum variant is listed (exhaustiveness)', () => {
    for (const s of Object.values(BillStatus)) {
      expect(BILL_TRANSITIONS[s]).toBeDefined();
    }
  });
});

describe('transitionBill', () => {
  it('accepts happy-path moves', () => {
    expect(transitionBill(BillStatus.DRAFT, BillStatus.ISSUED)).toBe(
      BillStatus.ISSUED,
    );
    expect(transitionBill(BillStatus.ISSUED, BillStatus.PARTIAL_PAID)).toBe(
      BillStatus.PARTIAL_PAID,
    );
    expect(
      transitionBill(BillStatus.PARTIAL_PAID, BillStatus.FULLY_PAID),
    ).toBe(BillStatus.FULLY_PAID);
  });

  it('allows ISSUED → FULLY_PAID (one-shot full payment)', () => {
    expect(transitionBill(BillStatus.ISSUED, BillStatus.FULLY_PAID)).toBe(
      BillStatus.FULLY_PAID,
    );
  });

  it('rejects DRAFT → PARTIAL_PAID (must issue first)', () => {
    expect(() =>
      transitionBill(BillStatus.DRAFT, BillStatus.PARTIAL_PAID),
    ).toThrow(InvalidBillTransitionError);
  });

  it('rejects PARTIAL_PAID → ISSUED (no going back)', () => {
    expect(() =>
      transitionBill(BillStatus.PARTIAL_PAID, BillStatus.ISSUED),
    ).toThrow(InvalidBillTransitionError);
  });

  it('rejects any outbound from FULLY_PAID (refund is a new negative bill, not a status flip)', () => {
    for (const target of Object.values(BillStatus)) {
      if (target === BillStatus.FULLY_PAID) continue;
      expect(() =>
        transitionBill(BillStatus.FULLY_PAID, target),
      ).toThrow(InvalidBillTransitionError);
    }
  });

  it('rejects self-transitions (no idempotent "re-issue")', () => {
    for (const s of Object.values(BillStatus)) {
      expect(() => transitionBill(s, s)).toThrow(InvalidBillTransitionError);
    }
  });
});

describe('canTransitionBill', () => {
  it('returns true / false without throwing', () => {
    expect(canTransitionBill(BillStatus.DRAFT, BillStatus.ISSUED)).toBe(true);
    expect(canTransitionBill(BillStatus.FULLY_PAID, BillStatus.ISSUED)).toBe(
      false,
    );
  });
});

describe('isTerminalBillStatus', () => {
  it('only FULLY_PAID is terminal', () => {
    expect(isTerminalBillStatus(BillStatus.DRAFT)).toBe(false);
    expect(isTerminalBillStatus(BillStatus.ISSUED)).toBe(false);
    expect(isTerminalBillStatus(BillStatus.PARTIAL_PAID)).toBe(false);
    expect(isTerminalBillStatus(BillStatus.FULLY_PAID)).toBe(true);
  });
});
