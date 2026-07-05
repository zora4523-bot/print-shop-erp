import { Prisma, type Role } from '../generated/prisma/client';
import { db } from './db';

const MASKED = '[MASKED]';
const SENSITIVE_FIELD_PATTERNS = [
  /password/i,
  /token/i,
  /secret/i,
  /credential/i,
  /phone/i,
  /wechat/i,
  /address/i,
];

export type AuditActor = {
  id: string;
  role: Role;
  username: string;
  displayName: string;
};

export type AuditLogInput = {
  actor: AuditActor | null;
  action: string;
  entityType: string;
  entityId: string;
  before?: unknown;
  after?: unknown;
  requestMetadata?: Record<string, unknown> | null;
};

export type AuditDiff = Record<
  string,
  { before: Prisma.InputJsonValue | null; after: Prisma.InputJsonValue | null }
>;

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return Object.prototype.toString.call(value) === '[object Object]';
}

function isSensitiveField(fieldName: string): boolean {
  return SENSITIVE_FIELD_PATTERNS.some((pattern) => pattern.test(fieldName));
}

function normalizeScalar(value: unknown): unknown {
  if (value instanceof Date) return value.toISOString();
  if (typeof value === 'bigint') return value.toString();
  if (value instanceof Prisma.Decimal) return value.toString();
  return value;
}

export function sanitizeAuditPayload(
  value: unknown,
  fieldName = '',
): Prisma.InputJsonValue | null {
  if (isSensitiveField(fieldName)) return MASKED;
  if (value === undefined) return null;
  if (value === null) return null;

  const scalar = normalizeScalar(value);
  if (
    typeof scalar === 'string' ||
    typeof scalar === 'number' ||
    typeof scalar === 'boolean'
  ) {
    return scalar;
  }
  if (Array.isArray(scalar)) {
    return scalar.map((item) => sanitizeAuditPayload(item, fieldName));
  }
  if (isPlainObject(scalar)) {
    const out: Record<string, Prisma.InputJsonValue | null> = {};
    for (const [key, child] of Object.entries(scalar)) {
      out[key] = sanitizeAuditPayload(child, key);
    }
    return out;
  }
  return String(scalar);
}

function normalizeAuditComparable(value: unknown): unknown {
  if (value === undefined || value === null) return null;
  const scalar = normalizeScalar(value);
  if (
    typeof scalar === 'string' ||
    typeof scalar === 'number' ||
    typeof scalar === 'boolean'
  ) {
    return scalar;
  }
  if (Array.isArray(scalar)) {
    return scalar.map((item) => normalizeAuditComparable(item));
  }
  if (isPlainObject(scalar)) {
    return Object.fromEntries(
      Object.entries(scalar)
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([key, child]) => [key, normalizeAuditComparable(child)]),
    );
  }
  return String(scalar);
}

function stableJson(value: unknown): string {
  return JSON.stringify(value);
}

export function buildAuditDiff(before: unknown, after: unknown): AuditDiff {
  const sanitizedBefore = sanitizeAuditPayload(before);
  const sanitizedAfter = sanitizeAuditPayload(after);
  const comparableBefore = normalizeAuditComparable(before);
  const comparableAfter = normalizeAuditComparable(after);
  if (!isPlainObject(sanitizedBefore) || !isPlainObject(sanitizedAfter)) {
    return stableJson(comparableBefore) === stableJson(comparableAfter)
      ? {}
      : { value: { before: sanitizedBefore, after: sanitizedAfter } };
  }

  const keys = new Set([
    ...Object.keys(sanitizedBefore),
    ...Object.keys(sanitizedAfter),
  ]);
  const diff: AuditDiff = {};
  for (const key of [...keys].sort()) {
    const sanitizedBeforeObject = sanitizedBefore as Record<
      string,
      Prisma.InputJsonValue | null
    >;
    const sanitizedAfterObject = sanitizedAfter as Record<
      string,
      Prisma.InputJsonValue | null
    >;
    const prev = sanitizedBeforeObject[key];
    const next = sanitizedAfterObject[key];
    const comparablePrev = isPlainObject(comparableBefore)
      ? comparableBefore[key]
      : undefined;
    const comparableNext = isPlainObject(comparableAfter)
      ? comparableAfter[key]
      : undefined;
    if (stableJson(comparablePrev) !== stableJson(comparableNext)) {
      diff[key] = { before: prev, after: next };
    }
  }
  return diff;
}

function nullableJson(value: Prisma.InputJsonValue | null) {
  return value === null ? Prisma.JsonNull : value;
}

export async function writeAuditLog(input: AuditLogInput) {
  const before = sanitizeAuditPayload(input.before);
  const after = sanitizeAuditPayload(input.after);
  const diff = buildAuditDiff(input.before, input.after);
  const requestMetadata = sanitizeAuditPayload(input.requestMetadata ?? null);

  return db.businessAuditLog.create({
    data: {
      actorId: input.actor?.id ?? null,
      actorRole: input.actor?.role ?? null,
      actorUsername: input.actor?.username ?? null,
      actorDisplayName: input.actor?.displayName ?? null,
      action: input.action,
      entityType: input.entityType,
      entityId: input.entityId,
      before: nullableJson(before),
      after: nullableJson(after),
      diff,
      requestMetadata: nullableJson(requestMetadata),
    },
    select: {
      id: true,
      actorId: true,
      actorRole: true,
      actorUsername: true,
      actorDisplayName: true,
      action: true,
      entityType: true,
      entityId: true,
      before: true,
      after: true,
      diff: true,
      requestMetadata: true,
      createdAt: true,
    },
  });
}
