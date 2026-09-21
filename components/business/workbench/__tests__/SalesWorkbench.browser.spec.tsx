import { waitForStableLayout } from '@/tests/browser/wait-for-layout';
import type { ComponentProps } from 'react';
import { flushSync } from 'react-dom';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { commands, page, userEvent } from 'vitest/browser';
import {
  WORKBENCH_CATALOG,
  WORKBENCH_CRAFTS,
} from '@/lib/workbench/__tests__/item-fixtures';
import {
  OrderItemPricingRoute,
  OrderLamination,
} from '@/generated/prisma/enums';
import type { WorkbenchQuoteResult } from '@/lib/workbench/quote';
import '@/app/globals.css';

const mocks = vi.hoisted(() => ({ quote: vi.fn(), push: vi.fn() }));
vi.mock('@/actions/workbench', () => ({
  quoteWorkbenchItemAction: mocks.quote,
}));
vi.mock('@/actions/create-order-quote', () => ({ quoteSampleOrderAction: vi.fn() }));
vi.mock('@/actions/order', () => ({ createOrderAction: vi.fn(), submitOrderAction: vi.fn() }));
vi.mock('@/actions/design-upload', () => ({ signDesignUploadAction: vi.fn(), recordDesignUploadAction: vi.fn(), deleteOrderItemDesignAction: vi.fn() }));
vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: mocks.push, replace: mocks.push }),
}));
vi.mock('next/image', () => ({
  default: ({ alt }: { alt: string }) => <span>{alt}</span>,
}));
vi.mock('next/link', () => ({
  __esModule: true,
  default: ({
    prefetch: _prefetch,
    ...props
  }: ComponentProps<'a'> & { prefetch?: boolean }) => {
    void _prefetch;
    return <a {...props} />;
  },
}));
import { SalesWorkbench } from '../SalesWorkbench';
import { SALES_SCENARIOS } from '@/lib/workbench/knowledge';

const options = WORKBENCH_CATALOG;
const success: WorkbenchQuoteResult = {
  status: 'success',
  quote: {
    baseAmount: '365.00',
    suggestedAmount: '492.75',
    markupAmount: '127.75',
    lines: [
      { name: '基础加工费', rate: '0.325', units: '1000', amount: '325.00' },
      { name: '烫金费', rate: '0.04', units: '1000', amount: '40.00' },
    ],
    needsPricing: false,
    plateFeePending: true,
    processingVersion: 1,
  },
};
let host: HTMLDivElement;
let root: Root;
beforeEach(async () => {
  await commands.setReducedMotion(true);
  vi.clearAllMocks();
  mocks.quote.mockResolvedValue(success);
  document.documentElement.lang = 'zh-CN';
  host = document.createElement('div');
  host.dataset.testid = 'workbench-fixture';
  host.className = 'admin-viewport p-4';
  document.body.append(host);
  root = createRoot(host);
});
afterEach(async () => {
  await commands.setReducedMotion(false);
  flushSync(() => root.unmount());
  host.remove();
  document.documentElement.classList.remove('dark');
});
function render(unavailable = false, catalog = options) {
  flushSync(() =>
    root.render(
      <SalesWorkbench
        options={catalog}
        crafts={WORKBENCH_CRAFTS}
        draftScope="sales"
        catalogUnavailable={unavailable}
      />,
    ),
  );
}
function geometry(width: number) {
  expect(document.documentElement.scrollWidth).toBeLessThanOrEqual(width);
  // Match the shared ui-gates contract: Base UI's aria-hidden form inputs
  // are not touch controls; their visible combobox triggers are checked.
  if (width <= 768)
    for (const element of host.querySelectorAll(
      'button, input:not([type="hidden"]):not([aria-hidden="true"]), a, summary',
    )) {
      if (!(element instanceof HTMLElement) || !element.checkVisibility())
        continue;
      const box = element.getBoundingClientRect();
      expect(
        box.height,
        element.textContent ?? element.tagName,
      ).toBeGreaterThanOrEqual(44);
      expect(
        box.width,
        element.textContent ?? element.tagName,
      ).toBeGreaterThanOrEqual(44);
    }
}
describe('sales workbench responsive gates', () => {
  for (const [width, height] of [
    [375, 667],
    [393, 852],
    [768, 1024],
    [1024, 768],
    [1280, 800],
    [1920, 1080],
  ]) {
    for (const theme of ['light', 'dark'])
      it(`${width}×${height} ${theme}`, async () => {
        await page.viewport(width!, height!);
        document.documentElement.classList.toggle('dark', theme === 'dark');
        render();
        await waitForStableLayout(host);
        for (const name of ['报价计算', '纸张与规格', '话术应对']) {
          await page.getByRole('button', { name, exact: true }).click();
          if (name === '话术应对')
            await userEvent.click(
              page.getByText('太贵了，能不能优惠点', { exact: true }),
            );
          await waitForStableLayout(host);
          geometry(width!);
          expect(
            await commands.checkShellAccessibility(
              '[data-testid="workbench-fixture"]',
            ),
          ).toEqual([]);
        }
      });
  }
});
it('searches, clears empty results, copies a reply and displays failures', async () => {
  await page.viewport(393, 852);
  render();
  await page.getByRole('button', { name: '话术应对', exact: true }).click();
  await page
    .getByRole('textbox', { name: '搜索销售话术' })
    .fill('不存在的场景');
  await expect.element(page.getByText('没有匹配的话术')).toBeVisible();
  await page.getByRole('button', { name: '清除筛选' }).click();
  await page
    .getByRole('textbox', { name: '搜索销售话术' })
    .fill('感觉纸质好薄');
  await page.getByText('感觉纸质好薄', { exact: true }).click();
  const write = vi.spyOn(navigator.clipboard, 'writeText').mockResolvedValue();
  await page.getByRole('button', { name: '复制话术：感觉纸质好薄' }).click();
  expect(write).toHaveBeenCalledWith(expect.stringContaining('纸的名称、克重'));
  await expect.element(page.getByText(/^已复制话术/)).toBeVisible();
  write.mockRejectedValueOnce(new Error('denied'));
  await page.getByRole('button', { name: '复制话术：感觉纸质好薄' }).click();
  await expect
    .element(page.getByText(/话术复制失败，请手动选择复制/))
    .toBeVisible();
  write.mockRestore();
});
it('keeps sales knowledge usable without the catalog', async () => {
  render(true);
  await expect.element(page.getByText('产品资料暂无法加载')).toBeVisible();
  await page.getByRole('button', { name: '话术应对', exact: true }).click();
  await expect.element(page.getByText('17 个应对场景')).toBeVisible();
});

