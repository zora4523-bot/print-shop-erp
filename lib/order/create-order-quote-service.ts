import { OrderSettlementType } from '../../generated/prisma/enums';
import type {
  QuoteExternalOrderChargesInput,
  QuoteOrderItemsInput,
  QuoteCreateOrderPackagingGroupsInput,
} from '../auth/schemas';
import { db } from '../db';
import {
  calculateExternalOrderCharges,
  type ExternalOrderChargeQuote,
} from '../price/external-order-charges';
import { calculateCreateOrderQuote } from '../price/create-order';
import type { CreateOrderQuoteInput as PureCreateOrderQuoteInput } from '../price/create-order/types';
import {
  buildCreateOrderQuoteInputFromCatalog,
  CreateOrderQuoteFactsAdapterError,
} from './create-order-quote-facts-adapter';
import {
  type CreateOrderQuotePresentation,
  presentCreateOrderQuote,
} from './create-order-quote-presentation';
import { createExternalOrderQuoteToken } from './create-order-quote-token';
import {
  PublishedCreateOrderPriceAdapterError,
  readPublishedCreateOrderPriceSnapshot,
} from './create-order-published-rule-adapter';
import { isNewOrderPricingRoute } from './pricing-route';

export type CreateOrderQuoteItemInput = Omit<
  QuoteOrderItemsInput['items'][number],
  'manualQuoteReason'
> & {
  manualQuoteReason?: string | null;
};

export type CreateOrderQuoteInput = {
  factsKey: string;
  settlementType: typeof OrderSettlementType.EXTERNAL_SALES;
  items: CreateOrderQuoteItemInput[];
  orderItemCount: number;
  packagingGroups: QuoteCreateOrderPackagingGroupsInput['groups'];
  logistics: QuoteExternalOrderChargesInput;
};

export type CreateOrderQuoteResult = CreateOrderQuotePresentation;
export type { CreateOrderItemQuotePreview } from './create-order-quote-presentation';

export class CreateOrderQuoteError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'CreateOrderQuoteError';
  }
}

function trustedChargeQuote(
  input: PureCreateOrderQuoteInput,
  snapshot: Parameters<typeof calculateCreateOrderQuote>[1],
): ExternalOrderChargeQuote {
  const itemsByKey = new Map(input.items.map((item) => [item.itemKey, item]));
  return calculateExternalOrderCharges(
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
            (sum, [, quantity]) => sum + quantity,
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
}

function packagingFacts(
  groups: CreateOrderQuoteInput['packagingGroups'],
  itemKeys: readonly string[],
) {
  return groups.map((group) => ({
    groupKey: group.groupKey,
    mode: group.mode,
    actualBagCount: group.actualBagCount,
    items: group.itemUnitsPerBag.flatMap((unitsPerBag, index) => {
      const itemKey = itemKeys[index];
      return itemKey && unitsPerBag > 0 ? [{ itemKey, unitsPerBag }] : [];
    }),
  }));
}

function shipmentFacts(input: CreateOrderQuoteInput) {
  const itemKeys = input.items.map((_, index) => String(index + 1));
  return input.logistics.shipments.map((shipment) => ({
    shipmentKey: shipment.shipmentKey,
    province: shipment.province,
    // Browser-authored billableWeightKg is deliberately ignored. Preview has
    // no trusted fulfilment measurement and therefore uses server estimation.
    browserBillableWeightKg: shipment.billableWeightKg,
    trustedFulfilmentWeightKg: null,
    itemQuantities: Object.fromEntries(
      itemKeys.map((itemKey, index) => [
        itemKey,
        shipment.itemQuantities?.[index] ?? 0,
      ]),
    ),
  }));
}

/**
 * Quote one external-sales create command from one immutable, dual-version
 * published snapshot. IO ends before the pure calculator is called.
 */
export async function quoteExternalCreateOrder(
  input: CreateOrderQuoteInput,
  now: Date = new Date(),
): Promise<CreateOrderQuoteResult> {
  if (input.settlementType !== OrderSettlementType.EXTERNAL_SALES) {
    throw new CreateOrderQuoteError('仅支持外部销售建单报价');
  }
  if (input.orderItemCount !== input.items.length) {
    throw new CreateOrderQuoteError('工单款式数与报价款式不一致');
  }

  try {
    return await db.$transaction(async (tx) => {
      const snapshot = await readPublishedCreateOrderPriceSnapshot(tx, {
        now,
      });
      const itemKeys = input.items.map((_, index) => String(index + 1));
      const catalogItems = input.items.map((item, index) => {
        if (item.manualQuoteReason?.trim()) {
          throw new CreateOrderQuoteError(
            `款式 ${index + 1}：外部销售建单不接受配置外备注`,
          );
        }
        if (!isNewOrderPricingRoute(item.pricingRoute)) {
          throw new CreateOrderQuoteError(
            `款式 ${index + 1}：新建工单必须选择有效计价路线`,
          );
        }
        return {
          ...item,
          pricingRoute: item.pricingRoute,
          itemKey: itemKeys[index]!,
          fig: index + 1,
        };
      });
      const pureInput = await buildCreateOrderQuoteInputFromCatalog(tx, {
        items: catalogItems,
        packagingGroups: packagingFacts(input.packagingGroups, itemKeys),
        isSfCollect: input.logistics.isSfCollect,
        shipments: shipmentFacts(input),
      });
      const quote = calculateCreateOrderQuote(pureInput, snapshot);
      if (!quote.submittable) {
        throw new CreateOrderQuoteError(
          quote.errors.join('；') || '报价业务事实无效',
        );
      }
      const logistics = trustedChargeQuote(pureInput, snapshot);
      const quoteToken = createExternalOrderQuoteToken({
        items: pureInput.items,
        packagingGroups: pureInput.packagingGroups,
        logistics: {
          isSfCollect: pureInput.isSfCollect,
          shipments: pureInput.shipments,
        },
        priceVersion: quote.priceVersion,
        result: {
          items: quote.items,
          packaging: quote.packagingGroups,
          logistics: quote.order,
        },
      });
      return presentCreateOrderQuote({
        factsKey: input.factsKey,
        input: pureInput,
        quote,
        logistics,
        quoteToken,
      });
    });
  } catch (error) {
    if (error instanceof CreateOrderQuoteError) throw error;
    if (
      error instanceof CreateOrderQuoteFactsAdapterError ||
      error instanceof PublishedCreateOrderPriceAdapterError
    ) {
      throw new CreateOrderQuoteError(error.message);
    }
    throw error;
  }
}
