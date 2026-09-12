import type { ExternalCreateOrderOptions } from '@/lib/order/create-order-options';
import { OrderItemPricingRoute } from '@/generated/prisma/enums';
import {
  catalogPricingFactChoices,
  parseCatalogPaperWeight,
} from '@/lib/order/catalog-pricing-facts';
import { canonicalizeCreateOrderSpecification } from '@/lib/price/create-order/canonical-facts';
import { productCategoryMatchesPricingRoute } from '@/lib/order/pricing-route';
import { workbenchPaperChoices } from './catalog';

/** Prototype starts with a complete common example; values still come from the live catalog. */
export function workbenchDefaultSelection(
  route: OrderItemPricingRoute,
  options: ExternalCreateOrderOptions,
) {
  const candidates = options.products
    .filter((product) =>
      productCategoryMatchesPricingRoute(route, product.category),
    )
    .flatMap((product) =>
      catalogPricingFactChoices(product.specification).flatMap(
        (specification) => {
          const spec = canonicalizeCreateOrderSpecification(specification);
          if (!spec) return [];
          return workbenchPaperChoices(product, options.papers).flatMap(
            (paperType) => {
              const weight = parseCatalogPaperWeight(paperType);
              if (!weight) return [];
              const preferred =
                route === OrderItemPricingRoute.COLOR_PRINT
                  ? /200(?:g|克).*(?:铜版|双铜)/.test(paperType)
                  : /160(?:g|克).*(?:珠光艳闪|艳闪|闪红|红卡)/.test(paperType);
              return [
                {
                  productId: product.id,
                  specification,
                  paperType,
                  score: (spec === '大号封' ? 10 : 0) + (preferred ? 20 : 0),
                },
              ];
            },
          );
        },
      ),
    )
    .sort((a, b) => b.score - a.score);
  const first = candidates[0];
  return first
    ? {
        productId: first.productId,
        specification: first.specification,
        paperType: first.paperType,
      }
    : { productId: '', specification: '', paperType: '' };
}
