import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { RuleSpecWorkspace } from '@/components/business/rules/catalog/RuleSpecWorkspace';
import { ProductCategory } from '@/generated/prisma/enums';
import type { ProductListRow } from '@/lib/product';

const products = [
  {
    id: 'sku-active',
    code: 'SKU-LARGE',
    category: ProductCategory.BLANK_STOCK,
    categoryNodeId: 'blank-stock',
    name: '大号信封（价格表!B6）',
    specification: '230 × 120 mm（规格表!A4）',
    paperType: '160g 触感纸（纸张表!B4）',
    baseUnitPrice: null,
    minOrderQty: 100,
    isActive: true,
    categoryNode: {
      id: 'blank-stock',
      path: 'product.blank_stock',
      name: '空白现货',
      legacyCategory: ProductCategory.BLANK_STOCK,
      isActive: true,
    },
    referenceImpact: {
      orderCount: 0,
      bomCount: 0,
      currentExternalPriceRuleCount: 0,
      currentInternalPriceTierCount: 0,
    },
  },
  {
    id: 'sku-inactive',
    code: 'SKU-SMALL',
    category: ProductCategory.CUSTOM_FLAT_FOIL,
    categoryNodeId: 'custom-flat-foil',
    name: '小号定制款',
    specification: null,
    paperType: null,
    baseUnitPrice: null,
    minOrderQty: null,
    isActive: false,
    categoryNode: {
      id: 'custom-flat-foil',
      path: 'product.custom_flat_foil',
      name: '定制平烫',
      legacyCategory: ProductCategory.CUSTOM_FLAT_FOIL,
      isActive: true,
    },
    referenceImpact: {
      orderCount: 0,
      bomCount: 0,
      currentExternalPriceRuleCount: 0,
      currentInternalPriceTierCount: 0,
    },
  },
] as unknown as ProductListRow[];

function renderWorkspace() {
  return renderToStaticMarkup(
    <RuleSpecWorkspace
      products={products}
      routeBase="/owner/rules/stock-skus"
      query="信封"
      status="all"
      hiddenSearchParams={{
        section: 'specs',
        pageSize: 10,
        status: 'all',
      }}
      pagination={{
        page: 2,
        pageCount: 3,
        total: 22,
        pageSize: 10,
        queryParams: {
          q: '信封',
          page: 2,
          pageSize: 10,
          status: 'all',
          section: 'specs',
        },
      }}
    />,
  );
}

describe('RuleSpecWorkspace', () => {
  it('只展示真实 SKU 规格事实和建单可选状态', () => {
    const html = renderWorkspace();

    expect(html).toContain('大号信封');
    expect(html).toContain('SKU-LARGE');
    expect(html).toContain('230 × 120 mm');
    expect(html).toContain('160g 触感纸');
    expect(html).toContain('空白现货');
    expect(html).toContain('100');
    expect(html).toContain('建单可选');
    expect(html).toContain('停止新单选用');
    expect(html).toContain('未标注规格');
    expect(html).toContain('未标注纸张');
    expect(html).not.toContain('价格表!B6');
    expect(html).not.toContain('规格表!A4');
    expect(html).not.toContain('纸张表!B4');
  });

  it('明确烫金颜色无独立主数据，不伪造色库或开关', () => {
    const html = renderWorkspace();

    expect(html).toContain('当前随工单事实维护');
    expect(html).toContain('暂无独立主数据');
    expect(html).toContain('此处不生成颜色列表或编辑开关');
    expect(html).not.toContain('亚金');
    expect(html).not.toContain('浅金');
    expect(html).not.toContain('type="checkbox"');
    expect(html).not.toContain('<table');
  });

  it('保留分区搜索、状态、翻页和真实编辑入口', () => {
    const html = renderWorkspace();

    expect(html).toContain('action="/owner/rules/stock-skus"');
    expect(html).toContain('name="section" value="specs"');
    expect(html).toContain('name="pageSize" value="10"');
    expect(html).toContain('name="status" value="all"');
    expect(html).toContain('/owner/rules/stock-skus/sku-active');
    expect(html).toContain('/owner/rules/stock-skus/sku-inactive');
    expect(html).toContain('page=1');
    expect(html).toContain('page=3');
    expect(html).toContain('section=specs');
  });
});
