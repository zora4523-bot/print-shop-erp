import Decimal from 'decimal.js';
import type { Prisma, OrderSettlementType } from '@/generated/prisma/client';
import {
  CustomerPriceBookPurpose,
  OrderPackagingMode,
} from '@/generated/prisma/enums';
import { db } from '@/lib/db';
import { acquirePriceRuleSnapshotReadLock } from './rule-snapshot-lock';
import { parseCustomerRuleCondition } from './customer-rule-condition';

const MAX_BAG_COUNT = 9_999_999;
const MAX_UNIT_PRICE = new Decimal('999999.9999');
const MAX_SUBTOTAL = new Decimal('9999999999.99');

export type OrderPackagingGroupQuoteInput = {
  groupKey: string;
  mode: OrderPackagingMode;
  actualBagCount: number;
};

export type OrderPackagingPriceBookSnapshot = {
  id: string;
  code: string;
  name: string;
  version: number;
  sourceName: string | null;
  sourceSha256: string | null;
};

export type OrderPackagingGroupQuoteLine = {
  groupKey: string;
  complete: boolean;
  errors: string[];
  suggestedUnitPrice: string | null;
  suggestedSubtotal: string | null;
  snapshot: Prisma.InputJsonObject;
};

export type OrderPackagingQuoteResult = {
  priceBook: OrderPackagingPriceBookSnapshot | null;
  groups: OrderPackagingGroupQuoteLine[];
  suggestedTotal: string | null;
  requiresAdminConfirmation: boolean;
  errors: string[];
};

export type OrderPackagingPriceRule = {
  id: string;
  code: string;
  name: string;
  kind: string;
  calculationType: string | null;
  amount: unknown;
  minQty: number | null;
  maxQty: number | null;
  triggerCondition: unknown;
  exclusiveGroup: string | null;
  blocksAutomaticQuote: boolean;
  productId: string | null;
  sourceSheet: string | null;
  sourceRange: string | null;
  note: string | null;
  category: { code: string; name: string };
};

type ValidPackagingRule = {
  rule: OrderPackagingPriceRule;
  modes: OrderPackagingMode[];
  rate: Decimal;
};

function normalizedRate(value: unknown): Decimal | null {
  if (value === null || value === undefined) return null;
  try {
    const rate = new Decimal(String(value));
    return rate.isFinite() &&
      !rate.isNegative() &&
      rate.decimalPlaces() <= 4 &&
      rate.lte(MAX_UNIT_PRICE)
      ? rate
      : null;
  } catch {
    return null;
  }
}

function validatePackagingRules(rules: OrderPackagingPriceRule[]): {
  rules: ValidPackagingRule[];
  errors: string[];
} {
  const valid: ValidPackagingRule[] = [];
  const errors: string[] = [];
  for (const rule of rules) {
    const label = rule.name || rule.code || rule.id;
    const parsed = parseCustomerRuleCondition(rule.triggerCondition);
    if (!parsed.condition) {
      errors.push(
        ...parsed.errors.map((error) => `入袋规则“${label}”：${error}`),
      );
      continue;
    }
    const condition = parsed.condition;
    if (condition.target !== 'PACKAGING_GROUP') {
      errors.push(`入袋规则“${label}”未明确指向包装组`);
      continue;
    }
    if (
      rule.kind !== 'ADD_ON' ||
      rule.calculationType !== 'PER_BAG' ||
      rule.productId !== null ||
      rule.category.code !== 'PACKING' ||
      rule.blocksAutomaticQuote ||
      rule.minQty !== null ||
      rule.maxQty !== null ||
      rule.exclusiveGroup !== 'PACKAGING_GROUP_MODE'
    ) {
      errors.push(
        `入袋规则“${label}”必须是通用产品的 PACKING / ADD_ON / PER_BAG 自动规则`,
      );
      continue;
    }
    const rate = normalizedRate(rule.amount);
    if (!rate) {
      errors.push(`入袋规则“${label}”的每袋单价非法`);
      continue;
    }
    valid.push({
      rule,
      modes: condition.packagingModes ?? [],
      rate,
    });
  }
  return { rules: valid, errors };
}

