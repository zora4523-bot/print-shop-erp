import { createHash } from 'node:crypto';

function canonical(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonical);
  if (value !== null && typeof value === 'object') {
    return Object.fromEntries(Object.entries(value).sort(([a], [b]) => a.localeCompare(b))
      .map(([key, entry]) => [key, canonical(entry)]));
  }
  return value;
}

/** Compare original commands, never current mutable order or price state. */
export function createOrderRequestFingerprint(input: unknown): string {
  return createHash('sha256').update(JSON.stringify(canonical(JSON.parse(JSON.stringify(input))))).digest('hex');
}

export function matchesCreateOrderRequest(changedFields: unknown, fingerprint: string): boolean {
  if (!changedFields || typeof changedFields !== 'object' || !('createRequest' in changedFields)) return false;
  const request = changedFields.createRequest;
  return Boolean(request && typeof request === 'object' && 'version' in request && request.version === 1 &&
    'fingerprint' in request && request.fingerprint === fingerprint);
}
