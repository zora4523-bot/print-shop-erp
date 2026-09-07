import {
  OrderItemPricingRoute,
  OrderProductStructure,
} from '@/generated/prisma/enums';
import {
  catalogPricingFactChoices,
  inferCatalogProductStructure,
  normalizeCatalogPricingText,
  parseCatalogDimensions,
} from './catalog-pricing-facts';
import { productCategoryMatchesPricingRoute } from './pricing-route';
import {
  canonicalizeCreateOrderPaperFact,
  canonicalizeCreateOrderSpecification,
} from '@/lib/price/create-order/canonical-facts';

export type OrderChangeCatalogProduct = {
  id: string;
  category: string;
  specification: string | null;
  paperType: string | null;
  weight: number | null;
  isActive: boolean;
  /**
   * Server-side catalog reads include the linked paper id and its current
   * availability facts. Browser option projections intentionally omit both;
   * approval never trusts that projection and re-resolves inside its
   * transaction.
   */
  paperMaterialId?: string | null;
  linkedPaper?: {
    isActive: boolean;
    outOfStock: boolean;
  } | null;
};

export type OrderChangeCatalogSourceItem = {
  pricingRoute: OrderItemPricingRoute;
  paperType: string | null;
  paperWeightGsm: number | null;
};

export type OrderChangeCatalogIdentity = {
  productId: string;
  specification: string;
  canonicalSpecification: string;
  productStructure: OrderProductStructure;
  actualWidthMm: number | null;
  actualHeightMm: number | null;
  pricingGroup: 'MID' | 'LARGE';
};

export type OrderChangeSpecificationOption =
  OrderChangeCatalogIdentity & {
    selectionKey: string;
  };

export class OrderChangeCatalogIdentityError extends Error {
  constructor(
    readonly code:
      | 'TARGET_PRODUCT_NOT_FOUND'
      | 'TARGET_PRODUCT_NOT_ACTIVE'
      | 'TARGET_PRODUCT_DUPLICATED'
      | 'PRICING_ROUTE_MISMATCH'
      | 'SOURCE_PAPER_INVALID'
      | 'TARGET_PAPER_MISMATCH'
      | 'TARGET_PAPER_NOT_AVAILABLE'
      | 'SPECIFICATION_INVALID'
      | 'SPECIFICATION_NOT_IN_PRODUCT'
      | 'SPECIFICATION_AMBIGUOUS'
      | 'SPECIFICATION_NOT_PRICEABLE',
    message: string,
  ) {
    super(message);
    this.name = 'OrderChangeCatalogIdentityError';
  }
}

function pricingGroupForSpecification(
  specification: string,
): OrderChangeCatalogIdentity['pricingGroup'] | null {
  if (specification === '大号封' || specification === '西封大号') {
    return 'LARGE';
  }
  if (
    specification === '迷你封' ||
    specification === '方形封' ||
    specification === '中号封' ||
    specification === '西封中号' ||
    specification === '万元封'
  ) {
    return 'MID';
  }
  return null;
}

function samePaperIdentity(
  source: ReturnType<typeof canonicalizeCreateOrderPaperFact>,
  target: ReturnType<typeof canonicalizeCreateOrderPaperFact>,
): boolean {
  return Boolean(
    source &&
      target &&
      source.paperWeightGsm === target.paperWeightGsm &&
      normalizeCatalogPricingText(source.paperType) ===
        normalizeCatalogPricingText(target.paperType),
  );
}

function productMatchesSourcePaper(
  product: OrderChangeCatalogProduct,
  sourceItem: OrderChangeCatalogSourceItem,
  sourcePaper: NonNullable<
    ReturnType<typeof canonicalizeCreateOrderPaperFact>
  >,
): boolean {
  if (
    sourceItem.pricingRoute ===
      OrderItemPricingRoute.CUSTOM_SINGLE_FLAT_FOIL &&
    !product.paperType?.trim()
  ) {
    return true;
  }
  const targetPaper = product.paperType?.trim()
    ? canonicalizeCreateOrderPaperFact(product.paperType, product.weight)
    : null;
  return samePaperIdentity(sourcePaper, targetPaper);
}

