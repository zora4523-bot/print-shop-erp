import { OrderStatus } from '../../generated/prisma/enums';
import { todayShanghai } from '../dashboard/shanghai-clock';

// 承诺交期的预警口径（详情页徽标 / dashboard 关注列表 / 每日 cron 推送
// 三处共用，避免"页面说逾期、推送说没逾期"的口径分裂）：
//
//   - 只对"还没发货"的工单预警：DRAFT..COMPLETED。SHIPPED/FINISHED
//     视为已履约，CANCELLED 已终止。
//   - 日界按 Asia/Shanghai 日历日算；promisedDate 存的是该日历日的
//     UTC 零点（parseStrictYmd 口径）。
//   - 剩余 0 天 = 今天到期（due-soon）；负数 = 已逾期。

export const DUE_SOON_DAYS = 3;

// dashboard 关注列表 / cron 扫描的 where 条件也用这份清单（数组形态
// 方便直接塞进 Prisma `in`）。
export const PROMISE_ALERT_STATUSES = [
  OrderStatus.DRAFT,
  OrderStatus.SUBMITTED,
  OrderStatus.SCHEDULING,
  OrderStatus.IN_PRODUCTION,
  OrderStatus.COMPLETED,
] as const;

const ALERTABLE_STATUSES: ReadonlySet<OrderStatus> = new Set(
  PROMISE_ALERT_STATUSES,
);

const MS_PER_DAY = 24 * 60 * 60 * 1000;

// 交期日历日 − 今天（上海日历日），单位天。0 = 今天到期，负 = 逾期。
export function promisedDaysLeft(promisedDate: Date, now: Date = new Date()): number {
  const promisedYmd = promisedDate.toISOString().slice(0, 10);
  const todayYmd = todayShanghai(now);
  return Math.round(
    (Date.parse(`${promisedYmd}T00:00:00Z`) - Date.parse(`${todayYmd}T00:00:00Z`)) /
      MS_PER_DAY,
  );
}

export type PromisedDateAlert = {
  kind: 'overdue' | 'due-soon';
  // overdue: 已逾期天数（≥1）；due-soon: 剩余天数（0..DUE_SOON_DAYS）
  days: number;
};

export function promisedDateAlert(
  promisedDate: Date | null,
  status: OrderStatus,
  now: Date = new Date(),
): PromisedDateAlert | null {
  if (!promisedDate) return null;
  if (!ALERTABLE_STATUSES.has(status)) return null;
  const daysLeft = promisedDaysLeft(promisedDate, now);
  if (daysLeft < 0) return { kind: 'overdue', days: -daysLeft };
  if (daysLeft <= DUE_SOON_DAYS) return { kind: 'due-soon', days: daysLeft };
  return null;
}
