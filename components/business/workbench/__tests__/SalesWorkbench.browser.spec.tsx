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
  await selectFrontGold();
}
async function selectFrontGold() {
  const button = page
    .getByRole('group', { name: '正面烫金颜色（最多 3 色）' })
    .getByRole('button', { name: '哑金' });
  if (button.element().getAttribute('aria-pressed') !== 'true')
    await button.click();
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
  await expect.element(page.getByText('条件已变更，待重新核价', { exact: true })).toBeVisible();
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
    if (side === '正面')
      await group.getByRole('button', { name: '金', exact: true }).click();
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
      mocks.quote.mockClear();
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

it('offers initial specification and paper choices and recovers from server and network failures', async () => {
  render();
  for (const label of ['规格', '纸张'])
    await expect
      .element(page.getByRole('combobox', { name: label, exact: true }))
      .toBeEnabled();
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
    .toHaveTextContent('彩印测试产品');
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
  await expect.element(gold).toHaveAttribute('aria-pressed', 'true');
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

it('starts with specification or paper, resolves matching products and resets without stale quotes', async () => {
  render(false, {
    ...options,
    products: [
      ...options.products,
      {
        ...options.products[0]!,
        id: 'small',
        name: '小号专版',
        specification: '中号封80×115',
        paperType: '230g红卡',
        weight: 230,
      },
    ],
  });
  await page.getByRole('combobox', { name: '规格', exact: true }).click();
  await page.getByRole('option', { name: '中号封80×115', exact: true }).click();
  await expect
    .element(page.getByRole('combobox', { name: '产品', exact: true }))
    .toHaveTextContent('小号专版');
  await expect
    .element(page.getByRole('combobox', { name: '纸张', exact: true }))
    .toHaveTextContent('230g红卡');
  await page.getByRole('button', { name: '重新选择产品、规格和纸张' }).click();
  await page.getByRole('combobox', { name: '纸张', exact: true }).click();
  await page.getByRole('option', { name: '160g珠光艳闪', exact: true }).click();
  await expect
    .element(page.getByRole('combobox', { name: '产品', exact: true }))
    .toHaveTextContent('大号专版烫金');
  await expect
    .element(page.getByRole('combobox', { name: '规格', exact: true }))
    .toHaveTextContent('大号封90×165');
  await selectFrontGold();
  await page.getByRole('button', { name: '计算报价', exact: true }).click();
  await expect
    .element(page.getByText('¥ 492.75', { exact: true }))
    .toBeVisible();
  expect(mocks.quote).toHaveBeenLastCalledWith(
    expect.objectContaining({
      productId: 'custom',
      specification: '大号封90×165',
      paperType: '160g珠光艳闪',
    }),
  );
  await page.getByRole('button', { name: '重新选择产品、规格和纸张' }).click();
  await expect
    .element(page.getByText('¥ 492.75', { exact: true }))
    .not.toBeInTheDocument();
  for (const label of ['规格', '纸张'])
    await expect
      .element(page.getByRole('combobox', { name: label, exact: true }))
      .toBeEnabled();
});

it('keeps ambiguous paper matches unselected until a specification resolves the product', async () => {
  render(false, {
    ...options,
    products: [
      ...options.products,
      {
        ...options.products[0]!,
        id: 'small',
        name: '中号专版',
        specification: '中号封80×115',
      },
    ],
  });
  await page.getByRole('button', { name: '重新选择产品、规格和纸张' }).click();
  await page.getByRole('combobox', { name: '纸张', exact: true }).click();
  await page.getByRole('option', { name: '160g珠光艳闪', exact: true }).click();
  await expect
    .element(page.getByRole('combobox', { name: '产品', exact: true }))
    .toHaveTextContent('请选择');
  await expect.element(page.getByText(/有 2 个产品符合选择/)).toBeVisible();
  await page.getByRole('combobox', { name: '规格', exact: true }).click();
  await page.getByRole('option', { name: '中号封80×115', exact: true }).click();
  await expect
    .element(page.getByRole('combobox', { name: '产品', exact: true }))
    .toHaveTextContent('中号专版');
  await expect
    .element(page.getByRole('combobox', { name: '纸张', exact: true }))
    .toHaveTextContent('160g珠光艳闪');
});

it('automatically calculates complete input, debounces edits and keeps keyboard focus', async () => {
  mocks.quote.mockImplementation(async (input: { quantity: number }) => ({
    ...success,
    quote: {
      ...(success.status === 'success' ? success.quote : {}),
      suggestedAmount: `${input.quantity}.00`,
    },
  }));
  render();
  await expect
    .element(page.getByText('¥ 1,000.00', { exact: true }))
    .toBeVisible();
  await page.getByRole('button', { name: '重新选择产品、规格和纸张' }).click();
  mocks.quote.mockClear();
  await new Promise((resolve) => setTimeout(resolve, 650));
  expect(mocks.quote).not.toHaveBeenCalled();
  await chooseProduct();
  await expect
    .element(page.getByText('¥ 1,000.00', { exact: true }))
    .toBeVisible();
  mocks.quote.mockClear();
  const quantity = page.getByRole('spinbutton', { name: '数量（个）' });
  await quantity.fill('2000');
  await quantity.fill('3000');
  await expect
    .element(page.getByText('¥ 3,000.00', { exact: true }))
    .toBeVisible();
  expect(mocks.quote).toHaveBeenCalledTimes(1);
  await expect.element(quantity).toHaveFocus();
  await quantity.fill('');
  await new Promise((resolve) => setTimeout(resolve, 650));
  expect(mocks.quote).toHaveBeenCalledTimes(1);
  await expect
    .element(page.getByText('¥ 3,000.00', { exact: true }))
    .not.toBeInTheDocument();
  await quantity.fill('4000');
  await expect
    .element(page.getByText('¥ 4,000.00', { exact: true }))
    .toBeVisible();
});

it('recalculates a different specification without resetting the form or choosing foil again', async () => {
  render(false, {
    ...options,
    products: [
      ...options.products,
      {
        ...options.products[0]!,
        id: 'medium',
        name: '中号专版',
        specification: '中号封80×115',
      },
    ],
  });
  await expect
    .element(page.getByText('¥ 492.75', { exact: true }))
    .toBeVisible();
  await page.getByRole('combobox', { name: '规格', exact: true }).click();
  await page.getByRole('option', { name: '中号封80×115', exact: true }).click();
  await expect
    .element(page.getByText('¥ 492.75', { exact: true }))
    .toBeVisible();
  expect(mocks.quote).toHaveBeenLastCalledWith(
    expect.objectContaining({
      productId: 'medium',
      specification: '中号封80×115',
      paperType: '160g珠光艳闪',
      frontFoilColors: ['哑金'],
    }),
  );
});

it('preserves an explicitly chosen product when its paper and size are shared by another product', async () => {
  render(false, {
    ...options,
    products: [
      ...options.products,
      { ...options.products[0]!, id: 'duplicate', name: '同规格另一产品' },
    ],
  });
  await page.getByRole('combobox', { name: '产品', exact: true }).click();
  await page
    .getByRole('option', { name: '同规格另一产品', exact: true })
    .click();
  for (const [field, choice] of [
    ['规格', '大号封90×165'],
    ['纸张', '160g珠光艳闪'],
  ]) {
    await page.getByRole('combobox', { name: field!, exact: true }).click();
    await page.getByRole('option', { name: choice!, exact: true }).click();
  }
  await expect
    .element(page.getByText('¥ 492.75', { exact: true }))
    .toBeVisible();
  expect(mocks.quote).toHaveBeenLastCalledWith(
    expect.objectContaining({ productId: 'duplicate' }),
  );
});

it('explains the missing color and displays manual pricing reasons without retaining an old amount', async () => {
  render();
  await expect
    .element(page.getByText('¥ 492.75', { exact: true }))
    .toBeVisible();
  await page
    .getByRole('group', { name: '正面烫金颜色（最多 3 色）' })
    .getByRole('button', { name: '哑金' })
    .click();
  await expect
    .element(page.getByText('请选择烫金颜色，单面单色请选择一种正面颜色', { exact: true }))
    .toBeVisible();
  await expect
    .element(page.getByText('¥ 492.75', { exact: true }))
    .not.toBeInTheDocument();
  mocks.quote.mockResolvedValue({
    ...success,
    quote: {
      ...success.quote,
      suggestedAmount: null,
      baseAmount: null,
      markupAmount: null,
      needsPricing: true,
      pricingReasons: [
        '所选纸张暂无专版烫金价格，请选择其他纸张或联系管理员核价',
      ],
    },
  });
  await selectFrontGold();
  await expect
    .element(
      page.getByText(
        '所选纸张暂无专版烫金价格，请选择其他纸张或联系管理员核价',
      ),
    )
    .toBeVisible();
  await expect
    .element(page.getByText('¥ 492.75', { exact: true }))
    .not.toBeInTheDocument();
});

it('manual calculation cancels the scheduled automatic request and repeated presets still recalculate', async () => {
  render();
  await chooseProduct();
  await page.getByRole('button', { name: '计算报价', exact: true }).click();
  await expect
    .element(page.getByText('¥ 492.75', { exact: true }))
    .toBeVisible();
  await new Promise((resolve) => setTimeout(resolve, 650));
  expect(mocks.quote).toHaveBeenCalledTimes(1);
  await page.getByRole('button', { name: '1,000', exact: true }).click();
  await expect
    .element(page.getByText('¥ 492.75', { exact: true }))
    .toBeVisible();
  expect(mocks.quote).toHaveBeenCalledTimes(2);
});

it('ignores a late automatic response after newer input has already been priced', async () => {
  const responses: Array<(value: WorkbenchQuoteResult) => void> = [];
  mocks.quote.mockImplementation(
    () =>
      new Promise<WorkbenchQuoteResult>((resolve) => responses.push(resolve)),
  );
  render();
  await chooseProduct();
  await vi.waitFor(() => expect(responses).toHaveLength(1));
  await page.getByRole('spinbutton', { name: '数量（个）' }).fill('2000');
  await vi.waitFor(() => expect(responses).toHaveLength(2));
  responses[1]!(success);
  await expect
    .element(page.getByText('¥ 492.75', { exact: true }))
    .toBeVisible();
  responses[0]!({ status: 'error', message: '旧条件错误' });
  await new Promise((resolve) => setTimeout(resolve, 50));
  await expect
    .element(page.getByText('¥ 492.75', { exact: true }))
    .toBeVisible();
  await expect.element(page.getByText('旧条件错误')).not.toBeInTheDocument();
});

it('announces automatic quote progress, invalidation and the latest amount without moving focus', async () => {
  const responses: Array<(value: WorkbenchQuoteResult) => void> = [];
  mocks.quote.mockImplementation(
    () => new Promise<WorkbenchQuoteResult>((resolve) => responses.push(resolve)),
  );
  render();
  const quote = page.getByRole('region', { name: '报价计算', exact: true });
  const status = quote.getByRole('status');
  await vi.waitFor(() => expect(responses).toHaveLength(1));
  await expect.element(status).toHaveAttribute('aria-live', 'polite');
  await expect.element(status).toHaveTextContent('正在按当前价格计算');
  expect(status.element().closest('[aria-busy="true"]')).toBeNull();
  responses[0]!(success);
  await expect.element(status).toHaveTextContent('加工费参考报价 ¥ 492.75');

  const quantity = page.getByRole('spinbutton', { name: '数量（个）' });
  await quantity.fill('2000');
  await expect.element(status).toHaveTextContent('条件已变更，待重新核价');
  await expect.element(page.getByText('¥ 492.75', { exact: true })).not.toBeInTheDocument();
  await expect.element(quantity).toHaveFocus();
  await vi.waitFor(() => expect(responses).toHaveLength(2));
  await expect.element(status).toHaveTextContent('正在按当前价格计算');
  responses[1]!({
    ...success,
    quote: { ...success.quote, suggestedAmount: '985.50' },
  });
  await expect.element(status).toHaveTextContent('加工费参考报价 ¥ 985.50');
  await expect.element(quantity).toHaveFocus();

  await quantity.fill('');
  await expect.element(status).toHaveTextContent('条件已变更，待重新核价');
  await expect.element(status).toHaveTextContent('数量须为 1–9,999,999 的整数');
  await expect.element(page.getByText('¥ 985.50', { exact: true })).not.toBeInTheDocument();
  await new Promise((resolve) => setTimeout(resolve, 650));
  expect(responses).toHaveLength(2);
  await expect.element(quantity).toHaveFocus();
});

it('announces pricing failures and manual pricing once in the quote region', async () => {
  render();
  await expect.element(page.getByText('¥ 492.75', { exact: true })).toBeVisible();
  const quote = page.getByRole('region', { name: '报价计算', exact: true });
  mocks.quote.mockRejectedValueOnce(new Error('offline'));
  await page.getByRole('button', { name: '计算报价', exact: true }).click();
  await expect.element(quote.getByRole('alert')).toHaveTextContent('计算失败，请检查网络后重新计算');
  expect(quote.element().querySelectorAll('[aria-live]')).toHaveLength(1);

  mocks.quote.mockResolvedValueOnce({
    ...success,
    quote: {
      ...success.quote,
      suggestedAmount: null,
      baseAmount: null,
      markupAmount: null,
      needsPricing: true,
      pricingReasons: ['专版烫金三色及以上需要管理员核价'],
    },
  });
  await page.getByRole('button', { name: '计算报价', exact: true }).click();
  await expect.element(quote.getByRole('status')).toHaveTextContent('部分费用待核价');
  await expect.element(quote.getByRole('status')).toHaveTextContent('专版烫金三色及以上需要管理员核价');
  expect(quote.element().querySelectorAll('[aria-live]')).toHaveLength(1);
});

it('supports keyboard selection, escape focus return and sales disclosure copy', async () => {
  render(false, {
    ...options,
    products: [
      ...options.products,
      {
        ...options.products[0]!,
        id: 'medium',
        name: '中号专版',
        specification: '中号封80×115',
      },
    ],
  });
  const product = page.getByRole('combobox', { name: '产品', exact: true });
  (product.element() as HTMLElement).focus();
  await userEvent.keyboard('{Enter}');
  await expect.element(page.getByRole('option', { name: '中号专版', exact: true })).toBeVisible();
  await userEvent.keyboard('{ArrowDown}{Enter}');
  await expect.element(product).toHaveTextContent('中号专版');
  await expect.element(product).toHaveFocus();
  await expect
    .element(page.getByRole('combobox', { name: '规格', exact: true }))
    .toHaveTextContent('中号封80×115');
  await userEvent.keyboard('{Enter}');
  await expect.element(page.getByRole('option', { name: '中号专版', exact: true })).toBeVisible();
  await userEvent.keyboard('{Escape}');
  await expect.element(product).toHaveFocus();
  await expect.element(product).toHaveAttribute('aria-expanded', 'false');

  const sales = page.getByRole('button', { name: '话术应对', exact: true });
  (sales.element() as HTMLElement).focus();
  await userEvent.keyboard('{Enter}');
  const scenario = SALES_SCENARIOS[0];
  const summary = page.getByText(scenario.title, { exact: true }).element().closest('summary')!;
  summary.focus();
  await userEvent.keyboard('{Enter}');
  await expect.element(page.getByText(scenario.reply, { exact: true })).toBeVisible();
  const write = vi.spyOn(navigator.clipboard, 'writeText').mockResolvedValue();
  try {
    const copy = page.getByRole('button', { name: `复制话术：${scenario.title}` });
    (copy.element() as HTMLElement).focus();
    await userEvent.keyboard('{Enter}');
    expect(write).toHaveBeenCalledWith(scenario.reply);
    summary.focus();
    await userEvent.keyboard(' ');
    await expect.element(page.getByText(scenario.reply, { exact: true })).not.toBeVisible();
    expect(document.activeElement).toBe(summary);
  } finally {
    write.mockRestore();
  }
});

it('accepts both quantity endpoints and a 100 percent markup', async () => {
  render();
  const quantity = page.getByRole('spinbutton', { name: '数量（个）' });
  const markup = page.getByRole('spinbutton', { name: '加工费加价比例（%）' });
  await markup.fill('100');
  for (const value of [1, 9_999_999]) {
    await quantity.fill(String(value));
    await page.getByRole('button', { name: '计算报价', exact: true }).click();
    await expect.element(page.getByText('¥ 492.75', { exact: true })).toBeVisible();
    expect(mocks.quote).toHaveBeenLastCalledWith(
      expect.objectContaining({ quantity: value, markup: 100 }),
    );
  }
});

it('explains an unavailable linked paper and resumes quoting after choosing an available product', async () => {
  render(false, {
    ...options,
    products: [
      ...options.products,
      {
        ...options.products[0]!,
        id: 'unavailable',
        name: '关联缺货纸张产品',
        paperMaterialId: 'unavailable-paper',
      },
      {
        ...options.products[0]!,
        id: 'weightless',
        name: '关联未录克重纸张产品',
        paperType: null,
        weight: null,
        paperMaterialId: 'weightless-paper',
      },
    ],
    papers: [
      ...options.papers,
      { ...options.papers[0]!, id: 'unavailable-paper', outOfStock: true },
      {
        ...options.papers[0]!,
        id: 'weightless-paper',
        name: '未录克重纸张',
        weight: null,
        specification: null,
      },
    ],
  });
  await expect.element(page.getByText('¥ 492.75', { exact: true })).toBeVisible();
  const product = page.getByRole('combobox', { name: '产品', exact: true });
  mocks.quote.mockClear();
  await product.click();
  await page.getByRole('option', { name: '关联缺货纸张产品', exact: true }).click();
  await expect.element(page.getByRole('combobox', { name: '纸张', exact: true })).toBeDisabled();
  await expect.element(page.getByText('所选产品的纸张已缺货或停用，请选择其他产品或联系管理员补充资料')).toBeVisible();
  await expect.element(page.getByText('¥ 492.75', { exact: true })).not.toBeInTheDocument();
  await new Promise((resolve) => setTimeout(resolve, 650));
  expect(mocks.quote).not.toHaveBeenCalled();
  await product.click();
  await page.getByRole('option', { name: '大号专版烫金', exact: true }).click();
  await expect.element(page.getByText('¥ 492.75', { exact: true })).toBeVisible();
  expect(mocks.quote).toHaveBeenLastCalledWith(
    expect.objectContaining({ productId: 'custom', paperType: '160g珠光艳闪' }),
  );
  await product.click();
  await page.getByRole('option', { name: '关联未录克重纸张产品', exact: true }).click();
  await expect.element(page.getByRole('combobox', { name: '纸张', exact: true })).toBeDisabled();
  await expect.element(page.getByText('所选产品的纸张已缺货或停用，请选择其他产品或联系管理员补充资料')).not.toBeInTheDocument();
});

it('shows a paper weight once when its specification already contains that weight', async () => {
  render();
  await page.getByRole('button', { name: '纸张与规格', exact: true }).click();
  const materials = page.getByRole('region', { name: '纸张与规格', exact: true });
  await expect.element(materials.getByText('160g', { exact: true })).toBeVisible();
  await expect.element(materials.getByText('160g · 160g', { exact: true })).not.toBeInTheDocument();
});
