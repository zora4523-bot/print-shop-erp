import { useEffect, useState, type ComponentProps } from 'react';
import { flushSync } from 'react-dom';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { commands, page, userEvent } from 'vitest/browser';
import '@/app/globals.css';
import { Button } from '@/components/ui/button';
import type { OrderPackagingMode } from '@/generated/prisma/enums';
import { createOrderSchema } from '@/lib/auth/schemas';
import {
  applyOrderPackagingMixing, applyOrderPackagingType, applySpecPackagingType, createPackagingGroupIndex,
  createPackagingRows, orderPackagingSelection, summarizeCreatePackaging,
} from '@/lib/order/create-packaging-selection';
import { packagingBoxType, packagingModeFor, packagingType } from '@/lib/order/packaging-mode';
import { OrderFormB, type OrderFormBProps } from '../order-form-b/ExternalSalesOrderFormB';

vi.mock('next/link', () => ({ default: (props: ComponentProps<'a'>) => <a {...props} /> }));
vi.mock('next/image', () => ({ default: ({ alt }: { alt: string }) => <span>{alt}</span> }));

vi.mock('@/actions/design-upload', () => ({ recordDesignUploadAction: vi.fn(), signDesignUploadAction: vi.fn() }));

let host: HTMLDivElement;
let root: Root;
let refreshQuote: () => void;
let requestErrorFocus: () => void;
let showFieldErrors: (visible: boolean) => void;
const noop = () => {};
// Parse the real defaults rather than inventing a second item schema.
const baseItem = createOrderSchema.shape.items.element.parse({
  name: '测试款', quantity: 1000, crafts: ['craft'], paperType: '珠光艳闪',
  paperWeightGsm: 160, specification: '大号封',
  productId: 'product', pricingRoute: 'STOCK_BLANK', remark: null,
  hasLocalFoil: true, foilTechnique: 'FLAT', foilColors: ['亚金'], frontFoilColors: ['亚金'],
});
/** One specification, packed on its own — the whole-order section's simplest state. */
function packagingView(mode: OrderPackagingMode = 'SINGLE_STYLE', unitsPerBag = 10, quantity = 1000, error: string | null = null): OrderFormBProps['packaging'] {
  const unpacked = packagingType(mode) === 'UNPACKED';
  return {
    rows: [{ label: '设计款 1 · 大号封', quantity, mode, unitsPerBag, bagCount: unpacked ? 0 : Math.ceil(quantity / unitsPerBag), error }],
    selection: { type: packagingType(mode), box: packagingBoxType(mode), mixing: unpacked ? null : 'SINGLE_STYLE' },
    summary: `合计 ${quantity} 个 · 1 个设计款 / 1 个规格`,
  };
}
const baseProps: Omit<OrderFormBProps, 'items' | 'itemFields' | 'activeIndex' | 'onActiveIndexChange' | 'onRemove'> = {
  values: { customName: '测试工单', receiverName: '', receiverPhone: '', receiverAddress: '', isSfCollect: false },
  pendingDesigns: {},
  packaging: packagingView(),
  paperOptions: [{ value: 'pearl', label: '珠光艳闪', texture: 'matte-red' }],
  paperKey: 'pearl', weightOptions: [{ value: 160 }],
  specificationOptions: [{ value: '大号封', label: '大号封' }],
  savedLabel: '草稿已保存 11:26:30', rail: <div>费用明细</div>,
  onAdd: noop, onDuplicate: noop, onCustomNameChange: noop, onRouteChange: noop,
  onPaperChange: noop, onWeightChange: noop, onSpecificationChange: noop,
  onFoilSidesChange: noop, onBackFoilToggle: noop, onFoilTechniqueChange: noop,
  onCustomSizeChange: noop, onPrintFoilModeChange: noop, onLaminationChange: noop,
  onQuantityChange: noop, onPackagingTypeChange: noop, onPackagingMixingChange: noop, onUnitsPerBagChange: noop,
  onPendingDesignsChange: noop, onReceiverAddressChange: noop,
  onReceiverNameChange: noop, onReceiverPhoneChange: noop, onSfCollectChange: noop,
};
function Fixture({ count = 15 }: { count?: number }) {
  const [items, setItems] = useState(() => Array.from({ length: count }, (_, index) => ({ ...baseItem, fig: index + 1 })));
  const [active, setActive] = useState(count - 1);
  const [quote, setQuote] = useState(0);
  const [focusRequest, setFocusRequest] = useState(0);
  useEffect(() => {
    refreshQuote = () => setQuote((value) => value + 1);
    requestErrorFocus = () => setFocusRequest((value) => value + 1);
  }, []);
  return <OrderFormB {...baseProps}
    items={items} itemFields={items.map((item) => ({ id: `item-${item.fig}` }))}
    activeIndex={active} onActiveIndexChange={setActive}
    errorFocusRequest={focusRequest}
    fieldErrors={{
      summary: [...items.map((item) => `第 ${item.fig} 款：请上传设计图`), `费用报价 ${quote}`],
      items: items.map(() => ({ designImage: '请上传设计图' })),
    }}
    onRemove={(index) => {
      setItems((values) => values.filter((_, current) => current !== index));
      setActive(Math.max(0, Math.min(index, items.length - 2)));
    }}
  />;
}
function QuoteRefreshFixture() {
  const [quantity, setQuantity] = useState(998);
  const [unitsPerBag, setUnitsPerBag] = useState(10);
  const [quoteFailed, setQuoteFailed] = useState(true);
  useEffect(() => {
    refreshQuote = () => setQuoteFailed(true);
  }, []);
  return <OrderFormB {...baseProps}
    items={[{ ...baseItem, quantity }]}
    itemFields={[{ id: 'item-1' }]} activeIndex={0}
    onActiveIndexChange={noop} onRemove={noop}
    fieldErrors={{ summary: quoteFailed ? ['报价失败：请调整包装数量并重新核价'] : [] }}
    packaging={packagingView('SINGLE_STYLE', unitsPerBag, quantity)}
    // Packaging now sits after the design card; like the real page, order notes follow it,
    // so removing the summary below cannot clamp the scroll position while editing.
    footerExtras={<section><label htmlFor="test-remark">工单备注（选填）</label><textarea id="test-remark" className="mt-2 min-h-24 w-full" /></section>}
    onQuantityChange={(value) => { setQuantity(value); setQuoteFailed(false); }}
    onUnitsPerBagChange={(_, value) => { setUnitsPerBag(value); setQuoteFailed(false); }}
  />;
}
function FieldFeedbackFixture() {
  const [invalid, setInvalid] = useState(false);
  const [values, setValues] = useState({
    customName: '测试工单', receiverName: '张先生', receiverPhone: '13800138000',
    receiverAddress: '广东省佛山市南海区测试路1号', isSfCollect: false,
  });
  useEffect(() => { showFieldErrors = setInvalid; }, []);
  return <OrderFormB {...baseProps}
    values={values} items={[baseItem]} itemFields={[{ id: 'item-1' }]}
    activeIndex={0} onActiveIndexChange={noop} onRemove={noop}
    packaging={packagingView('SINGLE_STYLE', 10, 1000, invalid ? '每包数量不能超过 12 个，请调整包装数量' : null)}
    fieldErrors={invalid ? {
      customName: '工单名称必填', receiverName: '请填写收件人', receiverPhone: '请填写收货电话',
      receiverAddress: '请填写收货地址', items: [{ quantity: '数量必须大于 0', designImage: '请上传设计图' }],
    } : {}}
    onCustomNameChange={(customName) => setValues((v) => ({ ...v, customName }))}
    onReceiverAddressChange={(receiverAddress) => setValues((v) => ({ ...v, receiverAddress }))}
    onReceiverNameChange={(receiverName) => setValues((v) => ({ ...v, receiverName }))}
    onReceiverPhoneChange={(receiverPhone) => setValues((v) => ({ ...v, receiverPhone }))}
  />;
}
beforeEach(() => {
  document.documentElement.lang = 'zh-CN';
  host = document.createElement('div');
  host.dataset.testid = 'navigation-fixture';
  host.className = 'p-4';
  document.body.append(host);
  root = createRoot(host);
  window.scrollTo({ top: 0, behavior: 'instant' });
});
afterEach(() => {
  flushSync(() => root.unmount());
  host.remove();
  document.documentElement.classList.remove('dark');
  vi.restoreAllMocks();
});
const layoutReady = () => new Promise<void>((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve())));
const deleteButton = () => host.querySelector<HTMLButtonElement>('button[aria-label^="删除第"]')!;
const selectedStyle = () => host.querySelector<HTMLButtonElement>('nav[aria-label="款式"] [aria-pressed="true"]')!;

