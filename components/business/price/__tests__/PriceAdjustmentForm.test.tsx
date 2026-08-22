import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import { PriceAdjustmentForm } from '../PriceAdjustmentForm';

describe('PriceAdjustmentForm', () => {
  it('uses structured business fields without exposing the stored condition format', () => {
    const action = vi.fn(async () => ({ status: 'success' as const }));
    const html = renderToStaticMarkup(
      <PriceAdjustmentForm
        mode="create"
        action={action}
        products={[{ id: 'product-1', label: '大号红包' }]}
        crafts={[{ id: 'craft-1', label: '平烫' }]}
      />,
    );

    expect(html).toContain('收费项目名称');
    expect(html).toContain('限定产品');
    expect(html).toContain('限定工艺');
    expect(html).toContain('多工艺匹配方式');
    expect(html).toContain('name="triggerCondition"');
    expect(html).toContain('type="hidden"');
    expect(html).not.toContain('JSON');
    expect(html).not.toContain('Decimal(10,4)');
    expect(html).not.toContain('>ANY<');
    expect(html).not.toContain('>ALL<');
  });
});
