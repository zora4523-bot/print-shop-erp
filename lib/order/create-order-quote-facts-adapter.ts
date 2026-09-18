import Decimal from 'decimal.js';
import type { Prisma } from '../../generated/prisma/client';
import {
  MaterialCategory,
  OrderFoilTechnique,
  OrderItemPricingRoute,
  OrderLamination,
  OrderProductStructure,
  type OrderPackagingMode,
} from '../../generated/prisma/enums';
import {
  canonicalizeCreateOrderPaperFact,
  canonicalizeCreateOrderSpecification,
  type CanonicalCreateOrderPaperFact,
} from '../price/create-order/canonical-facts';
import type {
  CreateOrderConfigurationFacts,
  CreateOrderCraft,
  CreateOrderPricingGroup,
  CreateOrderPrintFoilMode,
  CreateOrderQuoteInput,
  CreateOrderQuoteItemInput,
  CreateOrderSpecialEffect,
} from '../price/create-order/types';
import {
  catalogPricingFactChoices,
  inferCatalogProductStructure,
  normalizeCatalogPricingText,
  parseCatalogDimensions,
  parseCatalogPaperWeight,
} from './catalog-pricing-facts';
import {
  ORDER_PRICING_ROUTE_LABELS,
  productCategoryMatchesPricingRoute,
  requiredPricingCraftGroups,
  resolveOrderItemFoilSides,
  type NewOrderPricingRoute,
} from './pricing-route';

type DecimalLike = number | string | { toString(): string };

/**
 * Facts accepted from either the validated create command or a persisted
 * draft. Browser-authored price/configuration flags are intentionally absent.
 */
export type LegacyCreateOrderQuoteItemFacts = {
  itemKey: string;
  fig: number;
  productId: string | null;
  pricingRoute: NewOrderPricingRoute;
  /** Compatibility fact only. The adapter derives and verifies this value. */
  productStructure?: OrderProductStructure | null;
  /** Compatibility fact only. The adapter derives and verifies this value. */
  pricingGroup?: string | null;
  specification: string | null;
  actualWidthMm: DecimalLike | null;
  actualHeightMm: DecimalLike | null;
  paperType: string | null;
  paperWeightGsm: number | null;
  quantity: number;
  crafts: readonly string[];
  foilColors?: readonly string[];
  frontFoilColors: readonly string[];
  backFoilColors: readonly string[];
  foilTechnique: OrderFoilTechnique;
  hasLocalFoil: boolean | null;
  lamination: OrderLamination;
  /** Internal-only configuration-outside note; external commands reject it. */
  manualQuoteReason?: string | null;
};

export type LegacyCreateOrderPackagingGroupFacts = {
  groupKey: string;
  mode: OrderPackagingMode;
  /**
   * Persisted membership and per-bag composition. Any old actualBagCount is
   * deliberately ignored; the pure engine derives the chargeable bag count.
   */
  items: readonly { itemKey: string; unitsPerBag: number | null }[];
  actualBagCount?: number | null;
};

export type LegacyCreateOrderShipmentFacts = {
  shipmentKey: string;
  province: string | null;
  itemQuantities: Readonly<Record<string, number>>;
  /** Compatibility/browser preview value; never enters the pricing input. */
  browserBillableWeightKg?: string | null;
  /** Explicitly trusted server-side fulfilment measurement, when available. */
  trustedFulfilmentWeightKg?: DecimalLike | null;
};

export type CreateOrderQuoteFactsAdapterInput = {
  items: readonly LegacyCreateOrderQuoteItemFacts[];
  packagingGroups: readonly LegacyCreateOrderPackagingGroupFacts[];
  isSfCollect: boolean;
  shipments: readonly LegacyCreateOrderShipmentFacts[];
};

export type CreateOrderQuoteFactsReadClient = Pick<
  Prisma.TransactionClient,
  'product' | 'craft' | 'material'
>;