it.each([...new Set(SALES_SCENARIOS.map(item => item.category))])('filters %s, opens and closes every scenario and copies each exact reply', async category => {
  render();
  await page.getByRole('button', { name: '话术应对', exact: true }).click();
  const write = vi.spyOn(navigator.clipboard, 'writeText').mockResolvedValue();
  try {
    await page.getByRole('button', { name: category, exact: true }).click();
    await expect
      .element(
        page.getByText(
          `${SALES_SCENARIOS.filter((item) => item.category === category).length} 个应对场景`,
        ),
      )
      .toBeVisible();
    for (const item of SALES_SCENARIOS.filter(
      (item) => item.category === category,
    )) {
      await page.getByText(item.title, { exact: true }).click();
      await expect
        .element(page.getByText(item.concern, { exact: true }))
        .toBeVisible();
      await expect
        .element(page.getByText(item.approach, { exact: true }))
        .toBeVisible();
      await expect
        .element(page.getByText(item.avoid, { exact: true }))
        .toBeVisible();
      await page
        .getByRole('button', { name: `复制话术：${item.title}`, exact: true })
        .click();
      expect(write).toHaveBeenLastCalledWith(item.reply);
      await page.getByText(item.title, { exact: true }).click();
      await expect
        .element(page.getByText(item.reply, { exact: true }))
        .not.toBeVisible();
    }
    await page.getByRole('button', { name: '全部', exact: true }).click();
    await expect.element(page.getByText('17 个应对场景')).toBeVisible();
  } finally {
    write.mockRestore();
  }
});

it('shows a paper weight once when its specification already contains that weight', async () => {
  render();
  await page.getByRole('button', { name: '纸张与规格', exact: true }).click();
  const materials = page.getByRole('region', {
    name: '纸张与规格',
    exact: true,
  });
  await expect
    .element(materials.getByText('160g', { exact: true }))
    .toBeVisible();
  await expect
    .element(materials.getByText('160g · 160g', { exact: true }))
    .not.toBeInTheDocument();
});

