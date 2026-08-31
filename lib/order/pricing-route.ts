import {
  OrderFoilTechnique,
  OrderItemPricingRoute,
  ProductCategory,
} from '@/generated/prisma/enums';
import { NO_FOIL_COLOR } from './foil-colors';

export const MAX_ORDER_ITEM_FOIL_COLORS_PER_SIDE = 3;

type FoilSideFacts = {
  frontFoilColors?: readonly string[];
  backFoilColors?: readonly string[];
  foilColors?: readonly string[];
  isDoubleSided?: boolean;
};

function realFoilColors(colors: readonly string[] | undefined): string[] {
  return (colors ?? []).filter((color) => color !== NO_FOIL_COLOR);
}

/**
 * New orders submit explicit sides.  The legacy fallback is deliberately
 * isolated here so historical commands remain readable while every new
 * write can persist the explicit facts and derive the retired columns.
 */
export function resolveOrderItemFoilSides(facts: FoilSideFacts): {
  frontFoilColors: string[];
  backFoilColors: string[];
} {
  const explicitFront = realFoilColors(facts.frontFoilColors);
  const explicitBack = realFoilColors(facts.backFoilColors);
  if (explicitFront.length > 0 || explicitBack.length > 0) {
    return {
      frontFoilColors: explicitFront,
      backFoilColors: explicitBack,
    };
  }

  const legacy = realFoilColors(facts.foilColors);
  if (!facts.isDoubleSided) {
    return { frontFoilColors: legacy, backFoilColors: [] };
  }
  if (legacy.length <= 1) {
    const color = legacy[0];
    return color
      ? { frontFoilColors: [color], backFoilColors: [color] }
      : { frontFoilColors: [], backFoilColors: [] };
  }
  return {
    frontFoilColors: [legacy[0] as string],
    backFoilColors: legacy.slice(1),
  };
}

export function orderItemFoilPassCount(facts: FoilSideFacts): number {
  const sides = resolveOrderItemFoilSides(facts);
  return sides.frontFoilColors.length + sides.backFoilColors.length;
}

export function deriveLegacyOrderItemFoilFacts(facts: FoilSideFacts): {
  frontFoilColors: string[];
  backFoilColors: string[];
  foilColors: string[];
  isDoubleSided: boolean;
  isDoubleColor: boolean;
} {
  const sides = resolveOrderItemFoilSides(facts);
  const foilColors = [
    ...new Set([...sides.frontFoilColors, ...sides.backFoilColors]),
  ];
  return {
    ...sides,
    foilColors,
    isDoubleSided: sides.backFoilColors.length > 0,
    isDoubleColor: foilColors.length > 1,
  };
}

/**
 * The database enum still contains MANUAL_QUOTE so historical orders remain
 * readable. New orders choose one production/pricing route; an incomplete
 * rule result is a pricing status handled by an administrator, not a route.
 */
export const NEW_ORDER_PRICING_ROUTES = [
  OrderItemPricingRoute.STOCK_BLANK,
  OrderItemPricingRoute.CUSTOM_SINGLE_FLAT_FOIL,
  OrderItemPricingRoute.COLOR_PRINT,
] as const;

export type NewOrderPricingRoute =
  (typeof NEW_ORDER_PRICING_ROUTES)[number];

const NEW_ORDER_PRICING_ROUTE_SET = new Set<OrderItemPricingRoute>(
  NEW_ORDER_PRICING_ROUTES,
);

export function isNewOrderPricingRoute(
  route: OrderItemPricingRoute,
): route is NewOrderPricingRoute {
  return NEW_ORDER_PRICING_ROUTE_SET.has(route);
}