export class CreateOrderQuoteFactsAdapterError extends Error {
  constructor(
    readonly code:
      | 'INVALID_ITEM_FACTS'
      | 'CATALOG_PRODUCT_CHANGED'
      | 'CATALOG_PRODUCT_MISMATCH'
      | 'CATALOG_CRAFT_CHANGED'
      | 'CATALOG_CRAFT_MISMATCH'
      | 'CATALOG_PAPER_CHANGED'
      | 'INVALID_PACKAGING_FACTS'
      | 'INVALID_SHIPMENT_FACTS',
    message: string,
  ) {
    super(message);
    this.name = 'CreateOrderQuoteFactsAdapterError';
  }
}

type CatalogProduct = {
  id: string;
  code: string | null;
  category: string;
  specification: string | null;
  paperType: string | null;
  paperMaterialId: string | null;
  weight: number | null;
  isActive: boolean;
};

type CatalogCraft = {
  id: string;
  code: string;
  isActive: boolean;
};

type CatalogPaper = {
  id: string;
  name: string;
  specification: string | null;
  outOfStock: boolean;
  isActive: boolean;
};

function fail(
  code: CreateOrderQuoteFactsAdapterError['code'],
  message: string,
): never {
  throw new CreateOrderQuoteFactsAdapterError(code, message);
}

function uniqueNonEmpty(values: readonly (string | null)[]): string[] {
  return [...new Set(values.flatMap((value) => (value?.trim() ? [value] : [])))];
}

function routeCraft(route: NewOrderPricingRoute): CreateOrderCraft {
  switch (route) {
    case OrderItemPricingRoute.STOCK_BLANK:
      return 'PARTIAL';
    case OrderItemPricingRoute.CUSTOM_SINGLE_FLAT_FOIL:
      return 'FULL';
    case OrderItemPricingRoute.COLOR_PRINT:
      return 'PRINT';
  }
}

function specialEffect(
  technique: OrderFoilTechnique,
): CreateOrderSpecialEffect {
  switch (technique) {
    case OrderFoilTechnique.RELIEF:
      return 'RELIEF';
    case OrderFoilTechnique.RAISED:
      return 'RAISED';
    case OrderFoilTechnique.FLAT:
    case OrderFoilTechnique.NONE:
    case OrderFoilTechnique.UNSPECIFIED:
      return 'NONE';
  }
}

function printFinishing(
  lamination: OrderLamination,
): CreateOrderQuoteItemInput['printFinishing'] {
  switch (lamination) {
    case OrderLamination.NONE:
      return undefined;
    case OrderLamination.MATTE:
      return 'MATTE';
    case OrderLamination.SOFT_TOUCH:
      return 'TACTILE';
    case OrderLamination.NEW_GLOSS:
      return 'GLOSS';
    case OrderLamination.LASER:
      return 'LASER';
  }
}

function printFoilMode(
  item: LegacyCreateOrderQuoteItemFacts,
  frontColors: readonly string[],
  backColors: readonly string[],
): CreateOrderPrintFoilMode {
  if (item.pricingRoute !== OrderItemPricingRoute.COLOR_PRINT) return 'NONE';
  if (frontColors.length + backColors.length === 0) return 'NONE';
  if (item.hasLocalFoil === true) return 'PARTIAL';
  if (item.hasLocalFoil === false) return 'FULL';
  return fail(
    'INVALID_ITEM_FACTS',
    `款式 ${item.itemKey} 的彩印加烫金未明确局部/专版口径`,
  );
}

function pricingGroup(
  specification: string,
  itemKey: string,
): CreateOrderPricingGroup {
  if (specification === '大号封' || specification === '西封大号') {
    return 'LARGE';
  }
  if (
    specification === '迷你封' ||
    specification === '方形封' ||
    specification === '中号封' ||
    specification === '西封中号' ||
    specification === '万元封'
  ) {
    return 'MID';
  }
  return fail(
    'INVALID_ITEM_FACTS',
    `款式 ${itemKey} 的规格不属于已定义计价组：${specification}`,
  );
}

