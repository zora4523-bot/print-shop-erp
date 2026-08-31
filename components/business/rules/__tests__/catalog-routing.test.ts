import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const ROOT = process.cwd();

const CANONICAL_RULE_ROUTES = [
  ['app/(admin)/owner/rules/papers/page.tsx', '/catalog/'],
  ['app/(admin)/owner/rules/papers/new/page.tsx', '/catalog/'],
  ['app/(admin)/owner/rules/papers/[id]/page.tsx', '/catalog/'],
  ['app/(admin)/owner/rules/stock-skus/page.tsx', '/catalog/'],
  ['app/(admin)/owner/rules/stock-skus/new/page.tsx', '/catalog/'],
  ['app/(admin)/owner/rules/stock-skus/[id]/page.tsx', '/catalog/'],
  ['app/(admin)/owner/rules/product-categories/page.tsx', '/catalog/'],
  ['app/(admin)/owner/rules/product-categories/new/page.tsx', '/catalog/'],
  ['app/(admin)/owner/rules/product-categories/[id]/page.tsx', '/catalog/'],
  ['app/(admin)/owner/rules/crafts/page.tsx', '/catalog/'],
  ['app/(admin)/owner/rules/crafts/new/page.tsx', '/catalog/'],
  ['app/(admin)/owner/rules/crafts/[id]/page.tsx', '/catalog/'],
  ['app/(admin)/owner/rules/customer-pricing/page.tsx', '/pricing/'],
  ['app/(admin)/owner/rules/price-versions/page.tsx', '/pricing/'],
  ['app/(admin)/owner/rules/internal-pricing/page.tsx', '/pricing/'],
  [
    'app/(admin)/owner/rules/internal-pricing/tiers/new/page.tsx',
    '/pricing/',
  ],
  [
    'app/(admin)/owner/rules/internal-pricing/tiers/[id]/page.tsx',
    '/pricing/',
  ],
  [
    'app/(admin)/owner/rules/internal-pricing/adjustments/new/page.tsx',
    '/pricing/',
  ],
  [
    'app/(admin)/owner/rules/internal-pricing/adjustments/[id]/page.tsx',
    '/pricing/',
  ],
  ['app/(admin)/owner/rules/worker-piecework/page.tsx', '/salary/'],
  ['app/(admin)/owner/rules/employee-pay/page.tsx', '/salary/'],
] as const;

describe('rule-center feature routing', () => {
  it('canonical routes depend on shared feature modules, never redirected legacy pages', () => {
    for (const [relativePath, featureArea] of CANONICAL_RULE_ROUTES) {
      const source = readFileSync(join(ROOT, relativePath), 'utf8');

      expect(source).toContain(
        `@/components/business/rules${featureArea}`,
      );
      expect(source).not.toContain('@/app/(admin)/owner/');
      expect(source).not.toMatch(/from ['"]\.\.\/.*(?:prices|salary)/);
    }
  });

  it('canonical pricing forms never link back to redirected legacy dictionaries', () => {
    for (const relativePath of [
      'components/business/price/PriceTierForm.tsx',
      'components/business/price/PriceAdjustmentForm.tsx',
      'components/business/price/PriceTables.tsx',
    ]) {
      const source = readFileSync(join(ROOT, relativePath), 'utf8');

      expect(source).not.toContain('/owner/products');
      expect(source).not.toContain('/owner/prices');
    }
  });

  it('canonical catalog pages use server actions with fixed business scope', () => {
    const materialCatalog = readFileSync(
      join(
        ROOT,
        'components/business/rules/catalog/MaterialCatalogPages.tsx',
      ),
      'utf8',
    );
    const productCatalog = readFileSync(
      join(
        ROOT,
        'components/business/rules/catalog/ProductCatalogPages.tsx',
      ),
      'utf8',
    );
    const craftCatalog = readFileSync(
      join(ROOT, 'components/business/rules/catalog/CraftCatalogPages.tsx'),
      'utf8',
    );

    expect(materialCatalog).toContain('createPaperAction');
    expect(materialCatalog).toContain('createNonPaperMaterialAction');
    expect(materialCatalog).toContain('updatePaperAction');
    expect(materialCatalog).toContain('setPaperActiveAction');
    expect(productCatalog).toContain('createQuoteProductAction');
    expect(productCatalog).toContain('updateQuoteProductAction');
    expect(productCatalog).toContain('setQuoteProductActiveAction');
    expect(craftCatalog).toContain('createRuleCenterCraftAction');
  });

  it('BOM creates products and categories through canonical rule-center editors', () => {
    const bomForm = readFileSync(
      join(ROOT, 'components/business/bom/BomForm.tsx'),
      'utf8',
    );

    expect(bomForm).toContain('RULE_CENTER_HREFS.stockSkus');
    expect(bomForm).toContain('RULE_CENTER_HREFS.productCategories');
    expect(bomForm).not.toContain('/owner/products/new');
    expect(bomForm).not.toContain('/owner/product-categories/new');
  });

  it('计价方式只陈述参与计价的结构化事实', () => {
    const pricingRoutes = readFileSync(
      join(ROOT, 'app/(admin)/owner/rules/pricing-routes/page.tsx'),
      'utf8',
    );

    expect(pricingRoutes).toContain('现货规格、数量、单双面。');
    expect(pricingRoutes).not.toContain('通版现货统一按局部烫金处理');
    expect(pricingRoutes).not.toContain('可选局部烫金');
    expect(pricingRoutes).not.toContain('现货加烫');
  });

  it('旧物料字典排除纸张，首页报价规格直达规则中心', () => {
    const materialsPage = readFileSync(
      join(ROOT, 'app/(admin)/owner/materials/page.tsx'),
      'utf8',
    );
    const newMaterialPage = readFileSync(
      join(ROOT, 'app/(admin)/owner/materials/new/page.tsx'),
      'utf8',
    );
    const materialDetailPage = readFileSync(
      join(ROOT, 'app/(admin)/owner/materials/[id]/page.tsx'),
      'utf8',
    );
    const ownerDashboard = readFileSync(
      join(ROOT, 'app/(admin)/owner/page.tsx'),
      'utf8',
    );

    expect(materialsPage).toContain('excludeCategory: MaterialCategory.PAPER');
    expect(newMaterialPage).toContain(
      'excludedCategories: [MaterialCategory.PAPER]',
    );
    expect(materialDetailPage).toContain(
      'redirectCategory: MaterialCategory.PAPER',
    );
    expect(materialDetailPage).toContain(
      'redirectBase: RULE_CENTER_HREFS.papers',
    );
    expect(ownerDashboard).toContain('href={RULE_CENTER_HREFS.stockSkus}');
    expect(ownerDashboard).not.toContain('href="/owner/products"');
  });
});