for (const theme of ['light', 'dark']) for (const [width, height] of [
  [375, 667], [393, 852], [768, 1024], [1024, 768], [1280, 800], [1920, 1080],
]) {
  it(`${width}x${height} ${theme}: field feedback keeps downstream input positions and focus stable`, async () => {
    await page.viewport(width, height);
    document.documentElement.classList.toggle('dark', theme === 'dark');
    flushSync(() => root.render(<FieldFeedbackFixture />));
    await layoutReady();
    const selectors = ['-custom-name', '-quantity', '-units-per-bag', '-receiver-address-paste', '-receiver-name', '-receiver-phone'];
    const fields = selectors.map((suffix) => host.querySelector<HTMLInputElement | HTMLTextAreaElement>(`[id$="${suffix}"]`)!);
    const phone = fields.at(-1)!;
    phone.scrollIntoView({ block: 'center', behavior: 'instant' });
    await page.getByRole('textbox', { name: '收货电话', exact: true }).click();
    const positions = fields.map((field) => field.getBoundingClientRect().top);
    const scrollY = window.scrollY;
    for (const invalid of [true, false, true, false]) {
      flushSync(() => showFieldErrors(invalid));
      await layoutReady();
      expect(fields.map((field) => field.getBoundingClientRect().top)).toEqual(positions);
      expect(window.scrollY).toBe(scrollY);
      expect(document.activeElement).toBe(phone);
      // 逐字段错误不再挂 role="alert"（与 EditOrderForm 口径一致，避免 onBlur 抢播报）：
      // 以 aria-invalid 连线判断错误是否呈现。
      expect(host.querySelectorAll('[role="alert"]').length).toBe(0);
      expect(host.querySelectorAll('[aria-invalid="true"]').length > 0).toBe(invalid);
      expect(host.querySelector('[id$="-packaging-message"]')!.textContent).toBe(invalid
        ? '!每包数量不能超过 12 个，请调整包装数量' : '共 100 包');
    }
    expect(document.documentElement.scrollWidth).toBeLessThanOrEqual(width);
    expect(await commands.checkShellAccessibility('[data-slot="order-form-editor"]')).toEqual([]);
  });
}