function positiveDimension(
  value: DecimalLike | null,
  label: string,
  itemKey: string,
): number | null {
  if (value === null) return null;
  let parsed: Decimal;
  try {
    parsed = new Decimal(String(value));
  } catch {
    return fail('INVALID_ITEM_FACTS', `款式 ${itemKey} 的${label}无效`);
  }
  if (!parsed.isFinite() || !parsed.gt(0) || parsed.decimalPlaces() > 2) {
    return fail('INVALID_ITEM_FACTS', `款式 ${itemKey} 的${label}无效`);
  }
  return parsed.toNumber();
}

export function catalogPaperPricingFacts(paper: {
  name: string;
  specification: string | null;
}): CanonicalCreateOrderPaperFact[] {
  const configuredWeight =
    parseCatalogPaperWeight(paper.specification) ??
    parseCatalogPaperWeight(paper.name);
  if (configuredWeight === null) return [];
  const facts = [paper.name, paper.specification]
    .filter((value): value is string => Boolean(value?.trim()))
    .flatMap(catalogPricingFactChoices)
    .flatMap((choice) => {
      const fact = canonicalizeCreateOrderPaperFact(choice, configuredWeight);
      return fact ? [fact] : [];
    });
  const byIdentity = new Map(
    facts.map((fact) => [
      `${normalizeCatalogPricingText(fact.paperType)}:${fact.paperWeightGsm}`,
      fact,
    ]),
  );
  return [...byIdentity.values()];
}

function samePaperType(left: string, right: string): boolean {
  return normalizeCatalogPricingText(left) === normalizeCatalogPricingText(right);
}

function paperTypeWithoutRequiredWeight(label: string): string {
  const embeddedWeight = parseCatalogPaperWeight(label);
  return (
    canonicalizeCreateOrderPaperFact(label, embeddedWeight)?.paperType ??
    label.trim().replace(/^\d+\s*(?:g|克)\s*/iu, '')
  );
}

function productPaperFacts(product: CatalogProduct): CanonicalCreateOrderPaperFact[] {
  return catalogPricingFactChoices(product.paperType).flatMap((choice) => {
    const fact = canonicalizeCreateOrderPaperFact(choice, product.weight);
    return fact ? [fact] : [];
  });
}

function matchesPaperFamily(
  paper: CatalogPaper,
  fact: CanonicalCreateOrderPaperFact,
): boolean {
  return [paper.name, paper.specification]
    .filter((value): value is string => Boolean(value?.trim()))
    .flatMap(catalogPricingFactChoices)
    .some((label) =>
      samePaperType(paperTypeWithoutRequiredWeight(label), fact.paperType),
    );
}

function matchesPaperIdentity(
  paper: CatalogPaper,
  fact: CanonicalCreateOrderPaperFact,
): boolean {
  return catalogPaperPricingFacts(paper).some(
    (candidate) =>
      samePaperType(candidate.paperType, fact.paperType) &&
      candidate.paperWeightGsm === fact.paperWeightGsm,
  );
}

