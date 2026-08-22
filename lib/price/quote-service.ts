import {
  type OrderSettlementType,
  Prisma,
} from '../../generated/prisma/client';
import {
  CustomerPriceBookPurpose,
  OrderSettlementType as OrderSettlementTypeValue,
} from '../../generated/prisma/enums';
import type { QuoteOrderItemsInput } from '../auth/schemas';
import { db } from '../db';
import { MAX_ORDER_ITEMS_PER_ORDER } from '../order/limits';
import { calculateQuote, type QuoteResult } from './quote';
import {
  calculateExternalSalesQuote,
  type ExternalSalesPriceBook,
  type ExternalSalesPriceRule,
} from './external-sales-quote';
import { acquirePriceRuleSnapshotReadLock } from './rule-snapshot-lock';

export type QuoteOrderContext = {
  orderItemCount?: number;
};

function resolvedOrderItemCount(
  items: QuoteOrderItemsInput['items'],
  context?: QuoteOrderContext,
): number {
  const count = context?.orderItemCount ?? items.length;
  if (
    !Number.isSafeInteger(count) ||
    count < items.length ||
    count > MAX_ORDER_ITEMS_PER_ORDER
  ) {
    throw new Error('工单款式数量非法');
  }
  return count;
}

function unavailableExternalPriceBook(): ExternalSalesPriceBook {
  return {
    id: 'missing-external-sales-price-book',
    code: 'MISSING',
    name: '未配置外部销售价目簿',
    version: 0,
    sourceName: null,
    sourceSha256: null,
  };
}

function unavailableExternalPriceRule(): ExternalSalesPriceRule {
  return {
    id: 'missing-external-sales-price-book-rule',
    code: 'MISSING_PRICE_BOOK',
    name: '当前没有生效的外部销售价目簿',
    kind: 'REFERENCE',
    calculationType: null,
    amount: null,
    minQty: null,
    maxQty: null,
    triggerCondition: null,
    exclusiveGroup: null,
    priority: 0,
    blocksAutomaticQuote: true,
    sourceSheet: null,
    sourceRange: null,
    note: '请管理员到“对客加工费 → 外部销售报价单”检查价目簿',
    productId: null,
    category: { code: 'OTHER', name: '其他' },
  };
}

async function quoteExternalSalesItems(
  items: QuoteOrderItemsInput['items'],
  settlementType: OrderSettlementType,
  now: Date,
  client: Prisma.TransactionClient,
  orderItemCount: number,
): Promise<QuoteResult[]> {
  const books = await client.customerPriceBook.findMany({
    where: {
      settlementType,
      purpose: CustomerPriceBookPurpose.PROCESSING,
      isActive: true,
      effectiveFrom: { lte: now },
      OR: [{ effectiveTo: null }, { effectiveTo: { gt: now } }],
    },
    select: {
      id: true,
      code: true,
      name: true,
      version: true,
      sourceName: true,
      sourceSha256: true,
    },
    orderBy: [{ effectiveFrom: 'desc' }, { version: 'desc' }],
    take: 2,
  });
  if (books.length > 1) {
    throw new Error('同一结算方向同时存在多个生效加工费价目簿，请管理员修正有效期');
  }

  const productIds = [
    ...new Set(items.flatMap((item) => (item.productId ? [item.productId] : []))),
  ];
  const craftIds = [...new Set(items.flatMap((item) => item.crafts))];
  const [products, crafts] = await Promise.all([
    productIds.length === 0
      ? Promise.resolve([])
      : client.product.findMany({
          where: { id: { in: productIds }, isActive: true },
          select: { id: true, code: true },
        }),
    craftIds.length === 0
      ? Promise.resolve([])
      : client.craft.findMany({
          where: { id: { in: craftIds }, isActive: true },
          select: { id: true, code: true },
        }),
  ]);
  if (products.length !== productIds.length) {
    throw new Error('报价产品字典已变化，请刷新页面后重新选择产品');
  }
  if (crafts.length !== craftIds.length) {
    throw new Error('工艺字典已变化，请刷新页面后重新选择工艺');
  }

  const productCodeById = new Map(products.map((product) => [product.id, product.code]));
  const craftCodeById = new Map(crafts.map((craft) => [craft.id, craft.code]));
  const priceBook = books[0];
  const rules = priceBook
    ? await client.customerPriceRule.findMany({
        // A disabled category is a disabled charging surface.  Keep the
        // calculator aligned with the price-book catalog so a rule can never
        // continue charging after its category disappears from the UI.
        where: {
          priceBookId: priceBook.id,
          isActive: true,
          category: { isActive: true },
        },
        select: {
          id: true,
          code: true,
          name: true,
          kind: true,
          calculationType: true,
          amount: true,
          minQty: true,
          maxQty: true,
          triggerCondition: true,
          exclusiveGroup: true,
          priority: true,
          blocksAutomaticQuote: true,
          sourceSheet: true,
          sourceRange: true,
          note: true,
          productId: true,
          category: { select: { code: true, name: true } },
        },
        orderBy: [
          { category: { sortOrder: 'asc' } },
          { priority: 'desc' },
          { code: 'asc' },
        ],
      })
    : [unavailableExternalPriceRule()];

  const normalizedBook: ExternalSalesPriceBook = priceBook
    ? {
        ...priceBook,
        code: String(priceBook.code),
      }
    : unavailableExternalPriceBook();
  const normalizedRules: ExternalSalesPriceRule[] = rules.map((rule) => ({
    ...rule,
    code: String(rule.code),
    kind: String(rule.kind) as ExternalSalesPriceRule['kind'],
    calculationType: rule.calculationType
      ? (String(rule.calculationType) as ExternalSalesPriceRule['calculationType'])
      : null,
    amount: rule.amount?.toString() ?? null,
    category: {
      code: String(rule.category.code),
      name: rule.category.name,
    },
  }));

  return items.map((item) =>
    calculateExternalSalesQuote({
      input: {
        quantity: item.quantity,
        productId: item.productId ?? null,
        productCode: item.productId
          ? String(productCodeById.get(item.productId) ?? '') || null
          : null,
        craftIds: [...item.crafts],
        craftCodes: item.crafts.map((id) => String(craftCodeById.get(id))),
        specification: item.specification ?? null,
        paperType: item.paperType ?? null,
        foilColors: [...item.foilColors],
        isDoubleSided: item.isDoubleSided,
        isDoubleColor: item.isDoubleColor,
        settlementType,
        orderItemCount,
      },
      priceBook: normalizedBook,
      rules: normalizedRules,
    }),
  );
}

