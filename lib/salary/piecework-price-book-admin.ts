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
import { databaseClockNow } from '../background-jobs/clock';
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
  smallOrderAmount?: string;
  setupAmount?: string;
};

export type PieceworkPriceBookManifest = {
  schemaVersion: 1;
  priceBookVersion: number;
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
  smallOrderAmount?: Decimal | string | null;
  setupAmount?: Decimal | string | null;
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
  version: number;
  effectiveFrom: string;
  rules: Array<{
    operationType: PieceworkOperationTypeValue;
    unit: PieceworkRateUnitValue;
    rate: string;
    smallOrderAmount?: string;
    setupAmount?: string;
  }>;
  sourceSha256: string;
  manifestSha256: string;
  ruleSetSha256: string;
  auditLogId: string;
};

export type PublishPieceworkPriceBookInput = {
  manifest: PieceworkPriceBookManifest;
  expectedDraftUpdatedAt: Date;
  /** 版本化 manifest 文件的原始字节 SHA-256。 */
  sourceSha256: string;
  actor: AuditActor;
  /** Resolve the effective instant under the publication lock; retries reuse it. */
  effectiveImmediately?: boolean;
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

export function parsePieceworkPriceBookManifest(
  value: unknown,
): PieceworkPriceBookManifest {
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
    (!Number.isSafeInteger(value.priceBookVersion) || Number(value.priceBookVersion) < 1) ||
    (value.effectiveFrom !== null &&
      typeof value.effectiveFrom !== 'string') ||
    typeof value.sourceName !== 'string' ||
    typeof value.publishNote !== 'string' ||
    !Array.isArray(value.rules)
  ) {
    throw new PieceworkPriceBookAdminError('计件工价 manifest 结构非法');
  }

  const rules = value.rules.map((candidate) => {
    if (
      !isRecord(candidate) ||
      (!hasExactKeys(candidate, ['operationType', 'unit', 'amount']) && !hasExactKeys(candidate, ['operationType', 'unit', 'amount', 'smallOrderAmount', 'setupAmount'])) ||
      !PIECEWORK_OPERATION_TYPES.includes(
        candidate.operationType as PieceworkOperationTypeValue,
      ) ||
      !PIECEWORK_RATE_UNITS.includes(candidate.unit as PieceworkRateUnitValue) ||
      (candidate.amount !== null && typeof candidate.amount !== 'string') ||
      ('smallOrderAmount' in candidate && (typeof candidate.smallOrderAmount !== 'string' || typeof candidate.setupAmount !== 'string'))
    ) {
      throw new PieceworkPriceBookAdminError(
        '计件工价 manifest 规则结构非法',
      );
    }
    return {
      operationType: candidate.operationType as PieceworkOperationTypeValue,
      unit: candidate.unit as PieceworkRateUnitValue,
      amount: candidate.amount as string | null,
      ...(typeof candidate.smallOrderAmount === 'string' && typeof candidate.setupAmount === 'string' ? { smallOrderAmount: candidate.smallOrderAmount, setupAmount: candidate.setupAmount } : {}),
    };
  });

  return {
    schemaVersion: 1,
    priceBookVersion: Number(value.priceBookVersion),
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
        order.get(left.operationType)! - order.get(right.operationType)! ||
        left.unit.localeCompare(right.unit),
    )
    .map((rule) => ({
      operationType: rule.operationType,
      unit: rule.unit,
      ...(rule.smallOrderAmount !== undefined && rule.setupAmount !== undefined ? { smallOrderAmount: normalizeRate(rule.smallOrderAmount) ?? rule.smallOrderAmount, setupAmount: normalizeRate(rule.setupAmount) ?? rule.setupAmount } : {}),
      amount:
        rule.amount === null ? null : (normalizeRate(rule.amount) ?? rule.amount),
    }));
}

