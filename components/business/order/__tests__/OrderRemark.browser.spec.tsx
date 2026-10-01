import { flushSync } from 'react-dom';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, expect, it } from 'vitest';
import { commands, page } from 'vitest/browser';
import '@/app/globals.css';
import { OrderRemark } from '../OrderRemark';

/** 折叠提示只显示当前可做的一件事：收起时「展开」，展开时「收起」。 */
function visibleIndicatorText(summary: HTMLElement): string {
  return [...summary.querySelectorAll<HTMLElement>('[data-slot="disclosure-indicator"] span')]
    .filter((label) => getComputedStyle(label).display !== 'none')
    .map((label) => label.textContent)
    .join('');
}
let host: HTMLDivElement;
let root: Root;
const note = '先核对样稿，再安排生产。\n' + '注意收货标签与款式对应。'.repeat(70);
beforeEach(() => {
  document.documentElement.lang = 'zh-CN';
  host = document.createElement('div');
  host.dataset.testid = 'remark-fixture';
  host.className = 'p-4';
  document.body.append(host);
  root = createRoot(host);
});
afterEach(() => {
  flushSync(() => root.unmount()); host.remove();
  document.documentElement.classList.remove('dark');
});
for (const theme of ['light', 'dark']) for (const [width, height] of [[375,667], [393,852], [768,1024], [1024,768], [1280,800], [1920,1080]]) {
  it(`${width} ${theme}: full note is red, wrapping and accessible; list opens without activating its row`, async () => {
    await page.viewport(width, height);
    document.documentElement.classList.toggle('dark', theme === 'dark');
    let rowClicks = 0;
    flushSync(() => root.render(<><h1>工单</h1><OrderRemark remark={note} /><div onClick={() => rowClicks++}><OrderRemark remark={note} compact /></div></>));
    const full = host.querySelector('section[data-slot="order-remark"]')!;
    expect(full.textContent).toContain(note);
    expect(getComputedStyle(full.querySelector('p')!).whiteSpace).toBe('pre-wrap');
    const primary = document.createElement('span'); primary.className = 'text-primary'; host.append(primary);
    expect(getComputedStyle(full).color).toBe(getComputedStyle(primary).color);
    expect(document.documentElement.scrollWidth).toBeLessThanOrEqual(width);
    const summary = host.querySelector('details summary span[aria-describedby]')!;
    expect(document.getElementById(summary.getAttribute('aria-describedby')!)?.textContent).toBe(note);
    const compactSummary = host.querySelector<HTMLElement>('details > summary')!;
    expect(visibleIndicatorText(compactSummary)).toBe('展开');
    await page.elementLocator(compactSummary).click();
    expect(host.querySelector('details')?.open).toBe(true);
    expect(visibleIndicatorText(compactSummary)).toBe('收起');
    expect(host.querySelector('details > p')?.textContent).toBe(note);
    expect(rowClicks).toBe(0);
    expect(await commands.checkShellAccessibility('[data-testid="remark-fixture"]')).toEqual([]);
  });
}
it('omits whitespace-only and missing notes', () => {
  flushSync(() => root.render(<><OrderRemark remark={'  \n '} /><OrderRemark compact /></>));
  expect(host.children.length).toBe(0);
});
