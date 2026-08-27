import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import type { QuoteResult } from '@/lib/price/quote';

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn() }),
}));
vi.mock('@/actions/order', () => ({
  createOrderAction: vi.fn(),
  submitOrderAction: vi.fn(),
}));
vi.mock('@/actions/order-quote', () => ({ quoteOrderItemsAction: vi.fn() }));
vi.mock('@/actions/order-logistics-quote', () => ({
  quoteExternalOrderChargesAction: vi.fn(),
}));
vi.mock('../PendingDesignImages', () => ({
  PendingDesignImages: () => null,
}));
vi.mock('../design-upload-client', () => ({
  uploadOrderItemDesignFile: vi.fn(),
}));

import { QuoteFeedback, ShipmentPricingFactsFields } from '../OrderForm';

function registration(name: string) {
  return {
    name,
    onChange: async () => undefined,
    onBlur: async () => undefined,
    ref: () => undefined,
  } as never;
}

function renderFacts({
  isSfCollect,
  provinceError,
}: {
  isSfCollect: boolean;
  provinceError?: string;
}) {
  return renderToStaticMarkup(
    <ShipmentPricingFactsFields
      idPrefix="primary"
      provinceRegistration={registration('destinationProvince')}
      provinceError={provinceError}
      isSfCollect={isSfCollect}
    />,
  );
}

const completeQuote = {
  complete: true,
  suggestedUnitPrice: '0.2500',
  suggestedFixedFee: '90.00',
  suggestedSubtotal: '590.00',
  errors: [],
  components: [
    {
      source: 'BASE',
      sourceId: 'rule-1',
      name: '基础加工费',
      adjustmentType: 'PER_PIECE',
      rate: '0.2500',
      units: '2000',
      amount: '500.00',
      categoryCode: 'BASE',
      categoryName: '基础价',
      ruleCode: 'BASE-2000',
      sourceSheet: null,
      sourceRange: null,
    },
  ],
  snapshot: {
    quotedAt: '2026-08-26T06:00:00.000Z',
    priceBook: {
      id: 'book-1',
      code: 'PROCESSING_V2',
      name: '当前对客加工费',
      version: 2,
      currency: 'CNY',
      sourceName: null,
      sourceSha256: null,
    },
  } as never,
} satisfies QuoteResult;

describe('ShipmentPricingFactsFields', () => {
  it('renders only the destination fact and never asks sales for weight or charges', () => {
    const html = renderFacts({ isSfCollect: false });

    expect(html).toContain('id="primary-province"');
    expect(html).not.toContain('id="primary-weight"');
    expect(html).not.toContain('计费重量');
    expect(html).not.toContain('primary-shipping-fee');
    expect(html).not.toContain('primary-packing-fee');
    expect(html).not.toContain('primary-charge-reason');
    expect(html).not.toContain('销售暂定');
    expect(html).not.toContain('收费调整说明');
    expect(html).not.toContain('服务端');
  });

  it('disables the province for SF collect and keeps error semantics', () => {
    const sfHtml = renderFacts({ isSfCollect: true });
    const errorHtml = renderFacts({
      isSfCollect: false,
      provinceError: '请选择省份',
    });

    expect(sfHtml).toMatch(/id="primary-province"[^>]*disabled=""/);
    expect(errorHtml).toContain('id="primary-province-error" role="alert"');
  });
});

describe('QuoteFeedback presentation', () => {
  it('shows external automatic totals without editable-price terminology', () => {
    const html = renderToStaticMarkup(
      <QuoteFeedback
        presentation="external-auto"
        stale={false}
        view={{ inputKey: 'facts', result: completeQuote }}
      />,
    );

    expect(html).toContain('自动核价完成：本款加工费');
    expect(html).toContain('币种 CNY');
    expect(html).toContain('报价版本 当前对客加工费 第 2 版');
    expect(html).toContain('报价日期');
    expect(html).not.toContain('成交单价');
    expect(html).not.toContain('一次性费用');
    expect(html).not.toContain('建议价');
  });

  it('shows a business-facing rule name in the normal quote breakdown', () => {
    const html = renderToStaticMarkup(
      <QuoteFeedback
        presentation="external-auto"
        stale={false}
        view={{
          inputKey: 'facts',
          result: {
            ...completeQuote,
            components: [
              {
                ...completeQuote.components[0],
                name: '空封现货基础价（A4:C4）',
                sourceRange: 'A4:C4',
              },
            ],
          },
        }}
      />,
    );

    expect(html).toContain('空封现货基础价：');
    expect(html).not.toContain('A4:C4');
  });

  it('uses administrator-final-price semantics for incomplete or stale external quotes', () => {
    const incomplete = renderToStaticMarkup(
      <QuoteFeedback
        presentation="external-auto"
        stale={false}
        view={{
          inputKey: 'facts',
          result: {
            ...completeQuote,
            complete: false,
            suggestedUnitPrice: null,
            suggestedFixedFee: null,
            suggestedSubtotal: null,
            errors: ['规则未覆盖'],
          },
        }}
      />,
    );
    const stale = renderToStaticMarkup(
      <QuoteFeedback
        presentation="external-auto"
        stale
        view={{ inputKey: 'old', result: completeQuote }}
      />,
    );

    expect(incomplete).toContain('创建后由管理员定价');
    expect(incomplete).not.toContain('成交价');
    expect(stale).toContain('正在重新核价');
    expect(stale).not.toContain('建议价');
  });

  it('retains editable-price details for internal operators', () => {
    const html = renderToStaticMarkup(
      <QuoteFeedback
        presentation="internal-editable"
        stale={false}
        view={{ inputKey: 'facts', result: completeQuote }}
      />,
    );

    expect(html).toContain('成交单价');
    expect(html).toContain('一次性费用');
  });
});
