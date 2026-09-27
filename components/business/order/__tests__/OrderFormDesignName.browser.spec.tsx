import type { ComponentProps } from 'react';
import { flushSync } from 'react-dom';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { page, userEvent } from 'vitest/browser';
import '@/app/globals.css';
import { WORKBENCH_CATALOG, WORKBENCH_CRAFTS } from '@/lib/workbench/__tests__/item-fixtures';
import type { OrderCreationEditor, OrderEditorSnapshot } from '../order-creation-editor';

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

// 业主 2026-09-26：设计款名称由建单人填写；单款默认跟随工单名称，新增设计款须手动命名，
// 同一设计款的规格共用名称，同一工单内不重名。管理员与外部销售规则一致。
const accounts = [{ id: 'sales-1', displayName: '外销甲', username: 'sales-a' }];
type Actor = 'admin' | 'external-sales';

let host: HTMLDivElement;
let root: Root;
let editor: OrderCreationEditor | null;

function mount(actor: Actor, initialEditor?: OrderEditorSnapshot) {
  host = document.createElement('div');
  document.body.append(host);
  root = createRoot(host);
  flushSync(() => root.render(<OrderForm
    crafts={WORKBENCH_CRAFTS} products={WORKBENCH_CATALOG.products}
    externalCreateOrderOptions={WORKBENCH_CATALOG}
    externalSalesAccounts={actor === 'admin' ? accounts : undefined}
    draftScope={`design-name-test-${actor}`} registerEditor={(value) => { editor = value; }}
    initialEditor={initialEditor}
  />));
}
const orderName = () => page.getByRole('textbox', { name: '工单名称', exact: true });
const designName = () => page.getByRole('textbox', { name: '设计款名称', exact: true });
const savedNames = () => editor!.save().values.items.map((item) => item.name);
async function ready(actor: Actor) {
  mount(actor);
  await expect.element(designName()).toBeEnabled();
}

beforeEach(() => {
  localStorage.clear();
  sessionStorage.clear();
  editor = null;
});
afterEach(() => {
  flushSync(() => root.unmount());
  host.remove();
  localStorage.clear();
  sessionStorage.clear();
});

for (const actor of ['admin', 'external-sales'] as const) {
  it(`${actor}: a single design starts unnamed and follows the order name until edited by hand`, async () => {
    await ready(actor);
    await expect.element(designName()).toHaveValue('');
    await expect.element(designName()).toHaveAttribute('aria-required', 'true');
    await orderName().fill('新年福字红包');
    await expect.element(designName()).toHaveValue('新年福字红包');

    await designName().fill('福字款');
    await orderName().fill('新年红包二期');
    await expect.element(designName()).toHaveValue('福字款');
    expect(savedNames()).toEqual(['福字款']);

    // Clearing the design name hands it back to the order name.
    await designName().fill('');
    await orderName().fill('新年红包三期');
    await expect.element(designName()).toHaveValue('新年红包三期');
  });
}

it('a typed design name survives type, paper and specification changes', async () => {
  await ready('external-sales');
  await designName().fill('福字款');
  await page.getByRole('group', { name: '工单类型', exact: true })
    .getByRole('button', { name: '专版烫金', exact: true }).click();
  await expect.element(designName()).toHaveValue('福字款');
  expect(savedNames()).toEqual(['福字款']);
});

