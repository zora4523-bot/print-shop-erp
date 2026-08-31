import {
  type OrderSettlementType,
  Prisma,
} from '../../generated/prisma/client';
import {
  CustomerPriceBookPurpose,
  MaterialCategory,
  OrderSettlementType as OrderSettlementTypeValue,
} from '../../generated/prisma/enums';
import type { QuoteOrderItemsInput } from '../auth/schemas';
import { db } from '../db';
import { MAX_ORDER_ITEMS_PER_ORDER } from '../order/limits';
import {
  ORDER_PRICING_ROUTE_LABELS,
  canonicalizePricingCraftCodes,
  deriveLegacyOrderItemFoilFacts,
  productCategoryMatchesPricingRoute,
  requiredPricingCraftGroups,
} from '../order/pricing-route';
import {
  normalizeCatalogPricingText,
  parseCatalogDimensions,
  parseCatalogPaperWeight,
} from '../order/catalog-pricing-facts';
import { calculateQuote, type QuoteResult } from './quote';
import {
  calculateExternalSalesQuote,
  type ExternalSalesPriceBook,
  type ExternalSalesPriceRule,
} from './external-sales-quote';
import { acquirePriceRuleSnapshotReadLock } from './rule-snapshot-lock';

export type QuoteOrderContext = {
  orderItemCount?: number;
  /**
   * Admin-authorized historical repricing may need the stable codes from
   * catalog rows that were deactivated after the order was created. Older
   * catalog rows can also predate the structured specification/paper columns;
   * in that case the already-persisted order facts are accepted only when the
   * catalog has no contradictory fact. New order and ordinary preview callers
   * must leave this disabled.
   */
  allowInactiveCatalogFacts?: true;
};

export type QuoteOrderItemInput = Omit<
  QuoteOrderItemsInput['items'][number],
  'frontFoilColors' | 'backFoilColors'
> &
  Partial<
    Pick<
      QuoteOrderItemsInput['items'][number],
      'frontFoilColors' | 'backFoilColors'
    >
  >;

export class QuoteCatalogInvariantError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'QuoteCatalogInvariantError';
  }
}