export function productCategoryMatchesPricingRoute(
  route: OrderItemPricingRoute,
  category: string,
  options: { allowLegacyStockFoilAdd?: boolean } = {},
): boolean {
  switch (route) {
    case OrderItemPricingRoute.STOCK_BLANK:
      return (
        category === ProductCategory.BLANK_STOCK ||
        category === ProductCategory.GENERIC_STOCK ||
        (options.allowLegacyStockFoilAdd === true &&
          category === ProductCategory.STOCK_FOIL_ADD)
      );
    case OrderItemPricingRoute.CUSTOM_SINGLE_FLAT_FOIL:
      return category === ProductCategory.CUSTOM_FLAT_FOIL;
    case OrderItemPricingRoute.COLOR_PRINT:
      return category === ProductCategory.COLOR_PRINT;
    case OrderItemPricingRoute.MANUAL_QUOTE:
      return false;
  }
}

export function normalizeFoilFactsForPricingRoute(args: {
  route: OrderItemPricingRoute;
  foilColors: readonly string[];
  frontFoilColors?: readonly string[];
  backFoilColors?: readonly string[];
  isDoubleSided?: boolean;
  foilTechnique: OrderFoilTechnique;
  hasLocalFoil: boolean | null;
}): Pick<typeof args, 'foilTechnique' | 'hasLocalFoil'> {
  const actualFoilColorCount = orderItemFoilPassCount(args);

  if (args.route === OrderItemPricingRoute.STOCK_BLANK) {
    return {
      foilTechnique:
        args.foilTechnique === OrderFoilTechnique.NONE ||
        args.foilTechnique === OrderFoilTechnique.UNSPECIFIED
          ? OrderFoilTechnique.FLAT
          : args.foilTechnique,
      hasLocalFoil: true,
    };
  }

  if (
    args.route === OrderItemPricingRoute.COLOR_PRINT &&
    actualFoilColorCount === 0
  ) {
    return {
      foilTechnique: OrderFoilTechnique.NONE,
      hasLocalFoil: false,
    };
  }

  if (
    args.route === OrderItemPricingRoute.CUSTOM_SINGLE_FLAT_FOIL &&
    (args.foilTechnique === OrderFoilTechnique.NONE ||
      args.foilTechnique === OrderFoilTechnique.UNSPECIFIED)
  ) {
    return {
      foilTechnique: OrderFoilTechnique.FLAT,
      hasLocalFoil: args.hasLocalFoil,
    };
  }

  return {
    foilTechnique: args.foilTechnique,
    hasLocalFoil: args.hasLocalFoil,
  };
}

export const ORDER_PRICING_ROUTE_LABELS: Record<
  OrderItemPricingRoute,
  string
> = {
  [OrderItemPricingRoute.STOCK_BLANK]: '局部烫金（通版现货）',
  [OrderItemPricingRoute.CUSTOM_SINGLE_FLAT_FOIL]: '专版烫金',
  [OrderItemPricingRoute.COLOR_PRINT]: '彩印',
  [OrderItemPricingRoute.MANUAL_QUOTE]: '待管理员终价',
};

export const STOCK_LOCAL_FOIL_CRAFT_CODE = 'FLAT_FOIL_PARTIAL';
export const LEGACY_STOCK_FOIL_CRAFT_CODE = 'STOCK_FOIL';

export type RequiredPricingCraftGroup = {
  label: string;
  anyOfCodes: readonly string[];
};

/**
 * Production-task invariants for each pricing route.
 *
 * Price rules may decide that an amount needs administrator confirmation,
 * but they must never be able to waive the production operation itself.
 */
