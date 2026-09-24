import { flushSync } from 'react-dom';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, expect, it } from 'vitest';
import { commands, page, userEvent } from 'vitest/browser';
import { SalesRankingChart } from '../SalesRankingChart';
import '@/app/globals.css';

const data = [
  { userId: 'sales-1', displayName: '销售甲', role: 'SALES', totalAmount: '5000.50', orderCount: 1 },
  { userId: 'sales-2', displayName: '销售乙', role: 'SALES', totalAmount: '12345.67', orderCount: 2 },
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
        await expect.element(tooltip).toHaveTextContent('销售乙');
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

// 经营分析页在 375 / 393 视口的门禁曾在 CI 上失败：e2e 留下的长显示名让 Y 轴分类
// 标签向左溢出视口 1.8px（Linux 无中文字体时回退字形更宽）。这里锁定「按实际字体
// 度量单行省略」的契约：任何刻度文字都不能越过图表容器左边界，且长名被截断。
it('393: long display names are ellipsized inside the axis instead of overflowing left', async () => {
  await page.viewport(393, 852);
  const longName = 'E2E 客户及供应商验收账号 1789217384232';
  flushSync(() =>
    root.render(
      <main>
        <h1>销售业绩</h1>
        <SalesRankingChart data={[{ ...data[0]!, displayName: longName }, data[1]!]} />
      </main>,
    ),
  );
  await expect.poll(() => host.querySelectorAll('.recharts-bar-rectangle').length).toBe(2);
  // 自定义 tick 渲染器不带 recharts 的刻度类名，按分类文字内容从 SVG 里找两条 Y 轴标签。
  const findLabels = () =>
    [...host.querySelectorAll<SVGTextElement>('svg text')].filter((node) =>
      /销售乙|E2E/.test(node.textContent ?? ''),
    );
  await expect.poll(() => findLabels().length).toBe(2);
  const labels = findLabels();
  const hostLeft = host.getBoundingClientRect().left;
  for (const label of labels) {
    expect(label.getBoundingClientRect().left, label.textContent ?? '').toBeGreaterThanOrEqual(hostLeft);
    expect(label.getBoundingClientRect().left).toBeGreaterThanOrEqual(0);
  }
  const rendered = labels.map((label) => ({
    text: label.textContent,
    lines: label.querySelectorAll('tspan').length,
    width: Math.round(label.getBoundingClientRect().width),
  }));
  const truncated = labels.find((label) => label.textContent?.includes('…'));
  expect(truncated?.textContent ?? '', JSON.stringify(rendered)).not.toBe(longName);
  expect(truncated?.textContent ?? '', JSON.stringify(rendered)).toMatch(/…$/);
});