function resolvedOrderItemCount(
  items: QuoteOrderItemInput[],
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
    currency: 'CNY',
    effectiveFrom: null,
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
  items: QuoteOrderItemInput[],
  settlementType: OrderSettlementType,
  now: Date,
  client: Prisma.TransactionClient,
  orderItemCount: number,
  allowInactiveCatalogFacts: boolean,
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
      currency: true,
      effectiveFrom: true,
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
  const paperTypes = [
    ...new Set(
      items.flatMap((item) => (item.paperType ? [item.paperType] : [])),
    ),
  ];
  const [products, crafts, paperMaterials] = await Promise.all([
    productIds.length === 0
      ? Promise.resolve([])
      : client.product.findMany({
          where: {
            id: { in: productIds },
            ...(allowInactiveCatalogFacts ? {} : { isActive: true }),
          },
          select: {
            id: true,
            code: true,
            category: true,
            specification: true,
            paperType: true,
          },
        }),
    craftIds.length === 0
      ? Promise.resolve([])
      : client.craft.findMany({
          where: {
            id: { in: craftIds },
            ...(allowInactiveCatalogFacts ? {} : { isActive: true }),
          },
          select: { id: true, code: true },
        }),
    paperTypes.length === 0
      ? Promise.resolve([])
      : client.material.findMany({
          where: {
            category: MaterialCategory.PAPER,
            name: { in: paperTypes },
            ...(allowInactiveCatalogFacts ? {} : { isActive: true }),
          },
          select: { name: true },
        }),
  ]);
  if (products.length !== productIds.length) {
    throw new QuoteCatalogInvariantError(
      '报价产品字典已变化，请刷新页面后重新选择产品',
    );
  }
  if (crafts.length !== craftIds.length) {
    throw new QuoteCatalogInvariantError(
      '工艺字典已变化，请刷新页面后重新选择工艺',
    );
  }

  const productById = new Map(products.map((product) => [product.id, product]));
  const craftCodeById = new Map(crafts.map((craft) => [craft.id, craft.code]));
  for (const item of items) {
    if (
      item.productId &&
      !(allowInactiveCatalogFacts && item.pricingRoute === 'MANUAL_QUOTE')
    ) {
      const product = productById.get(item.productId);
      if (
        product &&
        !productCategoryMatchesPricingRoute(
          item.pricingRoute,
          String(product.category),
          { allowLegacyStockFoilAdd: allowInactiveCatalogFacts },
        )
      ) {
        throw new QuoteCatalogInvariantError(
          `报价产品“${product.code}”的分类与计价路线“${ORDER_PRICING_ROUTE_LABELS[item.pricingRoute]}”不一致，请重新选择产品`,
        );
      }
    }

    const rawCraftCodes = item.crafts.map((id) =>
      String(craftCodeById.get(id)),
    );
    const craftCodes = allowInactiveCatalogFacts
      ? canonicalizePricingCraftCodes(rawCraftCodes)
      : rawCraftCodes;
    const requiredGroups = requiredPricingCraftGroups({
      route: item.pricingRoute,
      foilColors: item.foilColors,
      frontFoilColors: item.frontFoilColors,
      backFoilColors: item.backFoilColors,
      isDoubleSided: item.isDoubleSided,
      foilTechnique: item.foilTechnique,
    });
    for (const group of requiredGroups) {
      const acceptedCodes = allowInactiveCatalogFacts
        ? canonicalizePricingCraftCodes(group.anyOfCodes)
        : group.anyOfCodes;
      if (!acceptedCodes.some((code) => craftCodes.includes(code))) {
        throw new QuoteCatalogInvariantError(
          `计价路线“${ORDER_PRICING_ROUTE_LABELS[item.pricingRoute]}”必须包含“${group.label}”生产工艺`,
        );
      }
    }
  }
  const activePaperNames = new Set(
    paperMaterials.map((material) => material.name),
  );
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
          NOT: {
            triggerCondition: {
              path: ['target'],
              equals: 'PACKAGING_GROUP',
            },
          },
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

  return items.map((item) => {
    const product = item.productId
      ? productById.get(item.productId)
      : undefined;
    const foilFacts = deriveLegacyOrderItemFoilFacts(item);
    const paperCatalogMatched = Boolean(
      item.paperType && activePaperNames.has(item.paperType),
    );
    const catalogDimensions = parseCatalogDimensions(product?.specification);
    const catalogPaperWeight = parseCatalogPaperWeight(item.paperType);
    const catalogSpecificationMatched = product?.specification
      ? Boolean(
          item.specification &&
            normalizeCatalogPricingText(product.specification) ===
              normalizeCatalogPricingText(item.specification),
        )
      : Boolean(
          allowInactiveCatalogFacts && product && item.specification,
        );
    const catalogDimensionsMatched = catalogDimensions
      ? Boolean(
          item.actualWidthMm !== null &&
            item.actualHeightMm !== null &&
            item.actualWidthMm === catalogDimensions.widthMm &&
            item.actualHeightMm === catalogDimensions.heightMm,
        )
      : Boolean(
          allowInactiveCatalogFacts &&
            catalogSpecificationMatched &&
            item.actualWidthMm !== null &&
            item.actualHeightMm !== null,
        );
    const productPaperMatchesSelection = product?.paperType
      ? Boolean(
          item.paperType &&
            normalizeCatalogPricingText(product.paperType) ===
              normalizeCatalogPricingText(item.paperType),
        )
      : true;
    const catalogPaperWeightMatched =
      productPaperMatchesSelection &&
      (catalogPaperWeight !== null
        ? Boolean(
            item.paperWeightGsm !== null &&
              item.paperWeightGsm === catalogPaperWeight,
          )
        : Boolean(
            allowInactiveCatalogFacts &&
              paperCatalogMatched &&
              item.paperWeightGsm !== null,
          ));

    return calculateExternalSalesQuote({
      input: {
        quantity: item.quantity,
        productId: item.productId ?? null,
        productCode: item.productId
          ? String(productById.get(item.productId)?.code ?? '') || null
          : null,
        craftIds: [...item.crafts],
        craftCodes: item.crafts.map((id) => String(craftCodeById.get(id))),
        specification: item.specification ?? null,
        paperType: item.paperType ?? null,
        paperCatalogMatched,
        pricingRoute: item.pricingRoute,
        productStructure: item.productStructure,
        artworkVersion: item.artworkVersion ?? null,
        plateGroupId: item.plateGroupId ?? null,
        pricingGroup: item.pricingGroup ?? null,
        actualWidthMm: item.actualWidthMm ?? null,
        actualHeightMm: item.actualHeightMm ?? null,
        paperWeightGsm: item.paperWeightGsm ?? null,
        catalogSpecification: product?.specification ?? null,
        catalogPaperType: product?.paperType ?? null,
        catalogSpecificationMatched,
        catalogDimensionsMatched,
        catalogPaperWeightMatched,
        frontFoilColors: foilFacts.frontFoilColors,
        backFoilColors: foilFacts.backFoilColors,
        foilColors: foilFacts.foilColors,
        foilTechnique: item.foilTechnique,
        hasLocalFoil: item.hasLocalFoil,
        lamination: item.lamination,
        printColors: [...item.printColors],
        // Explicit side arrays are the authoritative facts for new orders.
        // Derive the retired booleans here as well as on the create path so a
        // stale or forged legacy field cannot bypass a versioned matcher in
        // the customer-facing preview.
        isDoubleSided: foilFacts.isDoubleSided,
        isDoubleColor: foilFacts.isDoubleColor,
        settlementType,
        orderItemCount,
      },
      priceBook: normalizedBook,
      rules: normalizedRules,
      quotedAt: now,
    });
  });
}

async function quoteOrderItemsInTransaction(
  items: QuoteOrderItemInput[],
  settlementType: OrderSettlementType,
  now: Date,
  client: Prisma.TransactionClient,
  orderItemCount: number = items.length,
  allowInactiveCatalogFacts: boolean = false,
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
      allowInactiveCatalogFacts,
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
      lamination: item.lamination,
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
  items: QuoteOrderItemInput[],
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
      context?.allowInactiveCatalogFacts === true,
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
      context?.allowInactiveCatalogFacts === true,
    ),
  );
}

/**
 * Preview one or more completed lines while preserving the full form's item
 * count for order-level rules.  This is display-only context: authoritative
 * order creation still derives the count from the complete validated payload.
 */
export async function quoteOrderItemsPreview(
  items: QuoteOrderItemInput[],
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
