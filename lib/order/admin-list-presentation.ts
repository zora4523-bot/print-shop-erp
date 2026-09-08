const CRAFT_LABELS = [
  ['PARTIAL', '局部烫金'],
  ['FULL', '专版烫金'],
  ['PRINT', '彩印'],
] as const;

export type AdminOrderCraftTag = (typeof CRAFT_LABELS)[number][1];

/** Use canonical item craft types; dictionary names are editable and may overlap. */
export function adminOrderCraftTags(crafts: readonly (string | null | undefined)[]): AdminOrderCraftTag[] {
  const present = new Set(crafts);
  return CRAFT_LABELS.filter(([craft]) => present.has(craft)).map(([, label]) => label);
}

/** Countdown visibility follows the server's active-order delivery alert. */
export function adminOrderDueHint(alert: { kind: 'overdue' | 'due-soon'; days: number } | null): string | null {
  if (!alert) return null;
  if (alert.kind === 'overdue') return `逾期 ${alert.days} 天`;
  if (alert.days === 0) return '今天到期';
  if (alert.days === 1) return '明天到期';
  return `剩 ${alert.days} 天`;
}
