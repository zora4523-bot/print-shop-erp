import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import { BomForm } from '@/components/business/bom/BomForm';
import { BomsTable } from '@/components/business/bom/BomsTable';
import { OrderMaterialUsageEstimate } from '@/components/business/bom/OrderMaterialUsageEstimate';
import { PurchaseOrderForm } from '@/components/business/purchase/PurchaseOrderForm';

describe('业务路径的导入来源标识隔离', () => {
  it('BOM 选择器只显示产品、分类和物料的业务名称', () => {
    const html = renderToStaticMarkup(
      <BomForm
        action={vi.fn() as never}
        products={[
          {
            id: 'product-1',
            code: 'PRD-1',
            name: '现货大号（产品表!C2）',
            categoryName: '通版现货（分类表!A4）',
          },
        ]}
        categories={[]}
        materials={[
          {
            id: 'material-1',
            code: 'MAT-1',
            name: '纸张未标（烫金!B13）',
            unit: '张',
          },
        ]}
      />,
    );

    expect(html).toContain('现货大号');
    expect(html).toContain('通版现货');
    expect(html).toContain('纸张未标');
    expect(html).not.toMatch(/产品表!C2|分类表!A4|烫金!B13/);
  });

  it('BOM 列表与用量估算不泄漏来源坐标', () => {
    const tableHtml = renderToStaticMarkup(
      <BomsTable
        boms={[
          {
            id: 'bom-1',
            name: '大号 BOM（A4:C4）',
            version: 1,
            baseQuantity: 1,
            isActive: true,
            product: {
              code: 'PRD-1',
              name: '现货大号（产品表!C2）',
            },
            categoryNode: null,
            _count: { items: 1 },
          },
        ] as never}
        categoryLabelById={{}}
      />,
    );
    const estimateHtml = renderToStaticMarkup(
      <OrderMaterialUsageEstimate
        estimate={{
          items: [
            {
              orderItemId: 'item-1',
              sequence: 1,
              itemName: '现货大号（产品表!C2）',
              quantity: 2_000,
              source: 'PRODUCT',
              bom: { name: '大号 BOM（A4:C4）', version: 1, baseQuantity: 1 },
              materials: [
                {
                  materialId: 'material-1',
                  code: 'MAT-1',
                  name: '纸张未标（烫金!B13）',
                  quantity: '2000',
                  unit: '张',
                },
              ],
            },
          ],
          totals: [
            {
              materialId: 'material-1',
              code: 'MAT-1',
              name: '纸张未标（烫金!B13）',
              quantity: '2000',
              unit: '张',
            },
          ],
        } as never}
      />,
    );

    expect(`${tableHtml}${estimateHtml}`).not.toMatch(
      /A4:C4|产品表!C2|烫金!B13/,
    );
  });

  it('采购物料选项保留 ID 值但不显示来源坐标', () => {
    const html = renderToStaticMarkup(
      <PurchaseOrderForm
        action={vi.fn() as never}
        suppliers={[
          {
            id: 'supplier-1',
            code: 'SUP-1',
            name: '供应商',
            shortName: null,
          },
        ] as never}
        materials={[
          {
            id: 'material-1',
            code: 'MAT-1',
            name: '纸张未标（烫金!B13）',
            unit: '张',
          },
        ]}
      />,
    );

    expect(html).toContain('value="material-1"');
    expect(html).toContain('纸张未标');
    expect(html).not.toContain('烫金!B13');
  });
});