function resolveTargetProduct(
  products: readonly OrderChangeCatalogProduct[],
  targetProductId: string,
): OrderChangeCatalogProduct {
  const matches = products.filter((product) => product.id === targetProductId);
  if (matches.length === 0) {
    throw new OrderChangeCatalogIdentityError(
      'TARGET_PRODUCT_NOT_FOUND',
      '目标报价产品不存在，请刷新后重新选择规格',
    );
  }
  if (matches.length !== 1) {
    throw new OrderChangeCatalogIdentityError(
      'TARGET_PRODUCT_DUPLICATED',
      '目标报价产品标识不唯一，不能安全修改规格',
    );
  }
  const product = matches[0]!;
  if (!product.isActive) {
    throw new OrderChangeCatalogIdentityError(
      'TARGET_PRODUCT_NOT_ACTIVE',
      '目标报价产品已停用，请刷新后重新选择规格',
    );
  }
  if (product.paperMaterialId) {
    if (!product.linkedPaper) {
      throw new OrderChangeCatalogIdentityError(
        'TARGET_PAPER_NOT_AVAILABLE',
        '目标报价产品关联的纸张不存在，请刷新后重新选择规格',
      );
    }
    if (!product.linkedPaper.isActive || product.linkedPaper.outOfStock) {
      throw new OrderChangeCatalogIdentityError(
        'TARGET_PAPER_NOT_AVAILABLE',
        '目标报价产品关联的纸张已停用或缺货，请刷新后重新选择规格',
      );
    }
  }
  return product;
}

function hasAvailableLinkedPaper(product: OrderChangeCatalogProduct): boolean {
  return (
    !product.paperMaterialId ||
    Boolean(product.linkedPaper?.isActive && !product.linkedPaper.outOfStock)
  );
}

/**
 * Resolve the complete server-owned catalog identity for one specification
 * change. The browser chooses only a product id and one of that product's
 * configured specification labels; every coupled pricing fact is derived
 * here and must be re-resolved inside the approval transaction.
 */
