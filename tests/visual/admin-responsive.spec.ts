import { expect, test, type Page, type TestInfo } from '@playwright/test';
import { E2E_PASSWORD, E2E_USERS, login } from '../e2e/_helpers';
import {
  cleanupWorkerUiFixture,
  seedWorkerUiFixture,
  type WorkerUiFixture,
} from './worker-ui-fixture';
import {
  attachCandidateScreenshot,
  expectA11yGate,
  expectViewportGate,
} from './ui-gates';

let fixture: WorkerUiFixture;

test.beforeAll(async ({}, testInfo) => {
  fixture = await seedWorkerUiFixture(`admin-${testInfo.project.name}`);
});

test.afterAll(async () => {
  await cleanupWorkerUiFixture(fixture);
});

test.describe('administrator workspace', () => {
  test.describe.configure({ timeout: 180_000 });

  test.beforeEach(async ({ page }) => {
    await login(page, {
      from: '/owner',
      username: E2E_USERS.owner!.username,
      password: E2E_PASSWORD,
    });
  });

  test('critical routes pass responsive and accessibility gates', async ({ page }, testInfo) => {
    await checkRoutes(page, testInfo, ownerRoutes(fixture), 'light');
  });

  test('critical routes pass the same gates with dark tokens', async ({ page }, testInfo) => {
    await checkRoutes(page, testInfo, ownerRoutes(fixture), 'dark');
  });
});

test.describe('deterministic external sales price tier fixture', () => {
  test.describe.configure({ timeout: 90_000 });

  test.beforeEach(async ({ page }) => {
    await login(page, {
      from: '/owner/prices/external-sales/visual-fixture?state=current',
      username: E2E_USERS.owner!.username,
      password: E2E_PASSWORD,
    });
  });

  test('seven-tier current and draft states pass responsive and accessibility gates', async ({
    page,
  }, testInfo) => {
    await checkRoutes(page, testInfo, priceTierFixtureRoutes(), 'light');
  });

  test('seven-tier current and draft states pass the same gates with dark tokens', async ({
    page,
  }, testInfo) => {
    await checkRoutes(page, testInfo, priceTierFixtureRoutes(), 'dark');
  });
});

test.describe('sales workspace', () => {
  test.describe.configure({ timeout: 90_000 });

  test.beforeEach(async ({ page }) => {
    await login(page, {
      from: '/orders',
      username: E2E_USERS.sales!.username,
      password: E2E_PASSWORD,
    });
  });

  test('sales routes pass responsive and accessibility gates', async ({ page }, testInfo) => {
    await checkRoutes(page, testInfo, salesRoutes(fixture), 'light');
  });

  test('sales routes pass the same gates with dark tokens', async ({ page }, testInfo) => {
    await checkRoutes(page, testInfo, salesRoutes(fixture), 'dark');
  });
});

type AdminRoute = {
  name: string;
  path: string;
  readyHeading: string | RegExp;
  prepareGateState?: (page: Page) => Promise<void>;
};

async function checkRoutes(
  page: Page,
  testInfo: TestInfo,
  routes: readonly AdminRoute[],
  theme: 'light' | 'dark',
) {
  await page.emulateMedia({
    colorScheme: theme,
    reducedMotion: 'reduce',
  });
  await page.addInitScript((requestedTheme) => {
    localStorage.setItem('erp-theme', requestedTheme);
    document.documentElement.classList.toggle('dark', requestedTheme === 'dark');
    document.documentElement.dataset.theme = requestedTheme;
    document.documentElement.style.colorScheme = requestedTheme;
  }, theme);
  for (const route of routes) {
    await test.step(route.name, async () => {
      await page.goto(route.path);
      await expect(
        page.getByRole('heading', { name: route.readyHeading, exact: true }).first(),
      ).toBeVisible();
      await page.evaluate((requestedTheme) => {
        localStorage.setItem('erp-theme', requestedTheme);
        document.documentElement.classList.toggle('dark', requestedTheme === 'dark');
        document.documentElement.dataset.theme = requestedTheme;
        document.documentElement.style.colorScheme = requestedTheme;
      }, theme);
      await expect(page.locator('html')).toHaveAttribute('data-theme', theme);
      if (theme === 'dark') {
        await expect(page.locator('html')).toHaveClass(/\bdark\b/);
      } else {
        await expect(page.locator('html')).not.toHaveClass(/\bdark\b/);
      }
      await route.prepareGateState?.(page);
      await page.evaluate(async () => {
        await Promise.all(
          document
            .getAnimations()
            .map((animation) => animation.finished.catch(() => undefined)),
        );
      });
      await expectViewportGate(page, testInfo);
      await expectA11yGate(page);
      await attachCandidateScreenshot(
        page,
        testInfo,
        'admin',
        `${route.name}-${theme}`,
      );
    });
  }
}

