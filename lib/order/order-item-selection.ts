import {
  OrderItemPricingRoute,
  OrderFoilTechnique,
  OrderLamination,
} from '@/generated/prisma/enums';
import type { CreateOrderInput } from '@/lib/auth/schemas';
import type { ExternalCreateOrderOptions } from '@/lib/order/create-order-options';
import {
  externalOrderPapersForRoute,
  externalOrderWeightOptionsForSelection,
  externalOrderDefaultSpecification,
  externalOrderDimensions,
  type ExternalOrderCatalogProduct,
} from '@/lib/order/order-item-catalog';

type Item = CreateOrderInput['items'][number];
export type OrderItemSelectionChange =
  | { type: 'route'; value: OrderItemPricingRoute }
  | { type: 'paper' | 'specification'; value: string }
  | { type: 'weight'; value: number }
  | { type: 'foil'; front: string[]; back: string[] }
  | { type: 'technique'; value: OrderFoilTechnique }
  | { type: 'customSize'; value: boolean }
  | { type: 'printFoil'; value: 'NONE' | 'PARTIAL' | 'FULL' };
export type OrderItemNormalizationOptions = {
  paperKey?: string;
  resetPaper?: boolean;
  resetSpecification?: boolean;
  preserveCustomSize?: boolean;
  internalMaterialChange?: 'route' | 'paper' | 'weight' | 'specification';
};
/** Input transitions shared by order entry and the sales calculator. No prices or writes. */
export function orderItemSelectionUpdate(
  current: Item,
  change: OrderItemSelectionChange,
  products: readonly ExternalOrderCatalogProduct[],
  catalog?: ExternalCreateOrderOptions,
): { item: Item; options: OrderItemNormalizationOptions } | null {
  const defaultFoil = catalog?.foilColors[0]?.name ?? '';
  switch (change.type) {
    case 'route': {
      const front =
        change.value === OrderItemPricingRoute.COLOR_PRINT || !defaultFoil
          ? []
          : [defaultFoil];
      return {
        item: {
          ...current,
          pricingRoute: change.value,
          frontFoilColors: front,
          backFoilColors: [],
          foilColors: front,
          foilTechnique:
            change.value === OrderItemPricingRoute.COLOR_PRINT
              ? OrderFoilTechnique.NONE
              : OrderFoilTechnique.FLAT,
          hasLocalFoil: change.value === OrderItemPricingRoute.STOCK_BLANK,
          lamination: OrderLamination.NONE,
        },
        options: {
          resetPaper: true,
          resetSpecification: true,
          preserveCustomSize: false,
          internalMaterialChange: 'route',
        },
      };
    }
    case 'paper': {
      const paper = externalOrderPapersForRoute(
        products,
        current.pricingRoute,
        catalog?.papers,
      ).find((paper) => paper.key === change.value);
      if (!paper) return null;
      const weight =
        externalOrderWeightOptionsForSelection(
          paper,
          current.pricingRoute,
          current.specification ??
            externalOrderDefaultSpecification(products, current.pricingRoute),
        ).find((option) => !option.disabled)?.value ?? current.paperWeightGsm;
      return {
        item: {
          ...current,
          paperWeightGsm: weight,
          lamination:
            current.pricingRoute === OrderItemPricingRoute.COLOR_PRINT &&
            paper.appearance === 'coated'
              ? OrderLamination.MATTE
              : OrderLamination.NONE,
        },
        options: {
          paperKey: change.value,
          preserveCustomSize: false,
          internalMaterialChange: 'paper',
        },
      };
    }
    case 'weight':
      return {
        item: { ...current, paperWeightGsm: change.value },
        options: { internalMaterialChange: 'weight' },
      };
    case 'specification':
      return {
        item: { ...current, specification: change.value },
        options: { internalMaterialChange: 'specification' },
      };
    case 'foil':
      return {
        item: {
          ...current,
          frontFoilColors: change.front,
          backFoilColors: change.back,
          foilColors: [...new Set([...change.front, ...change.back])],
          isDoubleSided: change.back.length > 0,
          isDoubleColor: change.front.length + change.back.length > 1,
        },
        options: {},
      };
    case 'technique':
      return {
        item: {
          ...current,
          foilTechnique:
            current.foilTechnique === change.value
              ? OrderFoilTechnique.FLAT
              : change.value,
        },
        options: {},
      };
    case 'customSize': {
      const dimensions = externalOrderDimensions(current.specification ?? '');
      return {
        item: {
          ...current,
          actualWidthMm: change.value ? null : (dimensions?.widthMm ?? null),
          actualHeightMm: change.value ? null : (dimensions?.heightMm ?? null),
        },
        options: {},
      };
    }
    case 'printFoil': {
      const hasFoil = change.value !== 'NONE';
      const color = current.frontFoilColors[0] ?? defaultFoil;
      const front = hasFoil && color ? [color] : [];
      return {
        item: {
          ...current,
          frontFoilColors: front,
          backFoilColors: [],
          foilColors: front,
          foilTechnique: hasFoil
            ? OrderFoilTechnique.FLAT
            : OrderFoilTechnique.NONE,
          hasLocalFoil: change.value === 'PARTIAL',
        },
        options: {},
      };
    }
  }
}
