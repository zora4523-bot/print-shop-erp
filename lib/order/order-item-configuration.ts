import type { CreateOrderInput } from '@/lib/auth/schemas';
import { isCoatedOrderPaper } from './order-item-material';
import {
  OrderItemPricingRoute,
  OrderProductStructure,
  OrderFoilTechnique,
  OrderLamination,
} from '@/generated/prisma/enums';
import {
  ORDER_PRICING_ROUTE_LABELS,
  normalizeCraftIdsForPricingRoute,
  requiredPricingCraftGroups,
  type PricingCraftIdentity,
} from '@/lib/order/pricing-route';
import {
  externalOrderPapersForRoute,
  externalOrderSpecificationsForRoute,
  externalOrderDefaultSpecification,
  externalOrderWeightOptionsForSelection,
  externalOrderAvailableSpecifications,
  externalOrderPaperFromType,
  externalOrderPaperType,
  externalOrderDimensions,
  externalOrderCatalogCandidates,
  externalOrderProductStructure,
  externalOrderStyleName,
  type ExternalOrderPaperMaterial,
  type ExternalOrderPaperKey,
  type ExternalOrderCatalogProduct,
} from '@/lib/order/order-item-catalog';

export function createBlankItem(
  crafts: readonly PricingCraftIdentity[],
): CreateOrderInput['items'][number] {
  return {
    fig: 1,
    name: '',
    productId: null,
    pricingRoute: OrderItemPricingRoute.STOCK_BLANK,
    productStructure: OrderProductStructure.UNSPECIFIED,
    artworkVersion: null,
    plateGroupId: null,
    pricingGroup: null,
    manualQuoteReason: null,
    specification: null,
    actualWidthMm: null,
    actualHeightMm: null,
    paperType: null,
    paperWeightGsm: null,
    quantity: 1000,
    pack: 10,
    crafts: normalizeCraftIdsForPricingRoute(
      OrderItemPricingRoute.STOCK_BLANK,
      [],
      crafts,
    ),
    frontFoilColors: ['哑金'],
    backFoilColors: [],
    foilColors: ['哑金'],
    foilTechnique: OrderFoilTechnique.FLAT,
    hasLocalFoil: true,
    printColors: [],
    lamination: OrderLamination.NONE,
    isDoubleSided: false,
    isDoubleColor: false,
    unitPrice: null,
    fixedFee: null,
    suggestedSubtotal: null,
    priceOverrideReason: null,
    remark: null,
  };
}

export function resolveExternalOrderCraftIds(
  item: CreateOrderInput['items'][number],
  crafts: readonly PricingCraftIdentity[],
): string[] {
  const groups = requiredPricingCraftGroups({
    route: item.pricingRoute,
    foilColors: item.foilColors,
    frontFoilColors: item.frontFoilColors,
    backFoilColors: item.backFoilColors,
    isDoubleSided: item.isDoubleSided,
    foilTechnique: item.foilTechnique,
  });
  const resolved = groups.flatMap((group) => {
    const craft = crafts.find(
      (candidate) =>
        candidate.code && group.anyOfCodes.includes(candidate.code),
    );
    return craft ? [craft.id] : [];
  });
  return normalizeCraftIdsForPricingRoute(item.pricingRoute, resolved, crafts);
}

