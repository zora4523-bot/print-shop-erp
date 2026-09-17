import { isRetiredPaper } from '@/lib/rules/paper-availability';
import {
  OrderItemPricingRoute,
  OrderProductStructure,
} from '@/generated/prisma/enums';
import {
  normalizeCatalogPricingText,
  parseCatalogPaperWeight,
  catalogPricingFactChoices,
} from '@/lib/order/catalog-pricing-facts';
import { productCategoryMatchesPricingRoute } from '@/lib/order/pricing-route';
import { canonicalizeCreateOrderSpecification } from '@/lib/price/create-order/canonical-facts';

export type ExternalOrderPaperKey = string;

type ExternalOrderPaperVariant = {
  route: OrderItemPricingRoute;
  specification: string;
  paperType: string;
  weight: number;
  paperMaterialId: string | null;
  outOfStock: boolean;
};

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
  variants: readonly ExternalOrderPaperVariant[];
};

export type ExternalOrderCatalogProduct = {
  id: string;
  code?: string | null;
  category: string;
  specification: string | null;
  paperType: string | null;
  paperMaterialId?: string | null;
  weight?: number | null;
};

export type ExternalOrderPaperMaterial = {
  id: string;
  name: string;
  specification?: string | null;
  weight?: number | null;
  outOfStock?: boolean;
};

export type ExternalOrderWeightOption = {
  value: number;
  disabled: boolean;
};

const AUTOMATIC_ROUTES = [
  OrderItemPricingRoute.STOCK_BLANK,
  OrderItemPricingRoute.CUSTOM_SINGLE_FLAT_FOIL,
  OrderItemPricingRoute.COLOR_PRINT,
] as const;

function paperFamilyLabel(paperType: string): string {
  return paperType
    .replace(/^\s*\d+(?:\.\d+)?\s*(?:g|克)\s*/iu, '')
    .trim();
}

function paperAppearance(
  label: string,
): ExternalOrderPaper['appearance'] {
  if (label.includes('杂色') && label.includes('珠光')) return 'variegated';
  if (label.includes('珠光') && label.includes('红')) return 'pearl-red';
  if (label.includes('珠光')) return 'pearl';
  if (label.includes('触感')) return 'matte-red';
  if (label.includes('金葱')) return 'glitter';
  if (label.includes('莱尼')) return 'linen';
  if (label.includes('冰白')) return 'ice-white';
  if (label.includes('铜版')) return 'coated';
  return 'solid-red';
}

function productPricingRoute(
  product: ExternalOrderCatalogProduct,
): OrderItemPricingRoute | null {
  const routes = AUTOMATIC_ROUTES.filter((route) =>
    !isRetiredPaper(product) && productCategoryMatchesPricingRoute(route, product.category),
  );
  return routes.length === 1 ? routes[0] : null;
}

/**
 * Build the new-order choices from the active quote products supplied by the
 * server. Published products are the source of truth; this module only derives
 * labels and swatch appearance and never invents a priceable combination.
 */
export function buildExternalOrderPapers<
  T extends ExternalOrderCatalogProduct,
