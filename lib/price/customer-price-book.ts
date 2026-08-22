import type { OrderSettlementType, Prisma } from '../../generated/prisma/client';
import { CustomerPriceBookPurpose } from '../../generated/prisma/enums';
import { db } from '../db';
import { acquirePriceRuleSnapshotReadLock } from './rule-snapshot-lock';

export type CustomerPriceBookCatalogItem = {
  code: string;
  name: string;
  product?: string;
  specification?: string;
  paper?: string;
  calculationLabel: string;
  quantityRangeLabel: string;
  amountLabel: string;
  source: {
    fileName?: string;
    sha256?: string;
    sheet: string;
    range: string;
  };
  automation: 'AUTO' | 'MANUAL';
  note?: string;
};

export type CustomerPriceBookSourceReference = {
  fileName: string;
  sha256: string;
  sheet: string;
  range: string;
};

export type CustomerPriceBookCatalog = {
  code: string;
  name: string;
  version: number;
  settlementType: string;
  source: {
    fileName: string;
    sha256: string;
  };
  sources: CustomerPriceBookSourceReference[];
  effectiveFrom: Date;
  effectiveTo: Date | null;
  warnings: string[];
  categories: Array<{
    code: string;
    name: string;
    description?: string;
    items: CustomerPriceBookCatalogItem[];
  }>;
};

const CALCULATION_LABELS: Record<string, string> = {
  PER_PIECE: '按个',
  FIXED_AMOUNT: '整批固定金额',
  PER_SHEET: '按张',
  PER_10K: '每万个',
  PER_ITEM: '每款一次',
};

function warningsFromNotes(notes: unknown): string[] {
  if (!notes || typeof notes !== 'object' || Array.isArray(notes)) {
    return [];
  }
  const warnings = (notes as Record<string, unknown>).warnings;
  if (
    !Array.isArray(warnings) ||
    warnings.some((warning) => typeof warning !== 'string')
  ) {
    return [];
  }
  return [...new Set(warnings.map((warning) => warning.trim()).filter(Boolean))];
}

function sourceReferencesFromNotes(
  notes: unknown,
): CustomerPriceBookSourceReference[] {
  if (!notes || typeof notes !== 'object' || Array.isArray(notes)) {
    return [];
  }
  const sources = (notes as Record<string, unknown>).sources;
  if (!Array.isArray(sources)) return [];

  const result: CustomerPriceBookSourceReference[] = [];
  const seen = new Set<string>();
  for (const source of sources) {
    if (!source || typeof source !== 'object' || Array.isArray(source)) continue;
    const record = source as Record<string, unknown>;
    const fileName =
      typeof record.fileName === 'string' ? record.fileName.trim() : '';
    const sha256 = typeof record.sha256 === 'string' ? record.sha256.trim() : '';
    if (!fileName || !sha256) continue;

    const sheet =
      typeof record.sheet === 'string' && record.sheet.trim()
        ? record.sheet.trim()
        : '未记录';
    const range =
      typeof record.range === 'string' && record.range.trim()
        ? record.range.trim()
        : '未记录';
    const key = `${fileName}\u0000${sha256}\u0000${sheet}\u0000${range}`;
    if (seen.has(key)) continue;
    seen.add(key);
    result.push({ fileName, sha256, sheet, range });
  }
  return result;
}

function quantityRangeLabel(minQty: number | null, maxQty: number | null): string {
  if (minQty === null && maxQty === null) return '不限数量';
  if (minQty !== null && minQty === maxQty) return `仅 ${minQty} 个`;
  if (minQty === null) return `不超过 ${maxQty} 个`;
  if (maxQty === null) return `${minQty} 个起`;
  return `${minQty}–${maxQty} 个`;
}

function amountLabel(
  kind: string,
  calculationType: string | null,
  amount: unknown,
  includedUnits?: unknown,
  incrementUnits?: unknown,
  incrementAmount?: unknown,
): string {
  if (calculationType === null || amount === null) {
    return '人工报价 / 参考说明';
  }
  const value = Number(String(amount));
  const money = Number.isFinite(value)
    ? value.toLocaleString('zh-CN', { minimumFractionDigits: 2, maximumFractionDigits: 4 })
    : String(amount);
  if (
    includedUnits !== null &&
    includedUnits !== undefined &&
    incrementUnits !== null &&
    incrementUnits !== undefined &&
    incrementAmount !== null &&
    incrementAmount !== undefined
  ) {
    return `首重 ${String(includedUnits)}kg ¥${money}；续重每 ${String(
      incrementUnits,
    )}kg ¥${Number(String(incrementAmount)).toFixed(2)}`;
  }
  let rendered: string;
  switch (calculationType) {
    case 'PER_PIECE':
      rendered = `¥${money} / 个`;
      break;
    case 'PER_SHEET':
      rendered = `¥${money} / 张`;
      break;
    case 'PER_10K':
      rendered = `¥${money} / 万个`;
      break;
    case 'PER_ITEM':
      rendered = `¥${money} / 款`;
      break;
    case 'FIXED_AMOUNT':
      rendered = `整批 ¥${money}`;
      break;
    default:
      rendered = `¥${money}`;
  }
  return kind === 'REFERENCE' ? `参考：${rendered}` : rendered;
}

