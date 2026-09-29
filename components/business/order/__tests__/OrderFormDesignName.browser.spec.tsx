import { act, type ComponentProps } from 'react';
import { flushSync } from 'react-dom';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { commands, page, userEvent } from 'vitest/browser';
import '@/app/globals.css';
import { WORKBENCH_CATALOG, WORKBENCH_CRAFTS } from '@/lib/workbench/__tests__/item-fixtures';
import type { OrderCreationEditor, OrderEditorSnapshot } from '../order-creation-editor';
import type { PendingDesignImage } from '../pending-design-image';
import type { CreateOrderQuoteActionInput, CreateOrderQuoteMutationResult } from '@/actions/create-order-quote.types';
import { adminCreatePriceFactsKey, adminPackagingPriceFactsKey } from '@/lib/order/admin-create-price';

vi.mock('next/navigation', () => ({ useRouter: () => ({ push: vi.fn(), replace: vi.fn(), refresh: vi.fn() }) }));
vi.mock('next/link', () => ({ __esModule: true, default: (props: ComponentProps<'a'>) => <a {...props} /> }));
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
import { quoteExternalCreateOrderAction } from '@/actions/create-order-quote';

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

function remount(actor: Actor, snapshot: OrderEditorSnapshot) {
  flushSync(() => root.unmount());
  host.remove();
  mount(actor, snapshot);
}

it('whole-design deletion keeps other shipping, packaging and files aligned', async () => {
  await ready('admin');
  const snapshot = editor!.save();
  const item = snapshot.values.items[0];
  snapshot.values.items = ['a', 'b', 'a', 'c'].map((designGroupKey, index) => ({
    ...item, name: designGroupKey, designGroupKey, fig: index + 1,
    adminPrice: { factsKey: adminCreatePriceFactsKey({ ...item, manualQuoteReason: null }), amount: String((index + 1) * 111), reason: `协议价 ${index + 1}` },
  }));
  snapshot.values.packagingGroups = [
    { name: '混装', mode: 'MIXED_STYLE', actualBagCount: 500, itemUnitsPerBag: [2, 2, 2, 0] },
    { name: '保留', mode: 'SINGLE_STYLE', actualBagCount: 100, itemUnitsPerBag: [0, 0, 0, 10] },
  ];
  snapshot.values.additionalShipments = [[5, 0, 3, 0], [1, 7, 2, 9]].map((itemQuantities) => ({
    receiverName: '测试收件人', receiverPhone: '13800138000', receiverAddress: '广东省佛山市测试地址',
    expressCode: null, destinationProvince: '广东', quotedWeightKg: null, shippingFee: null,
    packingMaterialFee: null, customerChargeOverrideReason: null, itemQuantities,
  }));
  snapshot.values.packagingGroups[0].adminPrice = {
    amount: '0.1234', reason: '协议包装价', factsKey: adminPackagingPriceFactsKey(
      snapshot.values.packagingGroups[0], snapshot.values.items.map((entry) => entry.quantity),
      snapshot.values.additionalShipments.map((shipment) => shipment.itemQuantities),
    ),
  };
  const file = (name: string): PendingDesignImage => ({
    id: name, prepared: { file: new File(['test'], name), fileType: 'CDR', mimeType: 'application/octet-stream' },
  });
  snapshot.files = [[file('A.cdr')], [file('B.cdr')], [], [file('C.cdr')]];
  remount('admin', snapshot);
  await page.getByRole('button', { name: '删除设计款', exact: true }).click();
  const saved = editor!.save();
  expect(saved.values.items.map((entry) => entry.name)).toEqual(['b', 'c']);
  expect(saved.values.additionalShipments.map((entry) => entry.itemQuantities)).toEqual([[7, 9]]);
  expect(saved.values.packagingGroups.map((entry) => ({ mode: entry.mode, units: entry.itemUnitsPerBag }))).toEqual([
    { mode: 'SINGLE_STYLE', units: [2, 0] }, { mode: 'SINGLE_STYLE', units: [0, 10] },
  ]);
  expect(saved.files.map((files) => files.map((entry) => entry.prepared.file.name))).toEqual([['B.cdr'], ['C.cdr']]);
  expect(saved.values.items.map((entry) => entry.adminPrice)).toEqual([
    snapshot.values.items[1].adminPrice, snapshot.values.items[3].adminPrice,
  ]);
  expect(saved.values.packagingGroups[0].adminPrice).toEqual(snapshot.values.packagingGroups[0].adminPrice);
  await expect.element(page.getByRole('textbox', { name: '本款加工费（元）', exact: true })).toHaveValue('222');
  await expect.element(page.getByText('款式条件已变化，请重新确认人工价格', { exact: true })).not.toBeInTheDocument();
  await expect.element(page.getByRole('button', { name: '确认当前人工价格', exact: true })).toBeVisible();
  await expect.element(page.getByText('包装条件已变化，请重新确认包装价格', { exact: true })).toBeVisible();
  await expect.element(page.getByText('每个额外地址必须为全部款式提供分配数量', { exact: true })).not.toBeInTheDocument();
});

