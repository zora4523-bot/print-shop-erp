import { flushSync } from 'react-dom';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, expect, it } from 'vitest';
import { commands, page, userEvent } from 'vitest/browser';
import { SalesRankingChart } from '../SalesRankingChart';
import '@/app/globals.css';

const data = [
  { userId: 'sales-1', displayName: '销售甲', role: 'SALES', totalAmount: '5000.50', orderCount: 1 },
  { userId: 'cs-1', displayName: '客服乙', role: 'CUSTOMER_SERVICE', totalAmount: '12345.67', orderCount: 2 },
];
let host: HTMLDivElement;
let root: Root;

beforeEach(() => {
  document.documentElement.lang = 'zh-CN';
  host = document.createElement('div');
  host.dataset.testid = 'sales-ranking-fixture';
  host.className = 'bg-background p-8 text-foreground';
  document.body.append(host);
  root = createRoot(host);
});

afterEach(() => {
  flushSync(() => root.unmount());
  host.remove();
  document.documentElement.classList.remove('dark');
});

function luminance(cssColor: string) {
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = 1;
  const context = canvas.getContext('2d')!;
  // Canvas resolves the browser's computed CSS colors (including oklch) to sRGB.
  context.fillStyle = cssColor;
  context.fillRect(0, 0, 1, 1);
  const rgb = [...context.getImageData(0, 0, 1, 1).data].slice(0, 3).map((value) => {
    const channel = value / 255;
    return channel <= 0.04045 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4;
  });
  return rgb[0] * 0.2126 + rgb[1] * 0.7152 + rgb[2] * 0.0722;
}

for (const theme of ['light', 'dark']) {
  for (const interaction of ['hover', 'keyboard']) {
    it(`${theme}: ${interaction} exposes readable tooltip names and exact amounts`, async () => {
      await page.viewport(1920, 1080);
      document.documentElement.classList.toggle('dark', theme === 'dark');
      flushSync(() => root.render(<main><h1>销售业绩</h1><SalesRankingChart data={data} /></main>));
      await expect.poll(() => host.querySelectorAll('.recharts-bar-rectangle').length).toBe(2);
      if (interaction === 'hover') {
        await page.elementLocator(host.querySelector('.recharts-bar-rectangle')!).hover();
      } else {
        await page.getByRole('heading', { name: '销售业绩' }).hover();
        const chart = page.getByRole('application');
        await userEvent.keyboard('{Tab}');
        await expect.poll(() => document.activeElement).toBe(chart.element());
      }

      // Use its semantic role: an element-derived text locator becomes stale
      // when keyboard navigation changes the tooltip payload.
      const tooltip = page.getByRole('status');
      await expect.element(tooltip).toBeVisible();
      await expect.element(tooltip).toHaveTextContent('销售甲');
      await expect.element(tooltip).toHaveTextContent('¥ 5,000.50');
      if (interaction === 'keyboard') {
        // Recharts' vertical chart maps ArrowLeft to the next data index.
        await userEvent.keyboard('{ArrowLeft}');
        await expect.element(tooltip).toHaveTextContent('客服乙');
        await expect.element(tooltip).toHaveTextContent('¥ 12,345.67');
      }
      const background = luminance(getComputedStyle(tooltip.element()).backgroundColor);
      for (const selector of ['.recharts-tooltip-item-name', '.recharts-tooltip-item-value']) {
        const text = tooltip.element().querySelector(selector)!;
        const foreground = luminance(getComputedStyle(text).color);
        const ratio = (Math.max(foreground, background) + 0.05) / (Math.min(foreground, background) + 0.05);
        expect(ratio, `${theme} ${interaction} ${selector}`).toBeGreaterThanOrEqual(4.5);
      }
      expect(await commands.checkShellAccessibility('[data-testid="sales-ranking-fixture"]')).toEqual([]);
      // Keep the tooltip open for the entire accessibility check.
      await expect.element(tooltip).toBeVisible();
    });
  }
}