it('uses order conditions, calculates automatically and changes markup without requesting a new base', async () => {
  render();
  await expect.poll(() => mocks.quote.mock.calls.length).toBe(1);
  expect(mocks.quote.mock.calls[0]![0].item).toMatchObject({
    pricingRoute: 'STOCK_BLANK',
    quantity: 1000,
    productId: null,
    paperWeightGsm: 160,
  });
  await expect
    .element(page.getByText('¥ 492.75', { exact: true }))
    .toBeVisible();
  await page.getByRole('spinbutton', { name: '加工费加价比例（%）' }).fill('0');
  await expect
    .element(page.getByRole('status').getByText('¥ 365.00', { exact: true }))
    .toBeVisible();
  expect(mocks.quote).toHaveBeenCalledTimes(1);
  await page
    .getByRole('spinbutton', { name: '加工费加价比例（%）' })
    .fill('100');
  await expect
    .element(page.getByText('¥ 730.00', { exact: true }))
    .toBeVisible();
  expect(mocks.quote).toHaveBeenCalledTimes(1);
  await page
    .getByRole('spinbutton', { name: '加工费加价比例（%）' })
    .fill('-1');
  await expect.element(page.getByText('请输入 0–100 的整数')).toBeVisible();
  await expect
    .element(page.getByText('¥ 730.00', { exact: true }))
    .not.toBeInTheDocument();
});
it('uses shared lamination and printed-foil selectors without losing the selected material', async () => {
  render();
  await page
    .getByRole('group', { name: '工单类型' })
    .getByRole('button', { name: '彩印', exact: true })
    .click();
  await page
    .getByRole('group', { name: '覆膜' })
    .getByRole('button', { name: '触感膜', exact: true })
    .click();
  await page
    .getByRole('group', { name: '叠加烫金' })
    .getByRole('button', { name: '局部烫金', exact: true })
    .click();
  await expect
    .poll(() => mocks.quote.mock.calls.at(-1)?.[0]?.item)
    .toMatchObject({
      pricingRoute: OrderItemPricingRoute.COLOR_PRINT,
      lamination: OrderLamination.SOFT_TOUCH,
      hasLocalFoil: true,
      paperWeightGsm: 200,
    });
  await page
    .getByRole('group', { name: '叠加烫金' })
    .getByRole('button', { name: '专版烫金', exact: true })
    .click();
  await expect
    .poll(() => mocks.quote.mock.calls.at(-1)?.[0]?.item.hasLocalFoil)
    .toBe(false);
});
it('keeps administrator foil names selected and supports deselection without aliases or duplicates', async () => {
  render(false, {
    ...options,
    foilColors: [{ ...options.foilColors[0]!, name: '哑金' }],
  });
  const swatch = page.getByRole('button', { name: /^哑金(?:，第 \d 色)?$/ });
  await expect.element(swatch).toHaveAttribute('aria-pressed', 'true');
  await expect
    .poll(() => mocks.quote.mock.calls.at(-1)?.[0].item.frontFoilColors)
    .toEqual(['哑金']);
  await swatch.click();
  await expect.element(swatch).toHaveAttribute('aria-pressed', 'false');
  await swatch.click();
  await expect.element(swatch).toHaveAttribute('aria-pressed', 'true');
  await expect
    .poll(() => mocks.quote.mock.calls.at(-1)?.[0].item.frontFoilColors)
    .toEqual(['哑金']);
  await page.getByRole('button', { name: '按此款式创建工单' }).click();
  const id = new URL(
    mocks.push.mock.calls[0]![0],
    'http://localhost',
  ).searchParams.get('fromWorkbench');
  expect(
    JSON.parse(sessionStorage.getItem(`workbench-order:sales:${id}`)!).item
      .frontFoilColors,
  ).toEqual(['哑金']);
});
it('quotes and transfers the selected finishing for a COATED catalog paper', async () => {
  render(false, {
    ...options,
    products: options.products.map((product) =>
      product.id === 'color'
        ? { ...product, paperType: '200gCOATED' }
        : product,
    ),
    papers: options.papers.map((paper) =>
      paper.id === 'coated' ? { ...paper, name: 'COATED' } : paper,
    ),
  });
  await page
    .getByRole('group', { name: '工单类型' })
    .getByRole('button', { name: '彩印', exact: true })
    .click();
  const finishing = page
    .getByRole('group', { name: '覆膜' })
    .getByRole('button', { name: '触感膜', exact: true });
  await finishing.click();
  await expect.element(finishing).toHaveAttribute('aria-pressed', 'true');
  await expect
    .poll(() => mocks.quote.mock.calls.at(-1)?.[0].item.lamination)
    .toBe(OrderLamination.SOFT_TOUCH);
  await page.getByRole('button', { name: '按此款式创建工单' }).click();
  const id = new URL(
    mocks.push.mock.calls[0]![0],
    'http://localhost',
  ).searchParams.get('fromWorkbench');
  expect(
    JSON.parse(sessionStorage.getItem(`workbench-order:sales:${id}`)!).item
      .lamination,
  ).toBe(OrderLamination.SOFT_TOUCH);
});
it('rejects invalid quantities and stale asynchronous results, preserves focus, and retries failures', async () => {
  render();
  await expect.poll(() => mocks.quote.mock.calls.length).toBe(1);
  let resolve!: (result: WorkbenchQuoteResult) => void;
  mocks.quote.mockImplementationOnce(
    () =>
      new Promise<WorkbenchQuoteResult>((done) => {
        resolve = done;
      }),
  );
  const quantity = page.getByRole('spinbutton', { name: '数量', exact: true });
  await quantity.fill('2000');
  await expect.poll(() => mocks.quote.mock.calls.length).toBe(2);
  await quantity.fill('0');
  resolve(success);
  await expect
    .element(page.getByText('¥ 492.75', { exact: true }))
    .not.toBeInTheDocument();
  await expect.element(quantity).toHaveFocus();
  mocks.quote.mockRejectedValueOnce(new Error('offline'));
  await quantity.fill('9999999');
  await expect
    .element(page.getByText('计算失败，请检查网络后重新计算'))
    .toBeVisible();
  await page.getByRole('button', { name: '重试报价' }).click();
  await expect
    .element(page.getByText('¥ 492.75', { exact: true }))
    .toBeVisible();
  expect(mocks.quote.mock.calls.at(-1)?.[0].item.quantity).toBe(9999999);
});
it('keeps missing prices unknown and passes only item conditions to order creation', async () => {
  mocks.quote.mockResolvedValue({
    status: 'success',
    quote: {
      ...success.quote,
      baseAmount: null,
      needsPricing: true,
      pricingReasons: ['该组合待管理员核价'],
    },
  });
  render();
  await expect.element(page.getByText('该组合待管理员核价')).toBeVisible();
  await expect
    .element(page.getByRole('status').getByText('待核价', { exact: true }))
    .toBeVisible();
  await page.getByRole('button', { name: '按此款式创建工单' }).click();
  expect(mocks.push).toHaveBeenCalledWith(
    expect.stringMatching(/^\/orders\/new\?fromWorkbench=/),
  );
  const id = new URL(
    mocks.push.mock.calls[0]![0],
    'http://localhost',
  ).searchParams.get('fromWorkbench');
  const transferred = JSON.parse(
    window.sessionStorage.getItem(`workbench-order:sales:${id}`)!,
  );
  expect(transferred.item).toMatchObject({
    productId: null,
    quantity: 1000,
  });
  expect(transferred.item).not.toHaveProperty('suggestedSubtotal');
  expect(transferred).not.toHaveProperty('markup');
});
it('resolves duplicated products only after explicit selection and never silently switches them', async () => {
  const catalog = {
    ...options,
    products: [
      ...options.products,
      { ...options.products[1]!, id: 'custom2', name: '专版烫金二' },
    ],
  };
  render(false, catalog);
  await page.getByRole('button', { name: '专版烫金', exact: true }).click();
  mocks.quote.mockClear();
  const select = page.getByRole('combobox', { name: '匹配产品' });
  await expect.element(select).toHaveValue('');
  expect(mocks.quote).not.toHaveBeenCalled();
  await userEvent.selectOptions(select, 'custom2');
  await expect
    .poll(() => mocks.quote.mock.calls.at(-1)?.[0].item.productId)
    .toBe('custom2');
  await page.getByRole('spinbutton', { name: '数量', exact: true }).fill('500');
  await expect
    .poll(() => mocks.quote.mock.calls.at(-1)?.[0].item.quantity)
    .toBe(500);
  expect(mocks.quote.mock.calls.at(-1)?.[0].item.productId).toBe('custom2');
});
