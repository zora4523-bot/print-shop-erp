import {
  OrderItemPricingRoute,
  OrderProductStructure,
} from '@/generated/prisma/enums';
import { normalizeCatalogPricingText } from '@/lib/order/catalog-pricing-facts';
import { productCategoryMatchesPricingRoute } from '@/lib/order/pricing-route';

export type ExternalOrderPaperKey =
  | 'PEARL_FLASH'
  | 'PEARL_RED'
  | 'RED_CARD'
  | 'SOFT_TOUCH'
  | 'VARIEGATED_PEARL'
  | 'GOLD_GLITTER'
  | 'LINEN'
  | 'ICE_WHITE'
  | 'COATED';

export type ExternalOrderPaper = {
  key: ExternalOrderPaperKey;
  label: string;
  appearance:
    | 'pearl'
    | 'pearl-red'
    | 'solid-red'
    | 'matte-red'
    | 'variegated'
    | 'glitter'
    | 'linen'
    | 'ice-white'
    | 'coated';
  weights: readonly number[];
  paperTypeByWeight: Readonly<Record<number, string>>;
  routes: readonly OrderItemPricingRoute[];
};

export const EXTERNAL_ORDER_PAPERS: readonly ExternalOrderPaper[] = [
  {
    key: 'PEARL_FLASH',
    label: '珠光纸艳闪',
    appearance: 'pearl',
    weights: [120, 160],
    paperTypeByWeight: {
      120: '120g珠光艳闪',
      160: '160g珠光艳闪',
    },
    routes: [
      OrderItemPricingRoute.STOCK_BLANK,
      OrderItemPricingRoute.CUSTOM_SINGLE_FLAT_FOIL,
    ],
  },
  {
    key: 'PEARL_RED',
    label: '珠光纸闪红',
    appearance: 'pearl-red',
    weights: [160],
    paperTypeByWeight: { 160: '160g珠光闪红' },
    routes: [OrderItemPricingRoute.STOCK_BLANK],
  },
  {
    key: 'RED_CARD',
    label: '红卡',
    appearance: 'solid-red',
    weights: [160, 180, 230],
    paperTypeByWeight: {
      160: '160g红卡',
      180: '180g红卡',
      230: '230g红卡',
    },
    routes: [
      OrderItemPricingRoute.STOCK_BLANK,
      OrderItemPricingRoute.CUSTOM_SINGLE_FLAT_FOIL,
    ],
  },
  {
    key: 'SOFT_TOUCH',
    label: '触感纸',
    appearance: 'matte-red',
    weights: [200],
    paperTypeByWeight: { 200: '200g触感纸' },
    routes: [
      OrderItemPricingRoute.STOCK_BLANK,
      OrderItemPricingRoute.CUSTOM_SINGLE_FLAT_FOIL,
    ],
  },
  {
    key: 'VARIEGATED_PEARL',
    label: '杂色珠光纸',
    appearance: 'variegated',
    weights: [160],
    paperTypeByWeight: { 160: '160g杂色珠光' },
    routes: [
      OrderItemPricingRoute.STOCK_BLANK,
      OrderItemPricingRoute.CUSTOM_SINGLE_FLAT_FOIL,
    ],
  },
  {
    key: 'GOLD_GLITTER',
    label: '金葱',
    appearance: 'glitter',
    weights: [230],
    paperTypeByWeight: { 230: '230g金葱' },
    routes: [
      OrderItemPricingRoute.STOCK_BLANK,
      OrderItemPricingRoute.CUSTOM_SINGLE_FLAT_FOIL,
    ],
  },
  {
    key: 'LINEN',
    label: '莱尼纹',
    appearance: 'linen',
    weights: [150],
    paperTypeByWeight: { 150: '150g莱尼纹' },
    routes: [OrderItemPricingRoute.CUSTOM_SINGLE_FLAT_FOIL],
  },
  {
    key: 'ICE_WHITE',
    label: '冰白纸',
    appearance: 'ice-white',
    weights: [160],
    paperTypeByWeight: { 160: '160g冰白纸' },
    routes: [OrderItemPricingRoute.COLOR_PRINT],
  },
  {
    key: 'COATED',
    label: '铜版纸',
    appearance: 'coated',
    weights: [200],
    paperTypeByWeight: { 200: '200g铜版纸' },
    routes: [OrderItemPricingRoute.COLOR_PRINT],
  },
] as const;

export const EXTERNAL_ORDER_SPECIFICATIONS: Readonly<
  Record<OrderItemPricingRoute, readonly string[]>
> = {
  [OrderItemPricingRoute.STOCK_BLANK]: [
    '迷你封50×80',
    '方形88×88',
    '中号封80×115',
    '大号封90×165',
    '西封中号80×120',
    '西封大号85×165',
  ],
  [OrderItemPricingRoute.CUSTOM_SINGLE_FLAT_FOIL]: [
    '方形88×88',
    '中号封80×115',
    '大号封90×165',
    '西封中号80×120',
    '西封大号85×165',
    '万元封120×220',
  ],
  [OrderItemPricingRoute.COLOR_PRINT]: ['大号88×165', '中号80×120'],
  [OrderItemPricingRoute.MANUAL_QUOTE]: [],
};

