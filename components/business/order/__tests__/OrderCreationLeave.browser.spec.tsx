import type { ComponentProps } from 'react';
import { flushSync } from 'react-dom';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { page } from 'vitest/browser';
import '@/app/globals.css';
import { WORKBENCH_CATALOG, WORKBENCH_CRAFTS } from '@/lib/workbench/__tests__/item-fixtures';
import type { SampleOrderQuote } from '@/lib/order/sample-order';

/**
 * 新建工单页的站内离开保护（Codex 对抗审查 2026-09-30 第三轮）：真实工作台 + 真实 OrderForm，
 * 覆盖结果页、打样入口与保存失败分支。next/link 替身按 Next 的语义调用 onNavigate：
 * 被 preventDefault 就不导航，Cmd/Ctrl 点击（新标签）不调用 onNavigate。
 */
const mocks = vi.hoisted(() => ({
  push: vi.fn(), navigations: [] as string[], upload: vi.fn(),
  quote: vi.fn(), create: vi.fn(),
}));
vi.mock('next/navigation', () => ({ useRouter: () => ({ push: mocks.push, replace: vi.fn(), refresh: vi.fn() }) }));
vi.mock('next/image', () => ({ default: ({ alt }: { alt: string }) => <span>{alt}</span> }));
vi.mock('next/link', () => ({
  __esModule: true,
  default: ({ href, onNavigate, onClick, prefetch: _prefetch, ...props }: ComponentProps<'a'> & {
    prefetch?: boolean; onNavigate?: (event: { preventDefault(): void }) => void;
  }) => {
    void _prefetch;
    return <a {...props} href={String(href)} onClick={(event) => {
      onClick?.(event);
      if (event.defaultPrevented) return;
      event.preventDefault();
      if (event.metaKey || event.ctrlKey) { mocks.navigations.push(`new-tab:${String(href)}`); return; }
      let prevented = false;
      onNavigate?.({ preventDefault: () => { prevented = true; } });
      if (!prevented) mocks.navigations.push(String(href));
    }} />;
  },
}));
vi.mock('@/actions/order', () => ({ createOrderAction: mocks.create, submitOrderAction: vi.fn() }));
vi.mock('@/actions/create-order-quote', () => ({
  quoteExternalCreateOrderAction: vi.fn().mockResolvedValue({ status: 'error', message: '测试不请求报价' }),
  quoteSampleOrderAction: mocks.quote,
}));
vi.mock('@/actions/workbench', () => ({ quoteWorkbenchItemAction: vi.fn() }));
vi.mock('@/actions/design-upload', () => ({
  deleteOrderItemDesignAction: vi.fn(), recordDesignUploadAction: vi.fn(), signDesignUploadAction: vi.fn(),
}));
vi.mock('@/components/business/order/design-upload-client', async (importOriginal) => ({
  ...await importOriginal<typeof import('../design-upload-client')>(),
  uploadOrderItemDesignFile: mocks.upload,
}));

import { OrderCreationWorkspace } from '../OrderCreationWorkspace';

const SCOPE = 'leave-test';
const quote: SampleOrderQuote = {
  total: '12.00', knownTotal: '12.00', quoteToken: 'token', shippingAmount: '12.00',
  packagingAmount: '0.00', packagingOptions: [], errors: [],
};
let host: HTMLDivElement;
let root: Root;
function mount() {
  flushSync(() => root.render(<OrderCreationWorkspace crafts={WORKBENCH_CRAFTS} products={WORKBENCH_CATALOG.products}
    externalCreateOrderOptions={WORKBENCH_CATALOG} draftScope={SCOPE} />));
}
const orderName = () => page.getByRole('textbox', { name: '工单名称', exact: true });
const back = () => page.getByRole('link', { name: '返回工单列表', exact: true });
const dialog = () => page.getByRole('alertdialog');

function selectCdr(name: string) {
  const input = document.querySelector<HTMLInputElement>('input[aria-label="第 1 款 CDR 文件"]')!;
  const transfer = new DataTransfer();
  transfer.items.add(new File(['cdr'], name, { type: 'application/octet-stream' }));
  input.files = transfer.files;
  flushSync(() => input.dispatchEvent(new Event('change', { bubbles: true })));
}

/** 批量：工单 1 仍在填写，工单 2 已创建完成（结果页）。 */
function seedBatchWithCompletedSecond() {
  sessionStorage.setItem(`order-creation-batch:v1:${SCOPE}:new`, JSON.stringify([
    { id: crypto.randomUUID(), primary: true },
    { id: crypto.randomUUID(), created: { orderId: 'order-b', orderNo: 'GD-B', intent: 'submit' }, done: true },
  ]));
}

beforeEach(() => {
  localStorage.clear(); sessionStorage.clear(); vi.clearAllMocks(); mocks.navigations.length = 0;
  mocks.quote.mockResolvedValue({ status: 'success', quote });
  mocks.create.mockResolvedValue({ status: 'success', orderId: 'order-s', orderNo: 'GD-S', itemIds: ['item-1'], pricingStatus: 'AUTO' });
  host = document.createElement('div'); document.body.append(host); root = createRoot(host);
});
afterEach(() => {
  vi.restoreAllMocks();
  flushSync(() => root.unmount()); host.remove();
  localStorage.clear(); sessionStorage.clear();
});

