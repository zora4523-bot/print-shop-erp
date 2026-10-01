import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import {
  ProductReferenceImpact,
  productActiveChangeImpactItems,
} from '../ProductReferenceImpact';

const impact = {
  orderCount: 8,
  bomCount: 2,
  currentExternalPriceRuleCount: 3,
};

describe('ProductReferenceImpact', () => {
  it('只展示新结构仍在使用的三类引用', () => {
    const html = renderToStaticMarkup(
      <ProductReferenceImpact impact={impact} />,
    );
    expect(html).toContain('历史/现有工单');
    expect(html).toContain('用料清单');
    expect(html).toContain('当前客户计价规则');
    expect(html).not.toContain('内部计价');
    expect(html).not.toContain('费用快照');
    expect(html).not.toContain('不会改写');
  });

  it('states the historical-retention invariant in the deactivation impact', () => {
    const items = productActiveChangeImpactItems(impact, false);
    expect(items).toContain('8 张已有工单的产品和成交价保留。');
    expect(items).toContain('2 个用料清单和已有用料记录继续保留。');
    expect(items.join('')).not.toContain('产品选择器');
    expect(items.join('')).not.toContain('内部计价');
  });

  it('does not invent references when every count is zero', () => {
    const html = renderToStaticMarkup(
      <ProductReferenceImpact
        variant="compact"
        impact={{
          orderCount: 0,
          bomCount: 0,
          currentExternalPriceRuleCount: 0,
        }}
      />,
    );
    expect(html).toContain('未被引用');
  });
});