export const EXTERNAL_ORDER_DEFAULT_SPECIFICATION: Readonly<
  Record<OrderItemPricingRoute, string>
> = {
  [OrderItemPricingRoute.STOCK_BLANK]: '大号封90×165',
  [OrderItemPricingRoute.CUSTOM_SINGLE_FLAT_FOIL]: '大号封90×165',
  [OrderItemPricingRoute.COLOR_PRINT]: '大号88×165',
  [OrderItemPricingRoute.MANUAL_QUOTE]: '',
};

export type ExternalOrderCatalogProduct = {
  id: string;
  code?: string | null;
  category: string;
  specification: string | null;
  paperType: string | null;
};

function sameCatalogText(left: string | null, right: string | null): boolean {
  return Boolean(
    left &&
      right &&
      normalizeCatalogPricingText(left) === normalizeCatalogPricingText(right),
  );
}

export function externalOrderPapersForRoute(
  route: OrderItemPricingRoute,
): readonly ExternalOrderPaper[] {
  return EXTERNAL_ORDER_PAPERS.filter((paper) => paper.routes.includes(route));
}

export function externalOrderWeightsForSelection(
  paper: ExternalOrderPaper,
  route: OrderItemPricingRoute,
  specification: string,
): readonly number[] {
  if (paper.key === 'PEARL_FLASH') {
    return route === OrderItemPricingRoute.STOCK_BLANK &&
      specification.includes('迷你')
      ? [120]
      : [160];
  }
  return paper.weights;
}

export function externalOrderPaperFromType(
  paperType: string | null | undefined,
): ExternalOrderPaper | null {
  if (!paperType) return null;
  const normalizedPaperType = normalizeCatalogPricingText(paperType);
  return (
    EXTERNAL_ORDER_PAPERS.find((paper) =>
      Object.values(paper.paperTypeByWeight).some((candidate) =>
        sameCatalogText(candidate, paperType),
      ),
    ) ??
    EXTERNAL_ORDER_PAPERS.find((paper) =>
      normalizedPaperType.includes(normalizeCatalogPricingText(paper.label)),
    ) ??
    null
  );
}

export function externalOrderPaperType(
  paper: ExternalOrderPaper,
  weight: number,
): string {
  return paper.paperTypeByWeight[weight] ?? `${weight}g${paper.label}`;
}

export function canonicalExternalOrderProducts<
  T extends ExternalOrderCatalogProduct,
>(products: readonly T[]): T[] {
  const canonical = products.filter((product) =>
    product.code?.toUpperCase().startsWith('EXT-'),
  );
  return canonical.length > 0 ? canonical : [...products];
}

export function findExternalOrderCatalogProduct<
  T extends ExternalOrderCatalogProduct,
>(
  products: readonly T[],
  route: OrderItemPricingRoute,
  paperType: string,
  specification: string,
): T | null {
  const routeProducts = canonicalExternalOrderProducts(products).filter(
    (product) => productCategoryMatchesPricingRoute(route, product.category),
  );
  if (routeProducts.length === 0) return null;

  const exact = routeProducts.find(
    (product) =>
      sameCatalogText(product.specification, specification) &&
      (!product.paperType || sameCatalogText(product.paperType, paperType)),
  );
  if (exact) return exact;

  const samePaper = routeProducts.find((product) =>
    sameCatalogText(product.paperType, paperType),
  );
  if (samePaper) return samePaper;

  return (
    routeProducts.find((product) =>
      sameCatalogText(product.specification, specification),
    ) ?? routeProducts[0] ?? null
  );
}

export function externalOrderProductStructure(
  specification: string,
): OrderProductStructure {
  if (specification.includes('万元')) {
    return OrderProductStructure.TEN_THOUSAND_ENVELOPE;
  }
  if (specification.includes('西封')) {
    return OrderProductStructure.WESTERN_ENVELOPE;
  }
  return OrderProductStructure.STANDARD_ENVELOPE;
}

export function externalOrderDimensions(
  specification: string,
): { widthMm: number; heightMm: number } | null {
  const match = specification.match(/(\d+(?:\.\d+)?)\s*[×xX*]\s*(\d+(?:\.\d+)?)/);
  if (!match) return null;
  return { widthMm: Number(match[1]), heightMm: Number(match[2]) };
}

export function externalOrderStyleName(args: {
  routeLabel: string;
  paperLabel: string;
  weight: number;
  specification: string;
}): string {
  const specification = args.specification
    .replace(/(\d+(?:\.\d+)?)\s*[×xX*]\s*(\d+(?:\.\d+)?)/, '')
    .trim();
  return `${args.routeLabel} · ${args.paperLabel} ${args.weight}g · ${specification}`;
}

export function externalOrderSpecificationLabel(
  specification: string,
  route: OrderItemPricingRoute,
): string {
  if (route === OrderItemPricingRoute.COLOR_PRINT) {
    return specification.replace(/(\D)(\d+(?:\.\d+)?\s*[×xX*]\s*\d)/, '$1 $2');
  }
  return specification
    .replace(/(\d+(?:\.\d+)?)\s*[×xX*]\s*(\d+(?:\.\d+)?)/, '')
    .trim();
}