export function resolveOrderChangeCatalogIdentity(input: {
  sourceItem: OrderChangeCatalogSourceItem;
  targetProductId: string;
  targetSpecification: string;
  products: readonly OrderChangeCatalogProduct[];
}): OrderChangeCatalogIdentity {
  const product = resolveTargetProduct(input.products, input.targetProductId);
  if (
    !productCategoryMatchesPricingRoute(
      input.sourceItem.pricingRoute,
      product.category,
    )
  ) {
    throw new OrderChangeCatalogIdentityError(
      'PRICING_ROUTE_MISMATCH',
      '目标报价产品与原款式计价路线不一致',
    );
  }

  const submittedSpecification = canonicalizeCreateOrderSpecification(
    input.targetSpecification,
  );
  if (!submittedSpecification) {
    throw new OrderChangeCatalogIdentityError(
      'SPECIFICATION_INVALID',
      '目标规格无法唯一解析，请从产品目录重新选择',
    );
  }
  const matchingChoices = catalogPricingFactChoices(
    product.specification,
  ).filter(
    (choice) =>
      canonicalizeCreateOrderSpecification(choice) ===
      submittedSpecification,
  );
  if (matchingChoices.length === 0) {
    throw new OrderChangeCatalogIdentityError(
      'SPECIFICATION_NOT_IN_PRODUCT',
      '目标规格不属于选中的报价产品',
    );
  }
  if (matchingChoices.length !== 1) {
    throw new OrderChangeCatalogIdentityError(
      'SPECIFICATION_AMBIGUOUS',
      '目标报价产品内存在重复规格，不能安全修改',
    );
  }

  const sourcePaper = input.sourceItem.paperType
    ? canonicalizeCreateOrderPaperFact(
        input.sourceItem.paperType,
        input.sourceItem.paperWeightGsm,
      )
    : null;
  if (!sourcePaper) {
    throw new OrderChangeCatalogIdentityError(
      'SOURCE_PAPER_INVALID',
      '原款式纸张与克重无法唯一解析，不能自动修改规格',
    );
  }
  if (!productMatchesSourcePaper(product, input.sourceItem, sourcePaper)) {
    throw new OrderChangeCatalogIdentityError(
      'TARGET_PAPER_MISMATCH',
      '目标规格没有与原款式纸张、克重完全一致的报价产品',
    );
  }

  const compatibleProductIds = new Set(
    input.products.flatMap((candidate) => {
      if (
        !candidate.isActive ||
        !hasAvailableLinkedPaper(candidate) ||
        !productCategoryMatchesPricingRoute(
          input.sourceItem.pricingRoute,
          candidate.category,
        ) ||
        !productMatchesSourcePaper(candidate, input.sourceItem, sourcePaper)
      ) {
        return [];
      }
      const hasSpecification = catalogPricingFactChoices(
        candidate.specification,
      ).some(
        (choice) =>
          canonicalizeCreateOrderSpecification(choice) ===
          submittedSpecification,
      );
      return hasSpecification ? [candidate.id] : [];
    }),
  );
  if (compatibleProductIds.size !== 1) {
    throw new OrderChangeCatalogIdentityError(
      'SPECIFICATION_AMBIGUOUS',
      '目标规格对应多个兼容报价产品，不能安全确定计价规则',
    );
  }

  const pricingGroup = pricingGroupForSpecification(
    submittedSpecification,
  );
  if (!pricingGroup) {
    throw new OrderChangeCatalogIdentityError(
      'SPECIFICATION_NOT_PRICEABLE',
      `目标规格“${matchingChoices[0]}”不属于已定义计价组`,
    );
  }
  const specification = matchingChoices[0]!.trim();
  const dimensions = parseCatalogDimensions(specification);
  return {
    productId: product.id,
    specification,
    canonicalSpecification: submittedSpecification,
    productStructure: inferCatalogProductStructure(specification),
    actualWidthMm: dimensions?.widthMm ?? null,
    actualHeightMm: dimensions?.heightMm ?? null,
    pricingGroup,
  };
}

/**
 * Build browser choices from active catalog rows. If more than one product
 * represents the same canonical specification for the current route/paper,
 * omit that specification instead of making an arbitrary choice.
 */
export function listOrderChangeSpecificationOptions(input: {
  sourceItem: OrderChangeCatalogSourceItem;
  products: readonly OrderChangeCatalogProduct[];
}): OrderChangeSpecificationOption[] {
  const candidates = input.products.flatMap((product) =>
    catalogPricingFactChoices(product.specification).flatMap(
      (targetSpecification) => {
        try {
          const identity = resolveOrderChangeCatalogIdentity({
            sourceItem: input.sourceItem,
            targetProductId: product.id,
            targetSpecification,
            products: input.products,
          });
          return [identity];
        } catch (error) {
          if (error instanceof OrderChangeCatalogIdentityError) return [];
          throw error;
        }
      },
    ),
  );
  const bySpecification = new Map<string, OrderChangeCatalogIdentity[]>();
  for (const candidate of candidates) {
    const grouped = bySpecification.get(candidate.canonicalSpecification) ?? [];
    if (
      !grouped.some(
        (current) =>
          current.productId === candidate.productId &&
          current.specification === candidate.specification,
      )
    ) {
      grouped.push(candidate);
    }
    bySpecification.set(candidate.canonicalSpecification, grouped);
  }
  return [...bySpecification.values()]
    .flatMap((identities) => (identities.length === 1 ? identities : []))
    .sort((left, right) =>
      left.specification.localeCompare(right.specification, 'zh-CN', {
        numeric: true,
        sensitivity: 'base',
      }),
    )
    .map((identity) => ({
      ...identity,
      selectionKey: JSON.stringify([
        identity.productId,
        identity.specification,
      ]),
    }));
}