for (const theme of ['light', 'dark']) for (const [width, height] of [
  [375, 667], [393, 852], [768, 1024], [1024, 768], [1280, 800], [1920, 1080],
]) {
  it(`${width}x${height} ${theme}: quote refresh keeps quantity and pack inputs stationary`, async () => {
    await page.viewport(width, height);
    document.documentElement.classList.toggle('dark', theme === 'dark');
    flushSync(() => root.render(<QuoteRefreshFixture />));
    await layoutReady();
    for (const [label, suffix, value] of [
      ['数量', '-quantity', '999'], ['每包数量', '-units-per-bag', '12'],
    ]) {
      const input = host.querySelector<HTMLInputElement>(`input[id$="${suffix}"]`)!;
      input.scrollIntoView({ block: 'center', behavior: 'instant' });
      await page.getByRole('spinbutton', { name: label, exact: true }).click();
      await layoutReady();
      const top = input.getBoundingClientRect().top;
      const scrollY = window.scrollY;
      await page.getByRole('spinbutton', { name: label, exact: true }).fill(value);
      await layoutReady();
      expect(host.querySelector('[data-slot="order-form-errors"]')).toBeNull();
      expect(document.activeElement).toBe(input);
      expect(input.getBoundingClientRect().top).toBe(top);
      expect(window.scrollY).toBe(scrollY);
      flushSync(() => refreshQuote());
      await layoutReady();
      expect(host.querySelector('[data-slot="order-form-errors"]')).not.toBeNull();
      expect(document.activeElement).toBe(input);
      expect(input.getBoundingClientRect().top).toBe(top);
      expect(window.scrollY).toBe(scrollY);
    }
    expect(document.documentElement.scrollWidth).toBeLessThanOrEqual(width);
    expect(await commands.checkShellAccessibility('[data-slot="order-form-editor"]')).toEqual([]);
  });
}