it('removing the first specification retains its shared design files on the remaining specification', async () => {
  await ready('external-sales');
  const snapshot = editor!.save();
  const item = snapshot.values.items[0];
  snapshot.values.items = [1, 2].map((fig) => ({ ...item, name: '共享款', designGroupKey: 'a', fig }));
  snapshot.files = [[{ id: 'shared', prepared: {
    file: new File(['test'], 'shared.cdr'), fileType: 'CDR', mimeType: 'application/octet-stream',
  } }], []];
  remount('external-sales', snapshot);
  await expect.element(page.getByRole('button', { name: '删除设计款', exact: true })).not.toBeInTheDocument();
  await page.getByRole('button', { name: '移除当前规格', exact: true }).click();
  const saved = editor!.save();
  expect(saved.values.items.map((entry) => entry.fig)).toEqual([2]);
  expect(saved.files[0].map((entry) => entry.prepared.file.name)).toEqual(['shared.cdr']);
  await expect.element(page.getByRole('button', { name: '移除当前规格', exact: true })).not.toBeInTheDocument();
});

for (const actor of ['admin', 'external-sales'] as const) {
  it(`${actor}: deletes all noncontiguous specifications from the design toolbar`, async () => {
    await ready(actor);
    const snapshot = editor!.save();
    const item = snapshot.values.items[0];
    snapshot.values.items = [
      { ...item, name: 'A', designGroupKey: 'a', fig: 1 },
      { ...item, name: 'B', designGroupKey: 'b', fig: 2 },
      { ...item, name: 'A', designGroupKey: 'a', fig: 3 },
    ];
    remount(actor, snapshot);
    const toolbar = page.getByRole('group', { name: '设计款操作', exact: true });
    await expect.element(toolbar.getByRole('button', { name: '删除设计款', exact: true })).toBeVisible();
    await toolbar.getByRole('button', { name: '删除设计款', exact: true }).click();
    expect(savedNames()).toEqual(['B']);
    expect(editor!.save().values.items.map((entry) => entry.fig)).toEqual([2]);
    await expect.element(page.getByRole('tab', { name: '设计款 1', exact: true })).toHaveFocus();
    await expect.element(page.getByRole('button', { name: '删除设计款', exact: true })).not.toBeInTheDocument();
    await expect.element(page.getByRole('button', { name: '移除当前规格', exact: true })).not.toBeInTheDocument();
  });

  it(`${actor}: removing an interleaved specification stays in its design`, async () => {
    await ready(actor);
    const snapshot = editor!.save();
    const item = snapshot.values.items[0];
    snapshot.values.items = [
      { ...item, name: 'A', designGroupKey: 'a', fig: 1 },
      { ...item, name: 'B', designGroupKey: 'b', fig: 2 },
      { ...item, name: 'A', designGroupKey: 'a', fig: 3 },
    ];
    remount(actor, snapshot);
    await page.getByRole('button', { name: '移除当前规格', exact: true }).click();
    expect(savedNames()).toEqual(['B', 'A']);
    await expect.element(designName()).toHaveValue('A');
    const selectedSpec = host.querySelector('[aria-label="规格明细"] [aria-selected="true"]');
    expect(document.activeElement).toBe(selectedSpec);
  });

  it(`${actor}: deleting a legacy design preserves the remaining hand-written name`, async () => {
    await ready(actor);
    const snapshot = editor!.save();
    const item = snapshot.values.items[0];
    snapshot.values.customName = '整单名称';
    snapshot.values.items = [
      { ...item, name: '旧款 A', designGroupKey: undefined, fig: 1 },
      { ...item, name: '旧款 B', designGroupKey: undefined, fig: 2 },
    ];
    remount(actor, snapshot);
    await designName().fill('');
    await page.getByRole('tab', { name: '设计款 2', exact: true }).click();
    await designName().fill('手填名称');
    await page.getByRole('tab', { name: '设计款 1', exact: true }).click();
    await page.getByRole('button', { name: '删除设计款', exact: true }).click();
    expect(savedNames()).toEqual(['手填名称']);
    await orderName().fill('整单名称二期');
    await expect.element(designName()).toHaveValue('手填名称');
  });

  for (const handwritten of [true, false]) {
    it(`${actor}: legacy naming decision survives reindexing when ${handwritten ? 'equal to order name' : 'cleared'}`, async () => {
      await ready(actor);
      const snapshot = editor!.save();
      const item = snapshot.values.items[0];
      snapshot.values.customName = '工单名';
      snapshot.values.items = ['旧款一', '旧款二'].map((name) => ({ ...item, name, designGroupKey: undefined }));
      remount(actor, snapshot);
      await designName().fill(handwritten ? '' : '首款手填');
      await page.getByRole('tab', { name: '设计款 2', exact: true }).click();
      await designName().fill(handwritten ? '工单名' : '');
      await page.getByRole('tab', { name: '设计款 1', exact: true }).click();
      await page.getByRole('button', { name: '删除设计款', exact: true }).click();
      await expect.element(designName()).toHaveValue('工单名');
      await orderName().fill('工单名二期');
      await expect.element(designName()).toHaveValue(handwritten ? '工单名' : '工单名二期');
    });
  }
}