// Dashboard 的三张图走 next/dynamic + IntersectionObserver 延迟挂载
// （components/business/dashboard/DeferredDashboardCharts.tsx）。checkRoutes
// 只 goto + 等 heading，全程不滚动，于是 375/393/768 三个视口下门禁一直在
// 对占位骨架做断言，图表本身（含 recharts 生成的 SVG）从未被 axe 或裁切
// 检查看过。滚到容器可见并等 surface 出现，把这块真正纳入门禁。
async function prepareDashboardChartsState(page: Page): Promise<void> {
  // .first()：流式渲染期间 Suspense 的占位副本和已解析内容会同时命中这个
  // data-slot，不加会触发 strict mode violation（移动视口尤其容易撞上）。
  const deferred = page
    .locator('[data-slot="dashboard-charts-deferred"]')
    .first();
  if ((await deferred.count()) === 0) return;
  await deferred.scrollIntoViewIfNeeded();
  // 图表有数据时会渲染 recharts surface；数据为空时组件走「暂无数据」
  // 分支，占位块会消失——两种情况都算就绪，不要在空库上把门禁卡死。
  await page
    .locator('.recharts-surface, [data-slot="dashboard-chart-trend"]')
    .first()
    .waitFor({ state: 'visible', timeout: 15_000 })
    .catch(() => undefined);
  await page.evaluate(() => window.scrollTo(0, 0));
}

function ownerRoutes(data: WorkerUiFixture): readonly AdminRoute[] {
  return [
    {
      name: 'dashboard',
      path: '/owner',
      readyHeading: 'Dashboard',
      prepareGateState: prepareDashboardChartsState,
    },
    { name: 'orders', path: '/orders', readyHeading: '工单' },
    {
      name: 'orders-filtered',
      path:
        '/orders?status=SUBMITTED,IN_PRODUCTION&customerRef=' +
        encodeURIComponent('超长客户名称用于验证筛选标签在小屏幕上能够自然换行而不会裁切') +
        '&receiverAddress=' +
        encodeURIComponent('广东省深圳市南山区科技园长地址压力测试大厦A座12345678901234567890') +
        '&foilColor=' +
        encodeURIComponent('哑金,透明金,客户特殊调色长名称'),
      readyHeading: '工单',
      prepareGateState: prepareOrderFiltersState,
    },
    {
      name: 'order-detail',
      path: `/orders/${data.orderId}`,
      readyHeading: /^GD-260719-WORKER-RESPONSIVE-LONG-IDENTIFIER-0123456789/,
      prepareGateState: (page) => prepareOrderDetailDesignPreview(page, data),
    },
    {
      name: 'order-new',
      path: '/orders/new',
      readyHeading: '新建工单',
      prepareGateState: prepareOrderCreationComponentState,
    },
    {
      name: 'scheduling',
      path: '/foreman/scheduling',
      readyHeading: '待排产',
      prepareGateState: (page) =>
        preparePendingSchedulingListState(page, data),
    },
    {
      name: 'attendance',
      path: '/foreman/attendance',
      readyHeading: '员工考勤',
      prepareGateState: prepareAttendanceState,
    },
    {
      name: 'scheduling-detail',
      path: `/foreman/scheduling/${data.schedulingOrderId}`,
      readyHeading: `排产 ${data.schedulingOrderNo}`,
      prepareGateState: prepareBulkSchedulingState,
    },
    { name: 'inventory', path: '/foreman/materials', readyHeading: '物料库存' },
    { name: 'outsource', path: '/foreman/outsource', readyHeading: '外协单' },
    // 以下四条此前从未被任何门禁访问过。UI 审查在它们上面实测到 axe
    // label / select-name 违规（筛选栏 <label> 没有 htmlFor），修完补进
    // 路由表，避免再次退化。
    { name: 'salary-hourly', path: '/owner/salary/hourly', readyHeading: '时薪工月结' },
    { name: 'salary-daily', path: '/owner/salary/daily', readyHeading: '计件工资' },
    { name: 'cdr', path: '/foreman/cdr', readyHeading: 'CDR 汇总下载' },
    { name: 'cs-period-new', path: '/owner/salary/cs/new', readyHeading: '新建客服周期' },
    { name: 'accounts', path: '/owner/accounts', readyHeading: '账号管理' },
    { name: 'materials', path: '/owner/materials', readyHeading: '物料字典' },
    { name: 'products', path: '/owner/products', readyHeading: '产品字典' },
    {
      name: 'external-sales-processing-price-book',
      path: '/owner/prices/external-sales/items?purpose=processing',
      readyHeading: '外部销售收费',
      prepareGateState: preparePriceBookWorkspaceState,
    },
    {
      name: 'external-sales-logistics-price-book',
      path: '/owner/prices/external-sales/items?purpose=logistics',
      readyHeading: '外部销售收费',
      prepareGateState: preparePriceBookWorkspaceState,
    },
    {
      name: 'external-sales-price-book-versions',
      path: '/owner/prices/external-sales/versions',
      readyHeading: '发布中心',
      prepareGateState: preparePriceBookBusinessState,
    },
    { name: 'bills', path: '/owner/bills', readyHeading: '销售应收账单' },
    {
      name: 'order-changes',
      path: '/owner/order-changes',
      readyHeading: '工单修改申请',
    },
    { name: 'salary', path: '/owner/salary', readyHeading: '薪资总览' },
    {
      name: 'piecework-rules',
      path: '/owner/salary/piecework-rules',
      readyHeading: '计件规则',
    },
    { name: 'warehouses', path: '/owner/warehouses', readyHeading: '仓库作业台' },
    { name: 'pigsty', path: '/owner/pigsty', readyHeading: 'Pigsty 运维' },
    { name: 'settings', path: '/owner/settings', readyHeading: '系统设置' },
    {
      name: 'not-found',
      path: '/orders/e2e-admin-ui-missing',
      readyHeading: '没有找到这条记录',
    },
  ];
}

