/** Project both stored change protocols without mutating audit JSON. */
export function orderChangeDisplayFields(change: Record<string, unknown>): Record<string, unknown> {
  const target = change.targetBlankIdentity;
  if (!target || typeof target !== 'object' || Array.isArray(target)) return change;
  const identity = target as Record<string, unknown>;
  if (typeof identity.specification !== 'string') return change;
  return { ...change, specification: identity.specification };
}
