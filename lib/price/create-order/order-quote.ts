import { calculateExternalOrderCharges } from '../external-order-charges';
import { quoteCreateOrderItem } from './item-quote';
import { sumMoney } from './money';
import type {
  CreateOrderOrderQuote,
  CreateOrderPriceSnapshot,
  CreateOrderQuoteInput,
  CreateOrderQuoteLine,
  CreateOrderQuoteResult,
} from './types';

function validateOrderInput(input: CreateOrderQuoteInput): string[] {
  const errors: string[] = [];
  if (input.items.length === 0) errors.push('至少需要一个款式');
  if (input.shipments.length === 0) errors.push('至少需要一个发货地址');

  const itemKeys = input.items.map((item) => item.itemKey);
  const duplicateItemKeys = itemKeys.filter(
    (key, index) => itemKeys.indexOf(key) !== index,
  );
  if (duplicateItemKeys.length > 0) {
    errors.push(`款式标识重复：${[...new Set(duplicateItemKeys)].join('、')}`);
  }
  const figs = input.items.map((item) => item.fig);
  const duplicateFigs = figs.filter((fig, index) => figs.indexOf(fig) !== index);
  if (duplicateFigs.length > 0) {
    errors.push(`款式 fig 重复：${[...new Set(duplicateFigs)].join('、')}`);
  }

  const knownItemKeys = new Set(itemKeys);
  for (const shipment of input.shipments) {
    for (const [itemKey, quantity] of Object.entries(shipment.itemQuantities)) {
      if (!knownItemKeys.has(itemKey) && quantity !== 0) {
        errors.push(`发货记录 ${shipment.shipmentKey} 引用了未知款式 ${itemKey}`);
      }
      if (!Number.isSafeInteger(quantity) || quantity < 0) {
        errors.push(`发货记录 ${shipment.shipmentKey} 的 ${itemKey} 数量无效`);
      }
    }
  }
  for (const item of input.items) {
    const allocated = input.shipments.reduce(
      (total, shipment) => total + (shipment.itemQuantities[item.itemKey] ?? 0),
      0,
    );
    if (allocated !== item.quantity) {
      errors.push(
        `款式 ${item.itemKey} 分配数量 ${allocated} 与款式数量 ${item.quantity} 不一致`,
      );
    }
  }
  return errors;
}

function pendingPlateLine(snapshot: CreateOrderPriceSnapshot): CreateOrderQuoteLine {
  return {
    layer: 'ORDER',
    itemKey: null,
    code: 'PLATE_FEE',
    label: snapshot.plate.label,
    status: 'PENDING',
    amount: null,
    includedInKnownTotal: false,
    basis: { displayAmount: '待定', granularity: 'PER_ORDER' },
    errors: [],
  };
}

