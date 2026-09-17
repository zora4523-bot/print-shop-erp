import { foilColorLabel } from '@/lib/order/foil-colors';
import type { CreateOrderInput } from '@/lib/auth/schemas';
import type { ExternalCreateOrderOptions } from '@/lib/order/create-order-options';
import { productCategoryMatchesPricingRoute } from '@/lib/order/pricing-route';
import {
  externalOrderPaperFromType,
  externalOrderPapersForRoute,
  externalOrderWeightOptionsForSelection,
  externalOrderSpecificationsForRoute,
  externalOrderSpecificationLabel,
  type ExternalOrderPaper,
  type ExternalOrderCatalogProduct,
} from '@/lib/order/order-item-catalog';
import type { OrderPaperSwatchOption } from './order-form-b/OrderPaperSwatchPicker';
import type { OrderFoilSwatchOption } from './order-form-b/OrderFoilSwatchPicker';
function externalPaperSwatchTexture(
  appearance: ExternalOrderPaper['appearance'],
): OrderPaperSwatchOption['texture'] {
  switch (appearance) {
    case 'pearl':
      return 'pearl';
    case 'pearl-red':
      return 'pearl-red';
    case 'solid-red':
      return 'solid-red';
    case 'matte-red':
      return 'matte-red';
    case 'variegated':
      return 'variegated-pearl';
    case 'glitter':
      return 'glitter-red';
    case 'linen':
      return 'linen-red';
    case 'ice-white':
      return 'ice-white';
    case 'coated':
      return 'coated-white';
  }
}

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
  const externalPaperOptions: OrderPaperSwatchOption[] =
    externalOrderPapersForRoute(
      products,
      item.pricingRoute,
      options?.papers,
    ).map((paper) => ({
      value: paper.key,
      label: paper.label,
      texture: externalPaperSwatchTexture(paper.appearance),
      disabled: (() => {
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
    }));
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
      disabled: !activeExternalPaper || !externalOrderWeightOptionsForSelection(
        activeExternalPaper,
        item.pricingRoute,
        specification,
      ).some((weight) => !weight.disabled && weight.value === item.paperWeightGsm),
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