function successfulQuote(input: CreateOrderQuoteActionInput, amount: string): CreateOrderQuoteMutationResult {
  const zero = { complete: true, suggestedShippingTotal: '0.00', suggestedPackagingTotal: '0.00', suggestedTotal: '0.00', components: [], errors: [] };
  const version = { id: 'test', code: 'test', version: 1, sourceSha256: 'test' };
  return { status: 'success', quote: {
    factsKey: input.factsKey, knownTotal: amount, total: amount, quoteToken: 'test',
    totalSemantics: 'COMPLETE', hasManualPricing: false, plateFee: null,
    priceVersion: { processing: version, logistics: version },
    items: input.items.map(() => ({ complete: true, errors: [], components: [],
      suggestedSubtotal: amount, suggestedFixedFee: amount, suggestedUnitPrice: '0.00', snapshot: {} })),
    packaging: { groups: [], suggestedTotal: '0.00', requiresAdminConfirmation: false, errors: [] },
    logistics: { ...zero, shipments: [], snapshot: { ...zero, version: 2,
      policy: { ruleVersion: 'test', billableWeightInput: 'SERVER_ESTIMATE_WITH_ACTUAL_OVERRIDE',
        weightResolutionOrder: [], maxOrderQuantity: 999999, billableWeightRounding: 'CEIL_KG' },
      input: { isSfCollect: false, shipments: [] } } },
  } };
}