async function quoteOrderItemsInTransaction(
  items: QuoteOrderItemsInput['items'],
  settlementType: OrderSettlementType,
  now: Date,
  client: Prisma.TransactionClient,
  orderItemCount: number = items.length,
): Promise<QuoteResult[]> {
  // READ COMMITTED gives each SELECT its own snapshot.  The shared advisory
  // lock makes the three cooperating rule sources one logical snapshot by
  // preventing an administrator write until all three reads finish.
  await acquirePriceRuleSnapshotReadLock(client);

  if (settlementType === OrderSettlementTypeValue.EXTERNAL_SALES) {
    return quoteExternalSalesItems(
      items,
      settlementType,
      now,
      client,
      orderItemCount,
    );
  }

  const productIds = [
    ...new Set(items.flatMap((item) => (item.productId ? [item.productId] : []))),
  ];

  const [products, priceTiers, adjustments] = await Promise.all([
    productIds.length === 0
      ? Promise.resolve([])
      : client.product.findMany({
          where: { id: { in: productIds }, isActive: true },
          select: { id: true, baseUnitPrice: true, minOrderQty: true },
        }),
    productIds.length === 0
      ? Promise.resolve([])
      : client.priceTier.findMany({
          where: {
            productId: { in: productIds },
            effectiveFrom: { lte: now },
            OR: [{ effectiveTo: null }, { effectiveTo: { gt: now } }],
          },
          select: {
            id: true,
            productId: true,
            minQty: true,
            unitPrice: true,
          },
        }),
    client.priceAdjustment.findMany({
      where: { isActive: true },
      select: {
        id: true,
        name: true,
        adjustmentType: true,
        amount: true,
        triggerCondition: true,
        isActive: true,
      },
      orderBy: [{ name: 'asc' }, { id: 'asc' }],
    }),
  ]);

  const productById = new Map(products.map((product) => [product.id, product]));
  const normalizedTiers = priceTiers.map((tier) => ({
    ...tier,
    unitPrice: tier.unitPrice.toString(),
  }));
  const normalizedAdjustments = adjustments.map((adjustment) => ({
    ...adjustment,
    amount: adjustment.amount.toString(),
  }));

  return items.map((item) => {
    const product = item.productId ? productById.get(item.productId) : undefined;
    return calculateQuote({
      quantity: item.quantity,
      productId: item.productId ?? null,
      craftIds: item.crafts,
      specification: item.specification ?? null,
      paperType: item.paperType ?? null,
      foilColors: item.foilColors,
      isDoubleSided: item.isDoubleSided,
      isDoubleColor: item.isDoubleColor,
      settlementType,
      baseUnitPrice: product?.baseUnitPrice?.toString() ?? null,
      minOrderQty: product?.minOrderQty ?? null,
      priceTiers: normalizedTiers,
      adjustments: normalizedAdjustments,
    });
  });
}

/**
 * Load one coherent set of active price rules, then quote every item against
 * that same set.  Callers creating an order pass their transaction client so
 * the stored snapshot is based on the exact rules observed by that write.
 */
export async function quoteOrderItems(
  items: QuoteOrderItemsInput['items'],
  settlementType: OrderSettlementType,
  now: Date = new Date(),
  client?: Prisma.TransactionClient,
  context?: QuoteOrderContext,
): Promise<QuoteResult[]> {
  const orderItemCount = resolvedOrderItemCount(items, context);
  if (client) {
    return quoteOrderItemsInTransaction(
      items,
      settlementType,
      now,
      client,
      orderItemCount,
    );
  }

  // Preview callers do not already own a transaction.  Keep the transaction
  // deliberately short: lock, read the rule snapshot, calculate, release.
  return db.$transaction((tx) =>
    quoteOrderItemsInTransaction(
      items,
      settlementType,
      now,
      tx,
      orderItemCount,
    ),
  );
}

/**
 * Preview one or more completed lines while preserving the full form's item
 * count for order-level rules.  This is display-only context: authoritative
 * order creation still derives the count from the complete validated payload.
 */
export async function quoteOrderItemsPreview(
  items: QuoteOrderItemsInput['items'],
  settlementType: OrderSettlementType,
  orderItemCount: number,
  now: Date = new Date(),
): Promise<QuoteResult[]> {
  resolvedOrderItemCount(items, { orderItemCount });
  return db.$transaction((tx) =>
    quoteOrderItemsInTransaction(
      items,
      settlementType,
      now,
      tx,
      orderItemCount,
    ),
  );
}
