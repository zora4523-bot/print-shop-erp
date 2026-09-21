import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { OrderChangeFieldDiff } from '../OrderChangeFieldDiff';

const beforeSnapshot = {
  items: [
    {
      id: 'item-1',
      sequence: 1,
      name: '红包 A',
      quantity: 1000,
      specification: '大号',
      foilColors: ['哑金'],
    },
  ],
};

describe('OrderChangeFieldDiff', () => {
  it.each(['ADD', 'UPDATE'])('renders blank identity specification for %s', (operation) => {
    const html = renderToStaticMarkup(<OrderChangeFieldDiff beforeSnapshot={beforeSnapshot}
      proposedChanges={{ items: [{ operation, itemId: 'item-1', templateItemId: 'item-1',
        targetBlankIdentity: { paperType: '红卡', paperWeightGsm: 180, specification: '中号封80×115' } }] }} />);
    expect(html).toContain('中号封80×115');
    expect(html).toContain('规格');
    expect(html).not.toContain('targetBlankIdentity');
  });
  it('renders real before-to-after changes without repeating production instructions', () => {
    const html = renderToStaticMarkup(
      <OrderChangeFieldDiff
        beforeSnapshot={beforeSnapshot}
        proposedChanges={{
          items: [
            {
              operation: 'UPDATE',
              itemId: 'item-1',
              name: '红包 A',
              quantity: 1200,
              specification: '特大号',
              foilColors: ['亮金'],
            },
          ],
        }}
      />,
    );

    expect(html).toContain('data-slot="order-change-field-diff"');
    expect(html).toContain('#1 · 红包 A');
    expect(html).not.toContain('<th scope="row" class="px-3 py-2 text-left font-medium">款式名称</th>');
    expect(html).toContain('1,000');
    expect(html).toContain('1,200');
    expect(html).toContain('大号');
    expect(html).toContain('特大号');
    expect(html).toContain('哑金');
    expect(html).toContain('亮金');
    expect(html).not.toContain('计价影响');
    expect(html).not.toContain('生产影响');
  });

  it('makes newly added styles explicit and identifies the template', () => {
    const html = renderToStaticMarkup(
      <OrderChangeFieldDiff
        beforeSnapshot={beforeSnapshot}
        proposedChanges={{
          items: [
            {
              operation: 'ADD',
              templateItemId: 'item-1',
              name: '红包 B',
              quantity: 500,
              specification: null,
              foilColors: [],
            },
          ],
        }}
      />,
    );

    expect(html).toContain('新增 · 红包 B（参考 #1 · 红包 A）');
    expect(html).toContain('—（新增）');
    expect(html).toContain('500');
  });

  it('分开展示正反面烫金事实', () => {
    const html = renderToStaticMarkup(
      <OrderChangeFieldDiff
        beforeSnapshot={{
          items: [
            {
              ...beforeSnapshot.items[0],
              frontFoilColors: ['哑金'],
              backFoilColors: [],
              isDoubleSided: false,
            },
          ],
        }}
        proposedChanges={{
          items: [
            {
              operation: 'UPDATE',
              itemId: 'item-1',
              frontFoilColors: ['浅金'],
              backFoilColors: ['红金'],
            },
          ],
        }}
      />,
    );

    expect(html).toContain('正面烫金颜色');
    expect(html).toContain('反面烫金颜色');
    expect(html).toContain('浅金');
    expect(html).toContain('红金');
  });

  it('blocks blind approval when the stored payload cannot be interpreted', () => {
    const html = renderToStaticMarkup(
      <OrderChangeFieldDiff
        beforeSnapshot={beforeSnapshot}
        proposedChanges={{ broken: true }}
      />,
    );

    expect(html).toContain('role="alert"');
    expect(html).toContain('请勿仅凭摘要批准');
    expect(html).toContain('重新创建申请');
  });
});