>(
  products: readonly T[],
  paperMaterials?: readonly ExternalOrderPaperMaterial[],
): ExternalOrderPaper[] {
  const byKey = new Map<
    string,
    {
      label: string;
      variants: ExternalOrderPaperVariant[];
    }
  >();
  const addVariant = (args: {
    route: OrderItemPricingRoute;
    paperType: string;
    specification: string;
    weight: number;
    paperMaterialId: string | null;
    outOfStock: boolean;
  }) => {
    const {
      route,
      paperType,
      specification,
      weight,
      paperMaterialId,
      outOfStock,
    } = args;
    const label = paperFamilyLabel(paperType);
    if (!label || isRetiredPaper({ paperType, weight })) return;
    const key = normalizeCatalogPricingText(label);
    const entry = byKey.get(key) ?? { label, variants: [] };
    if (
      !entry.variants.some(
        (candidate) =>
          candidate.route === route &&
          sameCatalogText(candidate.paperType, paperType) &&
          sameCatalogText(candidate.specification, specification) &&
          candidate.paperMaterialId === paperMaterialId,
      )
    ) {
      entry.variants.push({
        route,
        specification,
        paperType,
        weight,
        paperMaterialId,
        outOfStock,
      });
    }
    byKey.set(key, entry);
  };

  for (const product of products) {
    const route = productPricingRoute(product);
    const paperType = product.paperType?.trim();
    const weight = product.weight ?? parseCatalogPaperWeight(paperType);
    if (!route || !paperType || weight === null) continue;
    const linkedPaper = product.paperMaterialId
      ? paperMaterials?.find((material) => material.id === product.paperMaterialId)
      : null;
    for (const specification of catalogPricingFactChoices(
      product.specification,
    )) {
      if (!canonicalizeCreateOrderSpecification(specification)) continue;
      addVariant({
        route,
        paperType,
        specification,
        weight,
        paperMaterialId: product.paperMaterialId ?? null,
        outOfStock:
          linkedPaper?.outOfStock === true ||
          (paperMaterials !== undefined &&
            Boolean(product.paperMaterialId) &&
            !linkedPaper),
      });
    }
  }

  // CUSTOM products intentionally own a size, not one paper SKU. Their paper
  // choices come from the active PAPER material catalog. Combining those two
  // configured facts does not invent a price: the server adapter re-resolves
  // both identities and the pure engine returns typed manual pricing for a
  // material without a published surcharge.
  const customSpecifications = [
    ...new Set(
      products
        .filter((product) =>
          productCategoryMatchesPricingRoute(
            OrderItemPricingRoute.CUSTOM_SINGLE_FLAT_FOIL,
            product.category,
          ),
        )
        .flatMap((product) =>
          catalogPricingFactChoices(product.specification),
        )
        .filter(
          (specification) =>
            canonicalizeCreateOrderSpecification(specification) !== null,
        ),
    ),
  ];
  for (const material of paperMaterials ?? []) {
    const weight =
      material.weight ??
      parseCatalogPaperWeight(material.specification) ??
      parseCatalogPaperWeight(material.name);
    if (weight === null) continue;
    for (const paperType of catalogPricingFactChoices(material.name)) {
      for (const specification of customSpecifications) {
        addVariant({
          route: OrderItemPricingRoute.CUSTOM_SINGLE_FLAT_FOIL,
          paperType,
          specification,
          weight,
          paperMaterialId: material.id,
          outOfStock: material.outOfStock === true,
        });
      }
    }
  }

  return [...byKey.entries()].map(([key, entry]) => {
    const routes = [...new Set(entry.variants.map((variant) => variant.route))];
    const weights = [...new Set(entry.variants.map((variant) => variant.weight))]
      .sort((left, right) => left - right);
    return {
      key,
      label: entry.label,
      appearance: paperAppearance(entry.label),
      weights,
      paperTypeByWeight: Object.fromEntries(
        entry.variants.map((variant) => [variant.weight, variant.paperType]),
      ),
      routes,
      variants: entry.variants,
    };
  });
}

function sameCatalogText(left: string | null, right: string | null): boolean {
  return Boolean(
    left &&
      right &&
      normalizeCatalogPricingText(left) === normalizeCatalogPricingText(right),
  );
}

export function externalOrderPapersForRoute(
  products: readonly ExternalOrderCatalogProduct[],
  route: OrderItemPricingRoute,
  paperMaterials?: readonly ExternalOrderPaperMaterial[],
): readonly ExternalOrderPaper[] {
  return buildExternalOrderPapers(products, paperMaterials).filter((paper) =>
    paper.routes.includes(route),
  );
}

export function externalOrderWeightsForSelection(
  paper: ExternalOrderPaper,
  route: OrderItemPricingRoute,
  specification: string,
): readonly number[] {
  return externalOrderWeightOptionsForSelection(
    paper,
    route,
    specification,
  ).map((option) => option.value);
}

