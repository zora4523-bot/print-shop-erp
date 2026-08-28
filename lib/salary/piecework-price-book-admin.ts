import { createHash } from 'node:crypto';
import Decimal from 'decimal.js';
import {
  Prisma,
  type Role,
} from '../../generated/prisma/client';
import {
  PieceworkPriceBookStatus,
  Role as RoleValue,
} from '../../generated/prisma/enums';
import { writeAuditLogInTx, type AuditActor } from '../audit-log';
import { db } from '../db';
import {
  PIECEWORK_OPERATION_TYPES,
  PIECEWORK_RATE_UNITS,
  PIECEWORK_UNIT_BY_OPERATION,
  type PieceworkOperationTypeValue,
  type PieceworkRateUnitValue,
} from './piecework-pricing';

export const PIECEWORK_V1_DEFAULT_MANIFEST_PATH =
  'config/piecework-price-books/v1.json';

export type PieceworkPriceBookManifestRule = {
  operationType: PieceworkOperationTypeValue;
  unit: PieceworkRateUnitValue;
  amount: string | null;
};

export type PieceworkPriceBookV1Manifest = {
  schemaVersion: 1;
  priceBookVersion: 1;
  effectiveFrom: string | null;
  sourceName: string;
  publishNote: string;
  rules: PieceworkPriceBookManifestRule[];
};

type StoredPieceworkRule = {
  id: string;
  operationType: PieceworkOperationTypeValue;
  unit: PieceworkRateUnitValue;
  amount: Decimal | string | null;
};

export type PieceworkPublicationPreview = {
  bookId: string | null;
  bookStatus: PieceworkPriceBookStatus | null;
  draftUpdatedAt: string | null;
  sourceSha256: string;
  manifestSha256: string;
  ruleSetSha256: string | null;
  readyToPublish: boolean;
  issues: string[];
  rules: PieceworkPriceBookManifestRule[];
};

export type PieceworkPublicationReceipt = {
  outcome: 'PUBLISHED' | 'ALREADY_PUBLISHED';
  bookId: string;
  version: 1;
  effectiveFrom: string;
  rules: Array<{
    operationType: PieceworkOperationTypeValue;
    unit: PieceworkRateUnitValue;
    rate: string;
  }>;
  sourceSha256: string;
  manifestSha256: string;
  ruleSetSha256: string;
  auditLogId: string;
};

export type PublishPieceworkPriceBookV1Input = {
  manifest: PieceworkPriceBookV1Manifest;
  expectedDraftUpdatedAt: Date;
  /** 版本化 manifest 文件的原始字节 SHA-256。 */
  sourceSha256: string;
  actor: AuditActor;
};

export class PieceworkPriceBookAdminError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'PieceworkPriceBookAdminError';
  }
}

const MAX_RATE = new Decimal('9999999999.9999');
const SHA256 = /^[0-9a-f]{64}$/;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function hasExactKeys(
  record: Record<string, unknown>,
  expected: readonly string[],
): boolean {
  const actual = Object.keys(record).sort();
  return (
    actual.length === expected.length &&
    actual.every((key, index) => key === [...expected].sort()[index])
  );
}

function normalizeRate(value: string): string | null {
  let parsed: Decimal;
  try {
    parsed = new Decimal(value);
  } catch {
    return null;
  }
  if (
    !parsed.isFinite() ||
    parsed.isNegative() ||
    parsed.decimalPlaces() > 4 ||
    parsed.gt(MAX_RATE)
  ) {
    return null;
  }
  return parsed.toFixed(4);
}

export function parsePieceworkPriceBookV1Manifest(
  value: unknown,
): PieceworkPriceBookV1Manifest {
  if (
    !isRecord(value) ||
    !hasExactKeys(value, [
      'schemaVersion',
      'priceBookVersion',
      'effectiveFrom',
      'sourceName',
      'publishNote',
      'rules',
    ]) ||
    value.schemaVersion !== 1 ||
    value.priceBookVersion !== 1 ||
    (value.effectiveFrom !== null &&
      typeof value.effectiveFrom !== 'string') ||
    typeof value.sourceName !== 'string' ||
    typeof value.publishNote !== 'string' ||
    !Array.isArray(value.rules)
  ) {
    throw new PieceworkPriceBookAdminError('计件工价 v1 manifest 结构非法');
  }

  const rules = value.rules.map((candidate) => {
    if (
      !isRecord(candidate) ||
      !hasExactKeys(candidate, ['operationType', 'unit', 'amount']) ||
      !PIECEWORK_OPERATION_TYPES.includes(
        candidate.operationType as PieceworkOperationTypeValue,
      ) ||
      !PIECEWORK_RATE_UNITS.includes(candidate.unit as PieceworkRateUnitValue) ||
      (candidate.amount !== null && typeof candidate.amount !== 'string')
    ) {
      throw new PieceworkPriceBookAdminError(
        '计件工价 v1 manifest 规则结构非法',
      );
    }
    return {
      operationType: candidate.operationType as PieceworkOperationTypeValue,
      unit: candidate.unit as PieceworkRateUnitValue,
      amount: candidate.amount as string | null,
    };
  });

  return {
    schemaVersion: 1,
    priceBookVersion: 1,
    effectiveFrom: value.effectiveFrom,
    sourceName: value.sourceName,
    publishNote: value.publishNote,
    rules,
  };
}