export function requiredPricingCraftGroups(args: {
  route: OrderItemPricingRoute;
  foilColors: readonly string[];
  frontFoilColors?: readonly string[];
  backFoilColors?: readonly string[];
  isDoubleSided?: boolean;
  foilTechnique: OrderFoilTechnique;
}): RequiredPricingCraftGroup[] {
  const foilColorCount = orderItemFoilPassCount(args);

  switch (args.route) {
    case OrderItemPricingRoute.STOCK_BLANK:
      return [
        {
          label: '局部烫金',
          anyOfCodes: [
            STOCK_LOCAL_FOIL_CRAFT_CODE,
            LEGACY_STOCK_FOIL_CRAFT_CODE,
          ],
        },
      ];
    case OrderItemPricingRoute.CUSTOM_SINGLE_FLAT_FOIL:
      if (args.foilTechnique === OrderFoilTechnique.RELIEF) {
        return [{ label: '浮雕', anyOfCodes: ['EMBOSS'] }];
      }
      if (args.foilTechnique === OrderFoilTechnique.RAISED) {
        return [{ label: '激凸', anyOfCodes: ['BUMP'] }];
      }
      return [
        {
          label:
            foilColorCount >= 3
              ? '专版三色平烫'
              : foilColorCount === 2
                ? '专版双色平烫'
                : '专版单色平烫',
          anyOfCodes: [
            foilColorCount >= 3
              ? 'FLAT_FOIL_TRIPLE'
              : foilColorCount === 2
                ? 'FLAT_FOIL_DOUBLE'
                : 'FLAT_FOIL_SINGLE',
          ],
        },
      ];
    case OrderItemPricingRoute.COLOR_PRINT: {
      const groups: RequiredPricingCraftGroup[] = [
        foilColorCount > 0
          ? {
              label: '彩印+烫金',
              anyOfCodes: [
                'COATED_COLOR_PRINT_FOIL',
                'COLOR_PRINT_FOIL',
              ],
            }
          : {
              label: '彩印',
              anyOfCodes: ['COATED_COLOR_PRINT', 'COLOR_PRINT'],
            },
      ];
      if (args.foilTechnique === OrderFoilTechnique.RELIEF) {
        groups.push({ label: '浮雕', anyOfCodes: ['EMBOSS'] });
      }
      if (args.foilTechnique === OrderFoilTechnique.RAISED) {
        groups.push({ label: '激凸', anyOfCodes: ['BUMP'] });
      }
      return groups;
    }
    case OrderItemPricingRoute.MANUAL_QUOTE:
      return [];
  }
}

export type PricingCraftIdentity = {
  id: string;
  name: string;
  code?: string | null;
};

export function isLegacyStockFoilCraft(
  craft: Pick<PricingCraftIdentity, 'name' | 'code'>,
): boolean {
  return (
    craft.code === LEGACY_STOCK_FOIL_CRAFT_CODE ||
    (!craft.code && craft.name.trim() === '现货加烫')
  );
}

export function findCanonicalStockLocalFoilCraft<
  T extends PricingCraftIdentity,
>(crafts: readonly T[]): T | undefined {
  return (
    crafts.find((craft) => craft.code === STOCK_LOCAL_FOIL_CRAFT_CODE) ??
    crafts.find(
      (craft) =>
        !isLegacyStockFoilCraft(craft) && craft.name.trim() === '局部烫金',
    )
  );
}

export function normalizeCraftIdsForPricingRoute(
  route: OrderItemPricingRoute,
  craftIds: readonly string[],
  crafts: readonly PricingCraftIdentity[],
): string[] {
  const canonical = findCanonicalStockLocalFoilCraft(crafts);
  const usesStockLocalFoil = route === OrderItemPricingRoute.STOCK_BLANK;
  const legacyIds = new Set(
    crafts.filter(isLegacyStockFoilCraft).map((craft) => craft.id),
  );
  const normalized = craftIds.flatMap((id) => {
    if (legacyIds.has(id)) {
      return usesStockLocalFoil && canonical ? [canonical.id] : [];
    }
    if (!usesStockLocalFoil && canonical?.id === id) return [];
    return [id];
  });
  if (usesStockLocalFoil && canonical) {
    normalized.push(canonical.id);
  }
  return [...new Set(normalized)];
}

/** Treat the retired code as an alias at the price-rule boundary. */
export function canonicalizePricingCraftCodes(
  codes: readonly string[],
): string[] {
  return [
    ...new Set(
      codes.map((code) =>
        code === LEGACY_STOCK_FOIL_CRAFT_CODE
          ? STOCK_LOCAL_FOIL_CRAFT_CODE
          : code,
      ),
    ),
  ];
}
