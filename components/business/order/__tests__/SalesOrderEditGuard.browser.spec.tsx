import { flushSync } from 'react-dom';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { page } from 'vitest/browser';
import '@/app/globals.css';
import { Input } from '@/components/ui/input';
import { SalesOrderEditGuard } from '../SalesOrderEditGuard';

/**
 * 销售改单离开保护（真实组件）：确认「放弃修改并离开」只覆盖这一次导航；若链接自己取消了
 * 这次导航，页面上的未保存修改仍在，刷新与再次离开都要继续受保护。
 */
const followed = vi.fn();
let root: Root;
let host: HTMLDivElement;
let shell: HTMLAnchorElement;
beforeEach(() => {
  followed.mockReset();
  shell = document.createElement('a');
  shell.href = '/orders';
  shell.textContent = '侧栏我的工单';
  // Cancels the (replayed) click like Next Link onNavigate.preventDefault().
  shell.addEventListener('click', (event) => { event.preventDefault(); followed(); });
  document.body.append(shell);
  host = document.createElement('div'); document.body.append(host); root = createRoot(host);
  flushSync(() => root.render(<SalesOrderEditGuard>
    <form aria-label="修改申请" onSubmit={(event) => event.preventDefault()}>
      <Input aria-label="收货地址" name="address" defaultValue="原地址" />
    </form>
  </SalesOrderEditGuard>));
});
afterEach(() => { flushSync(() => root.unmount()); host.remove(); shell.remove(); });
const link = () => page.getByRole('link', { name: '侧栏我的工单', exact: true });
function unloadPrevented() {
  const event = new Event('beforeunload', { cancelable: true });
  window.dispatchEvent(event);
  return event.defaultPrevented;
}

it('keeps unsaved input guarded after a confirmed leave that the link itself cancels', async () => {
  await page.getByRole('textbox', { name: '收货地址', exact: true }).fill('新的收货地址');
  await expect.poll(unloadPrevented).toBe(true);
  await link().click();
  const dialog = page.getByRole('alertdialog');
  await expect.element(dialog).toHaveTextContent('离开后，本页未保存的修改将丢失。');
  expect(followed).not.toHaveBeenCalled();
  await dialog.getByRole('button', { name: '放弃修改并离开', exact: true }).click();
  expect(followed).toHaveBeenCalledOnce();
  await expect.element(dialog).not.toBeInTheDocument();
  await expect.element(page.getByRole('textbox', { name: '收货地址', exact: true })).toHaveValue('新的收货地址');
  // Let the MutationObserver / state settle before checking that nothing was disarmed.
  await new Promise((resolve) => setTimeout(resolve, 50));
  expect(unloadPrevented()).toBe(true);
  await link().click();
  await expect.element(page.getByRole('alertdialog')).toBeVisible();
  expect(followed).toHaveBeenCalledOnce();
});

it('does not guard before anything changed', async () => {
  await link().click();
  expect(followed).toHaveBeenCalledOnce();
  expect(unloadPrevented()).toBe(false);
});