it('a quote requested before whole-design deletion cannot overwrite the remaining design', async () => {
  await ready('external-sales');
  const snapshot = editor!.save();
  snapshot.values.items = ['A', 'B', 'A'].map((name, index) => ({
    ...snapshot.values.items[0], name, designGroupKey: name, fig: index + 1,
  }));
  snapshot.values.packagingGroups = [{ name: '混装', mode: 'MIXED_STYLE', actualBagCount: 100,
    itemUnitsPerBag: [10, 10, 10] }];
  let releaseOld!: () => void;
  vi.mocked(quoteExternalCreateOrderAction).mockClear();
  const oldResponse = new Promise<CreateOrderQuoteMutationResult>((resolve) => {
    vi.mocked(quoteExternalCreateOrderAction).mockImplementation((rawInput) => {
      const input = rawInput as CreateOrderQuoteActionInput;
      if (input.items.length === 3) {
        releaseOld = () => resolve(successfulQuote(input, '9999.99'));
        return oldResponse;
      }
      return Promise.resolve(successfulQuote(input, '222.00'));
    });
  });
  remount('external-sales', snapshot);
  await expect.poll(() => typeof releaseOld).toBe('function');
  await page.getByRole('button', { name: '删除设计款', exact: true }).click();
  await expect.poll(() => vi.mocked(quoteExternalCreateOrderAction).mock.calls
    .some(([input]) => (input as CreateOrderQuoteActionInput).items.length === 1)).toBe(true);
  const actEnvironment = globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean };
  const previousActEnvironment = actEnvironment.IS_REACT_ACT_ENVIRONMENT;
  actEnvironment.IS_REACT_ACT_ENVIRONMENT = true;
  try {
    await act(async () => { releaseOld(); await oldResponse; });
  } finally {
    actEnvironment.IS_REACT_ACT_ENVIRONMENT = previousActEnvironment;
  }
  // Assert immediately after React drains the old callback. Retrying could hide a stale write
  // when the quote effect automatically repairs it with a third request 500ms later.
  const rail = [...host.querySelectorAll('section')].find((section) => section.querySelector('h2')?.textContent === '费用明细')!;
  expect(rail.textContent).toContain('222.00');
  expect(rail.textContent).not.toContain('9,999.99');
  expect(vi.mocked(quoteExternalCreateOrderAction)).toHaveBeenCalledTimes(2);
  expect(savedNames()).toEqual(['B']);
  await expect.element(designName()).toHaveValue('B');
});

beforeEach(async () => {
  await page.viewport(1280, 800);
  document.documentElement.lang = 'zh-CN';
  localStorage.clear();
  sessionStorage.clear();
  editor = null;
  vi.mocked(quoteExternalCreateOrderAction).mockReset().mockResolvedValue({ status: 'error', message: '测试不请求报价' });
});
afterEach(async () => {
  flushSync(() => root.unmount());
  host.remove();
  localStorage.clear();
  sessionStorage.clear();
  document.documentElement.classList.remove('dark');
  await commands.setReducedMotion(false);
});

