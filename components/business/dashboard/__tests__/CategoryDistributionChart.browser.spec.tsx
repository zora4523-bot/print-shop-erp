import { flushSync } from 'react-dom';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { commands, page } from 'vitest/browser';
import { CategoryDistributionChart } from '../CategoryDistributionChart';
import '@/app/globals.css';

const longCategory = '历史导入的超长产品类目ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789连续英文与中文均须完整可读';
const categories = [
  ['BLANK_STOCK', '空白现货', 1234567],
  ['GENERIC_STOCK', '通版现货', 20],
  ['CUSTOM_FLAT_FOIL', '专版烫金', 30],
  ['COLOR_PRINT', '彩印', 40],
  ['STOCK_FOIL_ADD', '现货加烫', 50],
  ['BYO_MATERIAL', '自带纸料', 60],
  ['UNCATEGORIZED', '未分类', 2],
  [longCategory, longCategory, 87654321],
] as const;
const data = categories.map(([category, , orderCount]) => ({ category, orderCount }));

let host: HTMLDivElement;
let root: Root;

beforeEach(() => {
  document.documentElement.lang = 'zh-CN';
  host = document.createElement('div');
  host.dataset.testid = 'category-chart-fixture';
  // Match the narrow admin page padding plus a chart card's inner padding.
  host.className = 'min-w-0 p-8';
  document.body.append(host);
  root = createRoot(host);
});

afterEach(() => {
  flushSync(() => root.unmount());
  host.remove();
  document.documentElement.classList.remove('dark');
});

describe('产品分布的移动端可读性', () => {
  for (const [width, height] of [[375, 667], [393, 852]]) {
    for (const theme of ['light', 'dark']) {
      it(`${width}×${height} ${theme}: 全部类目和单数完整显示，长名称换行`, async () => {
        await page.viewport(width, height);
        document.documentElement.classList.toggle('dark', theme === 'dark');
        flushSync(() => root.render(<CategoryDistributionChart data={data} />));
        await expect.element(page.getByRole('list', { name: '产品类目与工单数量' })).toBeVisible();
        await expect.poll(() => host.querySelectorAll('.recharts-pie-sector').length).toBe(8);

        const chart = host.querySelector<HTMLElement>('[data-slot="dashboard-chart-category"]')!;
        const items = [...chart.querySelectorAll<HTMLLIElement>('ul > li')];
        expect(items).toHaveLength(8);
        expect(chart.querySelector('.recharts-pie-labels')).toBeNull();
        expect(chart.scrollHeight).toBeGreaterThan(320);
        expect(document.documentElement.scrollWidth).toBeLessThanOrEqual(width);

        for (const [index, item] of items.entries()) {
          const [swatch, name, count] = [...item.children] as HTMLElement[];
          expect(name.textContent).toBe(categories[index][1]);
          expect(count.textContent).toBe(`${categories[index][2]} 单`);
          const itemRect = item.getBoundingClientRect();
          const nameRect = name.getBoundingClientRect();
          const countRect = count.getBoundingClientRect();
          expect(nameRect.right).toBeLessThanOrEqual(countRect.left);
          expect(countRect.right).toBeLessThanOrEqual(itemRect.right);
          expect(countRect.right).toBeLessThanOrEqual(width - 32);
          expect(countRect.height).toBe(20);
          expect(swatch.getAttribute('aria-hidden')).toBe('true');
          // Text bounding boxes catch clipping that document overflow checks miss.
          const textRange = document.createRange();
          textRange.selectNodeContents(name);
          for (const line of textRange.getClientRects()) {
            expect(line.left).toBeGreaterThanOrEqual(nameRect.left - 0.5);
            expect(line.right).toBeLessThanOrEqual(nameRect.right + 0.5);
            expect(line.bottom).toBeLessThanOrEqual(itemRect.bottom + 0.5);
          }
        }
        expect(items[7].getBoundingClientRect().height).toBeGreaterThan(40);
        expect(await commands.checkShellAccessibility('[data-testid="category-chart-fixture"]')).toEqual([]);
      });
    }
  }

  it('空数据保留暂无数据提示，不显示虚构类目或单数', async () => {
    await page.viewport(375, 667);
    flushSync(() => root.render(<CategoryDistributionChart data={[]} />));
    await expect.element(page.getByText('暂无数据', { exact: true })).toBeVisible();
    expect(host.querySelector('ul')).toBeNull();
    expect(host.querySelector('svg')).toBeNull();
  });
});
