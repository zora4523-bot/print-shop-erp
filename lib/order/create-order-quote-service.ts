import { assertBlankPriceAdmissionInTx, BlankPriceAdmissionError } from './blank-price-admission';
import { readConfirmedHistoricalBlankPrice, sameHistoricalBlankIdentity, type HistoricalBlankItem } from './historical-blank-price';
import { blankPriceIdentity } from '../price/blank-price-identity';
import Decimal from 'decimal.js';
import { OrderSettlementType } from '../../generated/prisma/enums';
import type { Prisma } from '../../generated/prisma/client';
import type {
  QuoteExternalOrderChargesInput,
  CreateOrderQuoteItemsInput,
  QuoteCreateOrderPackagingGroupsInput,
} from '../auth/schemas';
import { db } from '../db';
import { hasRetiredPaperItem, RETIRED_PAPER_MESSAGE } from '../rules/paper-availability';
import {
  calculateExternalOrderCharges,
  type ExternalOrderChargeQuote,
} from '../price/external-order-charges';
import { calculateCreateOrderQuote } from '../price/create-order';
import type {
  CreateOrderPriceSnapshot,
  CreateOrderQuoteInput as PureCreateOrderQuoteInput,
} from '../price/create-order/types';
import {
  buildCreateOrderQuoteInputFromCatalog,
  CreateOrderQuoteFactsAdapterError,
  type CreateOrderQuoteFactsAdapterInput,
} from './create-order-quote-facts-adapter';
import {
  type CreateOrderProcessingPresentation,
  type CreateOrderQuotePresentation,
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

function shipmentFacts(input: Pick<CreateOrderQuoteInput, 'items' | 'logistics'>) {
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
  /**
   * Binds the canonical catalog facts, published price-book versions and the
   * complete pure-engine result. Callers can use it as a server-verifiable
   * preview/apply handshake without trusting browser-supplied amounts.
   */
  quoteToken: string;
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
    historicalBlankItems?: readonly HistoricalBlankItem[];
  },
): Promise<CatalogCreateOrderQuoteCalculation> {
  try {
    const snapshot = await readPublishedCreateOrderPriceSnapshot(tx, {
      now: args.now,
    });
    const historical = new Map(args.facts.items.flatMap((item) => {
      const stored = args.historicalBlankItems?.find((candidate) => candidate.id === item.itemKey);
      return stored && sameHistoricalBlankIdentity(stored, item) ? [[item.itemKey, stored] as const] : [];
    }));
    await assertBlankPriceAdmissionInTx(tx, args.facts.items.filter((item) => !historical.has(item.itemKey)), args.now, { snapshot });
    const catalogInput = await buildCreateOrderQuoteInputFromCatalog(
      tx,
      args.facts,
      { historicalBlankItemKeys: new Set(historical.keys()) },
    );
    const input: PureCreateOrderQuoteInput = {
      ...catalogInput,
      items: catalogInput.items.map((item) => {
        const stored = historical.get(item.itemKey);
        if (!stored) return item;
        const identity = blankPriceIdentity(item);
        const prices = snapshot.partial.blankUnitPrices.filter((price) =>
          blankPriceIdentity(price)?.key === identity?.key);
        if (prices.length === 1 && prices[0]!.unitPrice !== null && new Decimal(prices[0]!.unitPrice!).gt(0)) return item;
        const confirmed = readConfirmedHistoricalBlankPrice(stored);
        if (!confirmed) throw new CreateOrderQuoteError(`款式 ${item.fig} 缺少可验证的材料单价，请在工单的历史材料单价中补核价`);
        return { ...item, historicalBlankPrice: confirmed };
      }),
      includeOrderCharges: args.includeOrderCharges,
    };
    const quote = calculateCreateOrderQuote(input, snapshot);
    if (!quote.submittable) {
      throw new CreateOrderQuoteError(
        quote.errors.join('；') || '报价业务事实无效',
      );
    }
    const quoteToken = createExternalOrderQuoteToken({
      items: input.items,
      packagingGroups: input.packagingGroups,
      logistics: {
        isSfCollect: input.isSfCollect,
        shipments: input.shipments,
      },
      priceVersion: quote.priceVersion,
      result: {
        items: quote.items,
        packaging: quote.packagingGroups,
        logistics: quote.order,
      },
    });
    return {
      input,
      snapshot,
      quote,
      processing: presentCreateOrderProcessingQuote({ input, quote }),
      quoteToken,
    };
  } catch (error) {
    if (error instanceof CreateOrderQuoteError) throw error;
    if (
      error instanceof BlankPriceAdmissionError ||
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
  if (hasRetiredPaperItem(input.items)) {
    throw new CreateOrderQuoteError(RETIRED_PAPER_MESSAGE);
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
      return presentCreateOrderQuote({
        factsKey: input.factsKey,
        input: pureInput,
        quote,
        logistics,
        quoteToken: calculated.quoteToken,
      });
    });
  } catch (error) {
    if (error instanceof CreateOrderQuoteError) throw error;
    if (
      error instanceof BlankPriceAdmissionError ||
      error instanceof CreateOrderQuoteFactsAdapterError ||
      error instanceof PublishedCreateOrderPriceAdapterError
    ) {
      throw new CreateOrderQuoteError(error.message);
    }
    throw error;
  }
}

