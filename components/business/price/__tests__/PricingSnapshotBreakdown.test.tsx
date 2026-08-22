import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import {
  parsePricingSnapshotComponents,
  parsePricingSnapshotSummary,
  PricingSnapshotBreakdown,
} from '../PricingSnapshotBreakdown';

describe('PricingSnapshotBreakdown', () => {
  it('fails closed for malformed snapshot envelopes and component rows', () => {
    expect(parsePricingSnapshotComponents(null)).toEqual([]);
    expect(parsePricingSnapshotComponents([])).toEqual([]);
    expect(parsePricingSnapshotComponents({ components: 'not-an-array' })).toEqual(
      [],
    );

    expect(
      parsePricingSnapshotComponents({
        components: [
          null,
          { name: '缺少金额' },
          { name: '非法金额', amount: 'Infinity' },
          { name: '有效项', amount: '12.30' },
        ],
      }),
    ).toHaveLength(1);

    const html = renderToStaticMarkup(
      <PricingSnapshotBreakdown pricingSnapshot={{ secretRule: '不应显示' }} />,
    );
    expect(html).toBe('');
  });

  it('renders the legacy component fields with formatted money and semantics', () => {
    const html = renderToStaticMarkup(
      <PricingSnapshotBreakdown
        pricingSnapshot={{
          components: [
            {
              source: 'BASE',
              sourceId: 'tier-001',
              name: '基础价',
              adjustmentType: 'PER_PIECE',
              rate: '0.1288',
              units: '1000',
              amount: '128.80',
            },
          ],
        }}
      />,
    );

    expect(html).toContain('<section');
    expect(html).toContain('<h4');
    expect(html).toContain('<ol');
    expect(html).toContain('<dl');
    expect(html).toContain('系统建议收费分项（1）');
    expect(html).toContain('基础价格');
    expect(html).toContain('按个');
    expect(html).toContain('¥ 0.1288');
    expect(html).toContain('× 1000个');
    expect(html).toContain('¥ 128.80');
    expect(html).not.toContain('tier-001');
    expect(html).toContain('min-w-0');
    expect(html).toContain('admin-wrap-anywhere');
  });

  it('distinguishes system suggestion from the actual manually adjusted charge', () => {
    const snapshot = {
      suggestedSubtotal: '128.80',
      actual: {
        subtotal: '120.00',
        overrideReason: '与客户确认后的协议价',
      },
      components: [
        {
          source: 'BASE',
          name: '报价单基础价',
          adjustmentType: 'PER_PIECE',
          rate: '0.1288',
          units: '1000',
          amount: '128.80',
        },
      ],
    };

    expect(parsePricingSnapshotSummary(snapshot)).toEqual({
      suggestedSubtotal: '128.8',
      actualSubtotal: '120',
      overrideReason: '与客户确认后的协议价',
    });

    const html = renderToStaticMarkup(
      <PricingSnapshotBreakdown pricingSnapshot={snapshot} />,
    );
    expect(html).toContain('系统建议小计');
    expect(html).toContain('¥ 128.80');
    expect(html).toContain('实际成交小计');
    expect(html).toContain('¥ 120.00');
    expect(html).toContain('与客户确认后的协议价');
    expect(html).toContain('下方分项是系统建议的计价依据');
  });

  it('keeps provenance in the parser but renders only business-facing fields', () => {
    const longName =
      '这是一条不含空格的超长中文收费项目名称用于验证小屏幕不会产生水平裁切';
    const parsed = parsePricingSnapshotComponents({
      components: [
        {
          source: 'ADJUSTMENT',
          name: longName,
          adjustmentType: 'FIXED_AMOUNT',
          rate: '20',
          units: '1',
          amount: 20,
          categoryName: '特殊工艺',
          categoryCode: 'SPECIAL-LONG-CATEGORY-CODE',
          ruleCode: 'RULE-LONG-CJK-001',
          sourceSheet: '长昆线下报价表不含空格的超长工作表名',
          sourceRange: 'A1024:Z2048',
        },
      ],
    });

    expect(parsed[0]).toMatchObject({
      categoryName: '特殊工艺',
      categoryCode: 'SPECIAL-LONG-CATEGORY-CODE',
      ruleCode: 'RULE-LONG-CJK-001',
      sourceRange: 'A1024:Z2048',
    });

    const html = renderToStaticMarkup(
      <PricingSnapshotBreakdown pricingSnapshot={{ components: parsed }} />,
    );
    expect(html).toContain(longName);
    expect(html).toContain('特殊工艺');
    expect(html).not.toContain('SPECIAL-LONG-CATEGORY-CODE');
    expect(html).not.toContain('RULE-LONG-CJK-001');
    expect(html).not.toContain('A1024:Z2048');
    expect(html).not.toContain('报价表来源');
    expect(html).not.toContain('规则编号');
    expect(html).not.toContain('来源编号');
    expect(html).toContain('grid-cols-1');
    expect(html).not.toContain('[object Object]');
    expect(html).not.toContain('NaN');
  });
});
