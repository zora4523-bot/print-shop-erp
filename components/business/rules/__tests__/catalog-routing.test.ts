import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const ROOT = process.cwd();

const CANONICAL_RULE_ROUTES = [
  ['app/(admin)/owner/rules/papers/page.tsx', '/catalog/'],
  ['app/(admin)/owner/rules/papers/new/page.tsx', '/catalog/'],
  ['app/(admin)/owner/rules/papers/[id]/page.tsx', '/catalog/'],
  ['app/(admin)/owner/rules/product-categories/items/page.tsx', '/catalog/'],
  ['app/(admin)/owner/rules/product-categories/items/new/page.tsx', '/catalog/'],
  ['app/(admin)/owner/rules/product-categories/items/[id]/page.tsx', '/catalog/'],
  ['app/(admin)/owner/rules/product-categories/page.tsx', '/catalog/'],
  ['app/(admin)/owner/rules/product-categories/new/page.tsx', '/catalog/'],
  ['app/(admin)/owner/rules/product-categories/[id]/page.tsx', '/catalog/'],
  ['app/(admin)/owner/rules/crafts/page.tsx', '/catalog/'],
  ['app/(admin)/owner/rules/crafts/new/page.tsx', '/catalog/'],
  ['app/(admin)/owner/rules/crafts/[id]/page.tsx', '/catalog/'],
  ['app/(admin)/owner/rules/customer-pricing/page.tsx', '/pricing/'],
  ['app/(admin)/owner/rules/price-versions/page.tsx', '/pricing/'],
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
    const productToggle = readFileSync(
      join(ROOT, 'components/business/product/ToggleActiveButton.tsx'),
      'utf8',
    );

    // PLAN S1: paper creation now uses the name/weight-only canonical entry.
    expect(materialCatalog).toContain('createCatalogPaperAction');
    expect(materialCatalog).toContain('createNonPaperMaterialAction');
    expect(materialCatalog).toContain('updatePaperAction');
    expect(materialCatalog).toContain('setPaperActiveAction');
    expect(productCatalog).toContain('createQuoteProductAction');
    expect(productCatalog).toContain('updateQuoteProductAction');
    expect(productToggle).toContain('setQuoteProductActiveAction');
    expect(craftCatalog).toContain('createRuleCenterCraftAction');
  });

  it('纸张规则列表使用独立工作台，通用物料列表保留旧表格', () => {
    const materialCatalog = readFileSync(
      join(
        ROOT,
        'components/business/rules/catalog/MaterialCatalogPages.tsx',
      ),
      'utf8',
    );
    const paperWorkspace = readFileSync(
      join(
        ROOT,
        'components/business/rules/catalog/RulePaperWorkspace.tsx',
      ),
      'utf8',
    );

    expect(materialCatalog).toMatch(
      /paperOnly \? \(\s*<RulePaperWorkspace/,
    );
    expect(materialCatalog).toContain('<AdminListToolbar');
    expect(materialCatalog).toContain('<MaterialsTable');
    expect(paperWorkspace).not.toContain('AdminListToolbar');
    expect(paperWorkspace).not.toContain('AdminTableCard');
    expect(paperWorkspace).not.toContain('MaterialsTable');
  });

  it('其他路线产品资料保留规格工作台与资料表格', () => {
    const productCatalog = readFileSync(
      join(
        ROOT,
        'components/business/rules/catalog/ProductCatalogPages.tsx',
      ),
      'utf8',
    );
    const specWorkspace = readFileSync(
      join(
        ROOT,
        'components/business/rules/catalog/RuleSpecWorkspace.tsx',
      ),
      'utf8',
    );

    expect(productCatalog).toContain(
      'routeBase === RULE_CENTER_HREFS.productReferences',
    );
    expect(productCatalog).toContain("firstSearchParam(sp.section) === 'specs'");
    expect(productCatalog).toMatch(
      /specWorkspace \? \(\s*<RuleSpecWorkspace/,
    );
    expect(productCatalog).toContain('<AdminListToolbar');
    expect(productCatalog).toContain('<ProductsTable');
    expect(specWorkspace).not.toContain('AdminListToolbar');
    expect(specWorkspace).not.toContain('AdminTableCard');
    expect(specWorkspace).not.toContain('ProductsTable');
  });

  it('BOM creates products and categories through canonical rule-center editors', () => {
    const bomForm = readFileSync(
      join(ROOT, 'components/business/bom/BomForm.tsx'),
      'utf8',
    );

    expect(bomForm).not.toContain('RULE_CENTER_HREFS.stockSkus');
    expect(bomForm).toContain('RULE_CENTER_HREFS.productCategories');
    expect(bomForm).not.toContain('/owner/products/new');
    expect(bomForm).not.toContain('/owner/product-categories/new');
  });

  it('旧物料字典排除纸张，工作台移除低频规则配置入口', () => {
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
    expect(ownerDashboard).not.toContain('label="建单产品"');
    expect(ownerDashboard).not.toContain('href="/owner/products"');
  });
});