function priceTierFixtureRoutes(): readonly AdminRoute[] {
  return [
    {
      name: 'external-sales-current-seven-tier-fixture',
      path: '/owner/prices/external-sales/visual-fixture?state=current',
      readyHeading: '收费工作台视觉验收',
      prepareGateState: (page) =>
        prepareDeterministicPriceWorkspaceState(page, 'current'),
    },
    {
      name: 'external-sales-draft-seven-tier-fixture',
      path: '/owner/prices/external-sales/visual-fixture?state=draft',
      readyHeading: '收费工作台视觉验收',
      prepareGateState: (page) =>
        prepareDeterministicPriceWorkspaceState(page, 'draft'),
    },
    {
      name: 'external-sales-per-piece-seven-tier-fixture',
      path: '/owner/prices/external-sales/visual-fixture?state=draft-piece',
      readyHeading: '收费工作台视觉验收',
      prepareGateState: (page) =>
        prepareDeterministicPriceWorkspaceState(page, 'draft-piece'),
    },
  ];
}

async function prepareOrderFiltersState(page: Page) {
  const filters = page.locator('section').filter({
    has: page.getByRole('heading', { name: '筛选工单', exact: true }),
  });
  const filterPanel = filters.locator('#order-list-filter-controls');
  await expect(filterPanel).not.toHaveAttribute('open', '');
  await filterPanel.locator('summary').first().click();
  await expect(filterPanel).toHaveAttribute('open', '');
  await expect(filterPanel.locator('details').first()).toHaveAttribute('open', '');
  expect(
    await filters
      .getByLabel('已启用的筛选条件')
      .getByRole('link')
      .count(),
  ).toBeGreaterThanOrEqual(5);
  const exportTrigger = filters.getByRole('button', {
    name: /导出工单/,
  });
  await expect(exportTrigger).toBeVisible();
  await exportTrigger.click();
  const exportDialog = page.getByRole('dialog', {
    name: '导出工单',
    exact: true,
  });
  await expect(exportDialog).toBeVisible();
  await expect(
    exportDialog.getByRole('button', { name: /导出筛选结果/ }),
  ).toBeVisible();
}