export function externalOrderWeightOptionsForSelection(
  paper: ExternalOrderPaper,
  route: OrderItemPricingRoute,
  specification: string,
): readonly ExternalOrderWeightOption[] {
  const byWeight = new Map<number, boolean[]>();
  for (const variant of paper.variants) {
    if (
      variant.route !== route ||
      !sameCatalogText(variant.specification, specification)
    ) {
      continue;
    }
    const availability = byWeight.get(variant.weight) ?? [];
    availability.push(variant.outOfStock);
    byWeight.set(variant.weight, availability);
  }
  return [...byWeight.entries()]
    .sort(([left], [right]) => left - right)
    .map(([value, stockStates]) => ({
      value,
      disabled: stockStates.every(Boolean),
    }));
}

export function externalOrderPaperFromType(
  products: readonly ExternalOrderCatalogProduct[],
  paperType: string | null | undefined,
  paperMaterials?: readonly ExternalOrderPaperMaterial[],
): ExternalOrderPaper | null {
  if (!paperType) return null;
  return (
    buildExternalOrderPapers(products, paperMaterials).find((paper) =>
      paper.variants.some((candidate) =>
        sameCatalogText(candidate.paperType, paperType),
      ),
    ) ?? null
  );
}

export function externalOrderPaperType(
  paper: ExternalOrderPaper,
  route: OrderItemPricingRoute,
  specification: string,
  weight: number,
): string | null {
  return (
    paper.variants.find(
      (variant) =>
        variant.route === route &&
        variant.weight === weight &&
        sameCatalogText(variant.specification, specification),
    )?.paperType ?? null
  );
}

export function externalOrderSpecificationsForRoute(
  products: readonly ExternalOrderCatalogProduct[],
  route: OrderItemPricingRoute,
): string[] {
  return [
    ...new Set(
      products
        .filter((product) =>
          !isRetiredPaper(product) && productCategoryMatchesPricingRoute(route, product.category),
        )
        .flatMap((product) =>
          catalogPricingFactChoices(product.specification),
        )
        .filter(
          (specification) =>
            canonicalizeCreateOrderSpecification(specification) !== null,
        ),
    ),
  ];
}

export function externalOrderDefaultSpecification(
  products: readonly ExternalOrderCatalogProduct[],
  route: OrderItemPricingRoute,
): string {
  const specifications = externalOrderSpecificationsForRoute(products, route);
  return (
    specifications.find((specification) => specification.includes('大号')) ??
    specifications[0] ??
    ''
  );
}

export function externalOrderCatalogCandidates<
  T extends ExternalOrderCatalogProduct,
>(
  products: readonly T[],
  route: OrderItemPricingRoute,
  paperType: string,
  specification: string,
): T[] {
  const specificationMatches = products.filter(
    (product) =>
      !isRetiredPaper(product) && productCategoryMatchesPricingRoute(route, product.category) &&
      catalogPricingFactChoices(product.specification).some((choice) =>
        sameCatalogText(choice, specification),
      ),
  );
  const exactPaperMatches = specificationMatches.filter((product) =>
    sameCatalogText(product.paperType, paperType),
  );
  if (exactPaperMatches.length !== 0) {
    return exactPaperMatches;
  }
  if (route !== OrderItemPricingRoute.CUSTOM_SINGLE_FLAT_FOIL) return [];
  const genericCustomProducts = specificationMatches.filter(
    (product) => !product.paperType?.trim(),
  );
  return genericCustomProducts;
}

export function findExternalOrderCatalogProduct<T extends ExternalOrderCatalogProduct>(products: readonly T[], route: OrderItemPricingRoute, paperType: string, specification: string): T | null {
  const matches = externalOrderCatalogCandidates(products, route, paperType, specification);
  return matches.length === 1 ? matches[0]! : null;
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
