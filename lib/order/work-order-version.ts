export function parseScannedWorkOrderVersion(
  value: string | string[] | undefined,
): number | null {
  const raw = (Array.isArray(value) ? value[0] : value)?.trim() ?? '';
  if (!/^\d+$/u.test(raw)) return null;
  const version = Number.parseInt(raw, 10);
  return Number.isSafeInteger(version) && version >= 1 ? version : null;
}

export function isCurrentWorkOrderVersion(
  scanned: number | null,
  current: number,
): boolean {
  return scanned !== null && scanned === current;
}
