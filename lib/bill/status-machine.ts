import { BillStatus } from '../../generated/prisma/enums';

// 应收账单状态机 (SPEC §4.3 财务衍生 — schema BillStatus enum)。
//
// Happy path: DRAFT → ISSUED → {PARTIAL_PAID | FULLY_PAID}
//   - DRAFT: 月初自动生成，owner 复核前的待发单状态
//   - ISSUED: owner 把账单推给销售（事实上的"生效"）
//   - PARTIAL_PAID: 客户分期付款中（累计 < totalAmount）
//   - FULLY_PAID: 累计已收 === totalAmount，终态
//
// 不做的事：没有 CANCELLED（schema 里没有这个 enum 值）。错发的
// DRAFT 账单直接删除；ISSUED 之后想作废也只能通过"退款冲账"这种
// 业务层面的手段，当前 MVP 不做此路径。

export class InvalidBillTransitionError extends Error {
  readonly from: BillStatus;
  readonly to: BillStatus;
  constructor(from: BillStatus, to: BillStatus) {
    super(`账单状态不能从 ${from} 直接切到 ${to}`);
    this.name = 'InvalidBillTransitionError';
    this.from = from;
    this.to = to;
  }
}

export const BILL_TRANSITIONS = {
  [BillStatus.DRAFT]: [BillStatus.ISSUED],
  // ISSUED 可以一次付清直接到 FULLY_PAID，也可以先进入 PARTIAL_PAID
  // 等续收。
  [BillStatus.ISSUED]: [BillStatus.PARTIAL_PAID, BillStatus.FULLY_PAID],
  // PARTIAL_PAID 只能往前走到 FULLY_PAID。不允许退回 ISSUED 以免
  // 一条账单上反复记录加减；退款/贷项当前不在系统内处理。
  [BillStatus.PARTIAL_PAID]: [BillStatus.FULLY_PAID],
  [BillStatus.FULLY_PAID]: [],
} as const satisfies Record<BillStatus, readonly BillStatus[]>;

export function transitionBill(
  from: BillStatus,
  to: BillStatus,
): BillStatus {
  if (!canTransitionBill(from, to)) {
    throw new InvalidBillTransitionError(from, to);
  }
  return to;
}

export function canTransitionBill(
  from: BillStatus,
  to: BillStatus,
): boolean {
  return (BILL_TRANSITIONS[from] as readonly BillStatus[]).includes(to);
}

export function isTerminalBillStatus(status: BillStatus): boolean {
  return BILL_TRANSITIONS[status].length === 0;
}