function canonicalRules(
  rules: PieceworkPriceBookManifestRule[],
): PieceworkPriceBookManifestRule[] {
  const order = new Map(
    PIECEWORK_OPERATION_TYPES.map((operationType, index) => [
      operationType,
      index,
    ]),
  );
  return [...rules]
    .sort(
      (left, right) =>
        order.get(left.operationType)! - order.get(right.operationType)!,
    )
    .map((rule) => ({
      operationType: rule.operationType,
      unit: rule.unit,
      amount:
        rule.amount === null ? null : (normalizeRate(rule.amount) ?? rule.amount),
    }));
}

function canonicalManifest(manifest: PieceworkPriceBookV1Manifest): string {
  return JSON.stringify({
    schemaVersion: manifest.schemaVersion,
    priceBookVersion: manifest.priceBookVersion,
    effectiveFrom: manifest.effectiveFrom,
    sourceName: manifest.sourceName.trim(),
    publishNote: manifest.publishNote.trim(),
    rules: canonicalRules(manifest.rules),
  });
}

export function calculatePieceworkManifestSha256(
  manifest: PieceworkPriceBookV1Manifest,
): string {
  return createHash('sha256').update(canonicalManifest(manifest)).digest('hex');
}

export function calculatePieceworkRuleSetSha256(
  rules: PieceworkPriceBookManifestRule[],
): string {
  return createHash('sha256')
    .update(JSON.stringify(canonicalRules(rules)))
    .digest('hex');
}

export function validatePieceworkManifestForPublication(
  manifest: PieceworkPriceBookV1Manifest,
): string[] {
  const issues: string[] = [];
  if (!manifest.effectiveFrom) {
    issues.push('effectiveFrom 尚未填写');
  } else if (!Number.isFinite(new Date(manifest.effectiveFrom).getTime())) {
    issues.push('effectiveFrom 不是有效时间');
  }
  if (
    manifest.sourceName.trim().length < 1 ||
    manifest.sourceName.trim().length > 500
  ) {
    issues.push('sourceName 长度必须为 1–500');
  }
  if (
    manifest.publishNote.trim().length < 2 ||
    manifest.publishNote.trim().length > 500
  ) {
    issues.push('publishNote 长度必须为 2–500');
  }
  if (manifest.rules.length !== PIECEWORK_OPERATION_TYPES.length) {
    issues.push('必须且只能提供 PARTIAL/FULL/PACKING 三条规则');
  }

  const seen = new Set<PieceworkOperationTypeValue>();
  for (const rule of manifest.rules) {
    if (seen.has(rule.operationType)) {
      issues.push(`${rule.operationType} 存在重复规则`);
    }
    seen.add(rule.operationType);
    if (PIECEWORK_UNIT_BY_OPERATION[rule.operationType] !== rule.unit) {
      issues.push(`${rule.operationType} 必须使用 ${PIECEWORK_UNIT_BY_OPERATION[rule.operationType]}`);
    }
    if (rule.amount === null) {
      issues.push(`${rule.operationType} 金额尚未填写`);
    } else if (normalizeRate(rule.amount) === null) {
      issues.push(`${rule.operationType} 金额必须是最多 4 位小数的非负数`);
    }
  }
  for (const operationType of PIECEWORK_OPERATION_TYPES) {
    if (!seen.has(operationType)) issues.push(`缺少 ${operationType} 规则`);
  }
  return [...new Set(issues)];
}

function manifestRulesWithNormalizedAmounts(
  manifest: PieceworkPriceBookV1Manifest,
): Array<PieceworkPriceBookManifestRule & { amount: string }> {
  return canonicalRules(manifest.rules).map((rule) => ({
    ...rule,
    amount: normalizeRate(rule.amount!)!,
  }));
}

function storedRulesMatch(
  stored: StoredPieceworkRule[],
  manifest: PieceworkPriceBookV1Manifest,
): boolean {
  if (stored.length !== PIECEWORK_OPERATION_TYPES.length) return false;
  const storedByType = new Map(stored.map((rule) => [rule.operationType, rule]));
  return manifestRulesWithNormalizedAmounts(manifest).every((expected) => {
    const actual = storedByType.get(expected.operationType);
    return (
      actual?.unit === expected.unit &&
      actual.amount !== null &&
      new Decimal(actual.amount).toFixed(4) === expected.amount
    );
  });
}

