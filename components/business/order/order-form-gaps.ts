export type OrderFormStep = 'customer' | 'items' | 'shipping';

export type OrderFormGap = {
  id: string;
  step: OrderFormStep;
  itemIndex?: number;
  label: string;
  fieldId: string;
};

export type OrderFormQuoteStatus =
  | 'missing'
  | 'loading'
  | 'stale'
  | 'error'
  | 'incomplete'
  | 'complete';

export type OrderFormGapItem = {
  name?: string | null;
  productId?: string | null;
  paperType?: string | null;
  quantity?: number | null;
  crafts?: string[] | null;
  quoteStatus?: OrderFormQuoteStatus;
  manualPriceProvided?: boolean;
  priceOverrideReason?: string | null;
  priceOverrideRequired?: boolean;
};

export type OrderFormGapShipment = {
  key: string;
  label: string;
  idPrefix: string;
  receiverFieldId: string;
  receiverAddress?: string | null;
  province?: string | null;
  billableWeightKg?: string | null;
};

export type OrderFormGapInput = {
  customerRef?: string | null;
  promisedDate?: Date | string | null;
  items: readonly OrderFormGapItem[];
  shipping: {
    usesExternalSalesPricing: boolean;
    isSfCollect: boolean;
    shipments: readonly OrderFormGapShipment[];
  };
};

function hasText(value: string | null | undefined): boolean {
  return Boolean(value?.trim());
}

function hasDate(value: Date | string | null | undefined): boolean {
  if (value instanceof Date) return !Number.isNaN(value.getTime());
  return hasText(value);
}

/**
 * Builds the operator-facing readiness list. These are not all Zod-required
 * fields: customer/deadline and the automatic quote paths are intentionally
 * allowed to remain incomplete while a DRAFT is created. The rail makes that
 * debt visible and provides an exact focus target without weakening the
 * server-side create contract.
 */
export function collectOrderFormGaps(
  input: OrderFormGapInput,
): OrderFormGap[] {
  const gaps: OrderFormGap[] = [];
  const usesExternalSalesPricing = input.shipping.usesExternalSalesPricing;

  if (!usesExternalSalesPricing && !hasText(input.customerRef)) {
    gaps.push({
      id: 'customer-ref',
      step: 'customer',
      label: '未填写客户名称/简称',
      fieldId: 'customerRef',
    });
  }
  if (!usesExternalSalesPricing && !hasDate(input.promisedDate)) {
    gaps.push({
      id: 'promised-date',
      step: 'customer',
      label: '未填写承诺交期',
      fieldId: 'promisedDate',
    });
  }

  input.items.forEach((item, index) => {
    const n = index + 1;
    if (!hasText(item.name)) {
      gaps.push({
        id: `item-${index}-name`,
        step: 'items',
        itemIndex: index,
        label: `款式 #${n} 未填名称`,
        fieldId: `items.${index}.name`,
      });
    }
    if (!hasText(item.productId)) {
      gaps.push({
        id: `item-${index}-product`,
        step: 'items',
        itemIndex: index,
        label: `款式 #${n} 未选报价产品`,
        fieldId: `items.${index}.productId`,
      });
    }
    if (!hasText(item.paperType)) {
      gaps.push({
        id: `item-${index}-paper`,
        step: 'items',
        itemIndex: index,
        label: `款式 #${n} 未选择纸张`,
        fieldId: `items.${index}.paperType`,
      });
    }
    if (!Number.isInteger(item.quantity) || (item.quantity ?? 0) < 1) {
      gaps.push({
        id: `item-${index}-qty`,
        step: 'items',
        itemIndex: index,
        label: `款式 #${n} 数量无效`,
        fieldId: `items.${index}.quantity`,
      });
    }
    if (!item.crafts || item.crafts.length === 0) {
      gaps.push({
        id: `item-${index}-crafts`,
        step: 'items',
        itemIndex: index,
        label: `款式 #${n} 未选工艺`,
        fieldId: `items.${index}.crafts`,
      });
    }

    // External sales submit production/quote facts only. The server ignores
    // browser-supplied amounts and routes an incomplete calculation to the
    // administrator pricing review, so asking the salesperson for a manual
    // price or override reason here would point at controls that are hidden.
    if (!usesExternalSalesPricing) {
      const hasReason = hasText(item.priceOverrideReason);
      const manualQuoteResolved = item.manualPriceProvided && hasReason;
      if (item.quoteStatus !== 'complete' && !manualQuoteResolved) {
        const stateLabel =
          item.quoteStatus === 'stale'
            ? '报价条件已变化，需重新核价'
            : item.quoteStatus === 'loading'
              ? '正在核价'
              : item.quoteStatus === 'incomplete'
                ? '自动报价不完整，需人工报价'
                : item.quoteStatus === 'error'
                  ? '自动报价失败，需重试或人工报价'
                  : '尚未核价';
        gaps.push({
          id: `item-${index}-quote`,
          step: 'items',
          itemIndex: index,
          label: `款式 #${n} ${stateLabel}`,
          fieldId: `items.${index}.quote`,
        });
      }
      if (item.priceOverrideRequired && !hasReason) {
        gaps.push({
          id: `item-${index}-price-reason`,
          step: 'items',
          itemIndex: index,
          label: `款式 #${n} 缺少人工改价说明`,
          fieldId: `items.${index}.priceOverrideReason`,
        });
      }
    }
  });

  const { shipping } = input;
  for (const shipment of shipping.shipments) {
    if (!hasText(shipment.receiverAddress)) {
      gaps.push({
        id: `shipment-${shipment.key}-address`,
        step: 'shipping',
        label: `${shipment.label}未填写收货信息`,
        fieldId: shipment.receiverFieldId,
      });
    }
    if (!shipping.usesExternalSalesPricing) continue;

    if (!shipping.isSfCollect && !hasText(shipment.province)) {
      gaps.push({
        id: `shipment-${shipment.key}-province`,
        step: 'shipping',
        label: `${shipment.label}未选计费省份`,
        fieldId: `${shipment.idPrefix}-province`,
      });
    }
    if (!shipping.isSfCollect && !hasText(shipment.billableWeightKg)) {
      gaps.push({
        id: `shipment-${shipment.key}-weight`,
        step: 'shipping',
        label: `${shipment.label}未填承运商计费重量`,
        fieldId: `${shipment.idPrefix}-weight`,
      });
    }
  }

  return gaps;
}

export const ORDER_FORM_STEP_LABELS: Record<OrderFormStep, string> = {
  customer: '① 客户与交期',
  items: '② 款式',
  shipping: '③ 收货与费用',
};

export const PRINT_ITEM_IMAGE_WARN_COUNT = 6;
