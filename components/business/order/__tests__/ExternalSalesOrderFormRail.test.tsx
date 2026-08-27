import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import {
  ExternalSalesOrderFormRail,
  externalSalesOrderFormTotal,
} from '../ExternalSalesOrderFormRail';

const quoteItems = [
  {
    key: 'style-1',
    label: '局部烫金 · 大号封',
    status: 'complete' as const,
    amount: '170.00',
    components: [
      { label: '空白封', amount: '130.00' },
      { label: '局部烫金', amount: '40.00' },
    ],
  },
];

describe('ExternalSalesOrderFormRail', () => {
  it('shows the known subtotal while shipping is still pending', () => {
    const logistics = {
      status: 'missing' as const,
      shippingAmount: null,
      packagingAmount: '3.00',
      totalAmount: null,
      message: '未填地址',
    };
    expect(
      externalSalesOrderFormTotal({
        quoteItems,
        packaging: { status: 'complete', amount: '10.00' },
        logistics,
      }),
    ).toBe(183);

    const html = renderToStaticMarkup(
      <ExternalSalesOrderFormRail
        itemCount={1}
        quoteItems={quoteItems}
        packaging={{ status: 'complete', amount: '10.00' }}
        logistics={logistics}
        busy={false}
        onAttemptSubmit={vi.fn()}
      />,
    );

    expect(html).toContain('¥183.00');
    expect(html).toContain('纸箱耗材');
    expect(html).toContain('¥3.00');
    expect(html).toContain('不含制版费与快递费');
    expect(html).not.toContain('这张单需要管理员终价');
  });

  it('does not repeat a completed style total above its fee lines', () => {
    const html = renderToStaticMarkup(
      <ExternalSalesOrderFormRail
        itemCount={1}
        quoteItems={quoteItems}
        packaging={{ status: 'complete', amount: '10.00' }}
        logistics={{
          status: 'complete',
          shippingAmount: '5.00',
          packagingAmount: '3.00',
          totalAmount: '8.00',
        }}
        busy={false}
        onAttemptSubmit={vi.fn()}
      />,
    );

    expect(html.match(/¥170\.00/g) ?? []).toHaveLength(0);
    expect(html).toContain('¥130.00');
    expect(html).toContain('¥40.00');
  });
});
