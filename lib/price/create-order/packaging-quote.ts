import { OrderPackagingMode } from '../../../generated/prisma/enums';
import { calculatePackagingBagCount } from '../../order/packaging-bag-count';
import { decimalValue, safeMoney, unitPrice } from './money';
import type {
  CreateOrderPackagingGroupInput,
  CreateOrderPackagingGroupQuote,
  CreateOrderPriceSnapshot,
  CreateOrderQuoteItemInput,
  CreateOrderQuoteLine,
} from './types';

function packagingLine(args: {
  groupKey: string;
  label: string;
  status: CreateOrderQuoteLine['status'];
  amount: string | null;
  includedInKnownTotal: boolean;
  basis: CreateOrderQuoteLine['basis'];
  errors?: readonly string[];
}): CreateOrderQuoteLine {
  return {
    layer: 'PACKAGING_GROUP',
    itemKey: null,
    groupKey: args.groupKey,
    code: 'BAGGING',
    label: args.label,
    status: args.status,
    amount: args.amount,
    includedInKnownTotal: args.includedInKnownTotal,
    basis: args.basis,
    errors: args.errors ?? [],
  };
}

function pendingGroup(
  groupKey: string,
  itemKeys: readonly string[],
  mode: CreateOrderPackagingGroupInput['mode'],
  errors: readonly string[] = [],
): CreateOrderPackagingGroupQuote {
  return {
    groupKey,
    status: errors.length > 0 ? 'INVALID_INPUT' : 'PENDING_AMOUNT',
    itemKeys,
    bagCount: null,
    amount: null,
    knownAmount: '0.00',
    line: packagingLine({
      groupKey,
      label: mode === 'MIXED_STYLE' ? '混装入袋' : '常规入袋',
      status: 'PENDING_AMOUNT',
      amount: null,
      includedInKnownTotal: false,
      basis: {
        mode,
        itemKeys: itemKeys.join(','),
        bagCount: null,
        displayAmount: '—',
      },
      errors,
    }),
    errors,
  };
}

function quoteGroup(args: {
  group: CreateOrderPackagingGroupInput;
  itemsByKey: ReadonlyMap<string, CreateOrderQuoteItemInput>;
  manualItemKeys: ReadonlySet<string>;
  snapshot: CreateOrderPriceSnapshot;
}): CreateOrderPackagingGroupQuote {
  const { group, itemsByKey, manualItemKeys, snapshot } = args;
  const itemKeys = group.items.map((item) => item.itemKey);
  const errors: string[] = [];

  if (!group.groupKey.trim()) errors.push('包装组标识不能为空');
  if (group.items.length === 0) errors.push('包装组至少包含一款');
  const duplicateItemKeys = itemKeys.filter(
    (itemKey, index) => itemKeys.indexOf(itemKey) !== index,
  );
  if (duplicateItemKeys.length > 0) {
    errors.push(
      `包装组款式重复：${[...new Set(duplicateItemKeys)].join('、')}`,
    );
  }
  const unknownItemKeys = itemKeys.filter((itemKey) => !itemsByKey.has(itemKey));
  if (unknownItemKeys.length > 0) {
    errors.push(`包装组引用未知款式：${unknownItemKeys.join('、')}`);
  }
  if (errors.length > 0) {
    return pendingGroup(group.groupKey, itemKeys, group.mode, errors);
  }

  if (group.items.some((item) => item.unitsPerBag === null)) {
    return pendingGroup(group.groupKey, itemKeys, group.mode);
  }

  const bagCountResult = calculatePackagingBagCount({
    mode:
      group.mode === 'MIXED_STYLE'
        ? OrderPackagingMode.MIXED_STYLE
        : OrderPackagingMode.SINGLE_STYLE,
    itemQuantities: group.items.map(
      (item) => itemsByKey.get(item.itemKey)!.quantity,
    ),
    itemUnitsPerBag: group.items.map((item) => item.unitsPerBag!),
  });
  if (!bagCountResult.complete) {
    return pendingGroup(
      group.groupKey,
      itemKeys,
      group.mode,
      bagCountResult.errors,
    );
  }

  const rawRate =
    group.mode === 'MIXED_STYLE'
      ? snapshot.bagging.mixedPerBag
      : snapshot.bagging.standardPerBag;
  const rate = decimalValue(rawRate);
  if (!rate) {
    return pendingGroup(group.groupKey, itemKeys, group.mode, [
      '入袋费率配置无效',
    ]);
  }
  const quotedAmount = safeMoney(rate.times(bagCountResult.bagCount));
  if (quotedAmount === null) {
    return pendingGroup(group.groupKey, itemKeys, group.mode, [
      '入袋费超过可保存上限',
    ]);
  }

  const excludedManual = itemKeys.some((itemKey) => manualItemKeys.has(itemKey));
  const status = excludedManual ? 'EXCLUDED_MANUAL' : 'QUOTED';
  return {
    groupKey: group.groupKey,
    status,
    itemKeys,
    bagCount: bagCountResult.bagCount,
    amount: excludedManual ? null : quotedAmount,
    knownAmount: excludedManual ? '0.00' : quotedAmount,
    line: packagingLine({
      groupKey: group.groupKey,
      label: group.mode === 'MIXED_STYLE' ? '混装入袋' : '常规入袋',
      status,
      amount: quotedAmount,
      includedInKnownTotal: !excludedManual,
      basis: {
        mode: group.mode,
        itemKeys: itemKeys.join(','),
        bagCount: bagCountResult.bagCount,
        rate: unitPrice(rate),
      },
    }),
    errors: [],
  };
}

/** Quote bagging exactly once per persisted packaging group. */
export function quoteCreateOrderPackagingGroups(args: {
  items: readonly CreateOrderQuoteItemInput[];
  groups: readonly CreateOrderPackagingGroupInput[];
  manualItemKeys: ReadonlySet<string>;
  snapshot: CreateOrderPriceSnapshot;
}): CreateOrderPackagingGroupQuote[] {
  const itemsByKey = new Map(args.items.map((item) => [item.itemKey, item]));
  const quotes = args.groups.map((group) =>
    quoteGroup({
      group,
      itemsByKey,
      manualItemKeys: args.manualItemKeys,
      snapshot: args.snapshot,
    }),
  );
  const groupedItemKeys = new Set(
    args.groups.flatMap((group) => group.items.map((item) => item.itemKey)),
  );

  for (const item of args.items) {
    if (groupedItemKeys.has(item.itemKey)) continue;
    quotes.push(
      pendingGroup(
        `UNASSIGNED:${item.itemKey}`,
        [item.itemKey],
        'SINGLE_STYLE',
      ),
    );
  }
  return quotes;
}
