import type { ComponentProps } from 'react';
import { flushSync } from 'react-dom';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { page } from 'vitest/browser';
import '@/app/globals.css';
import { PageHeader } from '@/components/ui-business';
import { OrderCreatedSuccessView } from '../OrderCreatedSuccessView';
import { useOrderCreationLeave, useOrderLeaveReport, type LocalDraftSaveFailure, type OrderLeaveState } from '../order-creation-leave';

const mocks = vi.hoisted(() => ({ push: vi.fn(), navigations: [] as string[] }));
vi.mock('next/navigation', () => ({ useRouter: () => ({ push: mocks.push }) }));
vi.mock('next/link', () => ({
  __esModule: true,
  default: ({ href, onNavigate, onClick, ...props }: ComponentProps<'a'> & { onNavigate?: (event: { preventDefault(): void }) => void }) =>
    <a {...props} href={String(href)} onClick={(event) => {
      onClick?.(event);
      if (event.defaultPrevented) return;
      event.preventDefault();
      let prevented = false;
      onNavigate?.({ preventDefault: () => { prevented = true; } });
      if (!prevented) mocks.navigations.push(String(href));
    }} />,
}));

let host: HTMLElement;
let root: Root;
beforeEach(() => {
  mocks.push.mockReset(); mocks.navigations.length = 0;
  host = document.createElement('div'); document.body.append(host); root = createRoot(host);
});
afterEach(() => { flushSync(() => root.unmount()); host.remove(); });

const IDLE: OrderLeaveState = { active: true, dirty: false, pendingFileCount: 0, submitted: false, busy: false };

function Reporter({ id, state, persist }: { id: string; state: OrderLeaveState; persist?: () => LocalDraftSaveFailure | null }) {
  const leave = useOrderLeaveReport(id, state, persist);
  return id === 'a' ? <PageHeader title="新建工单" back={leave.back('/orders', '返回工单列表')} /> : null;
}

/** 工作台层：统一的确认层；表单分支只上报状态。 */
function Harness({ orders }: { orders: { id: string; state: OrderLeaveState; persist?: () => LocalDraftSaveFailure | null }[] }) {
  const leave = useOrderCreationLeave({
    labelFor: (key) => (orders.length === 1 ? '本单' : `工单 ${orders.findIndex((order) => order.id === key) + 1}`),
  });
  return <leave.Provider value={leave.context}>
    {leave.dialog}
    {orders.map((order) => <Reporter key={order.id} {...order} />)}
  </leave.Provider>;
}

const back = () => page.getByRole('link', { name: '返回工单列表' });

it('cancels navigation with unsaved design files and asks before leaving', async () => {
  const persist = vi.fn(() => null);
  flushSync(() => root.render(<Harness orders={[{ id: 'a', state: { ...IDLE, dirty: true, pendingFileCount: 2 }, persist }]} />));
  await back().click();
  expect(mocks.navigations).toEqual([]);
  const dialog = page.getByRole('alertdialog');
  await expect.element(dialog).toHaveTextContent('本单 2 个未上传的设计文件将丢失。');
  await expect.element(dialog).toHaveTextContent('本单已填写的内容将保存为本机草稿。');
  await dialog.getByRole('button', { name: '继续编辑' }).click();
  expect(mocks.push).not.toHaveBeenCalled();
  expect(persist).not.toHaveBeenCalled();
  await expect.element(back()).toHaveFocus();

  await back().click();
  await page.getByRole('alertdialog').getByRole('button', { name: '放弃修改并离开' }).click();
  expect(persist).toHaveBeenCalledTimes(1);
  expect(mocks.push).toHaveBeenCalledWith('/orders');
});

