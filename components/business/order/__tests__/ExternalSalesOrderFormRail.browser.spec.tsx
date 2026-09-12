import { flushSync } from 'react-dom';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { commands, page } from 'vitest/browser';
import '@/app/globals.css';
import { OrderFormBRail, type OrderFormBRailQuoteItem } from '../ExternalSalesOrderFormRail';

let host: HTMLDivElement;
let root: Root;
const message = '局部烫金必须选择至少 1 种烫金颜色';
const items: OrderFormBRailQuoteItem[] = ['style-1', 'style-2'].map((key) => ({
  key, label: '局部烫金', status: 'error', amount: null, components: [], message,
}));

beforeEach(() => {
  document.documentElement.lang = 'zh-CN';
  host = document.createElement('div');
  host.dataset.testid = 'rail-fixture';
  host.className = 'max-w-sm p-4';
  document.body.append(host);
  root = createRoot(host);
});
afterEach(() => {
  flushSync(() => root.unmount());
  host.remove();
  document.documentElement.classList.remove('dark');
  vi.restoreAllMocks();
});

function render(quoteItems: OrderFormBRailQuoteItem[], packagingComplete = false) {
  flushSync(() => root.render(<OrderFormBRail
    itemCount={quoteItems.length} quoteItems={quoteItems}
    packaging={{ status: packagingComplete ? 'complete' : 'error', amount: packagingComplete ? '10' : null, message }}
    logistics={{ status: 'error', shippingAmount: null, packagingAmount: null, totalAmount: null, message }}
    usesExternalSalesPricing settlementLabel="外部销售应付工厂"
    gaps={[]} busy={false} onAttemptSubmit={() => {}}
  />));
}

for (const theme of ['light', 'dark']) for (const [width, height] of [
  [375, 667], [393, 852], [768, 1024], [1024, 768], [1280, 800], [1920, 1080],
]) {
  it(`${width} ${theme}: identical errors retain their source through deletion and requoting`, async () => {
    await page.viewport(width, height);
    document.documentElement.classList.toggle('dark', theme === 'dark');
    const errors = vi.spyOn(console, 'error');
    render(items);
    const initial = [...host.querySelectorAll('li')];
    expect(initial.map((node) => node.textContent)).toEqual([
      `第 1 款：${message}`, `第 2 款：${message}`, message, message,
    ]);

    render(items.slice(1));
    const afterDelete = [...host.querySelectorAll('li')];
    expect(afterDelete).toHaveLength(3);
    expect(afterDelete[0]).toBe(initial[1]);
    expect(afterDelete[0].textContent).toBe(`第 1 款：${message}`);
    expect(afterDelete[1]).toBe(initial[2]);
    expect(afterDelete[2]).toBe(initial[3]);

    render(items.slice(1), true);
    const afterQuote = [...host.querySelectorAll('li')];
    expect(afterQuote).toHaveLength(2);
    expect(afterQuote[1]).toBe(initial[3]);
    expect(afterQuote[1].textContent).toBe(message);
    expect(errors).not.toHaveBeenCalled();
    expect(document.documentElement.scrollWidth).toBeLessThanOrEqual(width);
    expect(await commands.checkShellAccessibility('[data-testid="rail-fixture"]')).toEqual([]);
  });
}
