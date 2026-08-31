import { Prisma, type ProductCategory } from '../../generated/prisma/client';
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

export type ExternalCreateOrderOptions = {
  products: readonly ExternalCreateOrderProductOption[];
  papers: readonly ExternalCreateOrderPaperOption[];
  specifications: readonly ExternalCreateOrderSpecificationOption[];
  foilColors: readonly ExternalCreateOrderFoilOption[];
};

export type ExternalCreateOrderOptionsReadClient =
  CreateOrderMaterialReadClient &
    CreateOrderProductReadClient &
    Pick<Prisma.TransactionClient, '$executeRaw'>;

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
  options: readonly { id: string; code: string | null }[],
): void {
  const ids = new Set<string>();
  const codes = new Set<string>();
  for (const option of options) {
    if (ids.has(option.id)) {
      throw new ExternalCreateOrderOptionsError(
        'DUPLICATE_ID',
        `${kind}配置存在重复 id：${option.id}`,
      );
    }
    ids.add(option.id);

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
  products: readonly ExternalCreateOrderProductOption[],
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
      configured.productIds.add(product.id);
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
  options: { snapshotLockHeld?: boolean } = {},
): Promise<ExternalCreateOrderOptions> {
  if (!options.snapshotLockHeld) {
    await acquirePriceRuleSnapshotReadLock(client);
  }

  const [products, papers, foilColors] = await Promise.all([
    listExternalCreateOrderProductOptions(client),
    listExternalCreateOrderPaperOptions(client),
    listExternalCreateOrderFoilOptions(client),
  ]);

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