function canonicalManifest(manifest: PieceworkPriceBookManifest): string {
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
  manifest: PieceworkPriceBookManifest,
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
  manifest: PieceworkPriceBookManifest,
): string[] {
  const issues: string[] = [];
  if (manifest.schemaVersion !== 1 || !Number.isSafeInteger(manifest.priceBookVersion) || manifest.priceBookVersion < 1) issues.push('工价版本号必须为正整数');
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
  if (manifest.rules.length < 2 || manifest.rules.length > 4) {
    issues.push('必须提供局部与专版烫金工价，包装工价可选');
  }

  const seen = new Set<string>();
  for (const rule of manifest.rules) {
    if (seen.has(`${rule.operationType}:${rule.unit}`)) {
      issues.push(`${rule.operationType} 存在重复规则`);
    }
    seen.add(`${rule.operationType}:${rule.unit}`);
    if (rule.smallOrderAmount !== undefined || rule.setupAmount !== undefined) {
      if (rule.operationType === 'PACKING' || rule.smallOrderAmount === undefined || rule.setupAmount === undefined || normalizeRate(rule.smallOrderAmount) === null || normalizeRate(rule.setupAmount) === null) issues.push('烫金小单工资与装版费须同时填写有效金额');
    }
    if (PIECEWORK_UNIT_BY_OPERATION[rule.operationType] !== rule.unit && !(rule.operationType === 'PACKING' && rule.unit === 'PER_BOX')) {
      issues.push(`${rule.operationType} 必须使用 ${PIECEWORK_UNIT_BY_OPERATION[rule.operationType]}`);
    }
    if (rule.amount === null) {
      issues.push(`${rule.operationType} 金额尚未填写`);
    } else if (normalizeRate(rule.amount) === null) {
      issues.push(`${rule.operationType} 金额必须是最多 4 位小数的非负数`);
    }
  }
  for (const operationType of PIECEWORK_OPERATION_TYPES.filter((type) => type !== 'PACKING')) {
    if (!seen.has(`${operationType}:${PIECEWORK_UNIT_BY_OPERATION[operationType]}`)) issues.push(`缺少 ${operationType} 规则`);
  }
  return [...new Set(issues)];
}

function manifestRulesWithNormalizedAmounts(
  manifest: PieceworkPriceBookManifest,
): Array<PieceworkPriceBookManifestRule & { amount: string }> {
  return canonicalRules(manifest.rules).map((rule) => ({
    ...rule,
    amount: normalizeRate(rule.amount!)!,
  }));
}

function storedRulesMatch(
  stored: StoredPieceworkRule[],
  manifest: PieceworkPriceBookManifest,
): boolean {
  if (stored.length !== manifest.rules.length) return false;
  const storedByType = new Map(stored.map((rule) => [`${rule.operationType}:${rule.unit}`, rule]));
  return manifestRulesWithNormalizedAmounts(manifest).every((expected) => {
    const actual = storedByType.get(`${expected.operationType}:${expected.unit}`);
    return (
      actual?.unit === expected.unit &&
      actual.amount !== null &&
      new Decimal(actual.amount).toFixed(4) === expected.amount &&
      (actual.smallOrderAmount == null ? undefined : new Decimal(actual.smallOrderAmount).toFixed(4)) === expected.smallOrderAmount &&
      (actual.setupAmount == null ? undefined : new Decimal(actual.setupAmount).toFixed(4)) === expected.setupAmount
    );
  });
}