export async function previewPieceworkPriceBookV1Publication(
  manifest: PieceworkPriceBookV1Manifest,
  sourceSha256: string,
): Promise<PieceworkPublicationPreview> {
  const issues = validatePieceworkManifestForPublication(manifest);
  if (!SHA256.test(sourceSha256)) issues.push('manifest 原始文件 SHA-256 非法');
  const book = await db.pieceworkPriceBook.findUnique({
    where: { version: 1 },
    include: {
      rules: {
        select: { id: true, operationType: true, unit: true, amount: true },
      },
    },
  });
  if (!book) issues.push('找不到 seed 创建的计件工价簿 v1');
  if (book?.status === PieceworkPriceBookStatus.PUBLISHED) {
    issues.push('计件工价簿 v1 已发布；apply 只能做同 manifest 幂等复放');
  }
  if (book && book.rules.length !== PIECEWORK_OPERATION_TYPES.length) {
    issues.push('草稿中不是正好三条工序规则');
  }

  return {
    bookId: book?.id ?? null,
    bookStatus: book?.status ?? null,
    draftUpdatedAt: book?.updatedAt.toISOString() ?? null,
    sourceSha256,
    manifestSha256: calculatePieceworkManifestSha256(manifest),
    ruleSetSha256:
      issues.length === 0
        ? calculatePieceworkRuleSetSha256(manifestRulesWithNormalizedAmounts(manifest))
        : null,
    readyToPublish: issues.length === 0,
    issues,
    rules: canonicalRules(manifest.rules),
  };
}

function receiptRules(manifest: PieceworkPriceBookV1Manifest) {
  return manifestRulesWithNormalizedAmounts(manifest).map((rule) => ({
    operationType: rule.operationType,
    unit: rule.unit,
    rate: rule.amount,
  }));
}

async function assertActiveAdmin(
  tx: Prisma.TransactionClient,
  submitted: AuditActor,
): Promise<AuditActor> {
  const actor = await tx.user.findUnique({
    where: { id: submitted.id },
    select: {
      id: true,
      role: true,
      username: true,
      displayName: true,
      isActive: true,
    },
  });
  if (
    !actor ||
    !actor.isActive ||
    actor.role !== RoleValue.ADMIN ||
    submitted.role !== RoleValue.ADMIN ||
    String(actor.username) !== submitted.username
  ) {
    throw new PieceworkPriceBookAdminError('发布必须由当前活跃管理员执行');
  }
  return {
    id: actor.id,
    role: actor.role as Role,
    username: String(actor.username),
    displayName: actor.displayName,
  };
}