async function readCatalog(
  client: Prisma.TransactionClient,
  settlementType: OrderSettlementType,
  purpose: CustomerPriceBookPurpose,
  now: Date,
): Promise<CustomerPriceBookCatalog | null> {
  await acquirePriceRuleSnapshotReadLock(client);

  const books = await client.customerPriceBook.findMany({
    where: {
      settlementType,
      purpose,
      isActive: true,
      effectiveFrom: { lte: now },
      OR: [{ effectiveTo: null }, { effectiveTo: { gt: now } }],
    },
    select: {
      id: true,
      code: true,
      name: true,
      version: true,
      settlementType: true,
      sourceName: true,
      sourceSha256: true,
      effectiveFrom: true,
      effectiveTo: true,
      notes: true,
    },
    orderBy: [{ effectiveFrom: 'desc' }, { version: 'desc' }],
    take: 2,
  });
  if (books.length === 0) return null;
  if (books.length > 1) {
    throw new Error('同一结算方向与用途同时存在多个生效价目簿，请管理员修正有效期');
  }
  const book = books[0]!;

  const [categories, rules] = await Promise.all([
    client.customerChargeCategory.findMany({
      where: {
        isActive: true,
        rules: { some: { priceBookId: book.id, isActive: true } },
      },
      select: {
        id: true,
        code: true,
        name: true,
        description: true,
        sortOrder: true,
      },
      orderBy: [{ sortOrder: 'asc' }, { name: 'asc' }],
    }),
    client.customerPriceRule.findMany({
      where: { priceBookId: book.id, isActive: true },
      select: {
        categoryId: true,
        code: true,
        name: true,
        kind: true,
        calculationType: true,
        amount: true,
        includedUnits: true,
        incrementUnits: true,
        incrementAmount: true,
        minQty: true,
        maxQty: true,
        blocksAutomaticQuote: true,
        sourceSheet: true,
        sourceRange: true,
        sourceName: true,
        sourceSha256: true,
        note: true,
        priority: true,
        product: {
          select: {
            name: true,
            specification: true,
            paperType: true,
          },
        },
      },
      orderBy: [{ categoryId: 'asc' }, { priority: 'desc' }, { code: 'asc' }],
    }),
  ]);

  const rulesByCategory = new Map<string, typeof rules>();
  for (const rule of rules) {
    const list = rulesByCategory.get(rule.categoryId) ?? [];
    list.push(rule);
    rulesByCategory.set(rule.categoryId, list);
  }

  return {
    code: book.code,
    name: book.name,
    version: book.version,
    settlementType: book.settlementType,
    source: {
      fileName: book.sourceName ?? '未记录来源文件',
      sha256: book.sourceSha256 ?? '未记录',
    },
    sources: sourceReferencesFromNotes(book.notes),
    effectiveFrom: book.effectiveFrom,
    effectiveTo: book.effectiveTo,
    warnings: warningsFromNotes(book.notes),
    categories: categories.map((category) => ({
      code: category.code,
      name: category.name,
      ...(category.description ? { description: category.description } : {}),
      items: (rulesByCategory.get(category.id) ?? []).map((rule) => ({
        code: rule.code,
        name: rule.name,
        ...(rule.product?.name ? { product: rule.product.name } : {}),
        ...(rule.product?.specification
          ? { specification: rule.product.specification }
          : {}),
        ...(rule.product?.paperType ? { paper: rule.product.paperType } : {}),
        calculationLabel:
          rule.kind === 'REFERENCE'
            ? '人工确认'
            : CALCULATION_LABELS[rule.calculationType ?? ''] ?? '未知计价方式',
        quantityRangeLabel: quantityRangeLabel(rule.minQty, rule.maxQty),
        amountLabel: amountLabel(
          rule.kind,
          rule.calculationType,
          rule.amount,
          rule.includedUnits,
          rule.incrementUnits,
          rule.incrementAmount,
        ),
        source: {
          ...(rule.sourceName ? { fileName: rule.sourceName } : {}),
          ...(rule.sourceSha256 ? { sha256: rule.sourceSha256 } : {}),
          sheet: rule.sourceSheet ?? '未记录',
          range: rule.sourceRange ?? '未记录',
        },
        automation:
          rule.kind === 'REFERENCE' || rule.blocksAutomaticQuote
            ? 'MANUAL'
            : 'AUTO',
        ...(rule.note ? { note: rule.note } : {}),
      })),
    })),
  };
}

export async function getActiveCustomerPriceBookCatalog(
  settlementType: OrderSettlementType,
  purpose: CustomerPriceBookPurpose = CustomerPriceBookPurpose.PROCESSING,
  now: Date = new Date(),
): Promise<CustomerPriceBookCatalog | null> {
  return db.$transaction((tx) =>
    readCatalog(tx, settlementType, purpose, now),
  );
}
