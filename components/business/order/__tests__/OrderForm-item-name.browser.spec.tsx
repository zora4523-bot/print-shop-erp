import { flushSync } from 'react-dom';
import { createRoot, type Root } from 'react-dom/client';
import type { ComponentProps } from 'react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { page } from 'vitest/browser';
import '@/app/globals.css';
import { WORKBENCH_CATALOG, WORKBENCH_CRAFTS } from '@/lib/workbench/__tests__/item-fixtures';
import { OrderItemPricingRoute, OrderSettlementType } from '@/generated/prisma/enums';
import { normalizeExternalOrderItem } from '@/lib/order/order-item-configuration';
import type { OrderCreationEditor, OrderEditorSnapshot } from '../order-creation-editor';
import { localOrderFormDraftStorageKey, serializeLocalOrderFormDraft } from '../order-form-local-draft';

vi.mock('next/navigation', () => ({ useRouter: () => ({ push: vi.fn() }) }));
vi.mock('next/link', () => ({ default: (props: ComponentProps<'a'>) => <a {...props} /> }));
vi.mock('next/image', () => ({ default: ({ alt }: { alt: string }) => <span>{alt}</span> }));
vi.mock('@/actions/order', () => ({ createOrderAction: vi.fn(), submitOrderAction: vi.fn() }));
vi.mock('@/actions/create-order-quote', () => ({
  quoteExternalCreateOrderAction: vi.fn().mockResolvedValue({ status: 'error', message: '测试不请求报价' }),
  quoteInternalCreateOrderAction: vi.fn().mockResolvedValue({ status: 'error', message: '测试不请求报价' }),
  quoteSampleOrderAction: vi.fn(),
}));
vi.mock('@/actions/workbench', () => ({ quoteWorkbenchItemAction: vi.fn() }));
vi.mock('@/actions/design-upload', () => ({
  deleteOrderItemDesignAction: vi.fn(),
  recordDesignUploadAction: vi.fn(),
  signDesignUploadAction: vi.fn(),
}));
vi.mock('../design-upload-client', async (importOriginal) => ({
  ...await importOriginal<typeof import('../design-upload-client')>(),
  uploadOrderItemDesignFile: vi.fn(),
}));

import { OrderForm } from '../OrderForm';

let host: HTMLDivElement;
let root: Root;
let editor: OrderCreationEditor | null;
function mount(initialEditor?: OrderEditorSnapshot) {
  host = document.createElement('div');
  document.body.append(host);
  root = createRoot(host);
  flushSync(() => root.render(<OrderForm
    crafts={WORKBENCH_CRAFTS} products={WORKBENCH_CATALOG.products}
    externalCreateOrderOptions={WORKBENCH_CATALOG}
    settlementType={OrderSettlementType.FACTORY_DIRECT} settlementLabel="工厂直接业务"
    externalSalesAccounts={[]} draftScope="automatic-name-test"
    initialEditor={initialEditor} registerEditor={(value) => { editor = value; }}
  />));
}
beforeEach(() => {
  localStorage.clear();
  mount();
});
afterEach(() => {
  flushSync(() => root.unmount());
  host.remove();
  localStorage.clear();
});

it('switches the generated name and fee label with the real internal form route', async () => {
  const name = page.getByRole('textbox', { name: '设计款名称', exact: true });
  await expect.element(name).toHaveValue('局部烫金（通版现货） · 艳红珠光纸 160g · 大号封');
  await page.getByRole('group', { name: '工单类型', exact: true })
    .getByRole('button', { name: '专版烫金', exact: true }).click();
  await expect.element(name).toHaveValue('专版烫金 · 艳红珠光纸 160g · 大号封');
  await expect.element(page.getByRole('region', { name: '费用明细', exact: true }))
    .not.toHaveTextContent('局部烫金（通版现货）');
});

it('preserves the manually entered design name when the route changes', async () => {
  const name = page.getByRole('textbox', { name: '设计款名称', exact: true });
  await name.fill('春节客户定制款');
  await page.getByRole('group', { name: '工单类型', exact: true })
    .getByRole('button', { name: '专版烫金', exact: true }).click();
  await expect.element(name).toHaveValue('春节客户定制款');
});

it('updates each copied design and its saved name when switching to dedicated foil', async () => {
  const route = page.getByRole('group', { name: '工单类型', exact: true });
  const name = page.getByRole('textbox', { name: '设计款名称', exact: true });
  await page.getByRole('button', { name: '＋ 增加设计款', exact: true }).click();
  await page.getByRole('tab', { name: '设计款 1', exact: true }).click();
  await page.getByRole('button', { name: '＋ 增加设计款', exact: true }).click();
  for (const number of [1, 2, 3]) {
    await page.getByRole('tab', { name: `设计款 ${number}`, exact: true }).click();
    await route.getByRole('button', { name: '专版烫金', exact: true }).click();
    await expect.element(name).toHaveValue(`专版烫金 · 艳红珠光纸 160g · 大号封${number === 1 ? '' : ' 副本'}`);
  }
  await expect.element(page.getByRole('region', { name: '费用明细', exact: true }))
    .not.toHaveTextContent('局部烫金（通版现货）');
  const items = editor!.save().values.items;
  expect(items).toHaveLength(3);
  for (const item of items) {
    expect(item.pricingRoute).toBe(OrderItemPricingRoute.CUSTOM_SINGLE_FLAT_FOIL);
    expect(item.crafts).toContain('FLAT_FOIL_SINGLE');
    expect(item.crafts).not.toContain('FLAT_FOIL_PARTIAL');
    expect(item.quantity).toBe(1000);
    expect(item.name).toMatch(/^专版烫金 · 艳红珠光纸 160g · 大号封/);
  }
});

it.each(['local draft', 'editor snapshot'] as const)('repairs stale generated names restored from a %s', async (source) => {
  await expect.element(page.getByRole('textbox', { name: '设计款名称', exact: true })).toBeEnabled();
  const snapshot = editor!.save();
  const original = snapshot.values.items[0];
  const dedicated = normalizeExternalOrderItem({
    item: { ...original, pricingRoute: OrderItemPricingRoute.CUSTOM_SINGLE_FLAT_FOIL },
    crafts: WORKBENCH_CRAFTS, products: WORKBENCH_CATALOG.products, paperMaterials: WORKBENCH_CATALOG.papers,
  });
  snapshot.values.items = [original.name, `${original.name} 副本`, '客户手填名称'].map((name, index) => ({
    ...dedicated, fig: index + 1, designGroupKey: `design-${index}`, name,
  }));
  snapshot.values.nextItemFig = 4;
  snapshot.files = [[], [], []];
  flushSync(() => root.unmount());
  host.remove();
  localStorage.clear();
  if (source === 'local draft') {
    localStorage.setItem(localOrderFormDraftStorageKey('automatic-name-test', false),
      serializeLocalOrderFormDraft(snapshot.values, 'internal', new Date())!);
    mount();
    await page.getByRole('button', { name: '恢复本地草稿', exact: true }).click();
  } else {
    mount(snapshot);
  }
  const fees = page.getByRole('region', { name: '费用明细', exact: true });
  await expect.element(fees).toHaveTextContent('客户手填名称');
  await expect.element(fees).not.toHaveTextContent('局部烫金（通版现货）');
  expect(editor!.save().values.items.map((item) => item.name)).toEqual([
    '专版烫金 · 艳红珠光纸 160g · 大号封',
    '专版烫金 · 艳红珠光纸 160g · 大号封 副本',
    '客户手填名称',
  ]);
});
