import type { ComponentProps } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { flushSync } from 'react-dom';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { commands, page } from 'vitest/browser';
import { OrderItemRemarkForm } from '../OrderItemRemarkForm';
import { InternalOrderEditWorkspace } from '../InternalOrderEditWorkspace';
import { Input } from '@/components/ui/input';
import '@/app/globals.css';

const mocks = vi.hoisted(() => ({ save: vi.fn(), push: vi.fn() }));
vi.mock('@/actions/order-item-remark', () => ({ editItemRemarkAction: mocks.save }));
vi.mock('next/link', () => ({ default: (props: ComponentProps<'a'>) => <a {...props} /> }));
vi.mock('next/navigation', () => ({ useRouter: () => ({ push: mocks.push }) }));
let host: HTMLDivElement;
let root: Root;
beforeEach(() => {
  vi.resetAllMocks();
  mocks.save.mockResolvedValue({ status: 'success' });
  host = document.createElement('div');
  host.setAttribute('data-testid', 'remark-fixture');
  host.className = 'bg-background p-4 text-foreground';
  document.body.append(host);
  root = createRoot(host);
});
afterEach(() => { flushSync(() => root.unmount()); host.remove(); document.documentElement.classList.remove('dark'); });
function form() {
  return <OrderItemRemarkForm orderId="order" itemId="item" sequence={2} version={3} initial="原备注" />;
}
for (const [width, height] of [[375, 667], [393, 852], [768, 1024], [1024, 768], [1280, 800], [1920, 1080]]) {
  for (const dark of [false, true]) {
    it(`${width}×${height} ${dark ? 'dark' : 'light'}: accessible remark editing`, async () => {
      await page.viewport(width, height);
      document.documentElement.classList.toggle('dark', dark);
      flushSync(() => root.render(form()));
      await page.getByRole('textbox', { name: '第 2 款备注' }).fill('核对方向\n按新版图稿制作');
      await page.getByRole('button', { name: '保存款式备注' }).click();
      await expect.poll(() => mocks.save.mock.calls.length).toBe(1);
      const data = mocks.save.mock.calls[0][3] as FormData;
      expect(data.get('remark')).toBe('核对方向\n按新版图稿制作');
      expect(data.get('expectedEditVersion')).toBe('3');
      expect(document.documentElement.scrollWidth).toBeLessThanOrEqual(width);
      for (const control of host.querySelectorAll('button,textarea')) {
        expect(control.getBoundingClientRect().height).toBeGreaterThanOrEqual(44);
      }
      expect(await commands.checkShellAccessibility('[data-testid="remark-fixture"]')).toEqual([]);
    });
  }
}
it('retains entered text on a domain conflict', async () => {
  mocks.save.mockResolvedValue({ status: 'error', message: '工单已更新，请刷新后重新填写' });
  flushSync(() => root.render(form()));
  await page.getByRole('textbox', { name: '第 2 款备注' }).fill('仍须保留');
  await page.getByRole('button', { name: '保存款式备注' }).click();
  await expect.element(page.getByText('工单已更新，请刷新后重新填写')).toBeVisible();
  await expect.element(page.getByRole('textbox', { name: '第 2 款备注' })).toHaveValue('仍须保留');
});
it('prevents auxiliary saves from replacing dirty basic metadata', async () => {
  flushSync(() => root.render(<InternalOrderEditWorkspace auxiliary={form()}>
    <form><Input aria-label="工单名称" defaultValue="原名" /></form>
  </InternalOrderEditWorkspace>));
  await page.getByRole('textbox', { name: '工单名称' }).fill('未保存的名字');
  await expect.element(page.getByRole('textbox', { name: '第 2 款备注' })).toBeDisabled();
  expect(mocks.save).not.toHaveBeenCalled();
  await page.getByRole('textbox', { name: '工单名称' }).fill('原名');
  await expect.element(page.getByRole('textbox', { name: '第 2 款备注' })).toBeEnabled();
});