export async function previewPieceworkPriceBookPublication(
  manifest: PieceworkPriceBookManifest,
  sourceSha256: string,
): Promise<PieceworkPublicationPreview> {
  const issues = validatePieceworkManifestForPublication(manifest);
  if (!SHA256.test(sourceSha256)) issues.push('manifest 原始文件 SHA-256 非法');
  const book = await db.pieceworkPriceBook.findUnique({
    where: { version: manifest.priceBookVersion },
    include: {
      rules: {
        select: { id: true, operationType: true, unit: true, amount: true, smallOrderAmount: true, setupAmount: true },
      },
    },
  });
  const latest = !book ? await db.pieceworkPriceBook.findFirst({ where: { workerId: null }, orderBy: { version: 'desc' } }) : null;
  const highest = !book ? await db.pieceworkPriceBook.findFirst({ orderBy: { version: 'desc' } }) : null;
  if (!book && (!latest || manifest.priceBookVersion !== (highest?.version ?? 0) + 1 || latest.status !== 'PUBLISHED')) issues.push('新版本必须紧接当前已发布版本');
  if (book?.workerId) throw new PieceworkPriceBookAdminError('个人工价请在师傅账号中维护');
  if (book?.status === PieceworkPriceBookStatus.PUBLISHED) {
    issues.push('计件工价簿已发布；apply 只能做同 manifest 幂等复放');
  }
  if (book && ![2, 3, 4].includes(book.rules.length)) issues.push('草稿工价规则数量不正确');

  return {
    bookId: book?.id ?? null,
    bookStatus: book?.status ?? null,
    draftUpdatedAt: book?.updatedAt.toISOString() ?? latest?.updatedAt.toISOString() ?? null,
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

function receiptRules(manifest: PieceworkPriceBookManifest) {
  return manifestRulesWithNormalizedAmounts(manifest).map((rule) => ({
    operationType: rule.operationType,
    unit: rule.unit,
    rate: rule.amount,
    ...(rule.smallOrderAmount !== undefined ? { smallOrderAmount: rule.smallOrderAmount, setupAmount: rule.setupAmount } : {}),
  }));
}

export async function assertActivePieceworkAdmin(
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

export async function publishPieceworkPriceBook(
  input: PublishPieceworkPriceBookInput,
  now?: Date,
): Promise<PieceworkPublicationReceipt> {
  const issues = validatePieceworkManifestForPublication(input.effectiveImmediately
    ? { ...input.manifest, effectiveFrom: (now ?? new Date()).toISOString() }
    : input.manifest);
  if (issues.length > 0) {
    throw new PieceworkPriceBookAdminError(issues.join('；'));
  }
  if (!Number.isFinite(input.expectedDraftUpdatedAt.getTime())) {
    throw new PieceworkPriceBookAdminError('草稿修订时间非法');
  }
  if (!SHA256.test(input.sourceSha256)) {
    throw new PieceworkPriceBookAdminError('manifest 原始文件 SHA-256 非法');
  }

  const normalizedRules = manifestRulesWithNormalizedAmounts(input.manifest);
  const ruleSetSha256 = calculatePieceworkRuleSetSha256(normalizedRules);

  return db.$transaction(async (tx) => {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext('print-shop-erp:piecework-price-book:publish'))`;
    await tx.$queryRaw`SELECT "id" FROM "PieceworkPriceBook" WHERE "version" = ${input.manifest.priceBookVersion} FOR UPDATE`;
    await tx.$queryRaw`SELECT rule."id" FROM "PieceworkPriceRule" rule INNER JOIN "PieceworkPriceBook" book ON book."id" = rule."priceBookId" WHERE book."version" = ${input.manifest.priceBookVersion} FOR UPDATE OF rule`;

    const actor = await assertActivePieceworkAdmin(tx, input.actor);
    let book = await tx.pieceworkPriceBook.findUnique({
      where: { version: input.manifest.priceBookVersion },
      include: {
        rules: {
          select: { id: true, operationType: true, unit: true, amount: true, smallOrderAmount: true, setupAmount: true },
        },
      },
    });
    if (book?.workerId) throw new PieceworkPriceBookAdminError('个人工价请在师傅账号中维护');
    if (!book) {
      const latest = await tx.pieceworkPriceBook.findFirst({ where: { workerId: null }, orderBy: { version: 'desc' } });
      const highest = await tx.pieceworkPriceBook.findFirst({ orderBy: { version: 'desc' } });
      if (!latest || latest.status !== 'PUBLISHED' || (highest?.version ?? 0) + 1 !== input.manifest.priceBookVersion || latest.updatedAt.getTime() !== input.expectedDraftUpdatedAt.getTime()) {
        throw new PieceworkPriceBookAdminError('当前工价版本已变化，请重新预览');
      }
      book = await tx.pieceworkPriceBook.create({
        data: { version: input.manifest.priceBookVersion, updatedAt: input.expectedDraftUpdatedAt,
          rules: { create: normalizedRules.map((rule) => ({ operationType: rule.operationType, unit: rule.unit, amount: null })) } },
        include: { rules: { select: { id: true, operationType: true, unit: true, amount: true, smallOrderAmount: true, setupAmount: true } } },
      });
    }

    const publicationNow = now ?? await databaseClockNow(tx);
    const effectiveFrom = input.effectiveImmediately
      ? (book.status === PieceworkPriceBookStatus.PUBLISHED ? book.effectiveFrom! : publicationNow)
      : new Date(input.manifest.effectiveFrom!);
    // Keep scheduled CLI manifests byte-semantically compatible with existing
    // publication hashes; only immediate publication needs a resolved time.
    const manifestSha256 = calculatePieceworkManifestSha256(input.effectiveImmediately
      ? { ...input.manifest, effectiveFrom: effectiveFrom.toISOString() }
      : input.manifest);

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
          '计件工价簿已以不同 manifest 发布，禁止覆盖',
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
        throw new PieceworkPriceBookAdminError('已发布版本缺少审计记录');
      }
      return {
        outcome: 'ALREADY_PUBLISHED',
        bookId: book.id,
        version: input.manifest.priceBookVersion,
        effectiveFrom: effectiveFrom.toISOString(),
        rules: receiptRules(input.manifest),
        sourceSha256: input.sourceSha256,
        manifestSha256,
        ruleSetSha256,
        auditLogId: audit.id,
      };
    }

    if (effectiveFrom < publicationNow) {
      throw new PieceworkPriceBookAdminError('计件工价簿不能追溯发布');
    }
    if (book.updatedAt.getTime() !== input.expectedDraftUpdatedAt.getTime()) {
      throw new PieceworkPriceBookAdminError('计件工价草稿已变更，请重新加载后核对');
    }
    if (book.rules.length === 3 && normalizedRules.some((rule) => rule.unit === 'PER_BOX')) {
      const added = await tx.pieceworkPriceRule.create({ data: {
        priceBookId: book.id, operationType: 'PACKING', unit: 'PER_BOX', amount: null,
      } });
      book.rules.push(added);
    }
    if (book.rules.length !== normalizedRules.length) throw new PieceworkPriceBookAdminError('草稿工价与发布规则不一致');
    const existingByType = new Map(
      (book.rules as StoredPieceworkRule[]).map((rule) => [
        `${rule.operationType}:${rule.unit}`,
        rule,
      ]),
    );
    for (const expected of normalizedRules) {
      const current = existingByType.get(`${expected.operationType}:${expected.unit}`);
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
      for (const column of ['smallOrderAmount', 'setupAmount'] as const) {
        const stored = current[column];
        if (stored != null && new Decimal(stored).toFixed(4) !== expected[column]) throw new PieceworkPriceBookAdminError('草稿小单工资或装版费不同，请重新核对');
      }
      if (current.smallOrderAmount == null && expected.smallOrderAmount !== undefined && expected.setupAmount !== undefined) {
        await tx.pieceworkPriceRule.updateMany({
          where: { id: current.id, smallOrderAmount: null, setupAmount: null },
          data: { smallOrderAmount: new Prisma.Decimal(expected.smallOrderAmount), setupAmount: new Prisma.Decimal(expected.setupAmount) },
        });
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

    const previous = await tx.pieceworkPriceBook.findFirst({
      where: { workerId: null, status: 'PUBLISHED', effectiveTo: null }, orderBy: { version: 'desc' },
    });
    if (previous) {
      if (!previous.effectiveFrom || previous.effectiveFrom >= effectiveFrom || previous.version >= book.version) {
        throw new PieceworkPriceBookAdminError('生效时间必须晚于当前工价版本');
      }
      await tx.pieceworkPriceBook.update({ where: { id: previous.id }, data: { effectiveTo: effectiveFrom } });
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
        publishedAt: publicationNow,
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
        version: input.manifest.priceBookVersion,
        status: PieceworkPriceBookStatus.DRAFT,
        updatedAt: book.updatedAt,
      },
      after: {
        version: input.manifest.priceBookVersion,
        status: PieceworkPriceBookStatus.PUBLISHED,
        effectiveFrom,
        rules: receiptRules(input.manifest),
        sourceSha256: input.sourceSha256,
        manifestSha256,
        ruleSetSha256,
      },
      requestMetadata: {
        source: 'piecework-price-book-admin.publishPieceworkPriceBook',
        sourceName: input.manifest.sourceName.trim(),
        publishNote: input.manifest.publishNote.trim(),
        previousBookId: previous?.id ?? null,
        previousEffectiveTo: effectiveFrom.toISOString(),
      },
    });

    return {
      outcome: 'PUBLISHED',
      bookId: book.id,
      version: input.manifest.priceBookVersion,
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

// Compatibility for existing deployment scripts; both entries use the same versioned publisher.
export type PieceworkPriceBookV1Manifest = PieceworkPriceBookManifest;
export type PublishPieceworkPriceBookV1Input = PublishPieceworkPriceBookInput;
export const parsePieceworkPriceBookV1Manifest = parsePieceworkPriceBookManifest;
export const previewPieceworkPriceBookV1Publication = previewPieceworkPriceBookPublication;
export const publishPieceworkPriceBookV1 = publishPieceworkPriceBook;
