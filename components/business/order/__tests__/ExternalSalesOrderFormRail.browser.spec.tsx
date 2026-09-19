import type { ComponentProps } from 'react';
import { flushSync } from 'react-dom';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { commands, page, userEvent } from 'vitest/browser';
import '@/app/globals.css';
import { OrderFormBRail, type OrderFormBRailQuoteItem } from '../ExternalSalesOrderFormRail';

vi.mock('next/link', () => ({ default: (props: ComponentProps<'a'>) => <a {...props} /> }));

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
  it(`${width} ${theme}: deduplicated shared errors and item identity survive deletion and requoting`, async () => {
    await page.viewport(width, height);
    document.documentElement.classList.toggle('dark', theme === 'dark');
    const errors = vi.spyOn(console, 'error');
    render(items);
    const initial = [...host.querySelectorAll('li')];
    expect(initial.map((node) => node.textContent)).toEqual([
      `第 1 款：${message}`, `第 2 款：${message}`, message,
    ]);

    render(items.slice(1));
    const afterDelete = [...host.querySelectorAll('li')];
    expect(afterDelete).toHaveLength(2);
    expect(afterDelete[0]).toBe(initial[1]);
    expect(afterDelete[0].textContent).toBe(`第 1 款：${message}`);
    expect(afterDelete[1]).toBe(initial[2]);

    render(items.slice(1), true);
    const afterQuote = [...host.querySelectorAll('li')];
    expect(afterQuote).toHaveLength(2);
    expect(afterQuote[1]).toBe(initial[2]);
    expect(afterQuote[1].textContent).toBe(message);
    expect(errors).not.toHaveBeenCalled();
    expect(document.documentElement.scrollWidth).toBeLessThanOrEqual(width);
    expect(await commands.checkShellAccessibility('[data-testid="rail-fixture"]')).toEqual([]);
  });
}

for (const theme of ['light', 'dark']) for (const [width, height] of [
  [375, 667], [393, 852], [768, 1024], [1024, 768], [1280, 800], [1920, 1080],
]) {
  it(`${width} ${theme}: both settlements expose breakdown, pending fees and actionable gaps`, async () => {
    await page.viewport(width, height);
    document.documentElement.classList.toggle('dark', theme === 'dark');
    const onGapClick = vi.fn();
    const onAttemptSubmit = vi.fn();
    for (const external of [false, true]) {
      flushSync(() => root.render(<OrderFormBRail
        itemCount={1} quoteItems={[{ key: 'one', label: '局部烫金 · 大号封', status: 'complete', amount: '170',
          components: [{ label: '空白封', amount: '130' }, { label: '局部烫金', amount: '40' }] }]}
        packaging={{ status: 'complete', amount: '0', label: '不包装', pricingSource: 'ADMIN' }}
        plateFee={{ status: 'PENDING', amount: null, displayAmount: '待定', label: '制烫金版费' }}
        logistics={{ status: 'incomplete', shippingAmount: null, packagingAmount: '3', totalAmount: null }}
        usesExternalSalesPricing={external} settlementLabel={external ? '外部销售应付工厂' : '工厂直接业务'}
        knownTotal="173" gaps={['未填写承诺交期']} busy={false}
        onGapClick={onGapClick} onAttemptSubmit={onAttemptSubmit}
      />));
      expect(host.textContent).toContain('¥ 130.00');
      expect(host.textContent).toContain('¥ 40.00');
      expect(host.textContent).toContain('¥ 0.00人工价');
      expect(host.textContent).toContain('制烫金版费');
      // 2026-09-18 起内销 / 工厂直接与外销共用物流价目，费用栏同样列出纸箱耗材与快递费。
      expect(host.textContent).toContain('纸箱耗材');
      expect(host.textContent).toContain('快递费');
      for (const control of host.querySelectorAll('button')) expect(control.getBoundingClientRect().height).toBeGreaterThanOrEqual(44);
      await page.getByRole('button', { name: '未填写承诺交期', exact: true }).click();
      expect(onGapClick).toHaveBeenLastCalledWith(0);
      const submit = host.querySelector<HTMLButtonElement>('button[value="submit"]')!;
      submit.focus();
      await userEvent.keyboard('{Enter}');
      expect(onAttemptSubmit).toHaveBeenLastCalledWith('submit');
      expect(document.documentElement.scrollWidth).toBeLessThanOrEqual(width);
      expect(await commands.checkShellAccessibility('[data-testid="rail-fixture"]')).toEqual([]);
    }
  });
}