function quoteOrderLayer(
  input: CreateOrderQuoteInput,
  snapshot: CreateOrderPriceSnapshot,
): CreateOrderOrderQuote {
  const itemsByKey = new Map(input.items.map((item) => [item.itemKey, item]));
  const chargeQuote = calculateExternalOrderCharges(
    {
      isSfCollect: input.isSfCollect,
      shipments: input.shipments.map((shipment) => {
        const allocations = Object.entries(shipment.itemQuantities).filter(
          ([, quantity]) => quantity > 0,
        );
        return {
          shipmentKey: shipment.shipmentKey,
          province: shipment.province,
          billableWeightKg: shipment.trustedBillableWeightKg ?? null,
          itemQuantity: allocations.reduce(
            (total, [, quantity]) => total + quantity,
            0,
          ),
          weightItems: allocations.flatMap(([itemKey, quantity]) => {
            const item = itemsByKey.get(itemKey);
            return item
              ? [
                  {
                    itemKey,
                    quantity,
                    paperWeightGsm: item.paperWeightGsm,
                    paperType: item.paperType,
                    productStructure: item.productStructure,
                  },
                ]
              : [];
          }),
        };
      }),
    },
    snapshot.orderCharges.rules,
    snapshot.orderCharges.logisticsPolicy,
  );

  const carton: CreateOrderQuoteLine = {
    layer: 'ORDER',
    itemKey: null,
    code: 'CARTON',
    label: '纸箱耗材',
    status:
      chargeQuote.suggestedPackagingTotal === null ? 'PENDING' : 'QUOTED',
    amount: chargeQuote.suggestedPackagingTotal,
    includedInKnownTotal: chargeQuote.suggestedPackagingTotal !== null,
    basis: {
      granularity: 'PER_ORDER',
      totalQuantity: input.items.reduce(
        (total, item) => total + item.quantity,
        0,
      ),
    },
    errors: chargeQuote.shipments.flatMap(
      (shipment) => shipment.packaging.errors,
    ),
  };
  const shipping: CreateOrderQuoteLine[] = chargeQuote.shipments.map(
    (shipment) => ({
      layer: 'ORDER',
      itemKey: null,
      code: `SHIPPING:${shipment.shipmentKey}`,
      label: shipment.shipping.name,
      status: shipment.shipping.complete ? 'QUOTED' : 'PENDING',
      amount: shipment.shipping.amount,
      includedInKnownTotal:
        shipment.shipping.complete && shipment.shipping.amount !== null,
      basis: shipment.shipping.basis,
      errors: shipment.shipping.errors,
    }),
  );
  const lines = [carton, ...shipping, pendingPlateLine(snapshot)];
  const knownAmount = sumMoney(
    lines.map((line) =>
      line.includedInKnownTotal ? line.amount : null,
    ),
  );
  const allNonPlateKnown = [carton, ...shipping].every(
    (line) => line.status === 'QUOTED' && line.amount !== null,
  );
  return {
    amount: allNonPlateKnown ? knownAmount : null,
    knownAmount,
    lines,
    errors: chargeQuote.errors,
  };
}

export function calculateCreateOrderQuote(
  input: CreateOrderQuoteInput,
  snapshot: CreateOrderPriceSnapshot,
): CreateOrderQuoteResult {
  const orderInputErrors = validateOrderInput(input);
  const items = input.items.map((item) => quoteCreateOrderItem(item, snapshot));
  const invalidItemErrors = items.flatMap((item) =>
    item.errors.map((error) => `款式 ${item.itemKey}：${error}`),
  );
  const hasInvalidInput =
    orderInputErrors.length > 0 ||
    items.some((item) => item.status === 'INVALID_INPUT');

  const order =
    orderInputErrors.length === 0
      ? quoteOrderLayer(input, snapshot)
      : {
          amount: null,
          knownAmount: '0.00',
          lines: [pendingPlateLine(snapshot)],
          errors: orderInputErrors,
        };
  const manualReasons = items.flatMap((item) =>
    item.manualReasons.map((reason) => ({ ...reason, itemKey: item.itemKey })),
  );
  const excludedManualItemKeys = items
    .filter((item) => item.status === 'MANUAL_PRICING_REQUIRED')
    .map((item) => item.itemKey);
  const pendingLineCodes = [
    ...items.flatMap((item) =>
      item.lines
        .filter((line) => line.status === 'PENDING')
        .map((line) => `${item.itemKey}:${line.code}`),
    ),
    ...order.lines
      .filter((line) => line.status === 'PENDING')
      .map((line) => line.code),
  ];
  const hasManual = manualReasons.length > 0;
  const hasBlockingPending =
    items.some((item) => item.status === 'PARTIAL') ||
    order.amount === null;
  const status = hasInvalidInput
    ? 'INVALID_INPUT'
    : hasManual
      ? 'MANUAL_PRICING_REQUIRED'
      : hasBlockingPending
        ? 'PARTIAL'
        : 'QUOTED';
  const knownTotal = sumMoney([
    ...items.map((item) => item.knownAmount),
    order.knownAmount,
  ]);
  const total = status === 'QUOTED' ? knownTotal : null;

  return {
    priceVersion: snapshot.priceVersion,
    status,
    submittable: !hasInvalidInput,
    items,
    order,
    total,
    knownTotal,
    excludedManualItemKeys,
    pendingLineCodes,
    manualReasons,
    errors: [...orderInputErrors, ...invalidItemErrors, ...order.errors],
  };
}
