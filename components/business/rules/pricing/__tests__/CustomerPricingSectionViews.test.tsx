import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import {
  CustomerBlankPricingSectionView,
  CustomerMachinePricingSectionView,
  CustomerPrintPricingSectionView,
  CustomerTiersPricingSectionView,
  type CustomerTierPricingRow,
  type PricingNumericFieldState,
} from '../CustomerPricingSectionViews';

function field(
  id: string,
  value: PricingNumericFieldState['value'],
  options: Omit<PricingNumericFieldState, 'id' | 'value'> = {},
): PricingNumericFieldState {
  return {
    id,
    value,
    editable: true,
    ...options,
  };
}

function tier(
  key: string,
  name: string,
  maxQuantity: number | null,
  middlePrice: number,
  largePrice: number,
): CustomerTierPricingRow {
  return {
    key,
    name,
    maxQuantity: field(`${key}-max`, maxQuantity),
    middlePrice: field(`${key}-middle`, middlePrice),
    largePrice: field(`${key}-large`, largePrice),
  };
}

function visibleText(html: string): string {
  return html
    .replace(/<[^>]+>/g, ' ')
    .replace(/\s+/g, ' ')
    .replace(/\s*([，。；：])\s*/g, '$1')
    .trim();
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function inputMarkup(html: string, ariaLabel: string): string {
  const match = html.match(
    new RegExp(`<input\\b[^>]*aria-label="${escapeRegExp(ariaLabel)}"[^>]*>`),
  );

  expect(match, `未找到输入框：${ariaLabel}`).not.toBeNull();
  return match![0];
}

function readonlyMarkup(html: string, priceLabel: string): string {
  const match = html.match(
    new RegExp(
      `<span\\b[^>]*data-price-label="${escapeRegExp(priceLabel)}"[^>]*>[\\s\\S]*?<\\/span>`,
    ),
  );

  expect(match, `未找到只读价格：${priceLabel}`).not.toBeNull();
  return match![0];
}

describe('CustomerPricingSectionViews', () => {
  it('制烫金版费显示默认零与人工选项，不渲染历史数值配置', () => {
    const html = renderToStaticMarkup(
      <CustomerMachinePricingSectionView
        rate={field('machine-rate', '0.04')}
        flatFee={field('machine-flat', '40')}
        jumpQuantity={field('machine-jump', 1_000)}
        plateFee={field('legacy-plate-fee', '999.99')}
      />,
    );
    const text = visibleText(html);

    expect(text).toContain('局部烫金 · 机烫费与制版费');
    expect(text).toContain('制烫金版费');
    expect(text).toContain('默认 0 元 · 可人工添加');
    expect(text).toContain('版费默认 0 元');
    expect(html).not.toContain('aria-label="价格参数"');
    expect(html).not.toContain('value="999.99"');
    expect(text).not.toContain('元/版');
  });

  it('renders tiers as the single design-spec ladder with derived ranges and paired prices', () => {
    const rows = [
      tier('q200', '200个档', 499, 0.96, 1),
      tier('q500', '500个档', 999, 0.48, 0.52),
      tier('q1000', '1千档', 1_999, 0.31, 0.325),
      tier('q2000', '2千档', 2_999, 0.27, 0.285),
      tier('q3000', '3千档', 3_999, 0.25, 0.27),
      tier('q4000', '4千档', 4_999, 0.23, 0.245),
      tier('q5000', '5千档', 9_999, 0.2, 0.22),
      tier('q10000', '1万档', 19_999, 0.18, 0.2),
      tier('q20000', '2万档', 29_999, 0.17, 0.19),
      tier('q30000', '3万档', 49_999, 0.17, 0.19),
      tier('q50000', '5万档', null, 0.16, 0.18),
    ];

    const html = renderToStaticMarkup(
      <CustomerTiersPricingSectionView rows={rows} />,
    );
    const text = visibleText(html);

    expect(html.match(/role="table"/g)).toHaveLength(1);
    expect(html).toContain('aria-label="专版烫金阶梯单价"');
    expect(text).toContain('专版烫金 · 阶梯单价');
    expect(text).toContain('数量范围');
    expect(text).toContain('数量上界（含）');
    expect(text).toContain('中号组单价');
    expect(text).toContain('大号组单价');
    expect(html.match(/role="columnheader"/g)).toHaveLength(5);
    expect(text).toContain('≥ 1 且 &lt; 500 个');
    expect(text).toContain('≥ 5,000 且 &lt; 10,000 个');
    expect(text).toContain('≥ 50,000 个');
    expect(text).not.toContain('4,600');
    expect(text).not.toContain('档位取档');
    expect(text).not.toContain('达到下一档');
    expect(text).not.toContain('未设最低起订量');

    expect(html.match(/aria-label="[^"]+中号组单价"/g)).toHaveLength(11);
    expect(html.match(/aria-label="[^"]+大号组单价"/g)).toHaveLength(11);
    expect(inputMarkup(html, '500个档中号组单价')).toContain(
      'value="0.48"',
    );
    expect(inputMarkup(html, '500个档大号组单价')).toContain(
      'value="0.52"',
    );
    expect(inputMarkup(html, '5万档中号组单价')).toContain('value="0.16"');
    expect(inputMarkup(html, '5万档大号组单价')).toContain('value="0.18"');
    expect(readonlyMarkup(html, '5万档上界')).toContain('∞');
    expect(readonlyMarkup(html, '5万档上界')).toContain(
      'data-disabled="true"',
    );

    expect(text).not.toContain('价格规则矩阵');
    expect(text).not.toContain('搜索收费项目');
    expect(text).not.toContain('状态');
    expect(text).not.toContain('操作');
  });

  it('renders a blank-price matrix where missing price and zero are distinct', () => {
    const html = renderToStaticMarkup(
      <CustomerBlankPricingSectionView
        columns={[
          { key: 'middle', label: '中号封' },
          { key: 'large', label: '大号封' },
        ]}
        rows={[
          {
            key: 'pearl-160',
            paperName: '珠光艳闪',
            weight: 160,
            cells: [
              {
                ...field('blank-pearl-160-middle', null),
                columnKey: 'middle',
              },
              {
                ...field('blank-pearl-160-large', 0),
                columnKey: 'large',
              },
            ],
          },
        ]}
      />,
    );

    expect(html).toContain('aria-label="局部烫金空白封现货单价矩阵"');
    expect(visibleText(html)).toContain('空格是“— 转人工”显式状态');
    expect(inputMarkup(html, '珠光艳闪160g中号封单价')).toContain(
      'placeholder="— 转人工"',
    );
    expect(inputMarkup(html, '珠光艳闪160g大号封单价')).toContain('value="0"');
  });

  it('以文本输出展示生效价，只把草稿价渲染为输入框', () => {
    const html = renderToStaticMarkup(
      <CustomerBlankPricingSectionView
        columns={[
          { key: 'middle', label: '中号封' },
          { key: 'large', label: '大号封' },
        ]}
        rows={[
          {
            key: 'pearl-160',
            paperName: '珠光艳闪',
            weight: 160,
            cells: [
              {
                ...field('blank-current-middle', 0.12, { editable: false }),
                columnKey: 'middle',
              },
              {
                ...field('blank-draft-large', 0.13),
                columnKey: 'large',
              },
            ],
          },
        ]}
      />,
    );

    expect(readonlyMarkup(html, '珠光艳闪160g中号封单价')).toContain(
      '0.12',
    );
    expect(html).not.toMatch(
      /<input\b[^>]*aria-label="珠光艳闪160g中号封单价"/,
    );
    expect(inputMarkup(html, '珠光艳闪160g大号封单价')).toContain(
      'value="0.13"',
    );
  });

  it('states that print tiers are per-order totals and blank cells go to manual pricing', () => {
    const html = renderToStaticMarkup(
      <CustomerPrintPricingSectionView
        columns={[
          { key: 'q1000', label: '1千' },
          { key: 'q2000', label: '2千' },
        ]}
        rows={[
          {
            key: 'ice-white-middle',
            label: '冰白160g 中号',
            cells: [
              {
                ...field('print-ice-middle-1000', 320),
                columnKey: 'q1000',
              },
              {
                ...field('print-ice-middle-2000', null),
                columnKey: 'q2000',
              },
            ],
          },
        ]}
        foilCells={[
          {
            ...field('print-foil-1000', 200),
            columnKey: 'q1000',
          },
          {
            ...field('print-foil-2000', null),
            columnKey: 'q2000',
          },
        ]}
      />,
    );
    const text = visibleText(html);

    expect(html).toContain('aria-label="彩印阶梯整单总价矩阵"');
    expect(text).toContain('彩印阶梯总价');
    expect(text).toContain('元 / 单 · PER_ORDER · 整单总价不乘数量');
    expect(text).toContain('查到的直接就是整单总价');
    expect(text).toContain('该档无报价转人工，不是 0 元');
    expect(text).toContain('单色烫金原子套餐');
    expect(text).toContain('含制版费 · 按不可拆套餐总价计价');
    expect(text).toContain('不再另收订单级制版费');
    expect(text).toContain('冰白中号 2千起为空就是现状');
    expect(inputMarkup(html, '冰白160g 中号2千档整单总价')).toContain(
      'placeholder="—"',
    );
    expect(
      inputMarkup(html, '单色烫金1千档含版费原子套餐价'),
    ).toContain('value="200"');
  });
});
