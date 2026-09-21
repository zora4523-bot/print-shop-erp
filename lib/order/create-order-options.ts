import { Prisma, ProductCategory } from '../../generated/prisma/client';
import { db } from '../db';
import {
  listExternalCreateOrderFoilOptions,
  listExternalCreateOrderPaperOptions,
  type CreateOrderMaterialReadClient,
  type ExternalCreateOrderFoilOption,
  type ExternalCreateOrderPaperOption,
} from '../material';
import {
  listExternalCreateOrderProductOptions,
  type CreateOrderProductReadClient,
  type ExternalCreateOrderProductOption,
} from '../product';
import { acquirePriceRuleSnapshotReadLock } from '../price/rule-snapshot-lock';
import {
  catalogPricingFactChoices,
  inferCatalogProductStructure,
  normalizeCatalogPricingText,
  parseCatalogDimensions,
} from './catalog-pricing-facts';
import Decimal from 'decimal.js';
import { BLANK_SPECIFICATIONS } from '../price/blank-paper';
import { blankPriceIdentity } from '../price/blank-price-identity';
import { catalogPaperPricingFacts } from './catalog-paper-identity';
import { isRetiredPaper } from '../rules/paper-availability';
import { readPublishedCreateOrderPriceSnapshot } from './create-order-published-rule-adapter';
import type { CreateOrderPriceSnapshot } from '../price/create-order/types';
import { canonicalizeCreateOrderSpecification } from '../price/create-order/canonical-facts';

export type ExternalCreateOrderSpecificationOption = {
  /** Deterministic identity derived from the configured specification label. */
  specCode: string;
  label: string;
  widthMm: number | null;
  heightMm: number | null;
  productStructure: ReturnType<typeof inferCatalogProductStructure>;
  productIds: readonly string[];
  productCategories: readonly ProductCategory[];
};

/** Catalog selection identity is distinct from an optional persisted Product FK. */
export type CreateOrderCatalogOption = Omit<ExternalCreateOrderProductOption, 'id'> & {
  id: string | null;
  selectionKey?: string;
  source?: 'BLANK_PRICE';
};

export type ExternalCreateOrderOptions = {
  products: readonly CreateOrderCatalogOption[];
  papers: readonly ExternalCreateOrderPaperOption[];
  specifications: readonly ExternalCreateOrderSpecificationOption[];
  foilColors: readonly ExternalCreateOrderFoilOption[];
};

export type ExternalCreateOrderOptionsReadClient =
  CreateOrderMaterialReadClient &
    CreateOrderProductReadClient &
    Pick<Prisma.TransactionClient, '$executeRaw' | 'customerPriceBook' | 'customerPriceRule'>;

export class ExternalCreateOrderOptionsError extends Error {
  constructor(
    readonly code:
      | 'DUPLICATE_ID'
      | 'DUPLICATE_CODE'
      | 'MISSING_REQUIRED_CONFIG',
    message: string,
  ) {
    super(message);
    this.name = 'ExternalCreateOrderOptionsError';
  }
}

function assertUniqueOptionIdentities(
  kind: string,
  options: readonly { id: string | null; selectionKey?: string; code: string | null }[],
): void {
  const ids = new Set<string>();
  const codes = new Set<string>();
  for (const option of options) {
    const key = option.selectionKey ?? option.id;
    if (!key || ids.has(key)) {
      throw new ExternalCreateOrderOptionsError(
        'DUPLICATE_ID',
        `${kind}配置存在重复 id：${option.id}`,
      );
    }
    ids.add(key);

    const code = option.code?.trim().toLocaleUpperCase('en-US');
    if (!code) continue;
    if (codes.has(code)) {
      throw new ExternalCreateOrderOptionsError(
        'DUPLICATE_CODE',
        `${kind}配置存在重复 code：${option.code}`,
      );
    }
    codes.add(code);
  }
}