function duplicateGroupKeyErrors(
  groups: readonly OrderPackagingGroupQuoteInput[],
): Map<string, string[]> {
  const counts = new Map<string, number>();
  for (const group of groups) {
    counts.set(group.groupKey, (counts.get(group.groupKey) ?? 0) + 1);
  }
  return new Map(
    [...counts.entries()]
      .filter(([, count]) => count > 1)
      .map(([key]) => [key, ['包装组标识重复，无法唯一归属报价']]),
  );
}

export function calculateOrderPackagingGroupsQuote(args: {
  groups: readonly OrderPackagingGroupQuoteInput[];
  priceBook: OrderPackagingPriceBookSnapshot | null;
  rules: OrderPackagingPriceRule[];
  quotedAt: Date;
  configurationErrors?: readonly string[];
}): OrderPackagingQuoteResult {
  const validated = validatePackagingRules(args.rules);
  const configurationErrors = [
    ...(args.configurationErrors ?? []),
    ...validated.errors,
  ];
  const duplicateErrors = duplicateGroupKeyErrors(args.groups);
  const groups = args.groups.map((group): OrderPackagingGroupQuoteLine => {
    const errors = [...configurationErrors];
    if (!group.groupKey.trim()) errors.push('包装组标识不能为空');
    errors.push(...(duplicateErrors.get(group.groupKey) ?? []));
    if (!Object.values(OrderPackagingMode).includes(group.mode)) {
      errors.push('包装模式非法');
    }
    if (
      !Number.isSafeInteger(group.actualBagCount) ||
      group.actualBagCount < 1 ||
      group.actualBagCount > MAX_BAG_COUNT
    ) {
      errors.push('实际袋数必须是 1–9999999 的整数');
    }

    const matches = validated.rules.filter((candidate) =>
      candidate.modes.includes(group.mode),
    );
    if (matches.length === 0) {
      errors.push('当前加工费价目未覆盖该包装模式');
    } else if (matches.length > 1) {
      errors.push('该包装模式同时命中多条入袋规则');
    }

    const matched = matches.length === 1 ? matches[0]! : null;
    let subtotal: Decimal | null = null;
    if (
      matched &&
      Number.isSafeInteger(group.actualBagCount) &&
      group.actualBagCount >= 1 &&
      group.actualBagCount <= MAX_BAG_COUNT
    ) {
      subtotal = matched.rate
        .times(group.actualBagCount)
        .toDecimalPlaces(2, Decimal.ROUND_HALF_UP);
      if (subtotal.gt(MAX_SUBTOTAL)) {
        errors.push('入袋费小计超过系统可保存上限');
        subtotal = null;
      }
    }
    const complete = errors.length === 0 && matched !== null && subtotal !== null;
    const suggestedUnitPrice = complete
      ? matched!.rate.toFixed(4)
      : null;
    const suggestedSubtotal = complete ? subtotal!.toFixed(2) : null;
    return {
      groupKey: group.groupKey,
      complete,
      errors,
      suggestedUnitPrice,
      suggestedSubtotal,
      snapshot: {
        version: 1,
        target: 'PACKAGING_GROUP',
        quotedAt: args.quotedAt.toISOString(),
        priceBook: args.priceBook,
        input: {
          groupKey: group.groupKey,
          mode: group.mode,
          actualBagCount: group.actualBagCount,
        },
        rule: matched
          ? {
              id: matched.rule.id,
              code: matched.rule.code,
              name: matched.rule.name,
              categoryCode: matched.rule.category.code,
              calculationType: matched.rule.calculationType,
              rate: matched.rate.toFixed(4),
              sourceSheet: matched.rule.sourceSheet,
              sourceRange: matched.rule.sourceRange,
              note: matched.rule.note,
            }
          : null,
        calculation: complete
          ? {
              rate: suggestedUnitPrice,
              units: group.actualBagCount,
              amount: suggestedSubtotal,
              rounding: 'HALF_UP_2',
            }
          : null,
        complete,
        errors,
      },
    };
  });
  const complete = groups.every((group) => group.complete);
  const errors = groups.flatMap((group) =>
    group.errors.map((error) => `包装组 ${group.groupKey}：${error}`),
  );
  return {
    priceBook: args.priceBook,
    groups,
    suggestedTotal: complete
      ? groups
          .reduce(
            (sum, group) => sum.plus(group.suggestedSubtotal ?? 0),
            new Decimal(0),
          )
          .toFixed(2)
      : null,
    requiresAdminConfirmation: !complete,
    errors,
  };
}