function resolvePaperFacts(args: {
  item: LegacyCreateOrderQuoteItemFacts;
  product: CatalogProduct | null;
  papers: readonly CatalogPaper[];
}): {
  paper: CanonicalCreateOrderPaperFact;
  configuration: Pick<CreateOrderConfigurationFacts, 'paper' | 'paperWeight'>;
} {
  const { item, product, papers } = args;
  const paperLabel = item.paperType?.trim();
  if (!paperLabel) {
    return fail('INVALID_ITEM_FACTS', `款式 ${item.itemKey} 缺少纸张`);
  }
  const submitted = canonicalizeCreateOrderPaperFact(
    paperLabel,
    item.paperWeightGsm,
  );
  if (!submitted) {
    return fail(
      'INVALID_ITEM_FACTS',
      `款式 ${item.itemKey} 的纸张名称与克重冲突或无法唯一解析`,
    );
  }

  const declaredByProduct = product ? productPaperFacts(product) : [];
  if (product?.paperType?.trim()) {
    const families = catalogPricingFactChoices(product.paperType).map(
      paperTypeWithoutRequiredWeight,
    );
    if (!families.some((family) => samePaperType(family, submitted.paperType))) {
      return fail(
        'CATALOG_PRODUCT_MISMATCH',
        `款式 ${item.itemKey} 的纸张与建单产品 ${product.code ?? product.id} 不一致`,
      );
    }
    if (
      declaredByProduct.length > 0 &&
      !declaredByProduct.some(
        (candidate) =>
          samePaperType(candidate.paperType, submitted.paperType) &&
          candidate.paperWeightGsm === submitted.paperWeightGsm,
      )
    ) {
      return fail(
        'CATALOG_PRODUCT_MISMATCH',
        `款式 ${item.itemKey} 的纸张克重与建单产品 ${product.code ?? product.id} 不一致`,
      );
    }
  }

  const linkedPaper = product?.paperMaterialId
    ? papers.find((paper) => paper.id === product.paperMaterialId)
    : null;
  if (product?.paperMaterialId && !linkedPaper) {
    return fail(
      'CATALOG_PAPER_CHANGED',
      `建单产品 ${product.code ?? product.id} 关联的纸张不存在`,
    );
  }
  if (linkedPaper && (!linkedPaper.isActive || linkedPaper.outOfStock)) {
    return fail(
      'CATALOG_PAPER_CHANGED',
      `建单产品 ${product?.code ?? product?.id} 关联的纸张已停用或缺货`,
    );
  }
  if (linkedPaper && !matchesPaperFamily(linkedPaper, submitted)) {
    return fail(
      'CATALOG_PRODUCT_MISMATCH',
      `款式 ${item.itemKey} 的纸张与产品关联纸张不一致`,
    );
  }
  const linkedPaperFacts = linkedPaper
    ? catalogPaperPricingFacts(linkedPaper)
    : [];
  if (
    linkedPaperFacts.length > 0 &&
    !linkedPaperFacts.some(
      (candidate) =>
        samePaperType(candidate.paperType, submitted.paperType) &&
        candidate.paperWeightGsm === submitted.paperWeightGsm,
    )
  ) {
    return fail(
      'CATALOG_PRODUCT_MISMATCH',
      `款式 ${item.itemKey} 的纸张克重与产品关联纸张不一致`,
    );
  }

  const activeMatchingPapers = papers.filter(
    (paper) =>
      paper.isActive &&
      !paper.outOfStock &&
      matchesPaperFamily(paper, submitted),
  );
  if (
    item.pricingRoute === OrderItemPricingRoute.CUSTOM_SINGLE_FLAT_FOIL &&
    !product?.paperMaterialId
  ) {
    const identityMatches = papers.filter((paper) =>
      matchesPaperIdentity(paper, submitted),
    );
    if (identityMatches.length !== 1) {
      return fail(
        'CATALOG_PAPER_CHANGED',
        `款式 ${item.itemKey} 的纸张目录身份不存在或不唯一，请重新选择`,
      );
    }
    const identityPaper = identityMatches[0]!;
    if (!identityPaper.isActive || identityPaper.outOfStock) {
      return fail(
        'CATALOG_PAPER_CHANGED',
        `款式 ${item.itemKey} 的纸张已停用或缺货`,
      );
    }
  }
  const catalogPaper = linkedPaper ?? activeMatchingPapers[0] ?? null;
  const catalogWeightFacts = activeMatchingPapers
    .flatMap(catalogPaperPricingFacts);
  const hasCatalogWeight =
    declaredByProduct.some(
      (candidate) =>
        samePaperType(candidate.paperType, submitted.paperType) &&
        candidate.paperWeightGsm === submitted.paperWeightGsm,
    ) ||
    catalogWeightFacts.some(
      (candidate) =>
        samePaperType(candidate.paperType, submitted.paperType) &&
        candidate.paperWeightGsm === submitted.paperWeightGsm,
    );

  return {
    paper: submitted,
    configuration: {
      paper: catalogPaper ? 'CATALOG' : 'CUSTOM',
      paperWeight: hasCatalogWeight ? 'CATALOG' : 'MANUAL',
    },
  };
}

