import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import { MaterialsTable } from '@/components/business/material/MaterialsTable';
import { ProductsTable } from '@/components/business/product/ProductsTable';
import {
  MaterialCategory,
  ProductCategory,
} from '@/generated/prisma/enums';
import type { MaterialSummary } from '@/lib/material';
import type { ProductListRow } from '@/lib/product';

vi.mock('@/lib/material', () => ({
  MATERIAL_CATEGORY_LABELS: {
    PAPER: '纸张',
    FOIL: '烫金纸',
    BAG: '包装袋',
    FINISHED_STOCK: '成品库存',
    OTHER: '其他',
  },
}));
vi.mock('@/lib/product', () => ({
  isRetiredProductCategory: (category: {
    path: string;
    legacyCategory: ProductCategory;
  }) =>
    category.path === 'product.generic_stock' ||
    category.legacyCategory === ProductCategory.GENERIC_STOCK,
}));

describe('规则中心目录业务语言投影', () => {
  it('建单产品列表隐藏导入表坐标', () => {
    const products = [
      {
        id: 'product-1',
        code: 'PRD-1',
        category: ProductCategory.BLANK_STOCK,
        categoryNodeId: 'category-1',
        name: '大号信封（价格表!B6）',
        specification: '（价格表!B7）',
        paperType: '触感纸（烫金!B13）',
        baseUnitPrice: null,
        minOrderQty: null,
        isActive: true,
        categoryNode: {
          id: 'category-1',
          path: 'root.category-1',
          name: '（分类表!A4）',
          legacyCategory: ProductCategory.BLANK_STOCK,
          isActive: true,
        },
        referenceImpact: {
          orderCount: 0,
          bomCount: 0,
          currentExternalPriceRuleCount: 0,
        },
      },
    ] as unknown as ProductListRow[];

    const html = renderToStaticMarkup(<ProductsTable products={products} />);

    expect(html).toContain('大号信封');
    expect(html).toContain('未标注规格');
    expect(html).toContain('触感纸');
    expect(html).toContain('未命名分类');
    expect(html).not.toContain('价格表!');
    expect(html).not.toContain('烫金!B13');
    expect(html).not.toContain('分类表!A4');
  });

  it('建单产品列表只展示一次产品结构', () => {
    const products = [
      {
        id: 'product-duplicate-category',
        code: 'EXT-STOCK-1',
        category: ProductCategory.BLANK_STOCK,
        categoryNodeId: 'blank-stock',
        name: '现货大号',
        specification: '大号',
        paperType: '160g 触感纸',
        baseUnitPrice: null,
        minOrderQty: null,
        isActive: true,
        categoryNode: {
          id: 'blank-stock',
          path: 'root.blank-stock',
          name: '空白现货',
          legacyCategory: ProductCategory.BLANK_STOCK,
          isActive: true,
        },
        referenceImpact: {
          orderCount: 0,
          bomCount: 0,
          currentExternalPriceRuleCount: 0,
        },
      },
    ] as unknown as ProductListRow[];

    const html = renderToStaticMarkup(
      <ProductsTable products={products} categoryHeading="产品结构" />,
    );

    expect(html.match(/空白现货/g)).toHaveLength(1);
    expect(html).not.toContain('计价路线 / 产品结构');
  });

  it('可建单组合列表不混入旧单价与起订量', () => {
    const product = {
      id: 'product-internal-price',
      code: 'PRD-INTERNAL',
      category: ProductCategory.BLANK_STOCK,
      categoryNodeId: 'blank-stock',
      name: '现货大号',
      specification: '大号',
      paperType: '160g 艳闪',
      baseUnitPrice: '123.4567',
      minOrderQty: 500,
      isActive: true,
      categoryNode: {
        id: 'blank-stock',
        path: 'root.blank-stock',
        name: '空白现货',
        legacyCategory: ProductCategory.BLANK_STOCK,
        isActive: true,
      },
      referenceImpact: {
        orderCount: 0,
        bomCount: 0,
        currentExternalPriceRuleCount: 0,
      },
    } as unknown as ProductListRow;

    const html = renderToStaticMarkup(
      <ProductsTable products={[product]} />,
    );

    expect(html).not.toContain('内部/直单基础单价');
    expect(html).not.toContain('123.4567');
    expect(html).not.toContain('起订量');
    expect(html).not.toContain('>500<');
  });

  it('建单产品列表明确标记退役分类下的历史记录', () => {
    const product = {
      id: 'product-retired',
      code: 'PRD-RETIRED',
      category: ProductCategory.GENERIC_STOCK,
      categoryNodeId: 'generic-stock',
      name: '历史现货',
      specification: null,
      paperType: null,
      baseUnitPrice: null,
      minOrderQty: null,
      isActive: false,
      categoryNode: {
        id: 'generic-stock',
        path: 'product.generic_stock',
        name: '历史通用现货',
        legacyCategory: ProductCategory.GENERIC_STOCK,
        isActive: false,
      },
      referenceImpact: {
        orderCount: 1,
        bomCount: 0,
        currentExternalPriceRuleCount: 0,
      },
    } as unknown as ProductListRow;

    const html = renderToStaticMarkup(<ProductsTable products={[product]} />);

    expect(html).toContain('历史 / 已退役');
    expect(html).toContain('停用');
  });

  it('纸张列表隐藏导入表坐标', () => {
    const materials = [
      {
        id: 'material-1',
        code: 'MAT-1',
        name: '（烫金!B13）',
        category: MaterialCategory.PAPER,
        specification: '160g（纸张表!A4:C4）',
        unit: '张',
        currentStock: 0,
        safetyStock: null,
        averageCost: null,
        isActive: true,
      },
    ] as unknown as MaterialSummary[];

    const html = renderToStaticMarkup(
      <MaterialsTable
        materials={materials}
        editBase="/owner/rules/papers"
      />,
    );

    expect(html).toContain('未命名纸张');
    expect(html).toContain('160g');
    expect(html).not.toContain('烫金!B13');
    expect(html).not.toContain('纸张表!A4:C4');
  });
});