for (const theme of ['light', 'dark']) for (const [width, height] of [
  [375, 667], [393, 852], [768, 1024], [1024, 768], [1280, 800], [1920, 1080],
]) {
  it(`${width}x${height} ${theme}: repeated deletion keeps the controls, scroll and focus stable`, async () => {
    await page.viewport(width, height);
    document.documentElement.classList.toggle('dark', theme === 'dark');
    const scroll = vi.spyOn(HTMLElement.prototype, 'scrollIntoView');
    flushSync(() => root.render(<Fixture />));
    await layoutReady();
    const initial = deleteButton().getBoundingClientRect();
    const initialScroll = window.scrollY;
    expect(selectedStyle().textContent).toContain('15.');
    expect(document.documentElement.scrollWidth).toBeLessThanOrEqual(width);
    for (const control of host.querySelectorAll('[aria-label="款式操作"] button, nav[aria-label="款式"] button')) {
      expect(control.getBoundingClientRect().height).toBeGreaterThanOrEqual(44);
    }
    expect(await commands.checkShellAccessibility('[aria-label="款式操作"], nav[aria-label="款式"]')).toEqual([]);
    // Cross several wrap boundaries, then remove the final extra style.
    for (let count = 15; count > 1; count--) {
      await page.getByRole('button', { name: `删除第 ${count} 款`, exact: true }).click();
      flushSync(() => refreshQuote());
      await layoutReady();
      expect(window.scrollY).toBe(initialScroll);
      expect(selectedStyle().textContent).toContain(`${count - 1}.`);
      if (count > 2) {
        const rect = deleteButton().getBoundingClientRect();
        expect(rect.top).toBe(initial.top);
        expect(rect.left).toBe(initial.left);
        expect(document.activeElement).toBe(deleteButton());
      } else {
        expect(deleteButton()).toBeNull();
        expect(document.activeElement).toBe(selectedStyle());
      }
    }
    expect(scroll).not.toHaveBeenCalled();
  });
}
it('only explicit error requests navigate; repeated submits and error links work after deleting a middle style', async () => {
  await page.viewport(1280, 800);
  const scroll = vi.spyOn(HTMLElement.prototype, 'scrollIntoView');
  flushSync(() => root.render(<Fixture count={4} />));
  await page.getByRole('button', { name: '2. 局部烫金', exact: false }).click();
  await page.getByRole('button', { name: '删除第 2 款', exact: true }).click();
  expect(selectedStyle().textContent).toContain('2.'); // Original fig 3 is now index 1.
  await page.getByRole('button', { name: '第 3 款：请上传设计图', exact: true }).click();
  await expect.poll(() => scroll.mock.calls.length).toBe(1);
  expect(selectedStyle().textContent).toContain('2.');
  expect(document.activeElement?.getAttribute('aria-label')).toContain('设计');
  flushSync(() => refreshQuote());
  await layoutReady();
  expect(scroll).toHaveBeenCalledTimes(1);
  flushSync(() => requestErrorFocus());
  await expect.poll(() => scroll.mock.calls.length).toBe(2);
  expect(selectedStyle().textContent).toContain('1.');
  flushSync(() => requestErrorFocus());
  await expect.poll(() => scroll.mock.calls.length).toBe(3);
  expect(scroll.mock.calls[0]?.[0]).toMatchObject({ block: 'center' });
});
it('keyboard deletion retains a usable focus target', async () => {
  await page.viewport(393, 852);
  flushSync(() => root.render(<Fixture count={3} />));
  deleteButton().focus({ preventScroll: true });
  await userEvent.keyboard('{Enter}');
  expect(document.activeElement).toBe(deleteButton());
  await userEvent.keyboard(' ');
  expect(document.activeElement).toBe(selectedStyle());
});

