/** Current paper terminology; persisted catalog facts and historical prices keep their identity. */
export function paperDisplayLabel(label: string): string {
  return label.replaceAll('珠光闪红', '珠光暗红');
}
