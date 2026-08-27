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
  currentInternalPriceTierCount: 1,
};

describe('ProductReferenceImpact', () => {
  it('renders the four authoritative reference categories', () => {
    const html = renderToStaticMarkup(
      <ProductReferenceImpact impact={impact} />,
    );
    expect(html).toContain('历史/现有工单');
    expect(html).toContain('BOM 版本');
    expect(html).toContain('当前客户计价规则');
    expect(html).toContain('当前内部计价档');
  });

  it('states the historical-retention invariant in the deactivation impact', () => {
    const items = productActiveChangeImpactItems(impact, false);
    expect(items).toContain('8 张已有工单的产品和成交价保留。');
    expect(items).toContain('2 个 BOM 版本和已有用料记录继续保留。');
  });

  it('does not invent references when every count is zero', () => {
    const html = renderToStaticMarkup(
      <ProductReferenceImpact
        variant="compact"
        impact={{
          orderCount: 0,
          bomCount: 0,
          currentExternalPriceRuleCount: 0,
          currentInternalPriceTierCount: 0,
        }}
      />,
    );
    expect(html).toContain('未被引用');
  });
});
