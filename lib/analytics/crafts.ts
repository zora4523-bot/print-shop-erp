/** Legacy primary craft and the same named catalog craft describe one dimension. */
export const ANALYTICS_CRAFT_LABELS: Record<string, string> = { PARTIAL: '局部烫金', FULL: '专版烫金', PRINT: '彩印' };
export function canonicalAnalyticsCraft(value: string, names: ReadonlyMap<string, string>) {
  const name = names.get(value);
  return Object.entries(ANALYTICS_CRAFT_LABELS).find(([, label]) => label === name)?.[0] ?? value;
}
