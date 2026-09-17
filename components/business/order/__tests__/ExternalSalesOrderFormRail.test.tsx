import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import {
  OrderFormBRail,
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

const pendingPlateFee = {
  status: 'PENDING' as const,
  amount: null,
  displayAmount: '待定' as const,
  label: '制烫金版费',
};

describe('OrderFormBRail', () => {
  it('keeps draft creation available for admin entry with external pricing', () => {
    const html = renderToStaticMarkup(
      <OrderFormBRail
        itemCount={1}
        quoteItems={quoteItems}
        packaging={{ status: 'complete', amount: '10.00' }}
        logistics={null}
        usesExternalSalesPricing
        allowSaveDraft
        settlementLabel="外部销售应付工厂"
        gaps={[]}
        busy={false}
        onAttemptSubmit={vi.fn()}
      />,
    );
    expect(html).toContain('保存草稿');
    expect(html).toContain('创建并提交');
    expect(html).toContain('纸箱耗材');
  });

  it('uses the internal settlement rail without external packaging or logistics fees', () => {
    const html = renderToStaticMarkup(
      <OrderFormBRail
        itemCount={1}
        quoteItems={quoteItems}
        packaging={{ status: 'missing', amount: null }}
        logistics={null}
        usesExternalSalesPricing={false}
        settlementLabel="工厂直接业务"
        gaps={['未填写承诺交期']}
        busy={false}
        onAttemptSubmit={vi.fn()}
      />,
    );

    expect(html).toContain('¥ 170.00');
    expect(html).toContain('工厂直接业务');
    expect(html).toContain('保存草稿');
    expect(html).toContain('创建并提交');
    expect(html).toContain('未填写承诺交期');
    expect(html).not.toContain('入袋');
    expect(html).not.toContain('制烫金版费');
    expect(html).not.toContain('纸箱耗材');
    expect(html).not.toContain('快递费');
  });

  it('uses the pure-engine known total for internal BAGGING without adding external-fee UI', () => {
    const html = renderToStaticMarkup(
      <OrderFormBRail
        itemCount={1}
        quoteItems={quoteItems}
        packaging={{ status: 'complete', amount: '10.00' }}
        logistics={null}
        usesExternalSalesPricing={false}
        settlementLabel="工厂直接业务"
        knownTotal="180.00"
        totalSemantics="COMPLETE"
        gaps={[]}
        busy={false}
        onAttemptSubmit={vi.fn()}
      />,
    );

    expect(html).toContain('¥ 180.00');
    expect(html).not.toContain('纸箱耗材');
    expect(html).not.toContain('快递费');
  });

  it('marks an internal known total as incomplete while the plate fee is pending', () => {
    const html = renderToStaticMarkup(
      <OrderFormBRail
        itemCount={1}
        quoteItems={quoteItems}
        packaging={{ status: 'complete', amount: '10.00' }}
        logistics={null}
        usesExternalSalesPricing={false}
        settlementLabel="工厂直接业务"
        knownTotal="180.00"
        totalSemantics="EXCLUDES_MANUAL_ITEMS"
        plateFee={pendingPlateFee}
        gaps={[]}
        busy={false}
        onAttemptSubmit={vi.fn()}
      />,
    );

    expect(html).toContain('已知合计');
    expect(html).toContain('¥ 180.00');
    expect(html).toContain('不含制版费');
    expect(html).toContain('创建并提交');
  });

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
      <OrderFormBRail
        itemCount={1}
        quoteItems={quoteItems}
        packaging={{ status: 'complete', amount: '10.00' }}
        logistics={logistics}
        usesExternalSalesPricing
        settlementLabel="外部销售应付工厂"
        gaps={[]}
        busy={false}
        onAttemptSubmit={vi.fn()}
      />,
    );

    expect(html).toContain('¥ 183.00');
    expect(html).toContain('外部销售应付工厂');
    expect(html).toContain('1 条规格明细');
    expect(html).toContain('纸箱耗材');
    expect(html).toContain('¥ 3.00');
    expect(html).toContain('不含快递费');
    expect(html).not.toContain('制烫金版费');
    expect(html).toContain('创建并提交');
    expect(html).not.toContain('保存草稿');
    expect(html).not.toContain('这张单需要管理员终价');
  });

  it('groups a completed style subtotal with its fee components', () => {
    const html = renderToStaticMarkup(
      <OrderFormBRail
        itemCount={1}
        quoteItems={quoteItems}
        packaging={{ status: 'complete', amount: '10.00' }}
        logistics={{
          status: 'complete',
          shippingAmount: '5.00',
          packagingAmount: '3.00',
          totalAmount: '8.00',
        }}
        usesExternalSalesPricing
        settlementLabel="外部销售应付工厂"
        gaps={[]}
        busy={false}
        onAttemptSubmit={vi.fn()}
      />,
    );

    expect(html.match(/¥ 170\.00/g) ?? []).toHaveLength(1);
    expect(html).toContain('¥ 130.00');
    expect(html).toContain('¥ 40.00');
  });

  it('requires factory pricing when only the plate amount is pending', () => {
    const html = renderToStaticMarkup(
      <OrderFormBRail
        itemCount={1}
        quoteItems={quoteItems}
        packaging={{ status: 'complete', amount: '10.00' }}
        logistics={{
          status: 'complete',
          shippingAmount: '5.00',
          packagingAmount: '3.00',
          totalAmount: '8.00',
        }}
        usesExternalSalesPricing
        settlementLabel="外部销售应付工厂"
        knownTotal="188.00"
        totalSemantics="EXCLUDES_MANUAL_ITEMS"
        plateFee={pendingPlateFee}
        gaps={[]}
        busy={false}
        onAttemptSubmit={vi.fn()}
      />,
    );

    expect(html).toContain('制烫金版费金额待工厂确认');
    expect(html).toContain('待工厂核价');
    expect(html).toContain('创建并提交');
  });

  it('keeps the known total and full fee semantics when one style needs manual pricing', () => {
    const mixedQuoteItems = [
      ...quoteItems,
      {
        key: 'style-2',
        label: '专版烫金 · 三色',
        status: 'incomplete' as const,
        amount: null,
        components: [],
        message: '专版三色需工厂核价',
      },
    ];
    const packaging = {
      status: 'complete' as const,
      amount: '10.00',
      label: '入袋 10袋',
    };
    const logistics = {
      status: 'complete' as const,
      shippingAmount: '5.00',
      packagingAmount: '3.00',
      totalAmount: '8.00',
    };

    expect(
      externalSalesOrderFormTotal({
        quoteItems: mixedQuoteItems,
        packaging,
        logistics,
      }),
    ).toBe(188);

    const html = renderToStaticMarkup(
      <OrderFormBRail
        itemCount={2}
        quoteItems={mixedQuoteItems}
        packaging={packaging}
        logistics={logistics}
        usesExternalSalesPricing
        settlementLabel="外部销售应付工厂"
        knownTotal="188.00"
        totalSemantics="EXCLUDES_MANUAL_ITEMS"
        plateFee={pendingPlateFee}
        gaps={[]}
        busy={false}
        onAttemptSubmit={vi.fn()}
      />,
    );

    expect(html).toContain('已知合计');
    expect(html).toContain('¥ 188.00');
    expect(html).toContain('不含待核价款');
    expect(html).not.toContain('>——<');
    expect(html).toContain('入袋 10袋');
    expect(html).toContain('制烫金版费');
    expect(html).toContain('待工厂核价');
    expect(html).toContain('纸箱耗材');
    expect(html).toContain('快递费');
    expect(html).toContain('待工厂核价');
  });

  for (const external of [false, true]) {
    it(`shares fee components and preserves manual zero prices for ${external ? 'external' : 'internal'} settlement`, () => {
      const render = (manual: boolean) => renderToStaticMarkup(<OrderFormBRail
        itemCount={1} quoteItems={manual ? [{ ...quoteItems[0], amount: '0', pricingSource: 'ADMIN' }] : quoteItems}
        packaging={{ status: 'complete', amount: '0', label: '不包装', pricingSource: manual ? 'ADMIN' : 'AUTO' }}
        logistics={{ status: 'error', shippingAmount: null, packagingAmount: '3.00', totalAmount: null, message: '运费待核' }}
        usesExternalSalesPricing={external} settlementLabel={external ? '外部销售应付工厂' : '工厂直接业务'}
        knownTotal={manual ? '0' : '170'} gaps={[]} busy={false} onAttemptSubmit={vi.fn()}
      />);
      const automatic = render(false);
      expect(automatic).toContain('空白封');
      expect(automatic).toContain('¥ 130.00');
      expect(automatic).toContain('¥ 40.00');
      const manual = render(true);
      expect(manual).toContain('人工价');
      expect(manual).toContain('¥ 0.00');
      expect(manual).not.toContain('¥ 130.00');
      expect(manual).not.toContain('预估费用');
      for (const text of ['纸箱耗材', '运费待核', '不含快递费']) {
        expect(manual.includes(text)).toBe(external);
      }
    });
  }

  it('distinguishes a mixture of manual and automatic packaging prices', () => {
    const html = renderToStaticMarkup(<OrderFormBRail itemCount={1} quoteItems={quoteItems}
      packaging={{ status: 'complete', amount: '10', pricingSource: 'MIXED' }}
      logistics={null} usesExternalSalesPricing={false} settlementLabel="工厂直接业务"
      knownTotal="180" gaps={[]} busy={false} onAttemptSubmit={vi.fn()} />);
    expect(html).toContain('含人工价');
    expect(html).not.toContain('>人工价<');
  });

  it('adds decimal amounts without floating-point drift', () => {
    expect(
      externalSalesOrderFormTotal({
        quoteItems: [
          {
            key: 'decimal-1',
            label: '款式 1',
            status: 'complete',
            amount: '0.10',
            components: [],
          },
          {
            key: 'decimal-2',
            label: '款式 2',
            status: 'complete',
            amount: '0.20',
            components: [],
          },
        ],
        packaging: { status: 'complete', amount: '0.30' },
        logistics: {
          status: 'complete',
          shippingAmount: '0.50',
          packagingAmount: '0.40',
          totalAmount: '0.90',
        },
      }),
    ).toBe(1.5);
  });
});
