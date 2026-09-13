import { useEffect, useState, type ComponentProps } from 'react';
import { flushSync } from 'react-dom';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { commands, page, userEvent } from 'vitest/browser';
import '@/app/globals.css';
import { createOrderSchema } from '@/lib/auth/schemas';
import { OrderFormB, type OrderFormBProps } from '../order-form-b/ExternalSalesOrderFormB';

vi.mock('next/link', () => ({ default: (props: ComponentProps<'a'>) => <a {...props} /> }));
vi.mock('next/image', () => ({ default: ({ alt }: { alt: string }) => <span>{alt}</span> }));
vi.mock('../design-upload-client', () => ({ prepareDesignFile: vi.fn() }));
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
const baseProps: Omit<OrderFormBProps, 'items' | 'itemFields' | 'activeIndex' | 'onActiveIndexChange' | 'onRemove'> = {
  values: { customName: '测试工单', receiverName: '', receiverPhone: '', receiverAddress: '', isSfCollect: false },
  pendingDesigns: {},
  packaging: { mode: 'SINGLE_STYLE', unitsPerBag: 10, bagCount: 100 },
  paperOptions: [{ value: 'pearl', label: '珠光艳闪', texture: 'matte-red' }],
  paperKey: 'pearl', weightOptions: [{ value: 160 }],
  specificationOptions: [{ value: '大号封', label: '大号封' }],
  savedLabel: '草稿已保存 11:26:30', rail: <div>费用明细</div>,
  onAdd: noop, onDuplicate: noop, onCustomNameChange: noop, onRouteChange: noop,
  onPaperChange: noop, onWeightChange: noop, onSpecificationChange: noop,
  onFoilSidesChange: noop, onBackFoilToggle: noop, onFoilTechniqueChange: noop,
  onCustomSizeChange: noop, onPrintFoilModeChange: noop, onLaminationChange: noop,
  onQuantityChange: noop, onPackagingModeChange: noop, onUnitsPerBagChange: noop,
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
    packaging={{ mode: 'SINGLE_STYLE', unitsPerBag, bagCount: Math.ceil(quantity / unitsPerBag) }}
    onQuantityChange={(value) => { setQuantity(value); setQuoteFailed(false); }}
    onUnitsPerBagChange={(value) => { setUnitsPerBag(value); setQuoteFailed(false); }}
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
    packaging={{ ...baseProps.packaging, error: invalid ? '每包数量不能超过 12 个，请调整包装数量' : null }}
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
      expect(host.querySelectorAll('[role="alert"]').length > 0).toBe(invalid);
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
    expect(await commands.checkShellAccessibility('section[aria-label="数量与包装"]')).toEqual([]);
  });
}