function configuredSpecifications(
  products: readonly CreateOrderCatalogOption[],
): ExternalCreateOrderSpecificationOption[] {
  type MutableSpecification = {
    specCode: string;
    label: string;
    widthMm: number | null;
    heightMm: number | null;
    productStructure: ReturnType<typeof inferCatalogProductStructure>;
    productIds: Set<string>;
    productCategories: Set<ProductCategory>;
  };

  const byCode = new Map<string, MutableSpecification>();
  for (const product of products) {
    for (const label of catalogPricingFactChoices(product.specification)) {
      // A configured label must survive the same canonicalization used by the
      // authoritative quote adapter. Do not expose a browser option that the
      // server is guaranteed to reject (for example a leading dimension pair).
      if (!canonicalizeCreateOrderSpecification(label)) continue;
      const specCode = normalizeCatalogPricingText(label);
      if (!specCode) continue;
      const dimensions = parseCatalogDimensions(label);
      const configured =
        byCode.get(specCode) ??
        ({
          specCode,
          label: label.trim(),
          widthMm: dimensions?.widthMm ?? null,
          heightMm: dimensions?.heightMm ?? null,
          productStructure: inferCatalogProductStructure(label),
          productIds: new Set<string>(),
          productCategories: new Set<ProductCategory>(),
        } satisfies MutableSpecification);
      if (product.id) configured.productIds.add(product.id);
      configured.productCategories.add(product.category);
      byCode.set(specCode, configured);
    }
  }

  return [...byCode.values()]
    .sort((left, right) =>
      left.label.localeCompare(right.label, 'zh-CN', {
        numeric: true,
        sensitivity: 'base',
      }),
    )
    .map(({ productIds, productCategories, ...option }) => ({
      ...option,
      productIds: [...productIds],
      productCategories: [...productCategories],
    }));
}

/**
 * Read the C-form catalog from one transaction snapshot. The caller may set
 * `snapshotLockHeld` only after acquiring the shared pricing snapshot lock in
 * the same transaction (for example while also reading both price-book flows).
 */
export async function readExternalCreateOrderOptions(
  client: ExternalCreateOrderOptionsReadClient,
  options: { snapshotLockHeld?: boolean; now?: Date } = {},
): Promise<ExternalCreateOrderOptions> {
  if (!options.snapshotLockHeld) {
    await acquirePriceRuleSnapshotReadLock(client);
  }

  const [legacyProducts, papers, foilColors, prices, blankPaperIdentities] = await Promise.all([
    listExternalCreateOrderProductOptions(client),
    listExternalCreateOrderPaperOptions(client),
    listExternalCreateOrderFoilOptions(client),
    readPublishedCreateOrderPriceSnapshot(client, { now: options.now, snapshotLockHeld: true }),
    // Blank admission resolves against all PAPER records, including retired
    // identities. Keep its ambiguity boundary identical in the picker.
    client.material.findMany({ where: { category: 'PAPER' },
      select: { id: true, name: true, specification: true, isActive: true } }),
  ]);

  const products = [...legacyProducts.filter((product) => product.category !== ProductCategory.BLANK_STOCK),
    ...blankPriceCatalogOptions(prices, blankPaperIdentities)];

  if (foilColors.length === 0) {
    throw new ExternalCreateOrderOptionsError(
      'MISSING_REQUIRED_CONFIG',
      '烫金颜色配置为空：请先在物料主数据中配置并启用 FOIL 物料',
    );
  }

  assertUniqueOptionIdentities('产品', products);
  assertUniqueOptionIdentities('纸张', papers);
  assertUniqueOptionIdentities('烫金色', foilColors);

  return {
    products,
    papers,
    specifications: configuredSpecifications(products),
    foilColors,
  };
}

/** Standalone server entry point; composition code should use the reader above. */
export async function listExternalCreateOrderOptions(): Promise<ExternalCreateOrderOptions> {
  return db.$transaction((tx) => readExternalCreateOrderOptions(tx));
}

/** Positive published prices provide selections without allocating Product records. */
export function blankPriceCatalogOptions(
  snapshot: CreateOrderPriceSnapshot,
  papers: readonly { id: string; name: string; specification: string | null; isActive: boolean }[],
): CreateOrderCatalogOption[] {
  return snapshot.partial.blankUnitPrices.flatMap((price) => {
    const identity = blankPriceIdentity(price);
    if (!identity || price.unitPrice === null || !new Decimal(price.unitPrice).gt(0) ||
        isRetiredPaper({ weight: identity.paperWeightGsm })) return [];
    const matches = papers.filter((paper) => catalogPaperPricingFacts(paper).some((fact) =>
      fact.paperType === identity.paperType && fact.paperWeightGsm === identity.paperWeightGsm));
    if (matches.length !== 1 || !matches[0]!.isActive) return [];
    const paper = matches[0]!;
    const spec = BLANK_SPECIFICATIONS.find((candidate) => candidate.key === identity.specificationKey)!;
    return [{ id: null, selectionKey: `blank:${paper.id}:${spec.key}`, source: 'BLANK_PRICE' as const,
      code: null, name: `${identity.paperLabel} ${spec.label}`, category: ProductCategory.BLANK_STOCK,
      specification: spec.specification, paperType: identity.paperLabel,
      paperMaterialId: paper.id, weight: identity.paperWeightGsm }];
  });
}
