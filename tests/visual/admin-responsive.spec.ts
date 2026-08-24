import { expect, test, type Page, type TestInfo } from '@playwright/test';
import {
  E2E_PASSWORD,
  E2E_USERS,
  login,
  openFirstOrderItemEditor,
} from '../e2e/_helpers';
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
  // Each test traverses the complete owner route matrix. Four viewport
  // projects may share one Turbopack development server, so the budget must
  // include cold RSC compilation without weakening any per-route assertion.
  test.describe.configure({ timeout: 360_000 });

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

  test('mobile pricing filters preserve focus, height, and single-chip removal', async ({
    page,
  }, testInfo) => {
    test.skip(testInfo.project.name !== 'admin-393x852');
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await page.goto(
      '/owner/prices/external-sales/visual-fixture?state=draft&category=print&kind=ADD_ON&status=ACTIVE&changed=1',
    );
    await expect(
      page.getByRole('heading', {
        name: '收费工作台视觉验收',
        exact: true,
      }),
    ).toBeVisible();

    const trigger = page.getByRole('button', {
      name: '打开更多筛选，已启用 4 项',
      exact: true,
    });
    await trigger.click();
    const dialog = page.getByRole('dialog', {
      name: '更多筛选',
      exact: true,
    });
    await expect(dialog).toBeVisible();
    await expect(
      dialog.locator('#mobile-external-charge-category'),
    ).toBeFocused();
    const dialogBox = await dialog.boundingBox();
    expect(dialogBox).not.toBeNull();
    expect(dialogBox!.height).toBeLessThanOrEqual(852 * 0.8 + 1);
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
      'pricing-filter-sheet-light',
    );

    await page.keyboard.press('Escape');
    await expect(dialog).toBeHidden();
    await expect(trigger).toBeFocused();

    const categoryChip = page.getByRole('link', {
      name: '清除筛选：类目：彩印基础加工费',
      exact: true,
    });
    await categoryChip.click();
    await expect(page).toHaveURL((url) => {
      return (
        !url.searchParams.has('category') &&
        url.searchParams.get('kind') === 'ADD_ON' &&
        url.searchParams.get('status') === 'ACTIVE' &&
        url.searchParams.get('changed') === '1'
      );
    });
    await expect(categoryChip).toHaveCount(0);
    await expect(
      page.getByRole('link', {
        name: '清除筛选：类型：附加费',
        exact: true,
      }),
    ).toBeVisible();
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
      readyHeading: '找不到这个页面，或你没有访问权限',
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
  const mobile = (page.viewportSize()?.width ?? 1280) < 640;
  if (mobile) {
    const filterTrigger = filters.getByRole('button', {
      name: /打开筛选条件/,
    });
    await expect(filterTrigger).toBeVisible();
    await filterTrigger.click();
    const filterDialog = page.getByRole('dialog', {
      name: '筛选工单',
      exact: true,
    });
    await expect(filterDialog).toBeVisible();
    await expect(filterDialog.locator('details').first()).toHaveAttribute(
      'open',
      '',
    );
    const dialogBox = await filterDialog.boundingBox();
    const viewportHeight = page.viewportSize()?.height ?? 0;
    expect(dialogBox).not.toBeNull();
    expect(dialogBox!.height).toBeLessThanOrEqual(viewportHeight * 0.8 + 1);
    await page.keyboard.press('Escape');
    await expect(filterDialog).toBeHidden();
    await expect(filterTrigger).toBeFocused();
  } else {
    const filterPanel = filters.locator('#order-list-filter-controls');
    await expect(filterPanel).not.toHaveAttribute('open', '');
    await filterPanel.locator('summary').first().click();
    await expect(filterPanel).toHaveAttribute('open', '');
    await expect(filterPanel.locator('details').first()).toHaveAttribute(
      'open',
      '',
    );
  }
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
  // 价格工作台由 Suspense 流式渲染。并发跑多个视口时，Turbopack
  // 可能仍在展示骨架；直接读取 count() 不会像 Playwright 的 web-first
  // 断言一样重试，会把尚未挂载误判成数据为空。
  await expect(groups.first()).toBeAttached({ timeout: 30_000 });
  const firstGroup = groups.first();
  const viewport = page.viewportSize();
  const selectedDetail = page.locator(
    'aside[aria-labelledby="selected-charge-heading"]',
  );
  const detailFirstOnMobile =
    Boolean(viewport && viewport.width < 1280) &&
    (await selectedDetail.count()) > 0 &&
    (await selectedDetail.isVisible());
  if (detailFirstOnMobile) {
    await expect(firstGroup).toBeHidden();
  } else {
    await expect(firstGroup).toBeVisible();
  }
  await expect(firstGroup.locator('ol > li').first()).toBeAttached({
    timeout: 30_000,
  });
  await expect(firstGroup.getByText('档数').first()).toHaveCount(1);
  await expect(firstGroup.getByText('当前价区间').first()).toHaveCount(1);
  await expect(firstGroup.getByText('调整进度').first()).toHaveCount(1);
  await expect(firstGroup.getByText('待补全').first()).toHaveCount(1);
  await expect(
    firstGroup.locator('dl[aria-label$="数量价格阶梯"]'),
  ).toHaveCount(0);
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
  const detailBox = await selectedDetail.boundingBox();
  if (!detailBox) throw new Error('收费工作台详情布局不可见');
  if (viewport.width < 1280) {
    await expect(returnToList).toBeVisible();
    await expect(chargeList).toBeHidden();
    await expect(returnToList).toHaveAttribute(
      'href',
      /#external-charge-list$/,
    );
  } else {
    await expect(returnToList).toBeHidden();
    await expect(chargeList).toBeVisible();
    const listBox = await chargeList.boundingBox();
    if (!listBox) throw new Error('收费工作台列表布局不可见');
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
        name: /^(?:保存到调价草稿|保存本组（\d+ 档待保存）)$/,
      }),
    ).toBeVisible();
    return;
  }

  await expect(page.getByLabel('价格状态')).toBeVisible();
  await expect(
    page.getByRole('heading', { name: '当前为生效价', exact: true }),
  ).toBeVisible();
  const selectedListLink = page.getByRole('link', { name: /^正在查看：/ });
  if (viewport.width < 1280) {
    await expect(selectedListLink).toBeHidden();
  } else {
    await expect(selectedListLink).toBeVisible();
  }

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
  await expect(firstItem).toHaveAttribute('href', /#selected-charge-detail$/);
  await firstItem.click();
  await expect(page).toHaveURL(/#selected-charge-detail$/, {
    // 四个视口共享开发态 Turbopack 时，RSC 导航可能超过默认 5 秒；
    // 等待导航提交，但仍要求落到明确的详情锚点。
    timeout: 30_000,
  });
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

  await expect(page.getByText('7 档', { exact: true })).toHaveCount(1);
  const selectedDetail = page.locator(
    'aside[aria-labelledby="selected-charge-heading"]',
  );
  const tierPanel =
    state === 'current'
      ? page.locator('section[aria-label="当前产品价格阶梯"]')
      : selectedDetail.locator('section[aria-label="编辑收费项目"] form');
  await expect(selectedDetail).toBeVisible();
  await expect(tierPanel).toBeVisible();
  const tierHeader = tierPanel.locator('header');
  await expect(
    tierHeader.getByText(/157克超长双铜纸彩印加局部烫金/),
  ).toBeVisible();
  await expect(
    tierHeader.getByText(/157克双铜纸·客户指定超长纸张名称/),
  ).toBeVisible();
  await expect(
    tierHeader.getByText(/非标定制 123\.45 × 678\.90 mm/),
  ).toBeVisible();
  await expect(
    tierPanel.getByText('7 个数量档', { exact: true }),
  ).toBeVisible();
  await expect(tierPanel.locator('ol > li')).toHaveCount(7);
  await expect(
    page.locator('dl[aria-label$="数量价格阶梯"]'),
  ).toHaveCount(0);

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
    await expect(tierPanel.locator('input[name^="tierAmount-"]')).toHaveCount(7);
    await expect(tierPanel.getByText('当前', { exact: true })).toHaveCount(1);
    await expect(tierPanel.getByText('草稿', { exact: true })).toHaveCount(1);
    await expect(tierPanel.getByText('变化', { exact: true })).toHaveCount(8);
    await expect(tierPanel.getByRole('checkbox')).toHaveCount(7);
    await expect(
      tierPanel
        .locator('ol > li')
        .first()
        .getByLabel('草稿总价（元）', { exact: true }),
    ).toHaveValue('310');
    await expect(
      tierPanel
        .locator('ol > li')
        .last()
        .getByLabel('草稿总价（元）', { exact: true }),
    ).toHaveValue('2480');
    await expect(
      tierPanel.getByLabel('1,000 个价格档启用', { exact: true }),
    ).toBeChecked();
    await expect(tierPanel.locator('ol > li').first()).toContainText('+¥15');
    await expect(
      tierPanel.getByRole('button', {
        name: '保存本组（0 档待保存）',
        exact: true,
      }),
    ).toBeDisabled();
  } else if (state === 'draft-piece') {
    await expect(tierPanel.locator('input[name^="tierAmount-"]')).toHaveCount(7);
    await expect(tierPanel.getByRole('checkbox')).toHaveCount(7);
    await expect(
      tierPanel
        .locator('ol > li')
        .first()
        .getByLabel('草稿单价（元/个）', { exact: true }),
    ).toHaveValue('0.54');
    await expect(
      tierPanel
        .locator('ol > li')
        .last()
        .getByLabel('草稿单价（元/个）', { exact: true }),
    ).toHaveValue('0.18');
    await expect(tierPanel.getByText('¥0.52 / 个', { exact: true })).toBeVisible();
    await expect(tierPanel).toContainText('计价单位：每个成品');
    await expect(tierPanel.getByText('折合单价', { exact: true })).toHaveCount(0);
    await expect(
      tierPanel.getByRole('button', {
        name: '保存本组（0 档待保存）',
        exact: true,
      }),
    ).toBeDisabled();
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
  const itemDetails = page
    .locator('section details')
    .filter({
      has: page.getByText(/#1\s*·\s*超长款式名称红包烫金高级定制版/),
    })
    .first();
  await expect(itemDetails).toBeVisible();
  await itemDetails.locator('summary').click();
  await expect(itemDetails).toHaveAttribute('open', '');

  const itemHeading = page.getByRole('heading', {
    level: 3,
    name: /#1\s+超长款式名称红包烫金高级定制版/,
  });
  await expect(itemHeading).toBeVisible();
  const itemCard = itemDetails.locator('xpath=ancestor::li[1]');
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

  for (const itemName of ['批量派工款式一', '批量派工款式二']) {
    const row = page.getByRole('row').filter({ hasText: itemName });
    const selectedWorker = row
      .getByRole('radio')
      .filter({ hasText: E2E_USERS.workerHandPress!.displayName });
    await expect(selectedWorker).toHaveCount(1);
    await expect(selectedWorker).toHaveAttribute('aria-checked', 'true');
  }
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
  await openFirstOrderItemEditor(page);
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
    page.getByAltText(
      '待上传设计图：超长设计图文件名ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789.png',
    ),
  ).toBeVisible();

  await page.getByRole('tab', { name: /收货与费用/ }).click();
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
  await expect(
    page.getByRole('heading', { name: '额外地址 1', exact: true }),
  ).toBeVisible();
}