for (const theme of ['light', 'dark']) for (const [width, height] of [
  [375, 667], [393, 852], [768, 1024], [1024, 768], [1280, 800], [1920, 1080],
]) {
  it(`${width}x${height} ${theme}: grouped design removal is discoverable and keeps keyboard focus`, async () => {
    await page.viewport(width, height);
    await commands.setReducedMotion(true);
    document.documentElement.classList.toggle('dark', theme === 'dark');
    await ready('admin');
    const snapshot = editor!.save();
    const item = snapshot.values.items[0];
    snapshot.values.items = Array.from({ length: 8 }, (_, index) => ({
      ...item, name: `款名 ${index + 1}`, designGroupKey: `design-${index}`, fig: index + 1,
    }));
    remount('admin', snapshot);
    const toolbar = host.querySelector<HTMLElement>('[aria-label="设计款操作"]')!;
    const tabs = host.querySelector<HTMLElement>('[aria-label="设计款"]')!;
    expect(toolbar.getBoundingClientRect().bottom).toBeLessThanOrEqual(tabs.getBoundingClientRect().top);
    for (const button of toolbar.querySelectorAll('button')) {
      expect(button.getBoundingClientRect().height).toBeGreaterThanOrEqual(44);
      expect(button.getBoundingClientRect().width).toBeGreaterThanOrEqual(44);
    }
    expect(document.documentElement.scrollWidth).toBeLessThanOrEqual(width);
    expect(await commands.checkShellAccessibility('[aria-label="设计款操作"], [aria-label="设计款"]')).toEqual([]);
    toolbar.scrollIntoView({ block: 'start', behavior: 'instant' });
    const initialTop = toolbar.getBoundingClientRect().top;
    const initialScroll = window.scrollY;
    for (let count = 8; count > 1; count--) {
      const remove = page.getByRole('button', { name: '删除设计款', exact: true });
      await remove.click();
      await expect.element(page.getByRole('tab', { name: '设计款 1', exact: true })).toHaveAttribute('aria-selected', 'true');
      expect(toolbar.getBoundingClientRect().top).toBe(initialTop);
      expect(window.scrollY).toBe(initialScroll);
      if (count > 2) await expect.element(remove).toHaveFocus();
    }
    await expect.element(page.getByRole('tab', { name: '设计款 1', exact: true })).toHaveFocus();
    expect(savedNames()).toEqual(['款名 8']);
    await userEvent.keyboard('{ArrowRight}');
    await expect.element(page.getByRole('tab', { name: '设计款 1', exact: true })).toHaveFocus();
    await page.getByRole('button', { name: '＋ 添加规格', exact: true }).click();
    await page.getByRole('button', { name: '＋ 添加规格', exact: true }).click();
    for (const label of ['＋ 添加规格', '移除当前规格']) {
      const button = [...host.querySelectorAll('button')].find((entry) => entry.textContent === label)!;
      expect(button.getBoundingClientRect().height).toBeGreaterThanOrEqual(44);
      expect(button.getBoundingClientRect().width).toBeGreaterThanOrEqual(44);
    }
    expect(await commands.checkShellAccessibility('[data-slot="order-specification-section"]')).toEqual([]);
    await page.getByRole('button', { name: '移除当前规格', exact: true }).click();
    await expect.element(page.getByRole('button', { name: '移除当前规格', exact: true })).toHaveFocus();
    await userEvent.keyboard('{Enter}');
    expect(document.activeElement).toBe(host.querySelector('[aria-label="规格明细"] [aria-selected="true"]'));
  });
}

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
  await page.getByRole('button', { name: '＋ 添加设计款', exact: true }).click();
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
  await page.getByRole('button', { name: '＋ 添加设计款', exact: true }).click();
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
  await page.getByRole('button', { name: '＋ 添加规格', exact: true }).click();
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
  await page.getByRole('button', { name: '＋ 添加设计款', exact: true }).click();
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
  await page.getByRole('button', { name: '＋ 添加设计款', exact: true }).click();
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
  await page.getByRole('button', { name: '＋ 添加设计款', exact: true }).click();
  await page.getByRole('button', { name: '保存草稿', exact: true }).click();
  const salesperson = page.getByRole('combobox', { name: '关联外部销售', exact: true });
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
  await page.getByRole('button', { name: '＋ 添加设计款', exact: true }).click();
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
  await page.getByRole('button', { name: '＋ 添加规格', exact: true }).click();
  await page.getByRole('button', { name: '＋ 添加设计款', exact: true }).click();
  await designName().fill('寿字款');
  await page.getByRole('button', { name: '删除设计款', exact: true }).click();
  await expect.element(designName()).toHaveValue('福字款');
  await designName().click();
  await orderName().click();
  expect(savedNames()).toEqual(['福字款', '福字款']);
});

it('a design without a group key keeps following after gaining one through ＋ 添加规格', async () => {
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
  await page.getByRole('button', { name: '＋ 添加设计款', exact: true }).click();
  await designName().fill('福字款');
  await orderName().fill('新年红包二期');
  await page.getByRole('tab', { name: /^设计款 1/ }).click();
  await page.getByRole('button', { name: '＋ 添加规格', exact: true }).click();
  await page.getByRole('tab', { name: /^设计款 2/ }).click();
  await page.getByRole('button', { name: '删除设计款', exact: true }).click();
  expect(savedNames()).toEqual(['新年红包二期', '新年红包二期']);
});