export async function publishPieceworkPriceBookV1(
  input: PublishPieceworkPriceBookV1Input,
  now: Date = new Date(),
): Promise<PieceworkPublicationReceipt> {
  const issues = validatePieceworkManifestForPublication(input.manifest);
  if (issues.length > 0) {
    throw new PieceworkPriceBookAdminError(issues.join('；'));
  }
  if (!Number.isFinite(input.expectedDraftUpdatedAt.getTime())) {
    throw new PieceworkPriceBookAdminError('草稿修订时间非法');
  }
  if (!SHA256.test(input.sourceSha256)) {
    throw new PieceworkPriceBookAdminError('manifest 原始文件 SHA-256 非法');
  }

  const effectiveFrom = new Date(input.manifest.effectiveFrom!);
  const manifestSha256 = calculatePieceworkManifestSha256(input.manifest);
  const normalizedRules = manifestRulesWithNormalizedAmounts(input.manifest);
  const ruleSetSha256 = calculatePieceworkRuleSetSha256(normalizedRules);

  return db.$transaction(async (tx) => {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext('print-shop-erp:piecework-price-book:publish'))`;
    await tx.$queryRaw`SELECT "id" FROM "PieceworkPriceBook" WHERE "version" = 1 FOR UPDATE`;
    await tx.$queryRaw`SELECT rule."id" FROM "PieceworkPriceRule" rule INNER JOIN "PieceworkPriceBook" book ON book."id" = rule."priceBookId" WHERE book."version" = 1 FOR UPDATE OF rule`;

    const book = await tx.pieceworkPriceBook.findUnique({
      where: { version: 1 },
      include: {
        rules: {
          select: { id: true, operationType: true, unit: true, amount: true },
        },
      },
    });
    if (!book) {
      throw new PieceworkPriceBookAdminError('找不到 seed 创建的计件工价簿 v1');
    }

    if (book.status === PieceworkPriceBookStatus.PUBLISHED) {
      const exactReplay =
        book.effectiveFrom?.getTime() === effectiveFrom.getTime() &&
        book.sourceName === input.manifest.sourceName.trim() &&
        book.sourceSha256 === input.sourceSha256 &&
        book.manifestSha256 === manifestSha256 &&
        book.ruleSetSha256 === ruleSetSha256 &&
        book.publishNote === input.manifest.publishNote.trim() &&
        storedRulesMatch(book.rules as StoredPieceworkRule[], input.manifest);
      if (!exactReplay) {
        throw new PieceworkPriceBookAdminError(
          '计件工价簿 v1 已以不同 manifest 发布，禁止覆盖',
        );
      }
      const audit = await tx.businessAuditLog.findFirst({
        where: {
          action: 'PUBLISH_VERSION',
          entityType: 'PieceworkPriceBook',
          entityId: book.id,
        },
        orderBy: { createdAt: 'asc' },
        select: { id: true },
      });
      if (!audit) {
        throw new PieceworkPriceBookAdminError('已发布 v1 缺少审计记录');
      }
      return {
        outcome: 'ALREADY_PUBLISHED',
        bookId: book.id,
        version: 1,
        effectiveFrom: effectiveFrom.toISOString(),
        rules: receiptRules(input.manifest),
        sourceSha256: input.sourceSha256,
        manifestSha256,
        ruleSetSha256,
        auditLogId: audit.id,
      };
    }

    if (effectiveFrom < now) {
      throw new PieceworkPriceBookAdminError('计件工价簿不能追溯发布');
    }
    if (book.updatedAt.getTime() !== input.expectedDraftUpdatedAt.getTime()) {
      throw new PieceworkPriceBookAdminError('计件工价草稿已变更，请重新 dry-run');
    }
    if (book.rules.length !== PIECEWORK_OPERATION_TYPES.length) {
      throw new PieceworkPriceBookAdminError('草稿必须且只能包含三条工序规则');
    }
    const actor = await assertActiveAdmin(tx, input.actor);
    const existingByType = new Map(
      (book.rules as StoredPieceworkRule[]).map((rule) => [
        rule.operationType,
        rule,
      ]),
    );
    for (const expected of normalizedRules) {
      const current = existingByType.get(expected.operationType);
      if (!current || current.unit !== expected.unit) {
        throw new PieceworkPriceBookAdminError(
          `草稿 ${expected.operationType} 单位缺失或不一致`,
        );
      }
      if (
        current.amount !== null &&
        new Decimal(current.amount).toFixed(4) !== expected.amount
      ) {
        throw new PieceworkPriceBookAdminError(
          `草稿 ${expected.operationType} 已有不同金额，禁止覆盖`,
        );
      }
      if (current.amount === null) {
        const updated = await tx.pieceworkPriceRule.updateMany({
          where: { id: current.id, amount: null },
          data: { amount: new Prisma.Decimal(expected.amount) },
        });
        if (updated.count !== 1) {
          throw new PieceworkPriceBookAdminError('工价草稿并发修改，发布已中止');
        }
      }
    }

    const published = await tx.pieceworkPriceBook.updateMany({
      where: {
        id: book.id,
        status: PieceworkPriceBookStatus.DRAFT,
        updatedAt: input.expectedDraftUpdatedAt,
      },
      data: {
        status: PieceworkPriceBookStatus.PUBLISHED,
        effectiveFrom,
        effectiveTo: null,
        sourceName: input.manifest.sourceName.trim(),
        sourceSha256: input.sourceSha256,
        manifestSha256,
        ruleSetSha256,
        publishNote: input.manifest.publishNote.trim(),
        publishedById: actor.id,
        publishedAt: now,
      },
    });
    if (published.count !== 1) {
      throw new PieceworkPriceBookAdminError('工价草稿并发修改，发布已中止');
    }

    const audit = await writeAuditLogInTx(tx, {
      actor,
      action: 'PUBLISH_VERSION',
      entityType: 'PieceworkPriceBook',
      entityId: book.id,
      before: {
        version: 1,
        status: PieceworkPriceBookStatus.DRAFT,
        updatedAt: book.updatedAt,
      },
      after: {
        version: 1,
        status: PieceworkPriceBookStatus.PUBLISHED,
        effectiveFrom,
        rules: receiptRules(input.manifest),
        sourceSha256: input.sourceSha256,
        manifestSha256,
        ruleSetSha256,
      },
      requestMetadata: {
        source: 'piecework-price-book-admin.publishPieceworkPriceBookV1',
        sourceName: input.manifest.sourceName.trim(),
        publishNote: input.manifest.publishNote.trim(),
      },
    });

    return {
      outcome: 'PUBLISHED',
      bookId: book.id,
      version: 1,
      effectiveFrom: effectiveFrom.toISOString(),
      rules: receiptRules(input.manifest),
      sourceSha256: input.sourceSha256,
      manifestSha256,
      ruleSetSha256,
      auditLogId: audit.id,
    };
  });
}

export function isSha256(value: string): boolean {
  return SHA256.test(value);
}