it('an added design starts unnamed, stops the order-name following and must be named', async () => {
  await ready('external-sales');
  await orderName().fill('新年红包');
  await page.getByRole('button', { name: '＋ 增加设计款', exact: true }).click();
  await expect.element(page.getByRole('tab', { name: /设计款 2/ })).toHaveAttribute('aria-selected', 'true');
  await expect.element(designName()).toHaveValue('');
  expect(savedNames()).toEqual(['新年红包', '']);

  // With two designs the first no longer follows the order name.
  await orderName().fill('新年红包二期');
  expect(savedNames()).toEqual(['新年红包', '']);

  await page.getByRole('button', { name: '创建并提交', exact: true }).click();
  const issue = page.getByRole('button', { name: '设计款 2：请填写设计款名称', exact: true });
  await expect.element(issue).toBeVisible();
  await expect.element(page.getByRole('tab', { name: /设计款 2 · 待完善/ })).toBeVisible();
  await page.getByRole('tab', { name: /设计款 1/ }).click();
  await issue.click();
  await expect.element(page.getByRole('tab', { name: /设计款 2/ })).toHaveAttribute('aria-selected', 'true');
  await expect.element(designName()).toHaveFocus();
});

it('design names must be unique within the order and are reported while typing', async () => {
  await ready('admin');
  await orderName().fill('新年红包');
  await page.getByRole('button', { name: '＋ 增加设计款', exact: true }).click();
  await designName().fill(' 新年红包 ');
  await expect.element(designName()).toHaveAttribute('aria-invalid', 'true');
  await expect.element(page.getByText('与其他设计款重名：新年红包', { exact: true })).toBeVisible();
  await designName().fill('新年红包·金色');
  await expect.element(designName()).toHaveAttribute('aria-invalid', 'false');
  await expect.element(page.getByText(/与其他设计款重名/)).not.toBeInTheDocument();
});

it('specification rows of one design share its name', async () => {
  await ready('admin');
  await designName().fill('福字款');
  await page.getByRole('button', { name: '＋ 增加规格', exact: true }).click();
  expect(savedNames()).toEqual(['福字款', '福字款']);
  await designName().fill('寿字款');
  expect(savedNames()).toEqual(['寿字款', '寿字款']);
});

it('a design name following a long order name reports the 64-character limit', async () => {
  await ready('external-sales');
  await orderName().fill('长'.repeat(70));
  await expect.element(page.getByText('设计款名称最多 64 个字符', { exact: true })).toBeVisible();
  await expect.element(designName()).toHaveAttribute('aria-invalid', 'true');
});

it('typing the order name key by key never takes over a hand-typed design name', async () => {
  await ready('external-sales');
  await designName().fill('福字款');
  await orderName().click();
  // Passes through “福字款” on the way to “福字款红包”.
  await userEvent.keyboard('福字款红包');
  await expect.element(orderName()).toHaveValue('福字款红包');
  await expect.element(designName()).toHaveValue('福字款');
});

it('going back to one design that was never named by hand follows the order name again', async () => {
  await ready('external-sales');
  await orderName().fill('A');
  await page.getByRole('button', { name: '＋ 增加设计款', exact: true }).click();
  await designName().fill('B');
  await orderName().fill('A2');
  expect(savedNames()).toEqual(['A', 'B']);
  await page.getByRole('button', { name: '删除设计款', exact: true }).click();
  expect(savedNames()).toEqual(['A2']);
  await orderName().fill('A23');
  await expect.element(designName()).toHaveValue('A23');
});

it('renaming an earlier design into a clash is reported on the field being typed', async () => {
  await ready('admin');
  await orderName().fill('A');
  await page.getByRole('button', { name: '＋ 增加设计款', exact: true }).click();
  await designName().fill('B');
  await page.getByRole('tab', { name: /^设计款 1/ }).click();
  await designName().fill('b');
  await expect.element(designName()).toHaveAttribute('aria-invalid', 'true');
  await expect.element(page.getByText('与其他设计款重名：b', { exact: true })).toBeVisible();
  // A design-level issue marks the design tab, never a specification tab.
  await expect.element(page.getByRole('tab', { name: /· 待完善/ }).first()).toBeVisible();
  await expect.element(page.getByRole('tab', { name: / 个 · 待完善/ })).not.toBeInTheDocument();
});

