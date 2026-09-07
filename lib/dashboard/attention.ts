import { todayShanghai } from './shanghai-clock';

export const ATTENTION_KINDS = ['due', 'shipments', 'outsource', 'over-reports', 'settlements'] as const;
export type AttentionKind = (typeof ATTENTION_KINDS)[number];
export const ATTENTION_TITLES: Record<AttentionKind, string> = {
  due: '交期预警',
  shipments: '待发货工单',
  outsource: '超期外协',
  'over-reports': '超计划报工记录',
  settlements: '即将结算客服周期',
};
export const DASHBOARD_PREVIEW_LIMIT = 3;
export const ATTENTION_PAGE_SIZE = 20;

export function attentionHref(kind: AttentionKind): string {
  return `/owner/attention?kind=${kind}`;
}

/** Shanghai calendar days since completion, not rounded 24-hour intervals. */
export function completedWaitingLabel(completedAt: Date, now: Date): string {
  const days = Math.max(0, Math.round(
    (Date.parse(todayShanghai(now)) - Date.parse(todayShanghai(completedAt))) / 86400000,
  ));
  return days === 0 ? '今日完工' : `完工后待发 ${days} 天`;
}