function resolveSpecificationFacts(args: {
  item: LegacyCreateOrderQuoteItemFacts;
  product: CatalogProduct | null;
}): {
  specification: string;
  pricingGroup: CreateOrderPricingGroup;
  productStructure: OrderProductStructure;
  specificationConfiguration: CreateOrderConfigurationFacts['specification'];
} {
  const { item, product } = args;
  const submitted = canonicalizeCreateOrderSpecification(
    item.specification ?? '',
  );
  if (!submitted) {
    return fail('INVALID_ITEM_FACTS', `款式 ${item.itemKey} 的规格无法唯一解析`);
  }

  const productChoices = product
    ? catalogPricingFactChoices(product.specification)
    : [];
  const matchedProductChoice = productChoices.find(
    (choice) => canonicalizeCreateOrderSpecification(choice) === submitted,
  );
  if (productChoices.length > 0 && !matchedProductChoice) {
    return fail(
      'CATALOG_PRODUCT_MISMATCH',
      `款式 ${item.itemKey} 的规格与建单产品 ${product?.code ?? product?.id} 不一致`,
    );
  }

  const width = positiveDimension(item.actualWidthMm, '实际宽度', item.itemKey);
  const height = positiveDimension(item.actualHeightMm, '实际高度', item.itemKey);
  if ((width === null) !== (height === null)) {
    return fail(
      'INVALID_ITEM_FACTS',
      `款式 ${item.itemKey} 的实际宽高必须同时填写`,
    );
  }
  const catalogDimensions = parseCatalogDimensions(matchedProductChoice);
  const isResized =
    !matchedProductChoice ||
    (width !== null &&
      height !== null &&
      (!catalogDimensions ||
        width !== catalogDimensions.widthMm ||
        height !== catalogDimensions.heightMm));
  const structure = inferCatalogProductStructure(
    matchedProductChoice ?? item.specification,
  );
  const group = pricingGroup(submitted, item.itemKey);

  if (
    item.productStructure &&
    item.productStructure !== OrderProductStructure.UNSPECIFIED &&
    item.productStructure !== structure
  ) {
    return fail(
      'CATALOG_PRODUCT_MISMATCH',
      `款式 ${item.itemKey} 的产品结构与服务端产品规格不一致`,
    );
  }
  if (item.pricingGroup?.trim() && item.pricingGroup !== group) {
    return fail(
      'CATALOG_PRODUCT_MISMATCH',
      `款式 ${item.itemKey} 的计价组与服务端产品规格不一致`,
    );
  }

  return {
    specification: submitted,
    pricingGroup: group,
    productStructure: structure,
    specificationConfiguration: isResized ? 'RESIZED' : 'CATALOG',
  };
}

const REPRESENTED_CRAFT_CODES: Readonly<Record<CreateOrderCraft, ReadonlySet<string>>> = {
  PARTIAL: new Set(['FLAT_FOIL_PARTIAL', 'PACKING']),
  FULL: new Set([
    'FLAT_FOIL_SINGLE',
    'FLAT_FOIL_DOUBLE',
    'FLAT_FOIL_TRIPLE',
    'EMBOSS',
    'BUMP',
    'PACKING',
  ]),
  PRINT: new Set([
    'COATED_COLOR_PRINT',
    'COATED_COLOR_PRINT_FOIL',
    'COLOR_PRINT',
    'COLOR_PRINT_FOIL',
    'EMBOSS',
    'BUMP',
    'PACKING',
  ]),
};

