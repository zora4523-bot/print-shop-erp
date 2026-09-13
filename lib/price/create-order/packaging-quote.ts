import { OrderPackagingMode } from '../../../generated/prisma/enums';
import { calculatePackagingBagCount } from '../../order/packaging-bag-count';
import { packagingBoxType, packagingModeLabel } from '@/lib/order/packaging-mode';
import type { CreateOrderShipmentInput } from './types';
import { decimalValue, safeMoney, safeUnitPrice } from './money';
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
    code:
      args.basis.mode === 'UNPACKED'
        ? 'NO_PACKAGING'
        : String(args.basis.mode).startsWith('BOX_')
          ? 'BOX_PACKAGING'
          : 'BAGGING',
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
      label: packagingModeLabel(mode),
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
  shipments?: readonly CreateOrderShipmentInput[];
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
    errors.push(`包装组款式重复：${[...new Set(duplicateItemKeys)].join('、')}`);
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
    mode: group.mode,
    itemQuantities: group.items.map((item) => itemsByKey.get(item.itemKey)!.quantity),
    itemUnitsPerBag: group.items.map((item) => item.unitsPerBag!),
    shipmentQuantities: args.shipments?.map((shipment) =>
      group.items.map((item) => shipment.itemQuantities[item.itemKey] ?? 0),
    ),
  });
  if (!bagCountResult.complete) {
    return pendingGroup(group.groupKey, itemKeys, group.mode, bagCountResult.errors);
  }

  const box = packagingBoxType(group.mode);
  const noPackaging = group.mode === OrderPackagingMode.UNPACKED;
  const boxMaterialRate = box
    ? decimalValue(
        box === 'RED_CARD'
          ? (snapshot.boxing?.redCardEmptyBox ?? '')
          : (snapshot.boxing?.tactileEmptyBox ?? ''),
      )
    : null;
  const boxPackingRate = box ? decimalValue(snapshot.boxing?.packingPerBox ?? '') : null;
  if (box && (!boxMaterialRate || !boxPackingRate)) {
    return pendingGroup(group.groupKey, itemKeys, group.mode, [
      '当前价格版本缺少盒子单价或装盒费，请配置并发布包装价格',
    ]);
  }
  const rawRate = noPackaging
    ? '0'
    : box
      ? boxMaterialRate!.plus(boxPackingRate!).toString()
      : group.mode === 'MIXED_STYLE'
        ? snapshot.bagging.mixedPerBag
        : snapshot.bagging.standardPerBag;
  const rate = decimalValue(rawRate);
  if (!rate) {
    return pendingGroup(group.groupKey, itemKeys, group.mode, ['入袋费率配置无效']);
  }
  const quotedAmount = safeMoney(rate.times(bagCountResult.bagCount));
  if (quotedAmount === null) {
    return pendingGroup(group.groupKey, itemKeys, group.mode, ['入袋费超过可保存上限']);
  }
  const storedRate = safeUnitPrice(rate);
  if (storedRate === null) {
    return pendingGroup(group.groupKey, itemKeys, group.mode, ['入袋费率超过可保存上限']);
  }

  const emptyBoxAmount = box
    ? safeMoney(boxMaterialRate!.times(bagCountResult.bagCount))!
    : null;

  const excludedManual =
    !noPackaging && !box && itemKeys.some((itemKey) => manualItemKeys.has(itemKey));
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
      label: packagingModeLabel(group.mode),
      status,
      amount: quotedAmount,
      includedInKnownTotal: !excludedManual,
      basis: {
        mode: group.mode,
        itemKeys: itemKeys.join(','),
        bagCount: bagCountResult.bagCount,
        rate: storedRate,
        ...(box
          ? {
              boxType: box,
              emptyBoxRate: safeUnitPrice(boxMaterialRate!)!,
              packingRate: safeUnitPrice(boxPackingRate!)!,
              emptyBoxAmount,
              // Allocate the rounding remainder so the evidence adds up to the charged total.
              packingAmount: safeMoney(decimalValue(quotedAmount)!.minus(emptyBoxAmount!))!,
            }
          : {}),
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
  shipments?: readonly CreateOrderShipmentInput[];
}): CreateOrderPackagingGroupQuote[] {
  const itemsByKey = new Map(args.items.map((item) => [item.itemKey, item]));
  const quotes = args.groups.map((group) =>
    quoteGroup({
      group,
      itemsByKey,
      manualItemKeys: args.manualItemKeys,
      snapshot: args.snapshot,
      shipments: args.shipments,
    }),
  );
  const groupedItemKeys = new Set(
    args.groups.flatMap((group) => group.items.map((item) => item.itemKey)),
  );

  for (const item of args.items) {
    if (groupedItemKeys.has(item.itemKey)) continue;
    quotes.push(pendingGroup(`UNASSIGNED:${item.itemKey}`, [item.itemKey], 'SINGLE_STYLE'));
  }
  return quotes;
}