for (const theme of ['light', 'dark']) for (const width of [393, 768, 1280]) {
  it(`packaging layout is readable and constrained at ${width}px in ${theme}`, async () => {
    await page.viewport(width, 900);
    document.documentElement.classList.toggle('dark', theme === 'dark');
    flushSync(() => root.render(<OrderFormB {...baseProps}
      items={[baseItem]} itemFields={[{ id: 'item-1' }]} activeIndex={0}
      onActiveIndexChange={noop} onRemove={noop}
      packagingExtras={<div><label htmlFor="test-pack-note">包装补充说明（选填）</label><input id="test-pack-note" /></div>}
    />));
    await layoutReady();
    const pack = host.querySelector<HTMLInputElement>('input[id$="-units-per-bag"]')!;
    expect(pack.max).toBe('12');
    pack.value = '13';
    expect(pack.validity.rangeOverflow).toBe(true);
    pack.value = '12';
    expect(pack.validity.valid).toBe(true);
    const mixed = page.getByRole('button', { name: '混装', exact: true });
    await expect.element(mixed).toBeDisabled();
    const mode = host.querySelector('button[id$="-packaging-mode-MIXED_STYLE"]')!.closest('fieldset')!;
    expect(mode.querySelector('legend')!.textContent).toBe('包装方式');
    const note = mode.parentElement!.querySelector('p')!;
    expect(note.className).toContain('text-muted-foreground');
    expect(note.getBoundingClientRect().top).toBeGreaterThanOrEqual(mode.getBoundingClientRect().bottom + 7);
    const nextLabel = host.querySelector('label[for="test-pack-note"]')!;
    expect(nextLabel.getBoundingClientRect().top).toBeGreaterThanOrEqual(note.getBoundingClientRect().bottom + 19);
    expect(document.documentElement.scrollWidth).toBeLessThanOrEqual(width);
    expect(await commands.checkShellAccessibility('section[aria-label="包装"]')).toEqual([]);
  });
}

function PackagingTypesFixture() {
  const [mode, setMode] = useState<OrderPackagingMode>('SINGLE_STYLE');
  return <OrderFormB {...baseProps} items={[baseItem]} itemFields={[{id: 'item-1'}]} activeIndex={0}
    onActiveIndexChange={noop} onRemove={noop}
    onPackagingTypeChange={(type, box) => setMode(packagingModeFor(type, false, box))}
    packaging={packagingView(mode, mode === 'BOX_TACTILE' ? 8 : 10)} />;
}
for (const theme of ['light', 'dark']) for (const [width, height] of [
  [375, 667], [393, 852], [768, 1024], [1024, 768], [1280, 800], [1920, 1080],
]) {
  it(`packaging types ${width}x${height} ${theme}: switch, capacity, touch and accessibility`, async () => {
    await page.viewport(width, height);
    document.documentElement.classList.toggle('dark', theme === 'dark');
    flushSync(() => root.render(<PackagingTypesFixture />));
    await layoutReady();
    await expect.element(page.getByRole('button', {name: '入袋', exact: true})).toHaveAttribute('aria-pressed', 'true');
    await page.getByRole('button', {name: '不包装', exact: true}).click();
    expect(host.querySelector('input[id$="-units-per-bag"]')).toBeNull();
    await expect.element(page.getByText('包装费 ¥0.00', {exact: true})).toBeVisible();
    await page.getByRole('button', {name: '装盒', exact: true}).click();
    await page.getByRole('button', {name: /触感盒子 250g/}).click();
    const field = host.querySelector<HTMLInputElement>('input[id$="-units-per-bag"]')!;
    expect(field.max).toBe('8');
    field.value = '9'; expect(field.validity.rangeOverflow).toBe(true);
    field.value = '8'; expect(field.validity.valid).toBe(true);
    const section = host.querySelector('section[aria-label="包装"]')!;
    for (const button of section.querySelectorAll('button')) {
      const rect = button.getBoundingClientRect();
      expect(rect.height).toBeGreaterThanOrEqual(44);
      expect(rect.left).toBeGreaterThanOrEqual(0);
      expect(rect.right).toBeLessThanOrEqual(width);
    }
    expect(document.documentElement.scrollWidth).toBeLessThanOrEqual(width);
    expect(await commands.checkShellAccessibility('section[aria-label="包装"]')).toEqual([]);
  });
}