async function quoteInTransaction(
  groups: readonly OrderPackagingGroupQuoteInput[],
  settlementType: OrderSettlementType,
  now: Date,
  client: Prisma.TransactionClient,
  snapshotLockHeld: boolean,
): Promise<OrderPackagingQuoteResult> {
  if (!snapshotLockHeld) await acquirePriceRuleSnapshotReadLock(client);

  const books = await client.customerPriceBook.findMany({
    where: {
      settlementType,
      purpose: CustomerPriceBookPurpose.PROCESSING,
      isActive: true,
      effectiveFrom: { lte: now },
      OR: [{ effectiveTo: null }, { effectiveTo: { gt: now } }],
    },
    select: {
      id: true,
      code: true,
      name: true,
      version: true,
      sourceName: true,
      sourceSha256: true,
    },
    orderBy: [{ effectiveFrom: 'desc' }, { version: 'desc' }],
    take: 2,
  });
  if (books.length !== 1) {
    return calculateOrderPackagingGroupsQuote({
      groups,
      priceBook: null,
      rules: [],
      quotedAt: now,
      configurationErrors: [
        books.length === 0
          ? '当前没有生效的加工费价目簿'
          : '同一结算方向同时存在多个生效加工费价目簿',
      ],
    });
  }
  const book = books[0]!;
  const rows = await client.customerPriceRule.findMany({
    where: {
      priceBookId: book.id,
      isActive: true,
      category: { isActive: true },
      triggerCondition: {
        path: ['target'],
        equals: 'PACKAGING_GROUP',
      },
    },
    select: {
      id: true,
      code: true,
      name: true,
      kind: true,
      calculationType: true,
      amount: true,
      minQty: true,
      maxQty: true,
      triggerCondition: true,
      exclusiveGroup: true,
      blocksAutomaticQuote: true,
      productId: true,
      sourceSheet: true,
      sourceRange: true,
      note: true,
      category: { select: { code: true, name: true } },
    },
    orderBy: [{ priority: 'desc' }, { code: 'asc' }],
  });
  const priceBook: OrderPackagingPriceBookSnapshot = {
    ...book,
    code: String(book.code),
  };
  return calculateOrderPackagingGroupsQuote({
    groups,
    priceBook,
    rules: rows.map((rule) => ({
      ...rule,
      code: String(rule.code),
      kind: String(rule.kind),
      calculationType: rule.calculationType
        ? String(rule.calculationType)
        : null,
      amount: rule.amount?.toString() ?? null,
      category: {
        code: String(rule.category.code),
        name: rule.category.name,
      },
    })),
    quotedAt: now,
  });
}

export async function quoteOrderPackagingGroups(
  groups: readonly OrderPackagingGroupQuoteInput[],
  settlementType: OrderSettlementType,
  now: Date = new Date(),
  client?: Prisma.TransactionClient,
  options: { snapshotLockHeld?: boolean } = {},
): Promise<OrderPackagingQuoteResult> {
  if (groups.length === 0) {
    return {
      priceBook: null,
      groups: [],
      suggestedTotal: '0.00',
      requiresAdminConfirmation: false,
      errors: [],
    };
  }
  if (client) {
    return quoteInTransaction(
      groups,
      settlementType,
      now,
      client,
      options.snapshotLockHeld ?? false,
    );
  }
  return db.$transaction((tx) =>
    quoteInTransaction(groups, settlementType, now, tx, false),
  );
}