it('① files still waiting on order 1 guard both the header back and 查看工单 on order 2’s result view', async () => {
  seedBatchWithCompletedSecond();
  mount();
  await expect.element(orderName()).toBeEnabled();
  selectCdr('第一单.cdr');
  await expect.element(page.getByTitle('第一单.cdr')).toBeVisible();
  await page.getByRole('button', { name: '工单 2 · 已完成', exact: true }).click();
  await expect.element(page.getByRole('heading', { name: '工单已创建' })).toBeVisible();

  await back().click();
  await expect.element(dialog()).toHaveTextContent('工单 1 的 1 个未上传的设计文件将丢失。');
  expect(mocks.navigations).toEqual([]);
  await dialog().getByRole('button', { name: '继续编辑' }).click();
  await expect.element(dialog()).not.toBeInTheDocument();
  await expect.element(back()).toHaveFocus();

  await page.getByRole('link', { name: '查看工单', exact: true }).click();
  await expect.element(dialog()).toHaveTextContent('工单 1 的 1 个未上传的设计文件将丢失。');
  expect(mocks.navigations).toEqual([]);
  await dialog().getByRole('button', { name: '放弃修改并离开' }).click();
  expect(mocks.push).toHaveBeenCalledWith('/orders/order-b');

  // 新标签打开不离开本页，不弹确认。
  await page.getByRole('link', { name: '查看工单', exact: true }).click({ modifiers: ['ControlOrMeta'] });
  expect(mocks.navigations).toEqual(['new-tab:/orders/order-b']);
  expect(document.querySelector('[role="alertdialog"]')).toBeNull();
});

it('② a failed local-draft save keeps the user on the page with the reason and a way out', async () => {
  mount();
  await expect.element(orderName()).toBeEnabled();
  await orderName().fill('未保存的工单');
  const setItem = Storage.prototype.setItem;
  vi.spyOn(Storage.prototype, 'setItem').mockImplementation(function (this: Storage, key: string, value: string) {
    if (this === window.localStorage) throw new DOMException('full', 'QuotaExceededError');
    return setItem.call(this, key, value);
  });
  await back().click();
  await expect.element(dialog()).toBeVisible();
  const promised = dialog().element().textContent;
  await dialog().getByRole('button').nth(1).click();
  expect(mocks.push).not.toHaveBeenCalled();
  expect(promised).toContain('本单已填写的内容将保存为本机草稿。');
  const notice = page.getByRole('alert').filter({ hasText: '本机草稿未保存' });
  await expect.element(notice).toHaveTextContent('浏览器无法写入本机草稿');
  await expect.element(notice).toHaveTextContent('仍然离开将丢失：本单已填写的内容。');
  await expect.element(orderName()).toHaveValue('未保存的工单');
  await notice.getByRole('button', { name: '仍然离开' }).click();
  expect(mocks.push).toHaveBeenCalledWith('/orders');
});

it('③ the header back is locked while a proof design file uploads', async () => {
  let finish!: (result: { ok: boolean }) => void;
  mocks.upload.mockImplementation(() => new Promise((resolve) => { finish = resolve; }));
  mount();
  await expect.element(orderName()).toBeEnabled();
  await orderName().fill('打样工单');
  await page.getByRole('button', { name: '打样', exact: true }).click();
  await page.getByLabelText('收货人', { exact: true }).fill('测试收货人');
  await page.getByLabelText('手机号', { exact: true }).fill('13800000000');
  await page.getByLabelText('收货地址', { exact: true }).fill('浙江省杭州市测试地址');
  await page.getByRole('button', { name: '核对费用', exact: true }).click();
  await page.getByRole('button', { name: '保存工单', exact: true }).click();
  await expect.poll(() => mocks.create.mock.calls.length).toBe(1);
  await page.getByLabelText('上传设计文件', { exact: true }).upload(new File(['design'], 'design.png', { type: 'image/png' }));
  await expect.poll(() => mocks.upload.mock.calls.length).toBe(1);
  await expect.element(back()).toHaveAttribute('aria-disabled', 'true');
  back().element().dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
  expect(mocks.navigations).toEqual([]);
  expect(document.querySelector('[role="alertdialog"]')).toBeNull();
  finish({ ok: true });
  await expect.element(back()).not.toHaveAttribute('aria-disabled');
});

it('⑤ navigates straight away when nothing would be lost (form and result views)', async () => {
  mount();
  await expect.element(orderName()).toBeEnabled();
  await back().click();
  expect(mocks.navigations).toEqual(['/orders']);
  expect(document.querySelector('[role="alertdialog"]')).toBeNull();

  flushSync(() => root.unmount()); root = createRoot(host);
  sessionStorage.clear(); mocks.navigations.length = 0;
  seedBatchWithCompletedSecond();
  mount();
  await expect.element(orderName()).toBeEnabled();
  await page.getByRole('button', { name: '工单 2 · 已完成', exact: true }).click();
  await page.getByRole('link', { name: '查看工单', exact: true }).click();
  await back().click();
  expect(mocks.navigations).toEqual(['/orders/order-b', '/orders']);
  expect(document.querySelector('[role="alertdialog"]')).toBeNull();
});
