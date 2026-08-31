import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const projectRoot = process.cwd();

describe('product pricing scope labels', () => {
  it('does not present the internal fallback price as an external-sales price', () => {
    const form = readFileSync(
      join(projectRoot, 'components/business/product/ProductForm.tsx'),
      'utf8',
    );
    const table = readFileSync(
      join(projectRoot, 'components/business/product/ProductsTable.tsx'),
      'utf8',
    );
    const catalogWorkspace = readFileSync(
      join(
        projectRoot,
        'components/business/rules/catalog/ProductCatalogPages.tsx',
      ),
      'utf8',
    );
    const ruleCenterRoutes = readFileSync(
      join(projectRoot, 'lib/navigation/rule-center.ts'),
      'utf8',
    );

    expect(form).toContain('内部销售/工厂直单基础单价');
    expect(table).toContain('内部/直单基础单价');
    expect(form).not.toContain('外部销售不读取此价格');
    expect(catalogWorkspace).not.toContain('此处基础单价仅供内部直单兼容使用');
    expect(catalogWorkspace).not.toContain('统一维护通版现货');
    expect(catalogWorkspace).toContain(
      "import { RULE_CENTER_HREFS } from '@/lib/navigation/rule-center'",
    );
    expect(catalogWorkspace).not.toContain(
      'href={RULE_CENTER_HREFS.customerPricing}',
    );
    expect(ruleCenterRoutes).toContain(
      "customerPricing: '/owner/rules/customer-pricing'",
    );
    expect(catalogWorkspace).not.toContain('/owner/prices/external-sales/items');
    expect(catalogWorkspace).not.toContain('并随成交价进入外部销售加工费账单');
  });
});