it('also protects when another batch order still has unsaved files, naming that order', async () => {
  flushSync(() => root.render(<Harness orders={[{ id: 'a', state: IDLE }, { id: 'b', state: { ...IDLE, active: false, pendingFileCount: 1 } }]} />));
  await back().click();
  expect(mocks.navigations).toEqual([]);
  const dialog = page.getByRole('alertdialog');
  await expect.element(dialog).toHaveTextContent('工单 2 的 1 个未上传的设计文件将丢失。');
  await expect.element(dialog).not.toHaveTextContent('本机草稿');
});

it('only saves the draft (no loss wording) when the current order is merely edited', async () => {
  const persist = vi.fn(() => null);
  flushSync(() => root.render(<Harness orders={[{ id: 'a', state: { ...IDLE, dirty: true }, persist }]} />));
  await back().click();
  const dialog = page.getByRole('alertdialog');
  await expect.element(dialog).toHaveTextContent('本单已填写的内容将保存为本机草稿。');
  await expect.element(dialog).not.toHaveTextContent('丢失');
  await dialog.getByRole('button', { name: '保存草稿并离开' }).click();
  expect(persist).toHaveBeenCalledTimes(1);
  expect(mocks.push).toHaveBeenCalledWith('/orders');
});

it('stays on the page with the reason when the local draft cannot be serialised; the user may still leave', async () => {
  flushSync(() => root.render(<Harness orders={[{ id: 'a', state: { ...IDLE, dirty: true, pendingFileCount: 1 }, persist: () => 'unserializable' }]} />));
  await back().click();
  await page.getByRole('alertdialog').getByRole('button', { name: '放弃修改并离开' }).click();
  expect(mocks.push).not.toHaveBeenCalled();
  const notice = page.getByRole('alert').filter({ hasText: '本机草稿未保存' });
  await expect.element(notice).toHaveTextContent('本单：表单内容无法存为本机草稿。');
  await expect.element(notice).toHaveTextContent('仍然离开将丢失：本单已填写的内容、本单 1 个未上传的设计文件。');
  await notice.getByRole('button', { name: '留在本页' }).click();
  await expect.element(notice).not.toBeInTheDocument();
  expect(mocks.push).not.toHaveBeenCalled();

  await back().click();
  await page.getByRole('alertdialog').getByRole('button', { name: '放弃修改并离开' }).click();
  await page.getByRole('button', { name: '仍然离开' }).click();
  expect(mocks.push).toHaveBeenCalledWith('/orders');
});

it('locks the header back while any order is submitting or uploading', async () => {
  flushSync(() => root.render(<Harness orders={[{ id: 'a', state: { ...IDLE, dirty: true } }, { id: 'b', state: { ...IDLE, active: false, busy: true } }]} />));
  await expect.element(back()).toHaveAttribute('aria-disabled', 'true');
  back().element().dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
  expect(mocks.navigations).toEqual([]);
  expect(document.querySelector('[role="alertdialog"]')).toBeNull();
});

it('lets navigation through when nothing would be lost', async () => {
  flushSync(() => root.render(<Harness orders={[{ id: 'a', state: IDLE }]} />));
  await back().click();
  expect(mocks.navigations).toEqual(['/orders']);
  expect(document.querySelector('[role="alertdialog"]')).toBeNull();
});

it('④ the single-order success view offers exactly one way back to the list (the page header)', async () => {
  function Success() {
    const leave = useOrderLeaveReport('a', { ...IDLE, submitted: true });
    return <OrderCreatedSuccessView order={{ orderNo: 'GD-1', manualQuote: false, readyForProduction: true }} back={leave.back('/orders', '返回工单列表')} />;
  }
  function Workspace() {
    const leave = useOrderCreationLeave({ labelFor: () => '本单' });
    return <leave.Provider value={leave.context}>{leave.dialog}<Success /></leave.Provider>;
  }
  flushSync(() => root.render(<Workspace />));
  await expect.element(page.getByRole('heading', { name: '工单已提交' })).toBeVisible();
  const returns = [...document.querySelectorAll('a, button')].filter((element) => element.textContent?.includes('返回工单列表'));
  expect(returns).toHaveLength(1);
  expect(returns[0].closest('[data-slot="page-header"]')).not.toBeNull();
  await expect.element(page.getByRole('button', { name: '再建一单' })).toBeVisible();
  await back().click();
  expect(mocks.navigations).toEqual(['/orders']);
});

