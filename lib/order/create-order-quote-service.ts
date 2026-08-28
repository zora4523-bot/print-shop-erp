import { OrderSettlementType } from '../../generated/prisma/enums';
import type {
  QuoteExternalOrderChargesInput,
  QuoteOrderItemsInput,
  QuoteOrderPackagingGroupsInput,
} from '../auth/schemas';
import { db } from '../db';
import { deriveExternalOrderChargeShipments } from '../price/external-order-charge-facts';
import type { ExternalOrderChargeQuote } from '../price/external-order-charges';
import {
  quoteExternalOrderChargesInTransaction,
} from '../price/order-charge-service';
import {
  quoteOrderPackagingGroups,
  type OrderPackagingQuoteResult,
} from '../price/order-packaging-quote';
import { quoteOrderItems } from '../price/quote-service';
import type { QuoteResult } from '../price/quote';
import {
  readExternalCreateOrderPriceSnapshot,
  type ExternalCreateOrderPriceSnapshot,
} from './create-order-price-snapshot';
import { createExternalOrderQuoteToken } from './create-order-quote-token';
import { summarizeExternalCreateOrderQuote } from './create-order-quote-summary';

export type CreateOrderQuoteInput = {
  factsKey: string;
  settlementType: typeof OrderSettlementType.EXTERNAL_SALES;
  items: QuoteOrderItemsInput['items'];
  orderItemCount: number;
  packagingGroups: QuoteOrderPackagingGroupsInput['groups'];
  logistics: QuoteExternalOrderChargesInput;
};

export type CreateOrderQuoteTotalSemantics =
  | 'COMPLETE'
  | 'EXCLUDES_MANUAL_ITEMS';

export type CreateOrderPendingPlateFee = {
  status: 'PENDING';
  amount: null;
  displayAmount: '待定';
  label: '制版费';
};

export type CreateOrderQuoteResult = {
  factsKey: string;
  items: QuoteResult[];
  packaging: OrderPackagingQuoteResult;
  logistics: ExternalOrderChargeQuote;
  priceVersion: ExternalCreateOrderPriceSnapshot;
  knownTotal: string;
  total: string | null;
  hasManualPricing: boolean;
  totalSemantics: CreateOrderQuoteTotalSemantics;
  plateFee: CreateOrderPendingPlateFee;
  quoteToken: string;
};

export class CreateOrderQuoteError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'CreateOrderQuoteError';
  }
}

const PENDING_PLATE_FEE: CreateOrderPendingPlateFee = {
  status: 'PENDING',
  amount: null,
  displayAmount: '待定',
  label: '制版费',
};

function assertPriceVersions(
  priceVersion: ExternalCreateOrderPriceSnapshot,
  items: readonly QuoteResult[],
  packaging: OrderPackagingQuoteResult,
  logisticsBook: { id: string; version: number; sourceSha256: string | null },
): void {
  if (
    items.some(
      (item) =>
        item.snapshot.priceBook?.id !== priceVersion.processing.id ||
        item.snapshot.priceBook.version !== priceVersion.processing.version ||
        item.snapshot.priceBook.sourceSha256 !==
          priceVersion.processing.sourceSha256,
    )
  ) {
    throw new CreateOrderQuoteError(
      '款式加工费未使用当前唯一生效的价目版本',
    );
  }
  if (
    packaging.priceBook?.id !== priceVersion.processing.id ||
    packaging.priceBook.version !== priceVersion.processing.version ||
    packaging.priceBook.sourceSha256 !== priceVersion.processing.sourceSha256
  ) {
    throw new CreateOrderQuoteError(
      '入袋费与款式加工费未使用同一价目版本',
    );
  }
  if (
    logisticsBook.id !== priceVersion.logistics.id ||
    logisticsBook.version !== priceVersion.logistics.version ||
    logisticsBook.sourceSha256 !== priceVersion.logistics.sourceSha256
  ) {
    throw new CreateOrderQuoteError(
      '纸箱与快递费未使用当前唯一生效的物流价目版本',
    );
  }
}

/**
 * Quotes one external-sales order from one database transaction and one
 * processing/logistics snapshot. Browser-supplied billable weights are never
 * trusted: the logistics quote is rebuilt from validated item allocations.
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

  return db.$transaction(async (tx) => {
    const priceVersion = await readExternalCreateOrderPriceSnapshot(tx, {
      now,
    });
    const items = await quoteOrderItems(
      input.items,
      OrderSettlementType.EXTERNAL_SALES,
      now,
      tx,
      { orderItemCount: input.orderItemCount },
    );
    const packaging = await quoteOrderPackagingGroups(
      input.packagingGroups,
      OrderSettlementType.EXTERNAL_SALES,
      now,
      tx,
      { snapshotLockHeld: true },
    );

    const shipments = deriveExternalOrderChargeShipments({
      isSfCollect: input.logistics.isSfCollect,
      items: input.items.map((item, index) => ({
        itemKey: String(index + 1),
        quantity: item.quantity,
        paperWeightGsm: item.paperWeightGsm,
        paperType: item.paperType,
        productStructure: item.productStructure,
      })),
      shipments: input.logistics.shipments.map((shipment) => ({
        shipmentKey: shipment.shipmentKey,
        province: shipment.province,
        // The action schema remains backward compatible with old browsers,
        // but a SALES preview must never trust their chosen charge weight.
        billableWeightKg: null,
        itemQuantities: shipment.itemQuantities ?? [],
      })),
    });
    const logisticsResult = await quoteExternalOrderChargesInTransaction(
      tx,
      { isSfCollect: input.logistics.isSfCollect, shipments },
      now,
      { snapshotLockHeld: true },
    );

    assertPriceVersions(
      priceVersion,
      items,
      packaging,
      logisticsResult.priceBook,
    );

    const summary = summarizeExternalCreateOrderQuote({
      items,
      packaging,
      logistics: logisticsResult.quote,
    });
    const resultWithoutToken = {
      factsKey: input.factsKey,
      items,
      packaging,
      logistics: logisticsResult.quote,
      priceVersion,
      ...summary,
      plateFee: PENDING_PLATE_FEE,
    };

    return {
      ...resultWithoutToken,
      quoteToken: createExternalOrderQuoteToken({
        items: input.items,
        packagingGroups: input.packagingGroups,
        logistics: {
          isSfCollect: input.logistics.isSfCollect,
          shipments,
        },
        priceVersion,
        result: { items, packaging, logistics: logisticsResult.quote },
      }),
    };
  });
}
