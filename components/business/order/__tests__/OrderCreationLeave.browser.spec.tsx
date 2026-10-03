import type { ComponentProps } from 'react';
import { flushSync } from 'react-dom';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { page } from 'vitest/browser';
import '@/app/globals.css';
import { WORKBENCH_CATALOG, WORKBENCH_CRAFTS } from '@/lib/workbench/__tests__/item-fixtures';
import type { SampleOrderQuote } from '@/lib/order/sample-order';
import type { CreateOrderQuoteActionInput, CreateOrderQuoteMutationResult } from '@/actions/create-order-quote.types';
import { quoteExternalCreateOrderAction } from '@/actions/create-order-quote';

/**
 * 新建工单页的站内离开保护（Codex 对抗审查 2026-09-30 第三轮）：真实工作台 + 真实 OrderForm，
 * 覆盖结果页、打样入口与保存失败分支。next/link 替身按 Next 的语义调用 onNavigate：
 * 被 preventDefault 就不导航，Cmd/Ctrl 点击（新标签）不调用 onNavigate。
 */
const mocks = vi.hoisted(() => ({
  push: vi.fn(), navigations: [] as string[], upload: vi.fn(),
  quote: vi.fn(), create: vi.fn(), submit: vi.fn(),
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
vi.mock('@/actions/order', () => ({ createOrderAction: mocks.create, submitOrderAction: mocks.submit }));
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

import { PendingLink } from '@/components/ui-business';
import { OrderCreationWorkspace } from '../OrderCreationWorkspace';
import { OrderForm } from '../OrderForm';
import type { OrderCreationEditor } from '../order-creation-editor';
import { localOrderFormDraftStorageKey } from '../order-form-local-draft';

const SCOPE = 'leave-test';
const quote: SampleOrderQuote = {
  total: '12.00', knownTotal: '12.00', quoteToken: 'token', shippingAmount: '12.00',
  packagingAmount: '0.00', packagingOptions: [], errors: [],
};
let host: HTMLDivElement;
let root: Root;
function mount(admin = false) {
  flushSync(() => root.render(<OrderCreationWorkspace crafts={WORKBENCH_CRAFTS} products={WORKBENCH_CATALOG.products}
    externalCreateOrderOptions={WORKBENCH_CATALOG} draftScope={SCOPE}
    externalSalesAccounts={admin ? [{ id: 'sales-1', displayName: '外销甲', username: 'sales-a' }] : undefined} />));
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
  vi.mocked(quoteExternalCreateOrderAction).mockReset().mockResolvedValue({ status: 'error', message: '测试不请求报价' });
  mocks.upload.mockReset();
  mocks.quote.mockResolvedValue({ status: 'success', quote });
  mocks.submit.mockResolvedValue({ status: 'success' });
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
  await expect.element(page.getByRole('button', { name: '查看已保存工单', exact: true })).toBeDisabled();
  page.getByRole('button', { name: '查看已保存工单', exact: true }).element().dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
  expect(mocks.push).not.toHaveBeenCalled();
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

function failWrites(storage: Storage) {
  const original = Storage.prototype.setItem;
  return vi.spyOn(Storage.prototype, 'setItem').mockImplementation(function (this: Storage, key: string, value: string) {
    if (this === storage) throw new DOMException('full', 'QuotaExceededError');
    original.call(this, key, value);
  });
}

it('blocks switching, adding and removal if the current text cannot be persisted', async () => {
  mount();
  await expect.element(orderName()).toBeEnabled();
  await page.getByRole('button', { name: '＋ 添加工单' }).click();
  const failed = failWrites(localStorage);
  await orderName().fill('必须保留的第二单');
  for (const name of ['工单 1', '移除当前工单', '＋ 添加工单']) {
    await page.getByRole('button', { name, exact: true }).click();
    await expect.element(orderName()).toHaveValue('必须保留的第二单');
    await expect.element(page.getByRole('alert').filter({ hasText: '本机草稿未保存' })).toBeVisible();
  }
  const unload = new Event('beforeunload', { cancelable: true });
  window.dispatchEvent(unload);
  expect(unload.defaultPrevented).toBe(true);
  failed.mockRestore();
  await page.getByRole('button', { name: '工单 1', exact: true }).click();
  await page.getByRole('button', { name: '工单 2', exact: true }).click();
  await expect.element(orderName()).toHaveValue('必须保留的第二单');
});

for (const purpose of ['打样', '寄样品']) {
  it(`${purpose} protects its own contact edits when session storage fails`, async () => {
    mount();
    await expect.element(orderName()).toBeEnabled();
    await page.getByRole('button', { name: purpose, exact: true }).click();
    failWrites(sessionStorage);
    await page.getByLabelText('收货地址', { exact: true }).fill('不能丢失的新地址');
    await back().click();
    await expect.element(dialog()).toBeVisible();
    await dialog().getByRole('button', { name: '保存草稿并离开' }).click();
    expect(mocks.push).not.toHaveBeenCalled();
    await expect.element(page.getByRole('alert').filter({ hasText: '本机草稿未保存' })).toBeVisible();
    await page.getByRole('button', { name: '留在本页' }).click();
    await expect.element(back()).toHaveFocus();
    await page.getByRole('button', { name: '＋ 添加工单' }).click();
    await expect.element(page.getByLabelText('收货地址', { exact: true })).toHaveValue('不能丢失的新地址');
  });
}

it('standalone OrderForm protects restored unsaved text even though it is now a default value', async () => {
  let editor: OrderCreationEditor | null = null;
  const props = { crafts: WORKBENCH_CRAFTS, products: WORKBENCH_CATALOG.products, externalCreateOrderOptions: WORKBENCH_CATALOG, draftScope: SCOPE };
  flushSync(() => root.render(<OrderForm {...props} registerEditor={(value) => { editor = value; }} />));
  await expect.element(orderName()).toBeEnabled();
  failWrites(localStorage);
  await orderName().fill('撤销后仍未保存');
  const snapshot = editor!.capture();
  flushSync(() => root.unmount()); root = createRoot(host);
  flushSync(() => root.render(<OrderForm {...props} initialEditor={snapshot} />));
  await expect.element(orderName()).toHaveValue('撤销后仍未保存');
  await back().click();
  await expect.element(dialog()).toHaveTextContent('本单已填写的内容将保存为本机草稿。');
  await dialog().getByRole('button', { name: '保存草稿并离开' }).click();
  expect(mocks.push).not.toHaveBeenCalled();
});

it('restoring a quote draft checks files in every batch order', async () => {
  mount();
  await expect.element(orderName()).toBeEnabled();
  await orderName().fill('报价草稿');
  selectCdr('整批保护.cdr');
  await page.getByRole('button', { name: '＋ 添加工单' }).click();
  const base = localOrderFormDraftStorageKey(SCOPE, true);
  const saved = localStorage.getItem(base)!;
  const id = crypto.randomUUID();
  const currentId = JSON.parse(sessionStorage.getItem(`order-creation-batch:v1:${SCOPE}:new`)!).at(-1).id;
  localStorage.setItem(`${localOrderFormDraftStorageKey(`${SCOPE}:batch:${currentId}`, true)}:workbench:${id}`, saved);
  window.dispatchEvent(new StorageEvent('storage'));
  await page.getByText('报价工单草稿（1）', { exact: true }).click();
  await page.getByRole('link', { name: '恢复草稿', exact: true }).click();
  await expect.element(dialog()).toHaveTextContent('工单 1 的 1 个未上传的设计文件将丢失。');
  expect(mocks.navigations).toEqual([]);
});

it('sample fee navigation checks other orders after submission settles', async () => {
  mount(true);
  await expect.element(orderName()).toBeEnabled();
  selectCdr('第一单未上传.cdr');
  await page.getByRole('button', { name: '＋ 添加工单' }).click();
  await page.getByRole('button', { name: '寄样品', exact: true }).click();
  await page.getByRole('combobox', { name: '关联外部销售', exact: true }).selectOptions('sales-1');
  await page.getByLabelText('样品名称').fill('样品');
  await page.getByLabelText('收货人', { exact: true }).fill('测试收货人');
  await page.getByLabelText('手机号', { exact: true }).fill('13800000000');
  await page.getByLabelText('收货地址', { exact: true }).fill('浙江省杭州市测试地址');
  await page.getByRole('button', { name: '核对费用', exact: true }).click();
  await page.getByRole('button', { name: '保存工单', exact: true }).click();
  let finish!: (value: { status: string }) => void;
  mocks.submit.mockImplementation(() => new Promise((resolve) => { finish = resolve; }));
  await page.getByRole('button', { name: '提交并编辑收费', exact: true }).click();
  await expect.element(page.getByRole('button', { name: '保存并继续下一张', exact: true })).toBeDisabled();
  expect(mocks.push).not.toHaveBeenCalled();
  finish({ status: 'success' });
  await expect.element(dialog()).toHaveTextContent('工单 1 的 1 个未上传的设计文件将丢失。');
  expect(mocks.push).not.toHaveBeenCalled();
  await dialog().getByRole('button', { name: '放弃修改并离开' }).click();
  expect(mocks.push).toHaveBeenCalledWith('/orders/order-s#admin-fee-editor');
});

it('opening a server draft after an upload failure checks all queued files', async () => {
  vi.mocked(quoteExternalCreateOrderAction).mockImplementation(async (input) => successfulQuote(input as CreateOrderQuoteActionInput));
  mount(true);
  await expect.element(orderName()).toBeEnabled();
  await orderName().fill('第一张待上传');
  selectCdr('第一张.cdr');
  await page.getByRole('button', { name: '＋ 添加工单' }).click();
  await orderName().fill('第二张上传失败');
  await page.getByRole('combobox', { name: '关联外部销售', exact: true }).selectOptions('sales-1');
  await page.getByRole('textbox', { name: '收货地址', exact: true }).fill('张先生 13800138000 广东省佛山市南海区测试路1号');
  selectCdr('第二张.cdr');
  mocks.upload.mockResolvedValue({ ok: false, message: '上传失败' });
  await page.getByRole('button', { name: '保存草稿', exact: true }).click();
  await expect.poll(() => mocks.create.mock.calls.length).toBe(1);
  await page.getByRole('link', { name: '打开草稿', exact: true }).click();
  await expect.element(dialog()).toHaveTextContent('工单 1 的 1 个未上传的设计文件将丢失。');
  await expect.element(dialog()).toHaveTextContent('工单 2 的 1 个未上传的设计文件将丢失。');
  expect(mocks.navigations).toEqual([]);
});

function successfulQuote(input: CreateOrderQuoteActionInput): CreateOrderQuoteMutationResult {
  const zero = { complete: true, suggestedShippingTotal: '0.00', suggestedPackagingTotal: '0.00', suggestedTotal: '0.00', components: [], errors: [] };
  const version = { id: 'test', code: 'test', version: 1, sourceSha256: 'test' };
  return { status: 'success', quote: {
    factsKey: input.factsKey, knownTotal: '12.00', total: '12.00', quoteToken: 'test',
    totalSemantics: 'COMPLETE', hasManualPricing: false, plateFee: null,
    priceVersion: { processing: version, logistics: version },
    items: input.items.map(() => ({ complete: true, errors: [], components: [], suggestedSubtotal: '12.00', suggestedFixedFee: '12.00', suggestedUnitPrice: '0.00', snapshot: {} })),
    packaging: { groups: [], suggestedTotal: '0.00', requiresAdminConfirmation: false, errors: [] },
    logistics: { ...zero, shipments: [], snapshot: { ...zero, version: 2,
      policy: { ruleVersion: 'test', billableWeightInput: 'SERVER_ESTIMATE_WITH_ACTUAL_OVERRIDE', weightResolutionOrder: [], maxOrderQuantity: 999999, billableWeightRounding: 'CEIL_KG' },
      input: { isSfCollect: false, shipments: [] } } },
  } };
}

it('normal-order fee navigation checks the batch after upload and submit complete', async () => {
  vi.mocked(quoteExternalCreateOrderAction).mockImplementation(async (input) => successfulQuote(input as CreateOrderQuoteActionInput));
  mocks.upload.mockResolvedValue({ ok: true });
  mount(true);
  await expect.element(orderName()).toBeEnabled();
  await orderName().fill('第一张有文件');
  selectCdr('保留文件.cdr');
  await page.getByRole('button', { name: '＋ 添加工单' }).click();
  await orderName().fill('第二张准备收费');
  await page.getByRole('combobox', { name: '关联外部销售', exact: true }).selectOptions('sales-1');
  await page.getByRole('textbox', { name: '收货地址', exact: true }).fill('张先生 13800138000 广东省佛山市南海区测试路1号');
  const png = Uint8Array.from(atob('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aMioAAAAASUVORK5CYII='), (c) => c.charCodeAt(0));
  await page.getByLabelText('第 1 款 设计图', { exact: true }).upload(new File([png], 'design.png', { type: 'image/png' }));
  await page.getByRole('button', { name: '创建并编辑收费', exact: true }).click();
  await page.getByRole('dialog').getByRole('button', { name: '确认无误，提交', exact: true }).click();
  await expect.element(dialog()).toHaveTextContent('工单 1 的 1 个未上传的设计文件将丢失。');
  expect(mocks.push).not.toHaveBeenCalled();
  await dialog().getByRole('button', { name: '放弃修改并离开', exact: true }).click();
  expect(mocks.push).toHaveBeenCalledWith('/orders/order-s#admin-fee-editor');
});

/**
 * 全应用导航守卫（2026-10-04）：侧栏、面包屑父级等工作台外的站内链接与浏览器后退 / 前进
 * 同样经过整批判定。外壳链接用 PendingLink（内部即 Next Link，与面包屑父级同一组件）渲染在工作台之外。
 */
describe('links outside the workspace and browser history', () => {
  let originalNavigation: PropertyDescriptor | undefined;
  let navigation: EventTarget & { traverseTo: ReturnType<typeof vi.fn> };
  beforeEach(() => {
    originalNavigation = Object.getOwnPropertyDescriptor(window, 'navigation');
    navigation = Object.assign(new EventTarget(), {
      traverseTo: vi.fn(() => ({ committed: Promise.resolve(), finished: Promise.resolve() })),
    });
    Object.defineProperty(window, 'navigation', { configurable: true, value: navigation });
  });
  afterEach(() => {
    if (originalNavigation) Object.defineProperty(window, 'navigation', originalNavigation);
    else Reflect.deleteProperty(window, 'navigation');
  });
  function mountInShell() {
    flushSync(() => root.render(<>
      <nav aria-label="侧栏"><PendingLink href="/foreman/schedule" pending={false}>排产看板</PendingLink></nav>
      <nav aria-label="面包屑"><PendingLink href="/orders" pending={false}>工单列表</PendingLink></nav>
      <OrderCreationWorkspace crafts={WORKBENCH_CRAFTS} products={WORKBENCH_CATALOG.products}
        externalCreateOrderOptions={WORKBENCH_CATALOG} draftScope={SCOPE} />
    </>));
  }
  const sidebar = () => page.getByRole('link', { name: '排产看板', exact: true });
  const breadcrumb = () => page.getByRole('link', { name: '工单列表', exact: true });
  function traversal(key: string, path: string) {
    const event = new Event('navigate', { cancelable: true });
    Object.assign(event, { navigationType: 'traverse', destination: { key, url: new URL(path, location.href).href, sameDocument: true } });
    navigation.dispatchEvent(event);
    return event;
  }

  it('sidebar, breadcrumb parent and browser back ask before discarding an unuploaded file', async () => {
    mountInShell();
    await expect.element(orderName()).toBeEnabled();
    selectCdr('侧栏离开.cdr');
    await expect.element(page.getByTitle('侧栏离开.cdr')).toBeVisible();

    await sidebar().click();
    await expect.element(dialog()).toHaveTextContent('本单 1 个未上传的设计文件将丢失。');
    expect(mocks.navigations).toEqual([]);
    await dialog().getByRole('button', { name: '继续编辑' }).click();
    await expect.element(dialog()).not.toBeInTheDocument();
    await expect.element(sidebar()).toHaveFocus();

    await breadcrumb().click();
    await expect.element(dialog()).toHaveTextContent('本单 1 个未上传的设计文件将丢失。');
    await dialog().getByRole('button', { name: '放弃修改并离开' }).click();
    expect(mocks.push).toHaveBeenCalledExactlyOnceWith('/orders');
    expect(mocks.navigations).toEqual([]);

    const before = { length: history.length, href: location.href };
    expect(traversal('previous-entry', '/orders').defaultPrevented).toBe(true);
    await expect.element(dialog()).toHaveTextContent('本单 1 个未上传的设计文件将丢失。');
    expect({ length: history.length, href: location.href }).toEqual(before);
    await dialog().getByRole('button', { name: '放弃修改并离开' }).click();
    expect(navigation.traverseTo).toHaveBeenCalledExactlyOnceWith('previous-entry');
  });

  it('browser back saves unsaved text as a local draft before leaving', async () => {
    mountInShell();
    await expect.element(orderName()).toBeEnabled();
    await orderName().fill('后退前保存');
    expect(traversal('previous-entry', '/orders').defaultPrevented).toBe(true);
    await expect.element(dialog()).toHaveTextContent('本单已填写的内容将保存为本机草稿。');
    await dialog().getByRole('button', { name: '保存草稿并离开' }).click();
    expect(navigation.traverseTo).toHaveBeenCalledExactlyOnceWith('previous-entry');
    expect(Object.values({ ...localStorage }).some((value) => value.includes('后退前保存'))).toBe(true);
  });

  it('a failed draft save on browser back keeps the page and 仍然离开 resumes the traversal', async () => {
    mountInShell();
    await expect.element(orderName()).toBeEnabled();
    await orderName().fill('后退保存失败');
    failWrites(localStorage);
    traversal('previous-entry', '/orders');
    await dialog().getByRole('button', { name: '保存草稿并离开' }).click();
    const notice = page.getByRole('alert').filter({ hasText: '本机草稿未保存' });
    await expect.element(notice).toBeVisible();
    expect(navigation.traverseTo).not.toHaveBeenCalled();
    await notice.getByRole('button', { name: '仍然离开' }).click();
    expect(navigation.traverseTo).toHaveBeenCalledExactlyOnceWith('previous-entry');
    expect(mocks.push).not.toHaveBeenCalled();
  });

  it('shell links and history pass straight through when nothing would be lost', async () => {
    mountInShell();
    await expect.element(orderName()).toBeEnabled();
    await sidebar().click();
    await breadcrumb().click();
    expect(traversal('previous-entry', '/orders').defaultPrevented).toBe(false);
    expect(mocks.navigations).toEqual(['/foreman/schedule', '/orders']);
    expect(document.querySelector('[role="alertdialog"]')).toBeNull();
  });

  it('holds shell links and history without a dialog while an upload is running', async () => {
    let finish!: (result: { ok: boolean }) => void;
    mocks.upload.mockImplementation(() => new Promise((resolve) => { finish = resolve; }));
    mountInShell();
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
    await sidebar().click();
    await breadcrumb().click();
    expect(traversal('previous-entry', '/orders').defaultPrevented).toBe(true);
    expect(mocks.navigations).toEqual([]);
    expect(mocks.push).not.toHaveBeenCalled();
    expect(document.querySelector('[role="alertdialog"]')).toBeNull();
    finish({ ok: true });
    await expect.element(back()).not.toHaveAttribute('aria-disabled');
  });
});