it('administrator gap targets select the affected style and focus its quantity field only on request', async () => {
  await page.viewport(1280, 800);
  function AdminGapFixture() {
    const [active, setActive] = useState(0);
    const [request, setRequest] = useState(0);
    const label = '款式 #2 数量必须大于 0';
    return <OrderFormB {...baseProps}
      items={[baseItem, { ...baseItem, fig: 2, quantity: 0 }]}
      itemFields={[{ id: 'first' }, { id: 'second' }]} activeIndex={active}
      onActiveIndexChange={setActive} onRemove={noop}
      fieldErrors={{ summary: [label], targets: { [label]: { fieldId: 'items.1.quantity', itemIndex: 1 } } }}
      errorFocusRequest={request} errorFocusMessage={label}
      rail={<Button onClick={() => setRequest((value) => value + 1)}>定位数量</Button>}
    />;
  }
  const scroll = vi.spyOn(HTMLElement.prototype, 'scrollIntoView');
  flushSync(() => root.render(<AdminGapFixture />));
  await layoutReady();
  expect(scroll).not.toHaveBeenCalled();
  await page.getByRole('button', { name: '定位数量', exact: true }).click();
  await expect.poll(() => document.activeElement?.id.endsWith('-quantity')).toBe(true);
  expect(selectedStyle().textContent).toContain('2.');
  expect(scroll).toHaveBeenCalledTimes(1);
});

function CdrFixture() {
  const [files, setFiles] = useState<OrderFormBProps['pendingDesigns']>({});
  const [active, setActive] = useState(0);
  return <OrderFormB {...baseProps} items={[baseItem, baseItem]}
    itemFields={[{ id: 'one' }, { id: 'two' }]} activeIndex={active}
    onActiveIndexChange={setActive} onRemove={noop} pendingDesigns={files}
    onPendingDesignsChange={(queue) => setFiles((old) => ({ ...old, [active ? 'two' : 'one']: queue }))}
  />;
}
for (const theme of ['light', 'dark']) for (const width of [375, 393, 768, 1024, 1280, 1920]) {
  it(`${width} ${theme}: CDR multi-selection appends, validates, drops and removes individual files`, async () => {
    await page.viewport(width, 900);
    document.documentElement.classList.toggle('dark', theme === 'dark');
    flushSync(() => root.render(<CdrFixture />));
    const input = host.querySelector<HTMLInputElement>('input[aria-label="第 1 款 CDR 文件"]')!;
    expect(input.multiple).toBe(true);
    await expect.element(page.getByText('可多选或拖放多个文件', { exact: true })).toBeVisible();
    const select = (names: string[]) => {
      const transfer = new DataTransfer();
      names.forEach((name) => transfer.items.add(new File(['content'], name, { type: 'application/octet-stream' })));
      input.files = transfer.files;
      flushSync(() => input.dispatchEvent(new Event('change', { bubbles: true })));
    };
    select(['front.cdr', 'back.cdr']);
    select(['detail.cdr', 'invalid.txt']);
    for (const name of ['front.cdr', 'back.cdr', 'detail.cdr']) expect(host.querySelector(`[title="${name}"]`)).not.toBeNull();
    expect(host.textContent).toContain('invalid.txt：');
    const transfer = new DataTransfer();
    for (const name of ['drop-one.cdr', 'drop-two.cdr']) transfer.items.add(new File(['cdr'], name));
    const drop = host.querySelector('button[aria-label="拖放或选择第 1 款 CDR 文件"]')!;
    flushSync(() => drop.dispatchEvent(new DragEvent('drop', { bubbles: true, dataTransfer: transfer })));
    expect(host.querySelector('[title="drop-two.cdr"]')).not.toBeNull();
    await page.getByRole('button', { name: '移除第 1 款 CDR 文件 back.cdr', exact: true }).click();
    expect(host.querySelector('[title="back.cdr"]')).toBeNull();
    expect(host.querySelector('[title="front.cdr"]')).not.toBeNull();
    await layoutReady();
    expect(document.documentElement.scrollWidth).toBeLessThanOrEqual(width);
    const remove = host.querySelector('button[aria-label="移除第 1 款 CDR 文件 front.cdr"]')!;
    expect(remove.getBoundingClientRect().height).toBeGreaterThanOrEqual(44);
    expect(await commands.checkShellAccessibility('[data-testid="navigation-fixture"]')).toEqual([]);
  });
}

