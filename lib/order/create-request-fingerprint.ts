import { createHash } from 'node:crypto';

function canonical(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonical);
  if (value !== null && typeof value === 'object') {
    return Object.fromEntries(Object.entries(value).sort(([a], [b]) => a.localeCompare(b))
      .map(([key, entry]) => [key, canonical(entry)]));
  }
  return value;
}

function hashRequest(input: unknown): string {
  return createHash('sha256').update(JSON.stringify(canonical(JSON.parse(JSON.stringify(input))))).digest('hex');
}

// 客户名称/简称与关联客户已退役（业主 2026-09-27）：旧客户端仍可能带着这两个键，
// 它们不再进入指纹。停用前保存的指纹按当时的建单表单计算——两个键都在且为 null
// （空白也被规范成 null），跨部署的重试核对时一并接受。
const RETIRED_REQUEST_KEYS = ['customerPartyId', 'customerRef'] as const;

function withoutRetiredKeys(input: unknown): unknown {
  if (input === null || typeof input !== 'object' || Array.isArray(input)) return input;
  const rest: Record<string, unknown> = { ...input };
  for (const key of RETIRED_REQUEST_KEYS) delete rest[key];
  return rest;
}

/** Compare original commands, never current mutable order or price state. */
export function createOrderRequestFingerprint(input: unknown): string {
  return hashRequest(withoutRetiredKeys(input));
}

/** Fingerprints a retry may match: the current one, then pre-2026-09-27 shapes. */
export function acceptedCreateOrderRequestFingerprints(input: unknown): readonly string[] {
  const current = withoutRetiredKeys(input);
  if (current === null || typeof current !== 'object' || Array.isArray(current)) return [hashRequest(current)];
  return [
    hashRequest(current),
    hashRequest({ ...current, customerPartyId: null, customerRef: null }),
    hashRequest({ ...current, customerRef: null }),
  ];
}

export function matchesCreateOrderRequest(changedFields: unknown, fingerprints: string | readonly string[]): boolean {
  if (!changedFields || typeof changedFields !== 'object' || !('createRequest' in changedFields)) return false;
  const request = changedFields.createRequest;
  const accepted: readonly unknown[] = typeof fingerprints === 'string' ? [fingerprints] : fingerprints;
  return Boolean(request && typeof request === 'object' && 'version' in request && request.version === 1 &&
    'fingerprint' in request && accepted.includes(request.fingerprint));
}
