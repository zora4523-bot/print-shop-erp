import type { ComponentProps } from 'react';
import { flushSync } from 'react-dom';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { page } from 'vitest/browser';
import '@/app/globals.css';
import { WORKBENCH_CATALOG, WORKBENCH_CRAFTS } from '@/lib/workbench/__tests__/item-fixtures';
import type { OrderCreationEditor } from '../order-creation-editor';
import { localOrderFormDraftStorageKey, serializeLocalOrderFormDraft } from '../order-form-local-draft';

vi.mock('next/navigation', () => ({ useRouter: () => ({ push: vi.fn(), replace: vi.fn(), refresh: vi.fn() }) }));
vi.mock('next/link', () => ({ default: (props: ComponentProps<'a'>) => <a {...props} /> }));
vi.mock('next/image', () => ({ default: ({ alt }: { alt: string }) => <span>{alt}</span> }));
vi.mock('@/actions/order', () => ({ createOrderAction: vi.fn(), submitOrderAction: vi.fn() }));
vi.mock('@/actions/create-order-quote', () => ({
  quoteExternalCreateOrderAction: vi.fn().mockResolvedValue({ status: 'error', message: '测试不请求报价' }),
  quoteSampleOrderAction: vi.fn(),
}));
vi.mock('@/actions/workbench', () => ({ quoteWorkbenchItemAction: vi.fn() }));
vi.mock('@/actions/design-upload', () => ({
  deleteOrderItemDesignAction: vi.fn(),
  recordDesignUploadAction: vi.fn(),
  signDesignUploadAction: vi.fn(),
}));

import { OrderForm } from '../OrderForm';

const DRAFT_SCOPE = 'local-draft-recovery-test';
const DRAFT_NAME = '本机草稿里的工单名称';
const accounts = [{ id: 'sales-1', displayName: '外销甲', username: 'sales-a' }];
type Actor = 'admin' | 'external-sales';

let host: HTMLDivElement;
let root: Root;
let editor: OrderCreationEditor | null;

function mount(actor: Actor) {
  host = document.createElement('div');
  document.body.append(host);
  root = createRoot(host);
  flushSync(() => root.render(<OrderForm
    crafts={WORKBENCH_CRAFTS} products={WORKBENCH_CATALOG.products}
    externalCreateOrderOptions={WORKBENCH_CATALOG}
    externalSalesAccounts={actor === 'admin' ? accounts : undefined}
    draftScope={DRAFT_SCOPE} registerEditor={(value) => { editor = value; }}
  />));
}
function unmount() {
  flushSync(() => root.unmount());
  host.remove();
}
const orderName = () => page.getByRole('textbox', { name: '工单名称', exact: true });

/** Save a real form snapshot with a recognisable name as the actor's stored local draft, then reopen the page. */
async function reopenWithStoredDraft(actor: Actor) {
  mount(actor);
  await expect.element(orderName()).toBeEnabled();
  const values = { ...editor!.save().values, customName: DRAFT_NAME };
  unmount();
  localStorage.clear();
  const externalSales = actor === 'external-sales';
  localStorage.setItem(
    localOrderFormDraftStorageKey(DRAFT_SCOPE, externalSales),
    serializeLocalOrderFormDraft(values, externalSales ? 'external-sales' : 'internal', new Date())!,
  );
  mount(actor);
}
/** Outlast the macrotask in which the external-sales path restores automatically. */
const settle = () => new Promise<void>((resolve) => setTimeout(resolve, 150));

beforeEach(() => {
  localStorage.clear();
  sessionStorage.clear();
  editor = null;
});
afterEach(() => {
  unmount();
  localStorage.clear();
});

it('administrator must explicitly restore a stored local draft; the form stays locked until then', async () => {
  await reopenWithStoredDraft('admin');
  const prompt = page.getByRole('alert').filter({ hasText: '发现本机未提交的表单草稿' });
  await expect.element(prompt).toBeVisible();
  await settle();
  await expect.element(prompt).toBeVisible();
  await expect.element(prompt).toHaveTextContent('图片和 CDR 文件不会保存在本地草稿中。');
  await expect.element(orderName()).toBeDisabled();

  await page.getByRole('button', { name: '恢复本地草稿', exact: true }).click();
  await expect.element(prompt).not.toBeInTheDocument();
  await expect.element(orderName()).toBeEnabled();
  await expect.element(orderName()).toHaveValue(DRAFT_NAME);
});

it('administrator can discard a stored local draft and start from a blank form', async () => {
  await reopenWithStoredDraft('admin');
  await settle();
  await page.getByRole('button', { name: '放弃本地草稿', exact: true }).click();
  await expect.element(page.getByRole('button', { name: '恢复本地草稿', exact: true })).not.toBeInTheDocument();
  await expect.element(orderName()).toBeEnabled();
  await expect.element(orderName()).not.toHaveValue(DRAFT_NAME);
  expect(localStorage.getItem(localOrderFormDraftStorageKey(DRAFT_SCOPE, false))).toBeNull();
});

it('external salesperson gets the stored local draft restored automatically without a prompt', async () => {
  await reopenWithStoredDraft('external-sales');
  await expect.element(orderName()).toHaveValue(DRAFT_NAME);
  await expect.element(orderName()).toBeEnabled();
  await settle();
  await expect.element(page.getByRole('button', { name: '恢复本地草稿', exact: true })).not.toBeInTheDocument();
  await expect.element(page.getByRole('button', { name: '放弃本地草稿', exact: true })).not.toBeInTheDocument();
});
