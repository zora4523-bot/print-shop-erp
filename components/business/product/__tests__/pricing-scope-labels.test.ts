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
    const page = readFileSync(
      join(projectRoot, 'app/(admin)/owner/products/page.tsx'),
      'utf8',
    );

    expect(form).toContain('内部销售/工厂直单基础单价');
    expect(form).toContain('外部销售不读取此价格');
    expect(table).toContain('内部/直单基础单价');
    expect(page).toContain('外部销售必须使用独立、版本化的报价管理');
    expect(page).toContain('href="/owner/prices/external-sales/items"');
    expect(page).not.toContain('并随成交价进入外部销售加工费账单');
  });
});
