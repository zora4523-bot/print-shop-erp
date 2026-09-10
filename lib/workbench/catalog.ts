import type { ExternalCreateOrderOptions } from '@/lib/order/create-order-options';
import { OrderItemPricingRoute } from '@/generated/prisma/enums';
import {
  catalogPricingFactChoices,
  parseCatalogPaperWeight,
} from '@/lib/order/catalog-pricing-facts';
import { productCategoryMatchesPricingRoute } from '@/lib/order/pricing-route';

/** Size-only custom products use the active material catalog, as in order creation. */
export function workbenchPaperChoices(
  product: ExternalCreateOrderOptions['products'][number] | undefined,
  papers: ExternalCreateOrderOptions['papers'],
): string[] {
  if (!product) return [];
  const linked = product.paperMaterialId
    ? papers.find((paper) => paper.id === product.paperMaterialId)
    : undefined;
  const withWeight = (name: string, weight: number | null) =>
    parseCatalogPaperWeight(name) === null && weight !== null
      ? `${weight}g${name}`
      : name;
  if (product.paperType?.trim()) {
    return catalogPricingFactChoices(product.paperType).map((name) =>
      withWeight(name, product.weight ?? linked?.weight ?? null),
    );
  }
  if (
    !productCategoryMatchesPricingRoute(
      OrderItemPricingRoute.CUSTOM_SINGLE_FLAT_FOIL,
      product.category,
    )
  )
    return [];
  return [
    ...new Set(
      papers
        .filter(
          (paper) =>
            !paper.outOfStock &&
            (!product.paperMaterialId || paper.id === product.paperMaterialId),
        )
        .flatMap((paper) => {
          const weight =
            paper.weight ??
            parseCatalogPaperWeight(paper.specification) ??
            parseCatalogPaperWeight(paper.name);
          return weight === null
            ? []
            : catalogPricingFactChoices(paper.name).map((name) =>
                withWeight(name, weight),
              );
        }),
    ),
  ];
}
