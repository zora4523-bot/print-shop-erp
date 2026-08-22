import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { OrderSettlementType } from '@/generated/prisma/enums';
import { ExternalSalesPriceBookCatalog } from '../ExternalSalesPriceBookCatalog';
import type { CustomerPriceBookCatalog } from '@/lib/price/customer-price-book';

const catalog = {
  code: 'EXTERNAL_SALES_PROCESSING',
  name: '外部销售加工费报价单',
  version: 3,
  settlementType: OrderSettlementType.EXTERNAL_SALES,
  source: {
    fileName: '长昆-线下报价表.xlsx',
    sha256: 'abc123',
  },
  sources: [
    {
      fileName: '长昆中通报价表(1).xlsx',
      sha256: 'express-hash',
      sheet: '中通',
      range: 'A1:D29',
    },
    {
      fileName: '纸箱价格表1(1).xlsx',
      sha256: 'carton-hash',
      sheet: 'Sheet1',
      range: 'A1:B6',
    },
  ],
  effectiveFrom: new Date('2026-08-08T00:00:00.000+08:00'),
  effectiveTo: null,
  warnings: ['彩印第 10 行缺少规格标签，不能自动套价。'],
  categories: [
    {
      code: 'FOIL',
      name: '专版烫金',
      description: '专版单色平烫及其附加项。',
      items: [
        {
          code: 'FOIL-MEDIUM-500',
          name: '中号 / 方形 · 500 个',
          product: '专版单色平烫',
          specification: '8*11.5 中号 / 方形',
          paper: '160g 艳闪 / 红卡',
          calculationLabel: '按个',
          quantityRangeLabel: '500 个锚点',
          amountLabel: '¥ 0.48 / 个',
          source: {
            fileName: '长昆-线下报价表.xlsx',
            sha256: 'rule-hash',
            sheet: '烫金',
            range: 'E4:F4',
          },
          automation: 'AUTO',
          note: '仅限明确锚点数量。',
        },
        {
          code: 'FOIL-NONSTANDARD',
          name: '非标尺寸',
          calculationLabel: '人工询价',
          quantityRangeLabel: '全部数量',
          amountLabel: '待确认',
          source: { sheet: '烫金', range: 'E6:O6' },
          automation: 'MANUAL',
        },
      ],
    },
  ],
} satisfies CustomerPriceBookCatalog;

describe('ExternalSalesPriceBookCatalog', () => {
  it('renders sales-facing rules without technical codes or source metadata', () => {
    const html = renderToStaticMarkup(
      <ExternalSalesPriceBookCatalog catalog={catalog} perspective="sales" />,
    );

    expect(html).toContain('专版烫金');
    expect(html).toContain('¥ 0.48 / 个');
    expect(html).toContain('自动计价');
    expect(html).toContain('需人工确认');
    expect(html).toContain('aria-label="专版烫金报价明细"');
    expect(html).toContain('overflow-x-auto');
    expect(html).not.toContain('FOIL-MEDIUM-500');
    expect(html).not.toContain('E4:F4');
    expect(html).not.toContain('EXTERNAL_SALES_PROCESSING');
    expect(html).not.toContain('SHA-256');
  });

  it('renders the admin catalog in business language without implementation metadata', () => {
    const html = renderToStaticMarkup(
      <ExternalSalesPriceBookCatalog catalog={catalog} perspective="admin" />,
    );

    expect(html).toContain('当前生效版本');
    expect(html).toContain('版本 v3');
    expect(html).toContain('2026/08/08');
    expect(html).toContain('彩印第 10 行缺少规格标签');
    expect(html).not.toContain('来源与审计详情');
    expect(html).not.toContain('长昆-线下报价表.xlsx');
    expect(html).not.toContain('SHA-256');
    expect(html).not.toContain('A1:D29');
    expect(html).not.toContain('FOIL-MEDIUM-500');
    expect(html).not.toContain('E4:F4');
    expect(html).not.toContain('abc123');
  });

  it('fails closed when no external-sales price book is active', () => {
    const html = renderToStaticMarkup(
      <ExternalSalesPriceBookCatalog catalog={null} />,
    );

    expect(html).toContain('当前没有生效的外部销售报价单');
    expect(html).not.toContain('¥ 0.48 / 个');
  });
});
