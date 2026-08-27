import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const projectRoot = process.cwd();

function source(path: string): string {
  return readFileSync(join(projectRoot, path), 'utf8');
}

describe('UI 只陈述事实和后果', () => {
  it('在 UI 规范中固化文案边界', () => {
    const uiSystem = source('UI-SYSTEM.md');

    expect(uiSystem).toContain('### 界面文案只陈述事实和后果');
    expect(uiSystem).toContain('同一事实在同一区域只展示一次');
    expect(uiSystem).toContain('错误、警告和高风险确认');
  });

  it('报价 SKU 不恢复重复分类和概念说明', () => {
    const catalog = source(
      'components/business/rules/catalog/ProductCatalogPages.tsx',
    );
    const table = source('components/business/product/ProductsTable.tsx');

    expect(catalog).not.toContain('统一维护通版现货');
    expect(catalog).not.toContain('类别用于识别三条计价路线');
    expect(catalog).not.toContain('此处基础单价仅供内部直单兼容使用');
    expect(table).not.toContain('PRODUCT_CATEGORY_LABELS');
    expect(table).not.toContain('routeLabel');
  });

  it('收费项目不恢复泛化类目和重复状态说明', () => {
    const workspace = source(
      'components/business/price/ExternalSalesChargeWorkspace.tsx',
    );

    expect(workspace).not.toContain('（使用时展开）');
    expect(workspace).not.toContain('group.categoryLabel');
    expect(workspace).not.toContain('当前价格正在用于工单计价');
    expect(workspace).not.toContain('已有一轮价格等待生效');
  });
});
