import Decimal from 'decimal.js';
import type { Prisma } from '@/generated/prisma/client';
import { OrderItemPricingRoute } from '@/generated/prisma/enums';
import { blankPriceIdentity } from '@/lib/price/blank-price-identity';
import { BLANK_SPECIFICATIONS } from '@/lib/price/blank-paper';
import type { CreateOrderPriceSnapshot } from '@/lib/price/create-order/types';
import { isRetiredPaper, RETIRED_PAPER_MESSAGE } from '@/lib/rules/paper-availability';
import { catalogPaperPricingFacts } from './catalog-paper-identity';
import { parseCatalogDimensions } from './catalog-pricing-facts';
import { readPublishedCreateOrderPriceSnapshot } from './create-order-published-rule-adapter';

export type BlankAdmissionItem = {
  pricingRoute: string;
  paperType?: string | null;
  paperWeightGsm?: number | null;
  specification?: string | null;
  actualWidthMm?: string | number | { toString(): string } | null;
  actualHeightMm?: string | number | { toString(): string } | null;
  manualQuoteReason?: string | null;
};

export class BlankPriceAdmissionError extends Error {
  constructor(message: string) { super(message); this.name = 'BlankPriceAdmissionError'; }
}

/** New business only. Historical recalculation must not call this for unchanged items. */
export function assertBlankPriceAdmission(
  items: readonly BlankAdmissionItem[],
  snapshot: CreateOrderPriceSnapshot,
) {
  for (const item of items) {
    if (item.pricingRoute !== OrderItemPricingRoute.STOCK_BLANK) continue;
    const identity = blankPriceIdentity({ paperType: item.paperType ?? '',
      paperWeightGsm: item.paperWeightGsm, specification: item.specification ?? '' });
    if (!identity) throw new BlankPriceAdmissionError('请选择已启用的空白封纸张、克重和标准规格');
    if (isRetiredPaper({ weight: identity.paperWeightGsm })) throw new BlankPriceAdmissionError(RETIRED_PAPER_MESSAGE);
    const matches = snapshot.partial.blankUnitPrices.filter((price) =>
      blankPriceIdentity(price)?.key === identity.key);
    const price = matches.length === 1 ? matches[0]!.unitPrice : null;
    if (price === null || !new Decimal(price).gt(0)) {
      throw new BlankPriceAdmissionError(`${identity.paperLabel} ${identity.specification}未启用，请先发布大于 0 的空白封单价`);
    }
    if (item.manualQuoteReason?.trim()) throw new BlankPriceAdmissionError('空白封请使用已启用的标准规格，不能通过配置外说明建单');
    const specification = BLANK_SPECIFICATIONS.find((spec) => spec.key === identity.specificationKey)!;
    const dimensions = parseCatalogDimensions(specification.specification)!;
    const width = item.actualWidthMm == null ? null : new Decimal(item.actualWidthMm.toString());
    const height = item.actualHeightMm == null ? null : new Decimal(item.actualHeightMm.toString());
    if ((width === null) !== (height === null) ||
        (width !== null && height !== null && (!width.eq(dimensions.widthMm) || !height.eq(dimensions.heightMm)))) {
      throw new BlankPriceAdmissionError('空白封请使用所选规格的标准尺寸');
    }
  }
}

export async function assertBlankPriceAdmissionInTx(
  tx: Prisma.TransactionClient,
  items: readonly BlankAdmissionItem[],
  now: Date,
  options: { snapshot?: CreateOrderPriceSnapshot } = {},
): Promise<void> {
  const blanks = items.filter((item) => item.pricingRoute === OrderItemPricingRoute.STOCK_BLANK);
  if (!blanks.length) return;
  const snapshot = options.snapshot ?? await readPublishedCreateOrderPriceSnapshot(tx, { now });
  assertBlankPriceAdmission(blanks, snapshot);
  const papers = await tx.material.findMany({ where: { category: 'PAPER' },
    select: { id: true, name: true, specification: true, isActive: true, outOfStock: true } });
  for (const item of blanks) {
    const identity = blankPriceIdentity({ paperType: item.paperType ?? '',
      paperWeightGsm: item.paperWeightGsm, specification: item.specification ?? '' })!;
    const matches = papers.filter((paper) => catalogPaperPricingFacts(paper).some((fact) =>
      fact.paperType === identity.paperType && fact.paperWeightGsm === identity.paperWeightGsm));
    if (matches.length !== 1 || !matches[0]!.isActive || matches[0]!.outOfStock) {
      throw new BlankPriceAdmissionError(`${identity.paperLabel}资料不唯一、已停用或缺货，请检查纸张资料`);
    }
  }
}