function salesRoutes(data: WorkerUiFixture): readonly AdminRoute[] {
  return [
    {
      name: 'sales-orders',
      path: '/orders',
      readyHeading: '工单',
      prepareGateState: prepareSalesOrderListState,
    },
    {
      name: 'sales-order-detail',
      path: `/orders/${data.orderId}`,
      readyHeading: /^GD-260719-WORKER-RESPONSIVE-LONG-IDENTIFIER-0123456789/,
      prepareGateState: prepareOrderChangeRequestState,
    },
    {
      name: 'sales-order-new',
      path: '/orders/new',
      readyHeading: '新建工单',
      prepareGateState: prepareOrderCreationComponentState,
    },
    {
      name: 'sales-processing-price-book',
      path: '/sales/quote?section=processing',
      readyHeading: '外部销售报价查询',
    },
    {
      name: 'sales-logistics-price-book',
      path: '/sales/quote?section=logistics',
      readyHeading: '外部销售报价查询',
    },
    {
      name: 'sales-bills',
      path: '/sales/bills',
      readyHeading: '我的对客应付账单',
    },
  ];
}

async function preparePriceBookBusinessState(page: Page) {
  const main = page.locator('main');
  await expect(main).not.toContainText('SHA-256');
  await expect(main).not.toContainText('价目簿代码');
  await expect(main).not.toContainText('规则代码');
  await expect(main).not.toContainText('触发条件（JSON）');
  await expect(
    main.locator(
      '[name="triggerCondition"], [name="exclusiveGroup"], [name="priority"]',
    ),
  ).toHaveCount(0);
}

async function expectPriceWorkspaceOverview(page: Page) {
  const groups = page.locator(
    'section[aria-labelledby^="external-charge-group-"]',
  );
  expect(await groups.count()).toBeGreaterThan(0);
  const firstGroup = groups.first();
  await expect(firstGroup).toBeVisible();
  expect(await firstGroup.locator('ol > li').count()).toBeGreaterThan(0);
  const productTierList = firstGroup.locator(
    'dl[aria-label$="数量价格阶梯"]',
  );
  if ((await productTierList.count()) > 0) {
    await expect(productTierList.first()).toBeVisible();
    expect(await productTierList.first().locator(':scope > div').count()).toBeGreaterThan(0);
  } else {
    await expect(firstGroup.getByText('数量范围').first()).toBeVisible();
    await expect(firstGroup.getByText('计价方式').first()).toBeVisible();
    await expect(firstGroup.getByText('当前价').first()).toBeVisible();
    await expect(firstGroup.getByText('草稿价').first()).toBeVisible();
    await expect(firstGroup.getByText('价格变化').first()).toBeVisible();
  }
}

