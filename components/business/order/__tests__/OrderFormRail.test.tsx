import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import {
  OrderFormRail,
  sumServerQuoteAmounts,
  type OrderFormRailQuoteItem,
} from '../OrderFormRail';

const completeQuoteItems: OrderFormRailQuoteItem[] = [
  {
    key: 'style-1',
    label: '封套 A',
    status: 'complete',
    amount: '10.10',
    components: [{ label: '基础加工费', amount: '10.10' }],
  },
  {
    key: 'style-2',
    label: '封套 B',
    status: 'complete',
    amount: '20.20',
    components: [],
  },
];

describe('OrderFormRail', () => {
  it('only aggregates amounts already returned by the server', () => {
    expect(sumServerQuoteAmounts(['10.10', '20.20', '7.00'])).toBe(37.3);
    expect(sumServerQuoteAmounts(['10.105', '非金额', '0.005'])).toBe(10.12);
  });

  it('renders the authoritative per-style and logistics total on desktop and mobile', () => {
    const html = renderToStaticMarkup(
      <OrderFormRail
        itemCount={2}
        totalQuantity={2_000}
        settlementLabel="外部销售"
        quoteItems={completeQuoteItems}
        logistics={{
          status: 'complete',
          shippingAmount: '5.00',
          packagingAmount: '2.00',
          totalAmount: '7.00',
        }}
        usesExternalSalesPricing
        gaps={[]}
        onJump={vi.fn()}
      />,
    );

    expect(html).toContain('费用明细');
    expect(html).toContain('封套 A');
    expect(html).toContain('快递费');
    expect(html).toContain('纸箱费');
    expect(html).toContain('¥37.30');
    expect(html).toMatch(/<aside class="(?![^"]*\bhidden\b)/);
    expect(html).toContain('lg:sticky');
  });

  it('does not manufacture a total while any server quote is incomplete', () => {
    const html = renderToStaticMarkup(
      <OrderFormRail
        itemCount={1}
        totalQuantity={1_000}
        settlementLabel="外部销售"
        quoteItems={[
          {
            ...completeQuoteItems[0]!,
            status: 'incomplete',
            amount: null,
            message: '未命中当前价格规则',
          },
        ]}
        logistics={null}
        usesExternalSalesPricing
        gaps={[
          {
            id: 'style-name',
            step: 'items',
            itemIndex: 0,
            label: '款式 #1 未填名称',
            fieldId: 'items.0.name',
          },
        ]}
        onJump={vi.fn()}
      />,
    );

    expect(html).toContain('待管理员终价');
    expect(html).toContain('款式 #1 未填名称');
    expect(html).not.toContain('¥10.10');
  });
});