function craftConfiguration(args: {
  item: LegacyCreateOrderQuoteItemFacts;
  crafts: readonly CatalogCraft[];
}): CreateOrderConfigurationFacts['craft'] {
  const { item, crafts } = args;
  const craftById = new Map(crafts.map((craft) => [craft.id, craft]));
  const selected = item.crafts.map((id) => craftById.get(id)!);
  const selectedCodes = selected.map((craft) => craft.code);
  const requiredGroups = requiredPricingCraftGroups({
    route: item.pricingRoute,
    foilColors: item.foilColors ?? [],
    frontFoilColors: item.frontFoilColors,
    backFoilColors: item.backFoilColors,
    foilTechnique: item.foilTechnique,
  });
  for (const group of requiredGroups) {
    if (!group.anyOfCodes.some((code) => selectedCodes.includes(code))) {
      return fail(
        'CATALOG_CRAFT_MISMATCH',
        `款式 ${item.itemKey} 的${ORDER_PRICING_ROUTE_LABELS[item.pricingRoute]}必须包含“${group.label}”工艺`,
      );
    }
  }
  const represented = REPRESENTED_CRAFT_CODES[routeCraft(item.pricingRoute)];
  return selectedCodes.every((code) => represented.has(code))
    ? 'CATALOG'
    : 'CUSTOM';
}

function assertPackagingFacts(
  groups: readonly LegacyCreateOrderPackagingGroupFacts[],
  itemKeys: ReadonlySet<string>,
): void {
  const groupKeys = new Set<string>();
  const groupedItems = new Set<string>();
  for (const group of groups) {
    const groupKey = group.groupKey.trim();
    if (!groupKey || groupKeys.has(groupKey)) {
      fail('INVALID_PACKAGING_FACTS', '包装组标识为空或重复');
    }
    groupKeys.add(groupKey);
    const withinGroup = new Set<string>();
    for (const line of group.items) {
      const itemKey = line.itemKey.trim();
      if (!itemKeys.has(itemKey)) {
        fail(
          'INVALID_PACKAGING_FACTS',
          `包装组 ${groupKey} 引用了未知款式 ${itemKey}`,
        );
      }
      if (withinGroup.has(itemKey)) {
        fail(
          'INVALID_PACKAGING_FACTS',
          `包装组 ${groupKey} 重复引用款式 ${itemKey}`,
        );
      }
      withinGroup.add(itemKey);
      if (groupedItems.has(itemKey)) {
        fail(
          'INVALID_PACKAGING_FACTS',
          `款式 ${itemKey} 只能归入一个包装组`,
        );
      }
      groupedItems.add(itemKey);
    }
  }
}

function trustedWeight(
  shipment: LegacyCreateOrderShipmentFacts,
  isSfCollect: boolean,
): string | null {
  if (isSfCollect || shipment.trustedFulfilmentWeightKg === null || shipment.trustedFulfilmentWeightKg === undefined) {
    return null;
  }
  let weight: Decimal;
  try {
    weight = new Decimal(String(shipment.trustedFulfilmentWeightKg));
  } catch {
    return fail(
      'INVALID_SHIPMENT_FACTS',
      `发货记录 ${shipment.shipmentKey} 的可信重量无效`,
    );
  }
  if (!weight.isFinite() || !weight.gt(0) || weight.decimalPlaces() > 3) {
    return fail(
      'INVALID_SHIPMENT_FACTS',
      `发货记录 ${shipment.shipmentKey} 的可信重量无效`,
    );
  }
  return weight.toString();
}

/**
 * Turn validated create/persisted facts into the only input accepted by the
 * pure pricing engine. Catalog reads and all authority decisions stay here;
 * the calculator remains deterministic and IO-free.
 */
