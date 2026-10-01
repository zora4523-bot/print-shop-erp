import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { RuleSpecWorkspace } from '@/components/business/rules/catalog/RuleSpecWorkspace';
import { ProductCategory } from '@/generated/prisma/enums';
import type { ProductListRow } from '@/lib/product';

const products = [
  {
    id: 'sku-active',
    code: 'SKU-LARGE',
    category: ProductCategory.CUSTOM_FLAT_FOIL,
    categoryNodeId: 'custom-flat-foil',
    name: '大号信封（价格表!B6）',
    specification: '230 × 120 mm（规格表!A4）',
    paperType: '160g 触感纸（纸张表!B4）',
    baseUnitPrice: null,
    minOrderQty: 100,
    isActive: true,
    categoryNode: {
      id: 'custom-flat-foil',
      path: 'product.custom_flat_foil',
      name: '专版烫金',
      legacyCategory: ProductCategory.CUSTOM_FLAT_FOIL,
      isActive: true,
    },
    referenceImpact: {
      orderCount: 0,
      bomCount: 0,
      currentExternalPriceRuleCount: 0,
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
    },
  },
] as unknown as ProductListRow[];

function renderWorkspace() {
  return renderToStaticMarkup(
    <RuleSpecWorkspace
      products={products}
      routeBase="/owner/rules/product-categories/items"
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
  it('只展示非空白封产品资料和建单可选状态', () => {
    const html = renderWorkspace();

    expect(html).toContain('大号信封');
    expect(html).toContain('SKU-LARGE');
    expect(html).toContain('230 × 120 mm');
    expect(html).toContain('160g 触感纸');
    expect(html).toContain('专版烫金');
    expect(html).not.toContain('起订量');
    expect(html).toContain('建单可选');
    expect(html).toContain('停止新单选用');
    expect(html).toContain('未标注规格');
    expect(html).toContain('未标注纸张');
    expect(html).not.toContain('价格表!B6');
    expect(html).not.toContain('规格表!A4');
    expect(html).not.toContain('纸张表!B4');
    expect(html).toContain('专版和彩印的规格与纸张资料');
    expect(html).not.toContain('可建单组合');
    expect(html).not.toContain('空白封适用规格在纸张页管理');
  });

  it('不渲染没有实际记录的烫金色库区块，也不伪造开关', () => {
    const html = renderWorkspace();

    expect(html).not.toContain('当前随工单事实维护');
    expect(html).not.toContain('暂无独立主数据');
    expect(html).not.toContain('此处不生成颜色列表或编辑开关');
    expect(html).not.toContain('亚金');
    expect(html).not.toContain('浅金');
    expect(html).not.toContain('type="checkbox"');
    expect(html).not.toContain('<table');
  });

  it('保留分区搜索、状态、翻页和真实编辑入口', () => {
    const html = renderWorkspace();

    expect(html).toContain('action="/owner/rules/product-categories/items"');
    expect(html).toContain('name="section" value="specs"');
    expect(html).toContain('name="pageSize" value="10"');
    expect(html).toContain('name="status" value="all"');
    expect(html).toContain('/owner/rules/product-categories/items/sku-active');
    expect(html).toContain('/owner/rules/product-categories/items/sku-inactive');
    expect(html).toContain('page=1');
    expect(html).toContain('page=3');
    expect(html).toContain('section=specs');
  });
});
