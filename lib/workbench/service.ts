import { db } from '@/lib/db';
import { hasRetiredPaperItem, RETIRED_PAPER_MESSAGE } from '@/lib/rules/paper-availability';
import type { WorkbenchItemQuoteInput } from '@/lib/workbench/item-quote';
import { calculateCreateOrderQuoteFromCatalogInTx } from '@/lib/order/create-order-quote-service';
import { presentCreateOrderPlateFee } from '@/lib/order/create-order-quote-presentation';
import {
  suggestWorkbenchAmount,
  workbenchPricingReasons,
  type WorkbenchQuoteResult,
} from '@/lib/workbench/quote';

export async function calculateWorkbenchItem(
  item: WorkbenchItemQuoteInput['item'],
  markup: number,
): Promise<WorkbenchQuoteResult> {
  if (hasRetiredPaperItem([item])) {
    return { status: 'error', message: RETIRED_PAPER_MESSAGE };
  }
  const calculated = await db.$transaction((tx) =>
    calculateCreateOrderQuoteFromCatalogInTx(tx, {
      now: new Date(),
      includeOrderCharges: false,
      facts: {
        items: [
          { ...item, pricingRoute: item.pricingRoute, itemKey: '1', fig: 1 },
        ],
        packagingGroups: [],
        isSfCollect: false,
        shipments: [
          {
            shipmentKey: 'workbench',
            province: null,
            itemQuantities: { '1': item.quantity },
          },
        ],
      },
    }),
  );
  const preview = calculated.processing.items[0]!;
  const baseAmount = preview.complete ? preview.suggestedSubtotal : null;
  return {
    status: 'success',
    quote: {
      baseAmount,
      ...suggestWorkbenchAmount(baseAmount, markup),
      lines: preview.components.map(
        ({ name, rate, units, amount, adjustmentType, ruleCode }) => {
          // Machine fees already include the quantity and every front/back
          // pass. The presenter has no standalone rate for this combination;
          // show its whole-item amount once instead of multiplying it again.
          const wholeItemAmount =
            ruleCode === 'PARTIAL_MACHINE' ||
            adjustmentType === 'PER_ORDER' ||
            adjustmentType === 'FIXED_AMOUNT';
          return {
            name,
            rate: wholeItemAmount ? amount : rate,
            units: wholeItemAmount ? '1' : units,
            amount,
          };
        },
      ),
      needsPricing: !preview.complete,
      pricingReasons: preview.complete
        ? []
        : workbenchPricingReasons(calculated.quote.items[0]!.manualReasons),
      plateFeePending: presentCreateOrderPlateFee(calculated.quote) !== null,
      processingVersion: calculated.quote.priceVersion.processing.version,
    },
  };
}
