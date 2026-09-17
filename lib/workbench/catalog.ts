import { isRetiredPaper } from '@/lib/rules/paper-availability';
import type { ExternalCreateOrderOptions } from '@/lib/order/create-order-options';
import { OrderItemPricingRoute } from '@/generated/prisma/enums';
import {
  catalogPricingFactChoices,
  parseCatalogPaperWeight,
} from '@/lib/order/catalog-pricing-facts';
import { productCategoryMatchesPricingRoute } from '@/lib/order/pricing-route';

/** Explain unavailable catalog facts before asking the user to select a paper. */
export function workbenchPaperIssue(
  product: ExternalCreateOrderOptions['products'][number] | undefined,
  papers: ExternalCreateOrderOptions['papers'],
): string | null {
  if (product && isRetiredPaper(product)) return '120g 纸张已停用，请选择其他克重';
  if (!product?.paperMaterialId) return null;
  const linked = papers.find((paper) => paper.id === product.paperMaterialId);
  if (!linked || linked.outOfStock || isRetiredPaper(linked))
    return '所选产品的纸张已缺货或停用，请选择其他产品或联系管理员补充资料';
  if (
    product.weight === null &&
    linked.weight === null &&
    parseCatalogPaperWeight(linked.specification) === null &&
    parseCatalogPaperWeight(linked.name) === null &&
    workbenchPaperChoices(product, papers).every(
      (choice) => parseCatalogPaperWeight(choice) === null,
    )
  )
    return '所选纸张缺少克重，请选择其他产品或联系管理员补充资料';
  return null;
}

/** Size-only custom products use the active material catalog, as in order creation. */
export function workbenchPaperChoices(
  product: ExternalCreateOrderOptions['products'][number] | undefined,
  papers: ExternalCreateOrderOptions['papers'],
): string[] {
  if (!product || isRetiredPaper(product)) return [];
  const linked = product.paperMaterialId
    ? papers.find((paper) => paper.id === product.paperMaterialId)
    : undefined;
  // The options reader returns active materials only. A missing linked paper
  // is unavailable even when the product still carries its saved paper label.
  if (product.paperMaterialId && (!linked || linked.outOfStock || isRetiredPaper(linked))) return [];
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
            !paper.outOfStock && !isRetiredPaper(paper) &&
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
