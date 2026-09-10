import type { ComponentProps } from 'react';
import { flushSync } from 'react-dom';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { commands, page, userEvent } from 'vitest/browser';
import {
  OrderProductStructure,
  ProductCategory,
} from '@/generated/prisma/enums';
import type { ExternalCreateOrderOptions } from '@/lib/order/create-order-options';
import type { WorkbenchQuoteResult } from '@/lib/workbench/quote';
import '@/app/globals.css';

const mocks = vi.hoisted(() => ({ quote: vi.fn() }));
vi.mock('@/actions/workbench', () => ({ quoteWorkbenchAction: mocks.quote }));
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

const options: ExternalCreateOrderOptions = {
  products: [
    {
      id: 'custom',
      code: null,
      name: '大号专版烫金',
      category: ProductCategory.CUSTOM_FLAT_FOIL,
      specification: '大号封90×165',
      paperType: '160g珠光艳闪',
      paperMaterialId: null,
      weight: 160,
    },
  ],
  papers: [
    {
      id: 'paper',
      code: 'paper',
      name: '珠光艳闪',
      specification: '160g',
      unit: '张',
      outOfStock: false,
      sortOrder: 0,
      weight: 160,
    },
  ],
  specifications: [
    {
      specCode: 'large',
      label: '大号封',
      widthMm: 90,
      heightMm: 165,
      productStructure: OrderProductStructure.STANDARD_ENVELOPE,
      productIds: ['custom'],
      productCategories: [ProductCategory.CUSTOM_FLAT_FOIL],
    },
  ],
  foilColors: [
    {
      id: 'gold',
      code: 'gold',
      name: '哑金',
      displayColor: null,
      displayImage: null,
      sortOrder: 0,
    },
  ],
};
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
beforeEach(() => {
  vi.clearAllMocks();
  mocks.quote.mockResolvedValue(success);
  document.documentElement.lang = 'zh-CN';
  host = document.createElement('div');
  host.dataset.testid = 'workbench-fixture';
  host.className = 'p-4';
  document.body.append(host);
  root = createRoot(host);
});
afterEach(() => {
  flushSync(() => root.unmount());
  host.remove();
  document.documentElement.classList.remove('dark');
});
function render(unavailable = false, catalog = options) {
  flushSync(() =>
    root.render(
      <SalesWorkbench options={catalog} catalogUnavailable={unavailable} />,
    ),
  );
}
async function chooseProduct() {
  await page.getByRole('combobox', { name: '产品', exact: true }).click();
  await page.getByRole('option', { name: '大号专版烫金' }).click();
  await page
    .getByRole('group', { name: '正面烫金颜色（最多 3 色）' })
    .getByRole('button', { name: '哑金' })
    .click();
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
        for (const name of ['报价计算', '纸张与规格', '话术应对']) {
          await page.getByRole('button', { name, exact: true }).click();
          if (name === '话术应对')
            await userEvent.click(
              page.getByText('太贵了，能不能优惠点', { exact: true }),
            );
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
it('calculates, invalidates a changed input and ignores an older in-flight response', async () => {
  await page.viewport(1280, 800);
  render();
  await chooseProduct();
  await page.getByRole('button', { name: '计算报价', exact: true }).click();
  await expect
    .element(page.getByText('¥ 492.75', { exact: true }))
    .toBeVisible();
  await page.getByRole('spinbutton', { name: '数量（个）' }).fill('2000');
  await expect
    .element(page.getByText('¥ 492.75', { exact: true }))
    .not.toBeInTheDocument();
  let resolve!: (result: WorkbenchQuoteResult) => void;
  mocks.quote.mockImplementationOnce(
    () =>
      new Promise<WorkbenchQuoteResult>((done) => {
        resolve = done;
      }),
  );
  await page.getByRole('button', { name: '计算报价', exact: true }).click();
  await page.getByRole('spinbutton', { name: '数量（个）' }).fill('3000');
  resolve(success);
  await expect.element(page.getByText('填写需求后计算报价')).toBeVisible();
  await expect
    .element(page.getByText('¥ 492.75', { exact: true }))
    .not.toBeInTheDocument();
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

it('selects and deselects every foil color on both sides and enforces independent three-color limits', async () => {
  render(false, {
    ...options,
    foilColors: ['金', '银', '红', '蓝', '绿', '黑', '透明', '浅色'].map(
      (name, index) => ({ ...options.foilColors[0]!, id: String(index), name }),
    ),
  });
  for (const side of ['正面', '反面']) {
    const group = page.getByRole('group', {
      name: `${side}烫金颜色（最多 3 色）`,
    });
    for (const name of ['金', '银', '红', '蓝', '绿', '黑', '透明', '浅色']) {
      const button = group.getByRole('button', { name, exact: true });
      await button.click();
      await expect.element(button).toHaveAttribute('aria-pressed', 'true');
      await button.click();
      await expect.element(button).toHaveAttribute('aria-pressed', 'false');
    }
    for (const name of ['金', '银', '红'])
      await group.getByRole('button', { name, exact: true }).click();
    await expect
      .element(group.getByRole('button', { name: '蓝', exact: true }))
      .toBeDisabled();
    await group.getByRole('button', { name: '金', exact: true }).click();
    await expect
      .element(group.getByRole('button', { name: '蓝', exact: true }))
      .toBeEnabled();
    await group.getByRole('button', { name: '蓝', exact: true }).click();
  }
});

it('selects every quantity and markup preset, preserves form across sections and rejects invalid numbers', async () => {
  render();
  await chooseProduct();
  for (const quantity of [500, 1000, 2000, 5000, 10000, 50000]) {
    await page
      .getByRole('button', {
        name: quantity.toLocaleString('zh-CN'),
        exact: true,
      })
      .click();
    await expect
      .element(page.getByRole('spinbutton', { name: '数量（个）' }))
      .toHaveValue(quantity);
  }
  for (const markup of [0, 20, 35, 50, 80]) {
    await page
      .getByRole('button', {
        name: markup === 0 ? '不加价' : `+${markup}%`,
        exact: true,
      })
      .click();
    await expect
      .element(page.getByRole('spinbutton', { name: '加工费加价比例（%）' }))
      .toHaveValue(markup);
  }
  await page.getByRole('button', { name: '纸张与规格', exact: true }).click();
  await page.getByRole('button', { name: '报价计算', exact: true }).click();
  await expect
    .element(page.getByRole('spinbutton', { name: '数量（个）' }))
    .toHaveValue(50000);
  for (const [label, values, valid] of [
    ['数量（个）', ['', '0', '-1', '1.5', '10000000'], '1000'],
    ['加工费加价比例（%）', ['', '-1', '101', '1.5'], '35'],
  ] as const) {
    for (const value of values) {
      await page.getByRole('spinbutton', { name: label }).fill(value);
      await page.getByRole('button', { name: '计算报价', exact: true }).click();
      expect(mocks.quote).not.toHaveBeenCalled();
    }
    await page.getByRole('spinbutton', { name: label }).fill(valid);
  }
  await page.getByRole('button', { name: '计算报价', exact: true }).click();
  expect(mocks.quote).toHaveBeenCalledWith(
    expect.objectContaining({ quantity: 1000, markup: 35 }),
  );
});

it('filters every category, opens and closes all 17 scenarios and copies each exact reply', async () => {
  render();
  await page.getByRole('button', { name: '话术应对', exact: true }).click();
  const write = vi.spyOn(navigator.clipboard, 'writeText').mockResolvedValue();
  try {
    for (const category of new Set(
      SALES_SCENARIOS.map((item) => item.category),
    )) {
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
    }
    await page.getByRole('button', { name: '全部', exact: true }).click();
    await expect.element(page.getByText('17 个应对场景')).toBeVisible();
  } finally {
    write.mockRestore();
  }
});

it('disables empty dependent choices and recovers from server and network failures', async () => {
  render();
  for (const label of ['规格', '纸张'])
    await expect
      .element(page.getByRole('combobox', { name: label, exact: true }))
      .toBeDisabled();
  await chooseProduct();
  mocks.quote.mockResolvedValueOnce({
    status: 'error',
    message: '请重新选择产品',
  });
  await page.getByRole('button', { name: '计算报价', exact: true }).click();
  await expect.element(page.getByText('请重新选择产品')).toBeVisible();
  mocks.quote.mockRejectedValueOnce(new Error('offline'));
  await page.getByRole('button', { name: '计算报价', exact: true }).click();
  await expect
    .element(page.getByText('计算失败，请检查网络后重新计算'))
    .toBeVisible();
  await page.getByRole('button', { name: '计算报价', exact: true }).click();
  await expect
    .element(page.getByText('¥ 492.75', { exact: true }))
    .toBeVisible();
  await expect
    .element(page.getByRole('link', { name: '创建工单' }))
    .toHaveAttribute('href', '/orders/new');
});

it('clears dependent selections on route changes and clears foil colors when switching to no foil', async () => {
  render(false, {
    ...options,
    products: [
      ...options.products,
      {
        ...options.products[0]!,
        id: 'print',
        name: '彩印测试产品',
        category: ProductCategory.COLOR_PRINT,
      },
    ],
  });
  await chooseProduct();
  await page.getByRole('combobox', { name: '产品类型', exact: true }).click();
  await page.getByRole('option', { name: '彩印', exact: true }).click();
  await expect
    .element(page.getByRole('combobox', { name: '产品', exact: true }))
    .toHaveTextContent('请选择');
  await expect
    .element(page.getByRole('combobox', { name: '烫金方式', exact: true }))
    .toHaveTextContent('无烫金');
  await page.getByRole('combobox', { name: '产品', exact: true }).click();
  await page.getByRole('option', { name: '彩印测试产品', exact: true }).click();
  await page.getByRole('combobox', { name: '烫金方式', exact: true }).click();
  await page.getByRole('option', { name: '平烫', exact: true }).click();
  const gold = page
    .getByRole('group', { name: '正面烫金颜色（最多 3 色）' })
    .getByRole('button', { name: '哑金' });
  await expect.element(gold).toHaveAttribute('aria-pressed', 'false');
  await gold.click();
  await page.getByRole('combobox', { name: '烫金方式', exact: true }).click();
  await page.getByRole('option', { name: '无烫金', exact: true }).click();
  await page.getByRole('button', { name: '计算报价', exact: true }).click();
  expect(mocks.quote).toHaveBeenLastCalledWith(
    expect.objectContaining({
      productId: 'print',
      foilTechnique: 'NONE',
      frontFoilColors: [],
      backFoilColors: [],
    }),
  );
});
