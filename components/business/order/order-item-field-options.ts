import { foilColorLabel } from '@/lib/order/foil-colors';
import { OrderItemPricingRoute } from '@/generated/prisma/enums';
import type { CreateOrderInput } from '@/lib/auth/schemas';
import type { ExternalCreateOrderOptions } from '@/lib/order/create-order-options';
import { productCategoryMatchesPricingRoute } from '@/lib/order/pricing-route';
import {
  externalOrderPaperFromType,
  externalOrderPapersForRoute,
  externalOrderWeightOptionsForSelection,
  externalOrderAvailableSpecifications,
  externalOrderSpecificationsForRoute,
  externalOrderSpecificationLabel,
  type ExternalOrderCatalogProduct,
} from '@/lib/order/order-item-catalog';
import { paperDisplayRank } from '@/lib/rules/paper-label';
import type { OrderPaperOption } from './order-form-b/OrderItemFields';
import type { OrderFoilSwatchOption } from './order-form-b/OrderFoilSwatchPicker';

export function orderItemFieldOptions(
  item: CreateOrderInput['items'][number],
  products: readonly ExternalOrderCatalogProduct[],
  options?: ExternalCreateOrderOptions,
) {
  const activeExternalPaper = externalOrderPaperFromType(
    products,
    item.paperType,
    options?.papers,
  );
  // Display order only (stable sort): normalizeExternalOrderItem still picks the
  // default paper from the catalog order, so reordering buttons cannot change it.
  const externalPaperOptions: OrderPaperOption[] =
    externalOrderPapersForRoute(
      products,
      item.pricingRoute,
      options?.papers,
    ).map((paper) => ({
      value: paper.key,
      label: paper.label,
      disabled: (() => {
        if (item.pricingRoute === OrderItemPricingRoute.STOCK_BLANK) {
          return externalOrderAvailableSpecifications(paper, item.pricingRoute).length === 0;
        }
        const weightOptions = externalOrderWeightOptionsForSelection(
          paper,
          item.pricingRoute,
          item.specification ?? '',
        );
        return (
          weightOptions.length === 0 ||
          weightOptions.every((option) => option.disabled)
        );
      })(),
    })).sort((left, right) => paperDisplayRank(left.label) - paperDisplayRank(right.label));
  const externalFoilOptions: OrderFoilSwatchOption[] =
    options?.foilColors.map((foil) => ({
      value: foil.name,
      label: foilColorLabel(foil.name),
      color: foil.displayColor,
      imageSrc: foil.displayImage,
    })) ?? [];
  const externalWeightOptions = activeExternalPaper
    ? externalOrderWeightOptionsForSelection(
        activeExternalPaper,
        item.pricingRoute,
        item.specification ?? '',
      )
    : [];
  const configuredExternalSpecifications = options
    ? options.specifications
        .filter((specification) =>
          specification.productCategories.some((category) =>
            productCategoryMatchesPricingRoute(item.pricingRoute, category),
          ),
        )
        .map((specification) => specification.label)
    : externalOrderSpecificationsForRoute(products, item.pricingRoute);
  const externalSpecificationOptions = configuredExternalSpecifications.map(
    (specification) => ({
      value: specification,
      label: externalOrderSpecificationLabel(specification, item.pricingRoute),
      // Any enabled weight on the active paper makes the specification
      // reachable; the weight renormalizes on selection. Requiring the current
      // weight here would dead-lock with the weight picker, which is itself
      // filtered by the current specification.
      disabled: !activeExternalPaper || !externalOrderWeightOptionsForSelection(
        activeExternalPaper,
        item.pricingRoute,
        specification,
      ).some((weight) => !weight.disabled),
    }),
  );
  return {
    activeExternalPaper,
    externalPaperOptions,
    externalFoilOptions,
    externalWeightOptions,
    externalSpecificationOptions,
  };
}