export async function buildCreateOrderQuoteInputFromCatalog(
  client: CreateOrderQuoteFactsReadClient,
  input: CreateOrderQuoteFactsAdapterInput,
): Promise<CreateOrderQuoteInput> {
  const itemKeys = input.items.map((item) => item.itemKey.trim());
  if (
    itemKeys.some((key) => !key) ||
    new Set(itemKeys).size !== itemKeys.length
  ) {
    return fail('INVALID_ITEM_FACTS', '款式标识为空或重复');
  }
  const figs = input.items.map((item) => item.fig);
  if (
    figs.some((fig) => !Number.isSafeInteger(fig) || fig < 1) ||
    new Set(figs).size !== figs.length
  ) {
    return fail('INVALID_ITEM_FACTS', '款式 fig 无效或重复');
  }

  for (const item of input.items) {
    if (item.manualQuoteReason != null && !item.manualQuoteReason.trim()) {
      fail(
        'INVALID_ITEM_FACTS',
        `款式 ${item.itemKey} 的配置外项目说明不能为空`,
      );
    }
  }

  const automaticallyPricedItems = input.items.filter(
    (item) => !item.manualQuoteReason?.trim(),
  );

  const productIds = uniqueNonEmpty(
    automaticallyPricedItems.map((item) => item.productId),
  );
  const craftIds = uniqueNonEmpty(
    automaticallyPricedItems.flatMap((item) => item.crafts),
  );
  const [products, crafts, papers] = await Promise.all([
    productIds.length === 0
      ? Promise.resolve([])
      : client.product.findMany({
          where: { id: { in: productIds } },
          select: {
            id: true,
            code: true,
            category: true,
            specification: true,
            paperType: true,
            paperMaterialId: true,
            weight: true,
            isActive: true,
          },
        }),
    craftIds.length === 0
      ? Promise.resolve([])
      : client.craft.findMany({
          where: { id: { in: craftIds } },
          select: { id: true, code: true, isActive: true },
        }),
    automaticallyPricedItems.length === 0
      ? Promise.resolve([])
      : client.material.findMany({
          where: { category: MaterialCategory.PAPER },
          select: {
            id: true,
            name: true,
            specification: true,
            outOfStock: true,
            isActive: true,
          },
        }),
  ]);
  const productRows = products as CatalogProduct[];
  const craftRows = crafts as CatalogCraft[];
  const paperRows = papers as CatalogPaper[];
  const productById = new Map(
    productRows.map((product) => [product.id, product]),
  );
  const craftById = new Map(craftRows.map((craft) => [craft.id, craft]));

  for (const productId of productIds) {
    const product = productById.get(productId);
    if (!product?.isActive) {
      fail(
        'CATALOG_PRODUCT_CHANGED',
        `建单产品不存在或已停用：${productId}`,
      );
    }
  }
  for (const craftId of craftIds) {
    const craft = craftById.get(craftId);
    if (!craft?.isActive) {
      fail('CATALOG_CRAFT_CHANGED', `工艺不存在或已停用：${craftId}`);
    }
  }

  const normalizedItems: CreateOrderQuoteItemInput[] = input.items.map(
    (item) => {
      const manualPricingReason = item.manualQuoteReason?.trim();
      if (manualPricingReason) {
        const foilSides = resolveOrderItemFoilSides(item);
        return {
          itemKey: item.itemKey.trim(),
          fig: item.fig,
          craft: routeCraft(item.pricingRoute),
          paperType: item.paperType?.trim() || '配置外纸张',
          paperWeightGsm: item.paperWeightGsm,
          specification: item.specification?.trim() || '配置外规格',
          pricingGroup: item.pricingGroup === 'LARGE' ? 'LARGE' : 'MID',
          productStructure:
            item.productStructure ?? OrderProductStructure.UNSPECIFIED,
          quantity: item.quantity,
          frontColors: foilSides.frontFoilColors,
          backColors: foilSides.backFoilColors,
          manualPricingReason,
          configuration: {
            paper: 'CUSTOM',
            paperWeight: 'MANUAL',
            specification: 'RESIZED',
            craft: 'CUSTOM',
          },
          specialEffect: specialEffect(item.foilTechnique),
          printFoilMode: 'NONE',
          printFinishing: undefined,
        };
      }
      const product = item.productId
        ? (productById.get(item.productId) ?? null)
        : null;
      if (
        product &&
        !productCategoryMatchesPricingRoute(item.pricingRoute, product.category)
      ) {
        return fail(
          'CATALOG_PRODUCT_MISMATCH',
          `建单产品“${product.code ?? product.id}”的分类与计价路线“${ORDER_PRICING_ROUTE_LABELS[item.pricingRoute]}”不一致`,
        );
      }
      const foilSides = resolveOrderItemFoilSides(item);
      const paper = resolvePaperFacts({ item, product, papers: paperRows });
      const specification = resolveSpecificationFacts({ item, product });
      const craft = routeCraft(item.pricingRoute);
      const configuration: CreateOrderConfigurationFacts = {
        ...paper.configuration,
        specification: specification.specificationConfiguration,
        craft: craftConfiguration({ item, crafts: craftRows }),
      };
      return {
        itemKey: item.itemKey.trim(),
        fig: item.fig,
        craft,
        paperType: paper.paper.paperType,
        paperWeightGsm: paper.paper.paperWeightGsm,
        specification: specification.specification,
        pricingGroup: specification.pricingGroup,
        productStructure: specification.productStructure,
        quantity: item.quantity,
        frontColors: foilSides.frontFoilColors,
        backColors: foilSides.backFoilColors,
        configuration,
        specialEffect: specialEffect(item.foilTechnique),
        printFoilMode: printFoilMode(
          item,
          foilSides.frontFoilColors,
          foilSides.backFoilColors,
        ),
        printFinishing:
          item.pricingRoute === OrderItemPricingRoute.COLOR_PRINT
            ? printFinishing(item.lamination)
            : undefined,
      };
    },
  );

  const knownItemKeys = new Set(itemKeys);
  assertPackagingFacts(input.packagingGroups, knownItemKeys);
  const shipmentKeys = new Set<string>();
  const shipments = input.shipments.map((shipment) => {
    const shipmentKey = shipment.shipmentKey.trim();
    if (!shipmentKey || shipmentKeys.has(shipmentKey)) {
      return fail(
        'INVALID_SHIPMENT_FACTS',
        '发货记录标识为空或重复',
      );
    }
    shipmentKeys.add(shipmentKey);
    for (const [itemKey, quantity] of Object.entries(shipment.itemQuantities)) {
      if (!knownItemKeys.has(itemKey)) {
        return fail(
          'INVALID_SHIPMENT_FACTS',
          `发货记录 ${shipmentKey} 引用了未知款式 ${itemKey}`,
        );
      }
      if (!Number.isSafeInteger(quantity) || quantity < 0) {
        return fail(
          'INVALID_SHIPMENT_FACTS',
          `发货记录 ${shipmentKey} 的 ${itemKey} 分配数量无效`,
        );
      }
    }
    return {
      shipmentKey,
      province: shipment.province?.trim() || null,
      trustedBillableWeightKg: trustedWeight(shipment, input.isSfCollect),
      itemQuantities: Object.fromEntries(
        itemKeys.map((itemKey) => [
          itemKey,
          shipment.itemQuantities[itemKey] ?? 0,
        ]),
      ),
    };
  });

  return {
    items: normalizedItems,
    packagingGroups: input.packagingGroups.map((group) => ({
      groupKey: group.groupKey.trim(),
      mode: group.mode,
      items: group.items.map((line) => ({
        itemKey: line.itemKey.trim(),
        unitsPerBag: line.unitsPerBag,
      })),
    })),
    isSfCollect: input.isSfCollect,
    shipments,
  };
}