it('protects unsaved text in a hidden batch order and browser unload', async () => {
  flushSync(() => root.render(<Harness orders={[{ id: 'a', state: IDLE }, { id: 'b', state: { ...IDLE, active: false, dirty: true }, persist: () => 'storage' }]} />));
  const unload = new Event('beforeunload', { cancelable: true });
  window.dispatchEvent(unload);
  expect(unload.defaultPrevented).toBe(true);
  await back().click();
  await expect.element(page.getByRole('alertdialog')).toHaveTextContent('工单 2 已填写的内容将保存为本机草稿。');
});

it('does not claim successfully persisted orders are lost when another save fails', async () => {
  flushSync(() => root.render(<Harness orders={[
    { id: 'a', state: { ...IDLE, dirty: true }, persist: () => null },
    { id: 'b', state: { ...IDLE, dirty: true }, persist: () => 'storage' },
  ]} />));
  await back().click();
  await page.getByRole('alertdialog').getByRole('button', { name: '保存草稿并离开' }).click();
  const notice = page.getByRole('alert').filter({ hasText: '本机草稿未保存' });
  await expect.element(notice).not.toHaveTextContent('工单 1 已填写的内容');
  await expect.element(notice).toHaveTextContent('工单 2 已填写的内容');
  expect(mocks.push).not.toHaveBeenCalled();
});

it('locks an existing save-failure exit when a request starts', async () => {
  const persist = () => 'storage' as const;
  flushSync(() => root.render(<Harness orders={[{ id: 'a', state: { ...IDLE, dirty: true }, persist }]} />));
  await back().click();
  await page.getByRole('alertdialog').getByRole('button', { name: '保存草稿并离开' }).click();
  flushSync(() => root.render(<Harness orders={[{ id: 'a', state: { ...IDLE, dirty: true, busy: true }, persist }]} />));
  await expect.element(page.getByRole('button', { name: '仍然离开' })).toBeDisabled();
  page.getByRole('button', { name: '仍然离开' }).element().dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
  expect(mocks.push).not.toHaveBeenCalled();
});

it('returns focus to the source when dismissing a save failure', async () => {
  flushSync(() => root.render(<Harness orders={[{ id: 'a', state: { ...IDLE, dirty: true }, persist: () => 'storage' }]} />));
  await back().click();
  await page.getByRole('alertdialog').getByRole('button', { name: '保存草稿并离开' }).click();
  await page.getByRole('button', { name: '留在本页' }).click();
  await expect.element(back()).toHaveFocus();
});

it('removes obsolete failure text after that order has been saved', async () => {
  const persist = () => 'storage' as const;
  flushSync(() => root.render(<Harness orders={[{ id: 'a', state: { ...IDLE, dirty: true }, persist }]} />));
  await back().click();
  await page.getByRole('alertdialog').getByRole('button', { name: '保存草稿并离开' }).click();
  flushSync(() => root.render(<Harness orders={[{ id: 'a', state: IDLE, persist }]} />));
  await expect.element(page.getByRole('alert').filter({ hasText: '本机草稿未保存' })).not.toBeInTheDocument();
});

it('fails closed when an unsaved editor has no persistence callback', async () => {
  flushSync(() => root.render(<Harness orders={[{ id: 'a', state: { ...IDLE, dirty: true } }]} />));
  await back().click();
  await page.getByRole('alertdialog').getByRole('button', { name: '保存草稿并离开' }).click();
  expect(mocks.push).not.toHaveBeenCalled();
  await expect.element(page.getByRole('alert').filter({ hasText: '本机草稿未保存' })).toBeVisible();
});