it('long fee rail stays scrollable in document flow and short rail can stick', async () => {
  await page.viewport(1280, 800);
  const submit = vi.fn();
  const renderRail = (height: number) => flushSync(() => root.render(
    <OrderFormB {...baseProps} items={[baseItem]} itemFields={[{ id: 'rail-item' }]}
      activeIndex={0} onActiveIndexChange={noop} onRemove={noop}
      rail={<div style={{ height, display: 'flex', alignItems: 'flex-end' }}>
        <Button onClick={submit}>核对并创建</Button>
      </div>} />,
  ));
  renderRail(1200);
  await layoutReady();
  const rail = host.querySelector<HTMLElement>('[data-slot="order-form-rail"]')!;
  await expect.poll(() => getComputedStyle(rail).position).toBe('static');
  await page.getByRole('button', { name: '核对并创建', exact: true }).click();
  expect(submit).toHaveBeenCalledOnce();
  window.scrollTo(0, 0);
  renderRail(100);
  await expect.poll(() => getComputedStyle(rail).position).toBe('sticky');
  expect(rail.getBoundingClientRect().bottom).toBeLessThanOrEqual(window.innerHeight);
});

type Groups = Parameters<typeof orderPackagingSelection>[0];
function WholeOrderPackagingFixture() {
  const items = [
    { ...baseItem, fig: 1, designGroupKey: 'design-a', quantity: 1000 },
    { ...baseItem, fig: 2, designGroupKey: 'design-a', specification: '方形', quantity: 500 },
    { ...baseItem, fig: 3, designGroupKey: 'design-b', quantity: 1500 },
  ];
  const quantities = items.map((item) => item.quantity);
  const [groups, setGroups] = useState<Groups>(() => items.map((_, index) => ({
    name: null, mode: 'SINGLE_STYLE', actualBagCount: 1, itemUnitsPerBag: items.map((__, item) => item === index ? 10 : 0),
  })));
  const rows = createPackagingRows({ groups, itemQuantities: quantities });
  return <OrderFormB {...baseProps}
    items={items} itemFields={items.map((item) => ({ id: `item-${item.fig}` }))} activeIndex={0}
    onActiveIndexChange={noop} onRemove={noop} onAddSpecification={noop}
    packaging={{
      rows: rows.map((row, index) => ({
        ...row, quantity: quantities[index],
        label: `设计款 ${index < 2 ? 1 : 2} · ${items[index].specification}`,
      })),
      selection: orderPackagingSelection(groups, items.length),
      summary: summarizeCreatePackaging({ rows, itemQuantities: quantities, designCount: 2 }),
    }}
    onPackagingTypeChange={(type, box, index) => setGroups((current) => index === undefined
      ? applyOrderPackagingType(current, items.length, type, box)
      : applySpecPackagingType(current, items.length, index, type, box))}
    onPackagingMixingChange={(mixed) => setGroups((current) => applyOrderPackagingMixing(current, items.length, mixed))}
    onUnitsPerBagChange={(index, value) => setGroups((current) => {
      const target = createPackagingGroupIndex(current, index);
      return current.map((group, candidate) => candidate === target
        ? { ...group, itemUnitsPerBag: group.itemUnitsPerBag.map((units, item) => item === index ? value : units) }
        : group);
    })}
  />;
}
for (const theme of ['light', 'dark']) for (const [width, height] of [[375, 667], [1280, 800]]) {
  it(`whole-order packaging ${width}x${height} ${theme}: outside design tabs, per-spec override, shared type and mixing`, async () => {
    await page.viewport(width, height);
    document.documentElement.classList.toggle('dark', theme === 'dark');
    flushSync(() => root.render(<WholeOrderPackagingFixture />));
    await layoutReady();
    // 包装在设计款卡片之外，规格面板里不再有包装输入。
    expect(host.querySelector('[data-slot="order-design-section"] section[aria-label="包装"]')).toBeNull();
    expect(host.querySelector('[data-slot="order-specification-section"] input[id$="-units-per-bag"]')).toBeNull();
    const section = host.querySelector<HTMLElement>('[data-slot="order-packaging-section"] section[aria-label="包装"]')!;
    expect(section.textContent).toContain('合计 3,000 个 · 2 个设计款 / 3 个规格 · 300 包');
    await expect.element(page.getByRole('spinbutton', { name: '每包数量', exact: true }).nth(2)).toBeVisible();

    // 单个规格单独改装盒：整单类型变为「不一致」，其他规格不动。
    await page.getByRole('combobox', { name: '包装类型', exact: true }).nth(1).selectOptions('BOX_TACTILE');
    await expect.element(page.getByRole('spinbutton', { name: '每盒数量', exact: true })).toHaveValue(8);
    expect(host.querySelector('[id$="-1-packaging-message"]')!.textContent).toBe('共 63 盒');
    expect(host.querySelector('[id$="-0-packaging-message"]')!.textContent).toBe('共 100 包');
    await expect.element(page.getByRole('button', { name: '入袋', exact: true })).toHaveAttribute('aria-pressed', 'false');
    expect(section.textContent).toContain('各规格包装类型不同');
    expect(section.textContent).toContain('250 包 + 63 盒');

    // 顶部类型统一作用于全部规格。
    await page.getByRole('button', { name: '入袋', exact: true }).click();
    await expect.element(page.getByRole('button', { name: '入袋', exact: true })).toHaveAttribute('aria-pressed', 'true');
    await expect.element(page.getByRole('spinbutton', { name: '每盒数量', exact: true })).not.toBeInTheDocument();

    // 混装覆盖全部规格；一包合计超过 12 个时每行都提示，调整后得到同一包数。
    await page.getByRole('button', { name: '混装', exact: true }).click();
    await expect.element(page.getByRole('button', { name: '混装', exact: true })).toHaveAttribute('aria-pressed', 'true');
    expect(host.querySelectorAll('select[id$="-packaging-choice"]').length).toBe(0);
    expect(host.querySelector('[id$="-2-units-per-bag"]')!.getAttribute('aria-invalid')).toBe('true');
    for (const [index, units] of [[0, '4'], [1, '2'], [2, '6']] as const) {
      await page.getByRole('spinbutton', { name: '每包数量', exact: true }).nth(index).fill(units);
    }
    await layoutReady();
    for (const index of [0, 1, 2]) {
      expect(host.querySelector(`[id$="-${index}-packaging-message"]`)!.textContent).toBe('共 250 包（混装组）');
    }
    expect(section.textContent).toContain('3 个规格 · 250 包');

    for (const control of section.querySelectorAll('button, select')) {
      const rect = control.getBoundingClientRect();
      expect(rect.height).toBeGreaterThanOrEqual(44);
      expect(rect.right).toBeLessThanOrEqual(width);
    }
    expect(document.documentElement.scrollWidth).toBeLessThanOrEqual(width);
    expect(await commands.checkShellAccessibility('[data-slot="order-packaging-section"]')).toEqual([]);
  });
}
