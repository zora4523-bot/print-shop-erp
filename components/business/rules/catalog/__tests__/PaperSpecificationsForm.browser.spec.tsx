import { flushSync } from 'react-dom';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { commands, page, userEvent } from 'vitest/browser';
import { PaperSpecificationsForm } from '../PaperSpecificationsForm';
import { NewCatalogPaperForm } from '../NewCatalogPaperForm';
import { buildPaperSpecificationView } from '@/lib/price/paper-specification-view';
import { ProductCategory } from '@/generated/prisma/enums';
import '@/app/globals.css';
vi.mock('next/link', () => ({ __esModule: true, default: ({ href, children, ...props }: React.AnchorHTMLAttributes<HTMLAnchorElement>) => <a href={href} {...props}>{children}</a> }));
const paper = { id: 'paper', name: '160g红卡', specification: '160g', isActive: true, outOfStock: false };
const product = { categoryNode: { isActive: true, path: 'product.blank_stock', legacyCategory: ProductCategory.BLANK_STOCK }, id: 'product', category: ProductCategory.BLANK_STOCK, specification: '中号封80×115', paperType: '160g红卡', weight: 160, paperMaterialId: null, isActive: true };
const view = buildPaperSpecificationView({ paper, papers: [paper], products: [product], selectableProducts: [product], selectablePapers: [paper], snapshot: null, nodeReady: true });
let host: HTMLDivElement;
let root: Root;
beforeEach(() => { host = document.createElement('div'); document.body.append(host); root = createRoot(host); document.documentElement.lang = 'zh-CN'; });
afterEach(() => { flushSync(() => root.unmount()); host.remove(); document.documentElement.classList.remove('dark'); });
function mount(action = vi.fn(async () => ({ status: 'error' as const, message: '组合资料已变化' }))) {
  flushSync(() => root.render(<main className="p-4"><h1>纸张</h1><PaperSpecificationsForm view={view} action={action} /></main>));
  return action;
}
for (const [width, height] of [[375, 667], [393, 852], [768, 1024], [1024, 768], [1280, 800], [1920, 1080]]) {
  for (const dark of [false, true]) {
    it(`规格复核 ${width} ${dark ? 'dark' : 'light'}：增量、触控、无溢出与无障碍`, async () => {
      await page.viewport(width, height); document.documentElement.classList.toggle('dark', dark); mount();
      const existing = page.getByRole('checkbox', { name: /中号封80×115/ });
      await expect.element(existing).toBeChecked(); await expect.element(existing).toBeDisabled();
      await page.getByRole('checkbox', { name: /迷你封50×80/ }).click();
      await page.getByRole('button', { name: '复核启用规格' }).click();
      await expect.element(page.getByRole('heading', { name: /启用 160g红卡 的 1 种规格/ })).toBeVisible();
      const form = host.querySelector('form')!;
      expect(new FormData(form).getAll('specifications')).toEqual(['mini']);
      expect(new FormData(form).get('reviewed')).toBe('yes');
      expect(host.textContent).toContain('物流费用可能待定');
      expect(document.documentElement.scrollWidth).toBeLessThanOrEqual(width);
      for (const checkbox of host.querySelectorAll('[data-slot="checkbox"]')) {
        expect(checkbox.getBoundingClientRect().width).toBeGreaterThanOrEqual(44);
      }
      expect(await commands.checkShellAccessibility('main')).toEqual([]);
      await page.getByRole('button', { name: '返回修改' }).click();
      expect(new FormData(form).get('reviewed')).toBeNull();
    });
  }
}
it('键盘选择、原生 action 提交与失败后可返回修改', async () => {
  const action = mount();
  const checkbox = host.querySelector<HTMLElement>('[role="checkbox"]')!;
  checkbox.focus(); await userEvent.keyboard(' ');
  await page.getByRole('button', { name: '复核启用规格' }).click();
  await page.getByRole('button', { name: '启用规格', exact: true }).click();
  await expect.poll(() => action.mock.calls.length).toBe(1);
  await expect.element(page.getByText('组合资料已变化')).toBeVisible();
  await page.getByRole('button', { name: '返回修改' }).click();
  await expect.element(page.getByRole('button', { name: '复核启用规格' })).toBeVisible();
});
it('新增纸张复核保留提交字段并集中说明专版影响', async () => {
  const action = vi.fn(async () => ({ status: 'error' as const, message: '同名纸张已存在' }));
  flushSync(() => root.render(<main><h1>新增纸张</h1><NewCatalogPaperForm action={action} /></main>));
  await page.getByRole('textbox', { name: '纸张名称' }).fill('红卡'); await page.getByRole('spinbutton', { name: '克重（g）' }).fill('160');
  await page.getByRole('button', { name: '复核新增纸张' }).click();
  expect(host.textContent?.split('进入专版纸张选项')).toHaveLength(2);
  expect(new FormData(host.querySelector('form')!).get('name')).toBe('红卡');
  await page.getByRole('button', { name: '新增纸张', exact: true }).click();
  await expect.element(page.getByText('同名纸张已存在')).toBeVisible();
  expect(await commands.checkShellAccessibility('main')).toEqual([]);
});