export function normalizeExternalOrderItem(args: {
  item: CreateOrderInput['items'][number];
  crafts: readonly PricingCraftIdentity[];
  products: readonly ExternalOrderCatalogProduct[];
  paperMaterials?: readonly ExternalOrderPaperMaterial[];
  paperKey?: ExternalOrderPaperKey;
  resetPaper?: boolean;
  resetSpecification?: boolean;
  preserveCustomSize?: boolean;
}): CreateOrderInput['items'][number] {
  const route = args.item.pricingRoute;
  const routePapers = externalOrderPapersForRoute(
    args.products,
    route,
    args.paperMaterials,
  );
  const specifications = externalOrderSpecificationsForRoute(
    args.products,
    route,
  );
  const requestedSpecification = args.item.specification ?? '';
  let specification =
    !args.resetSpecification && specifications.includes(requestedSpecification)
      ? requestedSpecification
      : externalOrderDefaultSpecification(args.products, route) ||
        specifications[0] ||
        '';
  const availableRoutePapers = routePapers.filter((candidate) =>
    externalOrderWeightOptionsForSelection(
      candidate,
      route,
      specification,
    ).some((option) => !option.disabled),
  );
  const inferredPaper = externalOrderPaperFromType(
    args.products,
    args.item.paperType,
    args.paperMaterials,
  );
  const selectablePapers = route === OrderItemPricingRoute.STOCK_BLANK
    ? routePapers.filter((paper) => externalOrderAvailableSpecifications(paper, route).length > 0)
    : availableRoutePapers;
  const requestedPaper = args.paperKey
    ? selectablePapers.find((paper) => paper.key === args.paperKey)
    : undefined;
  if (args.paperKey && !requestedPaper && route === OrderItemPricingRoute.STOCK_BLANK) return args.item;
  const paper =
    requestedPaper ??
    (!args.resetPaper &&
    inferredPaper &&
    availableRoutePapers.some(
      (candidate) => candidate.key === inferredPaper.key,
    )
      ? inferredPaper
      : availableRoutePapers[0] ?? selectablePapers[0]);
  if (!paper) return args.item;
  if (route === OrderItemPricingRoute.STOCK_BLANK) {
    // Paper selection must remain reachable when papers offer disjoint sizes.
    // Keep the current size when sold; otherwise choose a sold size on this paper.
    const soldSpecifications = externalOrderAvailableSpecifications(paper, route);
    if (!soldSpecifications.includes(specification)) specification = soldSpecifications[0] ?? '';
  }

  const weightOptions = externalOrderWeightOptionsForSelection(
    paper,
    route,
    specification,
  );
  const enabledWeights = weightOptions
    .filter((option) => !option.disabled)
    .map((option) => option.value);
  const currentWeight = args.item.paperWeightGsm ?? enabledWeights[0] ?? null;
  const configuredCurrentWeight = weightOptions.find(
    (option) => option.value === currentWeight,
  );
  const weight =
    currentWeight !== null &&
    configuredCurrentWeight &&
    !configuredCurrentWeight.disabled
      ? currentWeight
      : (enabledWeights[0] ?? currentWeight);
  if (weight === null) return args.item;
  const paperType = externalOrderPaperType(paper, route, specification, weight);
  if (!paperType) return args.item;

  // Catalog names are the selectable identities, not display aliases.
  let frontFoilColors = [...new Set(args.item.frontFoilColors)];
  let backFoilColors = [...new Set(args.item.backFoilColors)];
  let foilTechnique = args.item.foilTechnique;
  let hasLocalFoil = args.item.hasLocalFoil;
  let printColors = [...args.item.printColors];
  let lamination = args.item.lamination;
  if (route === OrderItemPricingRoute.STOCK_BLANK) {
    frontFoilColors = frontFoilColors.slice(0, 3);
    backFoilColors = backFoilColors.slice(0, 3);
    foilTechnique = OrderFoilTechnique.FLAT;
    hasLocalFoil = true;
    printColors = [];
    lamination = OrderLamination.NONE;
  } else if (route === OrderItemPricingRoute.CUSTOM_SINGLE_FLAT_FOIL) {
    frontFoilColors = frontFoilColors.slice(0, 3);
    backFoilColors = [];
    foilTechnique =
      foilTechnique === OrderFoilTechnique.RELIEF ||
      foilTechnique === OrderFoilTechnique.RAISED
        ? foilTechnique
        : OrderFoilTechnique.FLAT;
    hasLocalFoil = false;
    printColors = [];
    lamination = OrderLamination.NONE;
  } else if (route === OrderItemPricingRoute.COLOR_PRINT) {
    frontFoilColors = frontFoilColors.slice(0, 1);
    backFoilColors = [];
    printColors = ['彩印'];
    if (frontFoilColors.length === 0) {
      foilTechnique = OrderFoilTechnique.NONE;
      hasLocalFoil = false;
    } else if (
      foilTechnique === OrderFoilTechnique.NONE ||
      foilTechnique === OrderFoilTechnique.UNSPECIFIED
    ) {
      foilTechnique = OrderFoilTechnique.FLAT;
    }
    lamination =
      isCoatedOrderPaper(paper.label)
        ? lamination === OrderLamination.NONE
          ? OrderLamination.MATTE
          : lamination
        : OrderLamination.NONE;
  }

  const foilColors = [...new Set([...frontFoilColors, ...backFoilColors])];
  const dimensions = externalOrderDimensions(specification);
  const candidates = externalOrderCatalogCandidates(
    args.products,
    route,
    paperType,
    specification,
  );
  const catalogProduct =
    candidates.find((product) => product.id === args.item.productId) ??
    (candidates.length === 1 ? candidates[0] : null);
  const routeLabel = ORDER_PRICING_ROUTE_LABELS[route];
  const next: CreateOrderInput['items'][number] = {
    ...args.item,
    name: externalOrderStyleName({
      routeLabel,
      paperLabel: paper.label,
      weight,
      specification,
    }),
    productId: route === OrderItemPricingRoute.STOCK_BLANK ? null : catalogProduct?.id ?? null,
    pricingRoute: route,
    productStructure: externalOrderProductStructure(specification),
    specification,
    actualWidthMm:
      args.preserveCustomSize && args.item.actualWidthMm === null
        ? null
        : (dimensions?.widthMm ?? null),
    actualHeightMm:
      args.preserveCustomSize && args.item.actualHeightMm === null
        ? null
        : (dimensions?.heightMm ?? null),
    paperType,
    paperWeightGsm: weight,
    frontFoilColors,
    backFoilColors,
    foilColors,
    foilTechnique,
    hasLocalFoil,
    lamination,
    printColors,
    isDoubleSided: backFoilColors.length > 0,
    isDoubleColor: frontFoilColors.length + backFoilColors.length > 1,
    manualQuoteReason: null,
    unitPrice: null,
    fixedFee: null,
    suggestedSubtotal: null,
    priceOverrideReason: null,
  };
  return { ...next, crafts: resolveExternalOrderCraftIds(next, args.crafts) };
}

export function createExternalOrderItem(
  crafts: readonly PricingCraftIdentity[],
  products: readonly ExternalOrderCatalogProduct[],
  paperMaterials: readonly ExternalOrderPaperMaterial[],
  defaultFoilColor?: string | null,
): CreateOrderInput['items'][number] {
  const blank = {
    ...createBlankItem(crafts),
    frontFoilColors: defaultFoilColor ? [defaultFoilColor] : [],
    foilColors: defaultFoilColor ? [defaultFoilColor] : [],
  };
  return normalizeExternalOrderItem({
    item: blank,
    crafts,
    products,
    paperMaterials,
    resetPaper: true,
    resetSpecification: true,
  });
}
