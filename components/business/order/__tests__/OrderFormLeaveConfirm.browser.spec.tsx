import { flushSync } from 'react-dom';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { page } from 'vitest/browser';
import '@/app/globals.css';
import { Button } from '@/components/ui/button';
import { useOrderFormLeaveConfirm } from '../use-order-form-leave-confirm';

const router = vi.hoisted(() => ({ push: vi.fn() }));
vi.mock('next/navigation', () => ({ useRouter: () => router }));

let host: HTMLElement;
let root: Root;
beforeEach(() => { router.push.mockReset(); host = document.createElement('div'); document.body.append(host); root = createRoot(host); });
afterEach(() => { flushSync(() => root.unmount()); host.remove(); });

// 页头返回是站内链接：beforeunload 拦不住，必须在 onNavigate 判定（Codex 复审 2026-09-30）。
function Harness(props: { protectedLeave: boolean; pendingFileCount: number; other: boolean; persist: () => void; onPassed: () => void }) {
  const leave = useOrderFormLeaveConfirm({
    href: '/orders', protectedLeave: props.protectedLeave, pendingFileCount: props.pendingFileCount,
    otherOrdersHaveUnsavedFiles: props.other, persistDraft: props.persist,
  });
  return <>
    <Button type="button" onClick={() => {
      let prevented = false;
      leave.onNavigate({ preventDefault: () => { prevented = true; } });
      if (!prevented) props.onPassed();
    }}>返回工单列表</Button>
    {leave.dialog}
  </>;
}

it('cancels navigation with unsaved design files and asks before leaving', async () => {
  const persist = vi.fn();
  const passed = vi.fn();
  flushSync(() => root.render(<Harness protectedLeave pendingFileCount={2} other={false} persist={persist} onPassed={passed} />));
  await page.getByRole('button', { name: '返回工单列表' }).click();
  expect(passed).not.toHaveBeenCalled();
  const dialog = page.getByRole('alertdialog');
  await expect.element(dialog).toHaveTextContent('本单 2 个未上传的设计文件将丢失。');
  await dialog.getByRole('button', { name: '继续编辑' }).click();
  expect(router.push).not.toHaveBeenCalled();
  expect(persist).not.toHaveBeenCalled();

  await page.getByRole('button', { name: '返回工单列表' }).click();
  await page.getByRole('alertdialog').getByRole('button', { name: '放弃修改并离开' }).click();
  expect(persist).toHaveBeenCalledTimes(1);
  expect(router.push).toHaveBeenCalledWith('/orders');
});

it('also protects when another batch order still has unsaved files', async () => {
  const passed = vi.fn();
  flushSync(() => root.render(<Harness protectedLeave={false} pendingFileCount={0} other persist={vi.fn()} onPassed={passed} />));
  await page.getByRole('button', { name: '返回工单列表' }).click();
  expect(passed).not.toHaveBeenCalled();
  await expect.element(page.getByRole('alertdialog')).toHaveTextContent('其他工单中未上传的设计文件将丢失。');
});

it('lets navigation through when nothing would be lost', async () => {
  const passed = vi.fn();
  flushSync(() => root.render(<Harness protectedLeave={false} pendingFileCount={0} other={false} persist={vi.fn()} onPassed={passed} />));
  await page.getByRole('button', { name: '返回工单列表' }).click();
  expect(passed).toHaveBeenCalledTimes(1);
  expect(document.querySelector('[role="alertdialog"]')).toBeNull();
});