async function expectSelectedPriceWorkspace(
  page: Page,
  hasDraft: boolean,
) {
  const selectedDetail = page.locator(
    'aside[aria-labelledby="selected-charge-heading"]',
  );
  const chargeList = page.locator('#external-charge-list');
  const returnToList = page.getByRole('link', {
    name: '返回收费项目列表',
    exact: true,
  });
  await expect(selectedDetail).toBeVisible();

  const viewport = page.viewportSize();
  if (!viewport) throw new Error('收费工作台视口信息不可用');
  const [detailBox, listBox] = await Promise.all([
    selectedDetail.boundingBox(),
    chargeList.boundingBox(),
  ]);
  if (!detailBox || !listBox) {
    throw new Error('收费工作台列表或详情布局不可见');
  }
  if (viewport.width < 1280) {
    await expect(returnToList).toBeVisible();
    expect(listBox.y).toBeLessThan(detailBox.y);
    await returnToList.click();
    await expect(page).toHaveURL(/#external-charge-list$/);
    await expect(chargeList).toBeInViewport();
    await selectedDetail.scrollIntoViewIfNeeded();
  } else {
    await expect(returnToList).toBeHidden();
    expect(detailBox.x).toBeGreaterThan(listBox.x);
  }

  if (hasDraft) {
    await expect(page.getByLabel('调价草稿状态')).toBeVisible();
    const editorSection = page.locator(
      'section[aria-label="编辑收费项目"]',
    );
    await expect(editorSection).toBeVisible();
    const editorForm = editorSection.locator('form').first();
    await expect(editorForm).toBeVisible();
    await expect(
      editorForm.getByRole('button', {
        name: /^(?:保存到调价草稿|保存全部(?:总价|单价|每张价|每万个价|每款价)（\d+ 项）)$/,
      }),
    ).toBeVisible();
    return;
  }

  await expect(page.getByLabel('价格状态')).toBeVisible();
  await expect(page.getByText('当前价格仅供查看')).toBeVisible();
  await expect(
    page.getByRole('link', { name: /^正在查看：/ }),
  ).toBeVisible();

  const createDraftPanel = page.locator('#start-price-adjustment');
  if ((await createDraftPanel.count()) > 0) {
    await expect(createDraftPanel).not.toHaveAttribute('open', '');
    await createDraftPanel.locator('summary').click();
    await expect(createDraftPanel).toHaveAttribute('open', '');
    const createDraftForm = page.getByRole('form', {
      name: /^创建(?:加工费|快递与耗材)调价草稿$/,
    });
    await expect(createDraftForm).toBeVisible();
    await expect(createDraftForm.getByLabel('调价原因（必填）')).toBeVisible();
    await expect(
      createDraftForm.getByRole('button', {
        name: '复制当前价目并开始调价',
        exact: true,
      }),
    ).toBeVisible();
  } else {
    await expect(page.getByText(/生效前不能再发起新调价/)).toBeVisible();
  }
}

async function preparePriceBookWorkspaceState(page: Page) {
  await preparePriceBookBusinessState(page);
  await expectPriceWorkspaceOverview(page);

  const editableItems = page.getByRole('link', {
    name: /^编辑收费项目：/,
  });
  const hasDraft = (await editableItems.count()) > 0;
  const firstItem = hasDraft
    ? editableItems.first()
    : page.getByRole('link', { name: /^查看详情：/ }).first();

  await expect(firstItem).toBeVisible();
  await firstItem.click();
  await expect(page).toHaveURL(/#selected-charge-detail$/);
  await expectSelectedPriceWorkspace(page, hasDraft);

  await preparePriceBookBusinessState(page);
}

async function prepareDeterministicPriceWorkspaceState(
  page: Page,
  state: 'current' | 'draft' | 'draft-piece',
) {
  await expectPriceWorkspaceOverview(page);
  await expectSelectedPriceWorkspace(page, state !== 'current');
  const expectedQuantities = [
    '1,000 个',
    '2,000 个',
    '3,000 个',
    '4,000 个',
    '5,000 个',
    '10,000 个',
    '20,000 个',
  ];

  await expect(page.getByText('7 个数量档', { exact: true }).last()).toBeVisible();
  await expect(
    page.getByText(/157克超长双铜纸彩印加局部烫金/).last(),
  ).toBeVisible();
  await expect(
    page.getByText(/157克双铜纸·客户指定超长纸张名称/).last(),
  ).toBeVisible();
  await expect(
    page.getByText(/非标定制 123\.45 × 678\.90 mm/).last(),
  ).toBeVisible();

  const tierPanel =
    state === 'current'
      ? page.locator('section[aria-label="当前产品价格阶梯"]')
      : page.locator('section[aria-label="编辑收费项目"] form');
  await expect(tierPanel).toBeVisible();
  await expect(tierPanel.locator('ol > li')).toHaveCount(7);
  const compactTierLists = page.locator('dl[aria-label$="数量价格阶梯"]');
  await expect(compactTierLists).toHaveCount(2);
  await expect(compactTierLists.first().locator(':scope > div')).toHaveCount(7);
  await expect(compactTierLists.last().locator(':scope > div')).toHaveCount(7);

  const renderedQuantities = await tierPanel
    .locator('ol > li')
    .evaluateAll((rows) =>
      rows.map(
        (row) =>
          row.querySelector<HTMLElement>('.tabular-nums')?.textContent?.trim() ?? '',
      ),
    );
  expect(renderedQuantities).toEqual(expectedQuantities);

  if (state === 'draft') {
    await expect(tierPanel.locator('input[inputmode="decimal"]')).toHaveCount(7);
    await expect(
      tierPanel.getByLabel('1,000 个草稿总价（元）', { exact: true }),
    ).toHaveValue('310');
    await expect(
      tierPanel.getByLabel('20,000 个草稿总价（元）', {
        exact: true,
      }),
    ).toHaveValue('2480');
    await expect(
      tierPanel.getByRole('button', {
        name: '保存全部总价（7 项）',
        exact: true,
      }),
    ).toBeVisible();
  } else if (state === 'draft-piece') {
    await expect(tierPanel.locator('input[inputmode="decimal"]')).toHaveCount(7);
    await expect(
      tierPanel.getByLabel('1,000 个草稿单价（元/个）', { exact: true }),
    ).toHaveValue('0.54');
    await expect(
      tierPanel.getByLabel('20,000 个草稿单价（元/个）', {
        exact: true,
      }),
    ).toHaveValue('0.18');
    await expect(tierPanel.getByText('¥0.52 / 个', { exact: true })).toBeVisible();
    await expect(tierPanel.getByText('每个成品', { exact: true }).first()).toBeVisible();
    await expect(tierPanel.getByText('折合单价', { exact: true })).toHaveCount(0);
    await expect(
      tierPanel.getByRole('button', {
        name: '保存全部单价（7 项）',
        exact: true,
      }),
    ).toBeVisible();
  } else {
    await expect(tierPanel.locator('input')).toHaveCount(0);
    await expect(
      tierPanel.getByText('当前生效价格仅供查看；发起调价后才能修改。'),
    ).toBeVisible();
  }

  await expect(page.locator('body')).not.toContainText('visual-tier-');
  await expect(page.locator('body')).not.toContainText(
    '2026-08-11T20:00:00.000Z',
  );
  await preparePriceBookBusinessState(page);
}

async function prepareSalesOrderListState(page: Page) {
  await expect(
    page.getByRole('button', { name: /导出工单/ }),
  ).toHaveCount(0);
}

async function prepareOrderChangeRequestState(page: Page) {
  const formSection = page
    .locator('section')
    .filter({ has: page.getByRole('heading', { name: '申请修改工单', exact: true }) });
  await expect(formSection).toBeVisible();
  const styleCheckboxes = formSection.getByRole('checkbox');
  expect(await styleCheckboxes.count()).toBeGreaterThanOrEqual(3);
  await styleCheckboxes.first().check();
  await styleCheckboxes.last().check();
  await expect(
    formSection.getByLabel('新款式名称', { exact: true }),
  ).toBeVisible();
}

async function prepareAttendanceState(page: Page) {
  const dayCards = page.locator('main details');
  expect(await dayCards.count()).toBeGreaterThan(0);
  const firstDay = dayCards.first();
  await firstDay.locator('summary').click();
  await expect(firstDay).toHaveAttribute('open', '');
  const daySelectors = firstDay.locator('select');
  expect(await daySelectors.count()).toBeGreaterThanOrEqual(2);
  await expect(daySelectors.first()).toBeVisible();
}

async function prepareOrderDetailDesignPreview(
  page: Page,
  data: WorkerUiFixture,
) {
  const itemHeading = page.getByRole('heading', {
    level: 3,
    name: /#1 · 超长款式名称红包烫金高级定制版/,
  });
  await expect(itemHeading).toBeVisible();
  const itemCard = itemHeading.locator('xpath=ancestor::li[1]');
  const definition = (label: string) =>
    itemCard
      .locator('dt')
      .filter({ hasText: new RegExp(`^${label}$`) })
      .locator('..')
      .locator('dd');

  await expect(itemCard.getByText('1,234,567', { exact: true })).toBeVisible();
  await expect(itemCard.getByText('¥ 0.1234', { exact: true })).toBeVisible();
  await expect(itemCard.getByText('¥ 152,345.57', { exact: true })).toBeVisible();
  await expect(definition('工艺')).toHaveText(data.craftName);
  await expect(definition('印刷面')).toHaveText('双面');
  await expect(definition('印刷色数')).toHaveText('双色');
  await expect(definition('生产安排')).toContainText(data.craftName);
  await expect(itemCard).not.toContainText(data.craftId);

  const fileName =
    '生产设计图超长文件名ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789最终确认版.png';
  const previewLink = page.getByRole('link', {
    name: `查看原图：${fileName}`,
    exact: true,
  });
  const previewImage = page.getByRole('img', {
    name: fileName,
    exact: true,
  });

  await expect(previewLink).toBeVisible();
  await expect(previewImage).toBeVisible();
  await expect(previewImage).toHaveCSS('object-fit', 'contain');

  const box = await previewImage.boundingBox();
  expect(box?.height).toBeGreaterThanOrEqual(280);
}

async function prepareBulkSchedulingState(page: Page) {
  await page
    .getByRole('checkbox', { name: '选择全部内部工艺', exact: true })
    .check();
  await expect(page.getByText('已选 2 项', { exact: false })).toBeVisible();

  const bulkWorker = page.getByLabel('批量派给同一位师傅', {
    exact: true,
  });
  const workerOption = bulkWorker.locator('option').filter({
    hasText: E2E_USERS.workerHandPress!.displayName,
  });
  const workerId = await workerOption.getAttribute('value');
  expect(workerId).toBeTruthy();
  await bulkWorker.selectOption(workerId!);
  await page.getByRole('button', { name: '应用到已选', exact: true }).click();

  await expect(
    page.getByRole('combobox', {
      name: /为 #1 批量派工款式一 .* 选择师傅/,
    }),
  ).toHaveValue(workerId!);
  await expect(
    page.getByRole('combobox', {
      name: /为 #2 批量派工款式二 .* 选择师傅/,
    }),
  ).toHaveValue(workerId!);
}

async function preparePendingSchedulingListState(
  page: Page,
  data: WorkerUiFixture,
) {
  const workerSelect = page.getByLabel('接单师傅', { exact: true });
  const workerOption = workerSelect
    .locator('option')
    .filter({ hasText: E2E_USERS.workerHandPress!.displayName });
  const workerId = await workerOption.getAttribute('value');
  expect(workerId).toBeTruthy();
  await workerSelect.selectOption(workerId!);
  await page
    .getByRole('checkbox', {
      name: `选择工单 ${data.schedulingOrderNo}`,
      exact: true,
    })
    .check();
  await page
    .getByRole('checkbox', {
      name: `选择工单 ${data.schedulingOrderTwoNo}`,
      exact: true,
    })
    .check();
  await expect(page.getByText('已选 2 张', { exact: false })).toBeVisible();
  await expect(workerSelect).not.toHaveValue('');
  await expect(
    page.getByRole('button', {
      name: '确认分配所选工艺',
      exact: true,
    }),
  ).toBeEnabled();
}

async function prepareOrderCreationComponentState(page: Page) {
  await page
    .getByRole('button', {
      name: '非标定制（自定义尺寸）',
      exact: true,
    })
    .click();
  await page
    .getByLabel('自定义尺寸 / 规格', { exact: true })
    .fill('超长非标尺寸 123.45 × 678.90 mm / 横向折叠');

  await page
    .getByRole('button', { name: '其他纸张（自定义）', exact: true })
    .click();
  await page
    .getByLabel('自定义纸张', { exact: true })
    .fill('客户指定超长纸张名称ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789');

  await page.getByRole('button', { name: '哑金', exact: true }).click();
  await page.getByRole('button', { name: '红金', exact: true }).click();
  await page
    .getByRole('button', { name: '添加其他色', exact: true })
    .click();
  await page
    .getByLabel('自定义烫金色 / 色号', { exact: true })
    .fill('潘通 871C');
  await page
    .getByRole('button', { name: '添加颜色', exact: true })
    .click();

  await page
    .getByRole('button', { name: '增加收货地址', exact: true })
    .click();
  await page
    .locator(
      'textarea[name="additionalShipments.0.receiverAddress"]',
    )
    .fill('额外收货地址ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789');
  await page
    .locator(
      'input[name="additionalShipments.0.itemQuantities.0"]',
    )
    .fill('100');

  await page.getByLabel('款式 1 选择设计图', { exact: true }).setInputFiles({
    name: '超长设计图文件名ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789.png',
    mimeType: 'image/png',
    buffer: Buffer.from(
      'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=',
      'base64',
    ),
  });

  await expect(
    page.getByRole('button', {
      name: '非标定制（自定义尺寸）',
      exact: true,
      pressed: true,
    }),
  ).toBeVisible();
  await expect(
    page.getByRole('button', {
      name: '其他纸张（自定义）',
      exact: true,
      pressed: true,
    }),
  ).toBeVisible();
  await expect(page.getByText('已选 3 色：哑金、红金、潘通 871C')).toBeVisible();
  await expect(
    page.getByRole('heading', { name: '额外地址 1', exact: true }),
  ).toBeVisible();
  await expect(
    page.getByAltText(
      '待上传设计图：超长设计图文件名ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789.png',
    ),
  ).toBeVisible();
}
