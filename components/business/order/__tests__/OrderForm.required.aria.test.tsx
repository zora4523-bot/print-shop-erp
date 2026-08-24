import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';

// TextField 曾经把 required 解构出来「只拿去画红星」，没有透传给 <Input>。
// 读屏器于是把「款式名」「数量」念成普通选填输入框。tests/visual 的 axe 门禁
// 结构上覆盖不到这条路径：axe 无从知道哪些字段在业务上是必填的，星号和
// required 不一致它不算违规。所以用 SSR markup 断言把它钉住。
vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn() }),
}));
vi.mock('@/actions/order', () => ({ createOrderAction: vi.fn() }));
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

import { OrderForm, type CraftOption } from '../OrderForm';

const crafts: CraftOption[] = [
  { id: 'craft-1', name: '烫金', isOutsource: false, isLowFrequency: false },
  { id: 'craft-2', name: '击凸', isOutsource: true, isLowFrequency: true },
];

function render() {
  return renderToStaticMarkup(
    <OrderForm
      draftScope="test-user"
      crafts={crafts}
      products={[]}
      settlementLabel="内部结算"
      usesExternalSalesPricing
    />,
  );
}

/** 取出带某个 id 的那一个开标签，避免依赖属性之间的先后顺序。 */
function tagWithId(html: string, id: string): string {
  const match = html.match(new RegExp(`<[a-z]+[^>]*\\sid="${id}"[^>]*>`));
  expect(match, `应渲染出 id="${id}" 的控件`).not.toBeNull();
  return match![0]!;
}

describe('OrderForm 必填字段的 required 语义', () => {
  it('款式名与数量把 required / aria-required 透传给控件', () => {
    const html = render();

    const nameTag = tagWithId(html, 'items\\.0\\.name');
    expect(nameTag).toContain('required=""');
    expect(nameTag).toContain('aria-required="true"');

    const quantityTag = tagWithId(html, 'items\\.0\\.quantity');
    expect(quantityTag).toContain('required=""');
    expect(quantityTag).toContain('aria-required="true"');
  });

  it('选填字段不能被一刀切标成必填', () => {
    const html = render();

    expect(tagWithId(html, 'customerRef')).not.toContain('required=""');
    expect(tagWithId(html, 'customerRef')).not.toContain('aria-required');
    expect(tagWithId(html, 'expressCode')).not.toContain('required=""');
    expect(tagWithId(html, 'expressCode')).not.toContain('aria-required');
  });

  it('红星带 aria-hidden：必填靠 required 表达，不靠读屏器念星号', () => {
    const html = render();

    const label = html.match(
      /<label[^>]*for="items\.0\.name"[^>]*>([\s\S]*?)<\/label>/,
    );
    expect(label, '款式名应有 <label for="items.0.name">').not.toBeNull();
    const labelInner = label![1]!;
    expect(labelInner).toContain('款式名');
    expect(labelInner).toMatch(/<span aria-hidden="true"[^>]*>\s*\*/);
  });

  it('加了 required 不等于换回浏览器原生气泡：form 仍是 noValidate', () => {
    expect(render()).toMatch(/<form[^>]*novalidate/i);
  });
});