it('an empty name left by blur is not flagged before a save or submit', async () => {
  await ready('external-sales');
  await designName().click();
  await orderName().click();
  await expect.element(designName()).toHaveAttribute('aria-invalid', 'false');
});

it('administrator draft save blocked only by design names prompts salesperson and name, not submit checks', async () => {
  await ready('admin');
  await orderName().fill('新年红包');
  // Everything a draft needs except the salesperson and design 2's name.
  await page.getByRole('textbox', { name: '收货地址', exact: true })
    .fill('张先生 13800138000 广东省佛山市南海区测试路1号');
  await page.getByRole('button', { name: '＋ 增加设计款', exact: true }).click();
  await page.getByRole('button', { name: '保存草稿', exact: true }).click();
  const salesperson = page.getByRole('combobox', { name: '关联外部销售（必填）', exact: true });
  await expect.element(salesperson).toHaveFocus();
  await expect.element(page.getByRole('button', { name: '设计款 2：请填写设计款名称', exact: true })).toBeVisible();
  await expect.element(page.getByText(/请上传设计图/)).not.toBeInTheDocument();
  await expect.element(page.getByText(/收件人必填|收货地址必填/)).not.toBeInTheDocument();

  await salesperson.selectOptions('sales-1');
  await page.getByRole('button', { name: '保存草稿', exact: true }).click();
  await expect.element(page.getByRole('tab', { name: /设计款 2/ })).toHaveAttribute('aria-selected', 'true');
  await expect.element(designName()).toHaveFocus();
  await expect.element(page.getByText(/请上传设计图/)).not.toBeInTheDocument();
});

it('switching designs shows each design its own name, and a blur never copies it across', async () => {
  await ready('external-sales');
  await designName().fill('福字款');
  await page.getByRole('button', { name: '＋ 增加设计款', exact: true }).click();
  await designName().fill('寿字款');
  await page.getByRole('tab', { name: /^设计款 1/ }).click();
  await expect.element(designName()).toHaveValue('福字款');
  await designName().click();
  await orderName().click();
  expect(savedNames()).toEqual(['福字款', '寿字款']);
  await page.getByRole('tab', { name: /^设计款 2/ }).click();
  await expect.element(designName()).toHaveValue('寿字款');
});

it('deleting the design being edited leaves the remaining design showing its own name', async () => {
  await ready('external-sales');
  await designName().fill('福字款');
  await page.getByRole('button', { name: '＋ 增加规格', exact: true }).click();
  await page.getByRole('button', { name: '＋ 增加设计款', exact: true }).click();
  await designName().fill('寿字款');
  await page.getByRole('button', { name: '删除设计款', exact: true }).click();
  await expect.element(designName()).toHaveValue('福字款');
  await designName().click();
  await orderName().click();
  expect(savedNames()).toEqual(['福字款', '福字款']);
});

it('a design without a group key keeps following after gaining one through ＋ 增加规格', async () => {
  // A historical / workbench-style row without designGroupKey.
  await ready('external-sales');
  const snapshot = editor!.save();
  snapshot.values.items = snapshot.values.items.map((item) => ({ ...item, name: '', designGroupKey: null }));
  flushSync(() => root.unmount());
  host.remove();
  localStorage.clear();
  mount('external-sales', snapshot);
  await expect.element(designName()).toBeEnabled();

  await orderName().fill('新年红包');
  await expect.element(designName()).toHaveValue('新年红包');
  await page.getByRole('button', { name: '＋ 增加设计款', exact: true }).click();
  await designName().fill('福字款');
  await orderName().fill('新年红包二期');
  await page.getByRole('tab', { name: /^设计款 1/ }).click();
  await page.getByRole('button', { name: '＋ 增加规格', exact: true }).click();
  await page.getByRole('tab', { name: /^设计款 2/ }).click();
  await page.getByRole('button', { name: '删除设计款', exact: true }).click();
  expect(savedNames()).toEqual(['新年红包二期', '新年红包二期']);
});

