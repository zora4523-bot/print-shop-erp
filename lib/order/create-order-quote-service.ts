import { OrderSettlementType } from '../../generated/prisma/enums';
import type { Prisma } from '../../generated/prisma/client';
import type {
  QuoteExternalOrderChargesInput,
  CreateOrderQuoteItemsInput,
  QuoteCreateOrderPackagingGroupsInput,
} from '../auth/schemas';
import { db } from '../db';
import {
  calculateExternalOrderCharges,
  type ExternalOrderChargeQuote,
} from '../price/external-order-charges';
import { calculateCreateOrderQuote } from '../price/create-order';
import type {
  CreateOrderPriceSnapshot,
  CreateOrderPriceVersionBundle,
  CreateOrderQuoteInput as PureCreateOrderQuoteInput,
} from '../price/create-order/types';
import {
  buildCreateOrderQuoteInputFromCatalog,
  CreateOrderQuoteFactsAdapterError,
  type CreateOrderQuoteFactsAdapterInput,
} from './create-order-quote-facts-adapter';
import {
  type CreateOrderProcessingPresentation,
  type CreateOrderPlateFeePreview,
  type CreateOrderQuotePresentation,
  presentCreateOrderPlateFee,
  presentCreateOrderQuote,
  presentCreateOrderProcessingQuote,
} from './create-order-quote-presentation';
import { createExternalOrderQuoteToken } from './create-order-quote-token';
import { buildCreateOrderExternalChargeInput } from './create-order-charge-input';
import {
  PublishedCreateOrderPriceAdapterError,
  readPublishedCreateOrderPriceSnapshot,
} from './create-order-published-rule-adapter';
import { isNewOrderPricingRoute } from './pricing-route';

export type CreateOrderQuoteItemInput = Omit<
  CreateOrderQuoteItemsInput['items'][number],
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

export type InternalCreateOrderQuoteInput = {
  factsKey: string;
  settlementType:
    | typeof OrderSettlementType.INTERNAL_SALES
    | typeof OrderSettlementType.FACTORY_DIRECT;
  items: CreateOrderQuoteItemInput[];
  orderItemCount: number;
  packagingGroups: QuoteCreateOrderPackagingGroupsInput['groups'];
};

export type InternalCreateOrderQuoteResult =
  CreateOrderProcessingPresentation & {
    factsKey: string;
    priceVersion: CreateOrderPriceVersionBundle;
    knownTotal: string;
    total: string | null;
    hasManualPricing: boolean;
    totalSemantics: 'COMPLETE' | 'EXCLUDES_MANUAL_ITEMS';
    plateFee: CreateOrderPlateFeePreview | null;
  };

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
  return calculateExternalOrderCharges(
    buildCreateOrderExternalChargeInput(input),
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

export type CatalogCreateOrderQuoteCalculation = {
  input: PureCreateOrderQuoteInput;
  snapshot: CreateOrderPriceSnapshot;
  quote: ReturnType<typeof calculateCreateOrderQuote>;
  processing: CreateOrderProcessingPresentation;
};

/**
 * Shared transactional IO boundary. It reads one published version pair,
 * resolves catalog authority, then hands immutable data to the pure engine.
 */
export async function calculateCreateOrderQuoteFromCatalogInTx(
  tx: Prisma.TransactionClient,
  args: {
    now: Date;
    facts: CreateOrderQuoteFactsAdapterInput;
    includeOrderCharges: boolean;
  },
): Promise<CatalogCreateOrderQuoteCalculation> {
  try {
    const snapshot = await readPublishedCreateOrderPriceSnapshot(tx, {
      now: args.now,
    });
    const catalogInput = await buildCreateOrderQuoteInputFromCatalog(
      tx,
      args.facts,
    );
    const input: PureCreateOrderQuoteInput = {
      ...catalogInput,
      includeOrderCharges: args.includeOrderCharges,
    };
    const quote = calculateCreateOrderQuote(input, snapshot);
    if (!quote.submittable) {
      throw new CreateOrderQuoteError(
        quote.errors.join('；') || '报价业务事实无效',
      );
    }
    return {
      input,
      snapshot,
      quote,
      processing: presentCreateOrderProcessingQuote({ input, quote }),
    };
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
      const calculated = await calculateCreateOrderQuoteFromCatalogInTx(tx, {
        now,
        facts: {
          items: catalogItems,
          packagingGroups: packagingFacts(input.packagingGroups, itemKeys),
          isSfCollect: input.logistics.isSfCollect,
          shipments: shipmentFacts(input),
        },
        includeOrderCharges: true,
      });
      const pureInput = calculated.input;
      const quote = calculated.quote;
      const logistics = trustedChargeQuote(pureInput, calculated.snapshot);
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

/** Internal create preview: processing + BAGGING only, never external charges. */
export async function quoteInternalCreateOrder(
  input: InternalCreateOrderQuoteInput,
  now: Date = new Date(),
): Promise<InternalCreateOrderQuoteResult> {
  if (
    input.settlementType !== OrderSettlementType.INTERNAL_SALES &&
    input.settlementType !== OrderSettlementType.FACTORY_DIRECT
  ) {
    throw new CreateOrderQuoteError('仅支持内部收费建单报价');
  }
  if (input.orderItemCount !== input.items.length) {
    throw new CreateOrderQuoteError('工单款式数与报价款式不一致');
  }

  try {
    return await db.$transaction(async (tx) => {
      const itemKeys = input.items.map((_, index) => String(index + 1));
      const calculated = await calculateCreateOrderQuoteFromCatalogInTx(tx, {
        now,
        facts: {
          items: input.items.map((item, index) => {
            if (!isNewOrderPricingRoute(item.pricingRoute)) {
              throw new CreateOrderQuoteError(
                `款式 ${index + 1}：新建工单必须选择有效计价路线`,
              );
            }
            return {
              ...item,
              pricingRoute: item.pricingRoute,
              manualQuoteReason: item.manualQuoteReason,
              itemKey: itemKeys[index]!,
              fig: index + 1,
            };
          }),
          packagingGroups: packagingFacts(input.packagingGroups, itemKeys),
          isSfCollect: false,
          shipments: [
            {
              shipmentKey: 'internal-create',
              province: null,
              itemQuantities: Object.fromEntries(
                input.items.map((item, index) => [
                  itemKeys[index]!,
                  item.quantity,
                ]),
              ),
            },
          ],
        },
        includeOrderCharges: false,
      });
      const hasManualPricing = calculated.quote.status !== 'QUOTED';
      return {
        factsKey: input.factsKey,
        ...calculated.processing,
        priceVersion: calculated.quote.priceVersion,
        knownTotal: calculated.quote.knownTotal,
        total: calculated.quote.total,
        hasManualPricing,
        totalSemantics: hasManualPricing
          ? 'EXCLUDES_MANUAL_ITEMS'
          : 'COMPLETE',
        plateFee: presentCreateOrderPlateFee(calculated.quote),
      };
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
