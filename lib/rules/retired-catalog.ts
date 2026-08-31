import { ProductCategory } from '../../generated/prisma/enums';

export const RETIRED_CRAFT_CODES = ['STOCK_FOIL'] as const;
const RETIRED_CRAFT_CODE_SET: ReadonlySet<string> = new Set(
  RETIRED_CRAFT_CODES,
);

const RETIRED_PRODUCT_CATEGORY_PATHS = [
  'product.generic_stock',
  'product.stock_foil_add',
  'product.byo_material',
] as const;

const RETIRED_PRODUCT_LEGACY_CATEGORIES: ReadonlySet<ProductCategory> = new Set([
  ProductCategory.GENERIC_STOCK,
  ProductCategory.STOCK_FOIL_ADD,
  ProductCategory.BYO_MATERIAL,
]);

export function isRetiredCraft(craft: { code: string }): boolean {
  return RETIRED_CRAFT_CODE_SET.has(craft.code);
}

export function isRetiredProductCategory(category: {
  path: string;
  legacyCategory: ProductCategory;
}): boolean {
  return (
    RETIRED_PRODUCT_CATEGORY_PATHS.some(
      (rootPath) =>
        category.path === rootPath || category.path.startsWith(`${rootPath}.`),
    ) || RETIRED_PRODUCT_LEGACY_CATEGORIES.has(category.legacyCategory)
  );
}
