import { expect, test, type Page, type TestInfo } from '@playwright/test';
import {
  E2E_PASSWORD,
  E2E_USERS,
  login,
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
import {
  RULE_CENTER_HREFS,
  customerPricingHref,
} from '../../lib/navigation/rule-center';

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

test.describe('设计稿客户计价板块', () => {
  test.describe.configure({ timeout: 180_000 });

  test.beforeEach(async ({ page }) => {
    await login(page, {
      from: '/owner/rules/customer-pricing?section=blank',
      username: E2E_USERS.owner!.username,
      password: E2E_PASSWORD,
    });
  });

  test('六个业务编辑器不再回落通用价格矩阵', async ({
    page,
  }, testInfo) => {
    const sections = [
      ['blank', '局部烫金 · 空白封现货单价'],
      ['machine', '局部烫金 · 机烫费与制版费'],
      ['tiers', '专版烫金 · 阶梯单价'],
      ['adds', '专版烫金 · 加价'],
      ['print', '彩印阶梯总价'],
      ['ship', '包装 · 纸箱耗材 · 中通快递'],
    ] as const;

    for (const [section, heading] of sections) {
      await test.step(section, async () => {
        await page.goto(
          `${RULE_CENTER_HREFS.customerPricing}?section=${section}`,
        );
        await expect(
          page.getByRole('heading', { name: heading, exact: true }),
        ).toBeVisible();
        await expect(
          page.getByRole('region', { name: heading, exact: true }),
        ).toBeVisible();
        await expect(
          page.getByRole('region', {
            name: '客户计价规则矩阵',
            exact: true,
          }),
        ).toHaveCount(0);
        await expect(
          page.getByRole('search', { name: '查找收费项目' }),
        ).toHaveCount(0);
        await expect(
          page.getByRole('navigation', {
            name: '规则配置工作区导航',
          }),
        ).toHaveCount(0);
        await expectViewportGate(page, testInfo);
        await expectA11yGate(page);
      });
    }
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

  test('mobile pricing filters stay inline, scroll locally, and remove one chip', async ({
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

    const filters = page.getByRole('search', { name: '查找收费项目' });
    const filterDetails = filters.locator('details');
    const filterSummary = filterDetails.locator('summary');
    await expect(filterDetails).toHaveAttribute('open', '');
    await expect(filterSummary).toContainText('筛选定位');
    await expect(filterSummary).toContainText('4 项');
    await expect(filters.getByLabel('收费类目')).toHaveValue('print');
    await expect(
      page.getByRole('dialog', { name: '更多筛选', exact: true }),
    ).toHaveCount(0);

    await filterSummary.click();
    await expect(filterDetails).not.toHaveAttribute('open', '');
    await expect(filterSummary).toBeFocused();
    await filterSummary.click();
    await expect(filterDetails).toHaveAttribute('open', '');
    await expect(filterSummary).toBeFocused();

    const activeFilters = filters.getByLabel('已启用的收费项目筛选');
    const filterScrollMetrics = await activeFilters.evaluate((element) => {
      const node = element as HTMLElement;
      return {
        clientWidth: node.clientWidth,
        scrollWidth: node.scrollWidth,
        overflowX: getComputedStyle(node).overflowX,
      };
    });
    expect(filterScrollMetrics.overflowX).toMatch(/auto|scroll/);
    expect(filterScrollMetrics.scrollWidth).toBeGreaterThan(
      filterScrollMetrics.clientWidth,
    );
    await activeFilters.evaluate((element) => {
      const node = element as HTMLElement;
      node.scrollLeft = node.scrollWidth;
    });
    await expect
      .poll(() =>
        activeFilters.evaluate((element) => (element as HTMLElement).scrollLeft),
      )
      .toBeGreaterThan(0);
    await activeFilters.evaluate((element) => {
      (element as HTMLElement).scrollLeft = 0;
    });
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
      'pricing-filters-inline-light',
    );

    const categoryChip = page.getByRole('link', {
      name: '清除筛选：类目：彩印基础加工费',
      exact: true,
    });
    await expect(categoryChip).toHaveAttribute(
      'href',
      /state=draft(?=.*kind=ADD_ON)(?=.*status=ACTIVE)(?=.*changed=1)(?!.*category=)/,
    );
    await categoryChip.click();
    await expect(page).toHaveURL(
      (url) => {
        return (
          !url.searchParams.has('category') &&
          url.searchParams.get('kind') === 'ADD_ON' &&
          url.searchParams.get('status') === 'ACTIVE' &&
          url.searchParams.get('changed') === '1'
        );
      },
      { timeout: 30_000 },
    );
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

  test('sales order list passes its focused light and dark gates', async ({
    page,
  }, testInfo) => {
    const listRoute = salesRoutes(fixture).filter(
      (route) => route.name === 'sales-orders',
    );
    await checkRoutes(page, testInfo, listRoute, 'light');
    await checkRoutes(page, testInfo, listRoute, 'dark');
  });

  test('sales order detail passes its focused safe-surface gates', async ({
    page,
  }, testInfo) => {
    const detailRoute = salesRoutes(fixture).filter(
      (route) => route.name === 'sales-order-detail',
    );
    await checkRoutes(page, testInfo, detailRoute, 'light');
    await checkRoutes(page, testInfo, detailRoute, 'dark');
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
      prepareGateState: prepareAdminOrderCreationState,
    },
    {
      name: 'attendance',
      path: '/foreman/attendance',
      readyHeading: '员工考勤',
      prepareGateState: prepareAttendanceState,
    },
    { name: 'inventory', path: '/foreman/materials', readyHeading: '物料库存' },
    { name: 'outsource', path: '/foreman/outsource', readyHeading: '外协单' },
    // 以下四条此前从未被任何门禁访问过。UI 审查在它们上面实测到 axe
    // label / select-name 违规（筛选栏 <label> 没有 htmlFor），修完补进
    // 路由表，避免再次退化。
    { name: 'salary-hourly', path: '/owner/salary/hourly', readyHeading: '时薪工月结' },
    {
      name: 'salary-daily',
      path: '/owner/salary/daily',
      readyHeading: '历史开机师傅日薪档案',
    },
    { name: 'cdr', path: '/foreman/cdr', readyHeading: 'CDR 汇总下载' },
    { name: 'cs-period-new', path: '/owner/salary/cs/new', readyHeading: '新建客服周期' },
    { name: 'accounts', path: '/owner/accounts', readyHeading: '账号管理' },
    { name: 'materials', path: '/owner/materials', readyHeading: '物料字典' },
    {
      name: 'stock-skus',
      path: RULE_CENTER_HREFS.stockSkus,
      readyHeading: '建单产品目录',
    },
    {
      name: 'rule-center',
      path: RULE_CENTER_HREFS.root,
      readyHeading: '局部烫金 · 空白封现货单价',
    },
    {
      name: 'rule-center-customer-processing',
      path: customerPricingHref('processing'),
      readyHeading: '局部烫金 · 空白封现货单价',
      prepareGateState: (page) =>
        prepareDedicatedPriceSectionState(
          page,
          '局部烫金 · 空白封现货单价',
        ),
    },
    {
      name: 'rule-center-customer-logistics',
      path: customerPricingHref('logistics'),
      readyHeading: '包装 · 纸箱耗材 · 中通快递',
      prepareGateState: (page) =>
        prepareDedicatedPriceSectionState(
          page,
          '包装 · 纸箱耗材 · 中通快递',
        ),
    },
    {
      name: 'rule-center-papers',
      path: RULE_CENTER_HREFS.papers,
      readyHeading: '纸张',
    },
    {
      name: 'rule-center-specs',
      path: `${RULE_CENTER_HREFS.stockSkus}?section=specs`,
      readyHeading: '规格 · 烫金颜色',
    },
    {
      name: 'rule-center-product-categories',
      path: RULE_CENTER_HREFS.productCategories,
      readyHeading: '产品结构分类',
    },
    {
      name: 'rule-center-crafts',
      path: RULE_CENTER_HREFS.crafts,
      readyHeading: '工艺与参数',
    },
    {
      name: 'rule-center-price-versions',
      path: RULE_CENTER_HREFS.priceVersions,
      readyHeading: '价格版本与发布',
      prepareGateState: preparePriceBookBusinessState,
    },
    {
      name: 'rule-center-internal-pricing',
      path: RULE_CENTER_HREFS.internalPricing,
      readyHeading: '内部直单价格',
    },
    {
      name: 'rule-center-employee-pay',
      path: RULE_CENTER_HREFS.employeePay,
      readyHeading: '员工工资规则',
    },
    { name: 'bills', path: '/owner/bills', readyHeading: '销售应收账单' },
    {
      name: 'order-changes',
      path: '/owner/order-changes',
      readyHeading: '工单修改申请',
    },
    { name: 'salary', path: '/owner/salary', readyHeading: '薪资总览' },
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
      prepareGateState: prepareSalesOrderDetailState,
    },
    {
      name: 'sales-order-new',
      path: '/orders/new',
      readyHeading: '新建工单',
      prepareGateState: prepareSalesOrderCreationState,
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

async function prepareDedicatedPriceSectionState(
  page: Page,
  heading: string,
) {
  await preparePriceBookBusinessState(page);
  await expect(
    page.getByRole('region', { name: heading, exact: true }),
  ).toBeVisible({ timeout: 30_000 });
  await expect(
    page.getByRole('region', {
      name: '客户计价规则矩阵',
      exact: true,
    }),
  ).toHaveCount(0);
  await expect(
    page.getByRole('search', { name: '查找收费项目' }),
  ).toHaveCount(0);
  await expect(
    page.getByRole('navigation', { name: '规则配置工作区导航' }),
  ).toHaveCount(0);
}

async function expectPriceWorkspaceOverview(page: Page) {
  const workbench = page.locator('[data-slot="rule-price-workbench"]');
  await expect(workbench).toBeVisible({ timeout: 30_000 });
  const matrix = workbench.getByRole('region', {
    name: '客户计价规则矩阵',
    exact: true,
  });
  await expect(matrix).toBeVisible({ timeout: 30_000 });
  const table = matrix.locator(':scope > table');
  const tableHeader = table.locator(':scope > thead');
  await expect(table.locator('tbody > tr').first()).toBeAttached({
    timeout: 30_000,
  });
  for (const heading of [
    '收费项目',
    '适用范围',
    '数量与档位',
    '当前价',
    '状态',
    '操作',
  ]) {
    await expect(
      tableHeader.getByRole('columnheader', { name: heading, exact: true }),
    ).toBeAttached();
  }
  await expect(
    matrix
      .getByRole('link', {
        name: /^(?:编辑|查看|正在编辑|正在查看)收费项目：/,
      })
      .first(),
  ).toBeAttached();

  // 新工作台只有一张矩阵，选中详情作为同一表格的下一行
  // 展开；不再保留旧分组卡片、独立列表或右侧详情栏。
  await expect(
    workbench.locator('section[aria-labelledby^="external-charge-group-"]'),
  ).toHaveCount(0);
  await expect(workbench.locator('#external-charge-list')).toHaveCount(0);
  await expect(
    workbench.locator('aside[aria-labelledby="selected-charge-heading"]'),
  ).toHaveCount(0);

  if ((page.viewportSize()?.width ?? 1280) <= 768) {
    const metrics = await matrix.evaluate((element) => {
      const node = element as HTMLElement;
      return {
        clientWidth: node.clientWidth,
        scrollWidth: node.scrollWidth,
        overflowX: getComputedStyle(node).overflowX,
      };
    });
    expect(metrics.overflowX).toMatch(/auto|scroll/);
    expect(metrics.scrollWidth).toBeGreaterThan(metrics.clientWidth);
    await matrix.evaluate((element) => {
      const node = element as HTMLElement;
      node.scrollLeft = node.scrollWidth;
    });
    await expect
      .poll(() =>
        matrix.evaluate((element) => (element as HTMLElement).scrollLeft),
      )
      .toBeGreaterThan(0);
    await matrix.evaluate((element) => {
      (element as HTMLElement).scrollLeft = 0;
    });
  }
}

async function expectSelectedPriceWorkspace(
  page: Page,
  hasDraft: boolean,
) {
  const workbench = page.locator('[data-slot="rule-price-workbench"]');
  const matrix = workbench.getByRole('region', {
    name: '客户计价规则矩阵',
    exact: true,
  });
  const selectedDetail = workbench.locator('section#selected-charge-detail');
  const collapseDetail = selectedDetail.getByRole('link', {
    name: '收起详情',
    exact: true,
  });
  await expect(selectedDetail).toBeVisible();
  await expect(matrix).toBeVisible();
  await expect(collapseDetail).toBeVisible();
  await expect(collapseDetail).toHaveAttribute(
    'href',
    /#rule-price-matrix-heading$/,
  );
  await expect(
    matrix.getByRole('link', {
      name: /^(正在编辑|正在查看)收费项目：/,
    }),
  ).toHaveAttribute('aria-current', 'page');
  await expect(selectedDetail.locator('xpath=ancestor::td[1]')).toHaveCount(0);

  if (hasDraft) {
    await expect(workbench.getByLabel('调价草稿状态')).toBeVisible();
    const editorSection = selectedDetail.getByLabel('编辑收费项目');
    await expect(editorSection).toBeVisible();
    const editorForm = editorSection.locator('form').first();
    await expect(editorForm).toBeVisible();
    await expect(
      editorForm.getByRole('button', {
        name: /^(?:保存到调价草稿|保存（\d+ 档）)$/,
      }),
    ).toBeVisible();
    return;
  }

  await expect(workbench.getByLabel('价格状态')).toBeVisible();
  await expect(
    workbench.getByText('当前生效', { exact: true }),
  ).toBeVisible();
  await expect(
    matrix.getByRole('link', { name: /^正在查看收费项目：/ }),
  ).toBeAttached();

  const createDraftSummary = workbench
    .locator('details > summary')
    .filter({ hasText: /^发起调价$/ });
  const createDraftPanel = createDraftSummary.locator('..');
  if ((await createDraftPanel.count()) > 0) {
    await expect(createDraftPanel).not.toHaveAttribute('open', '');
    await createDraftSummary.click();
    await expect(createDraftPanel).toHaveAttribute('open', '');
    const createDraftForm = workbench.getByRole('form', {
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
  } else if (
    (await workbench.getByRole('link', { name: '发起调价', exact: true }).count()) >
    0
  ) {
    await expect(
      workbench.getByRole('link', { name: '发起调价', exact: true }),
    ).toBeVisible();
  } else {
    await expect(workbench.getByText(/生效前不能再发起新调价/)).toBeVisible();
  }
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

  const matrix = page.getByRole('region', {
    name: '客户计价规则矩阵',
    exact: true,
  });
  const selectedDetail = page.locator(
    '[data-slot="rule-price-workbench"] section#selected-charge-detail',
  );
  await expect(
    matrix.getByText(/^7 档 · 7 个数量档·/),
  ).toBeVisible();
  await expect(
    selectedDetail.getByRole('heading', {
      name: /大号·非标定制 123\.45 × 678\.90 mm/,
    }),
  ).toBeVisible();
  await expect(
    selectedDetail
      .getByText(/157克双铜纸·客户指定超长纸张名称/)
      .first(),
  ).toBeVisible();

  const readOnlyTierPanel = selectedDetail.getByRole('region', {
    name: /大号·非标定制 123\.45 × 678\.90 mm.*价格阶梯$/,
  });
  const tierPanel = state === 'current'
    ? readOnlyTierPanel
    : selectedDetail.getByLabel('编辑收费项目').locator('form');
  await expect(tierPanel).toBeVisible();
  if (state === 'current') {
    await expect(
      tierPanel.getByRole('columnheader', { name: '数量档', exact: true }),
    ).toBeVisible();
    await expect(tierPanel.locator('tbody > tr')).toHaveCount(7);
    await expect(tierPanel.locator('input')).toHaveCount(0);
  } else {
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
  }

  const quantityRows =
    state === 'current'
      ? tierPanel.locator('tbody > tr')
      : tierPanel.locator('ol > li');
  const renderedQuantities = await quantityRows.evaluateAll((rows) =>
    rows.map(
      (row) =>
        row.querySelector<HTMLElement>('.tabular-nums')?.textContent?.trim() ??
        row.querySelector<HTMLElement>('td')?.textContent?.trim() ??
        '',
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
        name: '保存（0 档）',
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
    await expect(tierPanel.getByText('按个计价', { exact: true })).toBeVisible();
    await expect(tierPanel.getByText('折合单价', { exact: true })).toHaveCount(0);
    await expect(
      tierPanel.getByRole('button', {
        name: '保存（0 档）',
        exact: true,
      }),
    ).toBeDisabled();
  } else {
    await expect(readOnlyTierPanel).toBeVisible();
    await expect(
      readOnlyTierPanel.getByRole('columnheader', {
        name: '当前价',
        exact: true,
      }),
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
  const filters = page.locator(
    '[data-slot="sales-order-list-filters"]:visible',
  );
  await expect(filters).toBeVisible();
  const views = filters.getByRole('navigation', { name: '销售工单视图' });
  for (const label of ['全部', '需处理', '进行中', '已发货', '已完成', '草稿']) {
    await expect(views.getByRole('link', { name: new RegExp(`^${label}`) })).toBeVisible();
  }
  await expect(
    filters.getByRole('searchbox', {
      name: '搜索工单名、客户或工单号',
    }),
  ).toBeVisible();

  const list = page.getByRole('list', { name: '销售工单列表' });
  await expect(list).toBeVisible();
  const cards = list.locator('[data-sales-order-card]');
  expect(await cards.count()).toBeGreaterThan(0);
  const actionableButton = page.getByRole('button', {
    name: /查看详情|查看原因/,
  });
  const firstCard = cards.filter({ has: actionableButton }).first();
  const action = firstCard.getByRole('button', {
    name: /查看详情|查看原因/,
  });
  await expect(action).toBeVisible();
  await expect(firstCard).not.toContainText('计件成本');
  await expect(firstCard).not.toContainText('师傅');
  const copyLabel = await firstCard
    .getByRole('button', { name: /^复制工单号 / })
    .getAttribute('aria-label');
  const orderNo = copyLabel?.replace(/^复制工单号 /, '');
  expect(orderNo).toBeTruthy();

  await action.click();
  await expect(page).toHaveURL(/#wo=/);
  const drawer = page.getByRole('dialog', { name: /工单明细/ });
  await expect(drawer).toBeVisible();
  await expect(drawer).not.toContainText('计件成本');
  await expect(drawer).not.toContainText('生产任务');
  await expect(drawer.getByRole('link', { name: '完整详情' })).toHaveCount(0);
  await expect(drawer.getByRole('link', { name: '下载 PDF' })).toHaveCount(0);
  if ((page.viewportSize()?.width ?? 0) < 640) {
    const drawerBox = await drawer.boundingBox();
    expect(drawerBox).not.toBeNull();
    expect(drawerBox!.width).toBeGreaterThanOrEqual(
      (page.viewportSize()?.width ?? 0) - 1,
    );
  }

  await drawer.getByRole('button', { name: '关闭', exact: true }).click();
  await expect(drawer).toBeHidden();
  await expect(page).toHaveURL((url) => !url.hash);
  await page.goForward();
  await expect(drawer).toBeVisible();

  await page.goto(`/orders?view=draft#wo=${encodeURIComponent(orderNo!)}`);
  await expect(drawer).toBeVisible();
  await expect(drawer).toContainText(orderNo!);
  await expect(
    drawer.getByRole('heading', { name: '进度', exact: true }),
  ).toBeVisible();
}

async function prepareSalesOrderDetailState(page: Page) {
  // Streaming can briefly retain the hidden Suspense copy beside the resolved
  // page on compact viewports; gate only the visible sales surface.
  const detail = page.locator('[data-slot="sales-order-detail"]:visible');
  await expect(detail).toBeVisible();
  for (const hiddenFactoryField of [
    '师傅',
    '生产安排',
    '修改日志',
    '制版明细',
    '计价快照',
    '计件工资',
    '内部成本',
  ]) {
    await expect(detail).not.toContainText(hiddenFactoryField);
  }
  await expect(detail.getByRole('link', { name: '打印', exact: true })).toHaveCount(0);
  await expect(
    detail.getByRole('link', { name: '下载 PDF', exact: true }),
  ).toHaveCount(0);
  await expect(
    detail.getByRole('link', { name: '返回工单列表', exact: true }),
  ).toBeVisible();

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
  await expect(definition('加工面')).toHaveText('双面加工');
  await expect(definition('双色烫金')).toHaveText('是');
  await expect(definition('生产工序')).toContainText('局部烫金：进行中');
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

async function prepareConfiguredLocalFoilStyle(page: Page) {
  const form = page.locator('[data-slot="order-form-b"]:visible');
  await expect(form).toBeVisible();
  await expect(
    form
      .getByRole('navigation', { name: '款式' })
      .getByRole('button')
      .first(),
  ).toHaveAttribute('aria-pressed', 'true');

  const routePicker = form.getByRole('group', { name: '工艺类型' });
  for (const route of ['局部烫金', '专版烫金', '彩印']) {
    await expect(
      routePicker.getByRole('button', { name: route, exact: true }),
    ).toBeVisible();
  }
  await routePicker
    .getByRole('button', { name: '局部烫金', exact: true })
    .click();

  const paperPicker = form.getByRole('group', { name: '纸张材质' });
  await paperPicker
    .getByRole('button', { name: '珠光艳闪', exact: true })
    .click();
  const specificationPicker = form.getByRole('group', { name: '规格' });
  await specificationPicker
    .getByRole('button', { name: '大号封', exact: true })
    .click();
  const weightPicker = form.getByRole('group', { name: '克重' });
  await weightPicker
    .getByRole('button', { name: '160g', exact: true })
    .click();

  await expect(
    routePicker.getByRole('button', {
      name: '局部烫金',
      exact: true,
      pressed: true,
    }),
  ).toBeVisible();
  await expect(
    paperPicker.getByRole('button', {
      name: '珠光艳闪',
      exact: true,
      pressed: true,
    }),
  ).toBeVisible();
  await expect(
    specificationPicker.getByRole('button', {
      name: '大号封',
      exact: true,
      pressed: true,
    }),
  ).toBeVisible();
  await expect(
    weightPicker.getByRole('button', {
      name: '160g',
      exact: true,
      pressed: true,
    }),
  ).toBeVisible();
  for (const retiredField of ['报价产品', '成交单价', '人工改价说明']) {
    await expect(form.getByLabel(retiredField, { exact: true })).toHaveCount(0);
  }

  return form;
}

async function prepareAdminOrderCreationState(page: Page) {
  const form = await prepareConfiguredLocalFoilStyle(page);
  await form
    .getByRole('textbox', { name: '工单名称', exact: true })
    .fill('管理员内部建单超长工单名称ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789');
  await form
    .getByRole('textbox', { name: '客户名称/简称', exact: true })
    .fill('超长客户名称用于验证小屏换行与表单容器不溢出');
  await form
    .getByRole('textbox', { name: '款式名', exact: true })
    .fill('超长款式名称珠光艳闪大号封局部烫金高级定制版');
  await form
    .getByRole('textbox', {
      name: '配置外项目说明（转人工核价）',
      exact: true,
    })
    .fill('客户要求追加配置外特殊工艺，请工厂确认环节人工核价并保留完整客需说明。');

  await form
    .getByRole('button', { name: '增加收货地址', exact: true })
    .click();
  await form
    .locator('textarea[name="additionalShipments.0.receiverAddress"]')
    .fill('额外收货地址ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789');
  await form
    .locator('input[name="additionalShipments.0.itemQuantities.0"]')
    .fill('100');
  await expect(
    form.getByRole('heading', { name: '额外地址 1', exact: true }),
  ).toBeVisible();
}

async function prepareSalesOrderCreationState(page: Page) {
  const form = await prepareConfiguredLocalFoilStyle(page);
  // 销售端款式名由已选计价事实生成，不提供人工命名入口。
  await expect(
    form.getByRole('textbox', { name: '款式名', exact: true }),
  ).toHaveCount(0);
  await form
    .getByRole('textbox', { name: '工单名称', exact: true })
    .fill('外部销售建单超长工单名称ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789');
  await form
    .getByRole('spinbutton', { name: '数量', exact: true })
    .fill('1234567');
  await form
    .getByRole('textbox', { name: '收货地址', exact: true })
    .fill('张三 13800138000 广东省深圳市南山区科技园超长地址压力测试大厦A座12345678901234567890');

  const foilPicker = form.getByRole('group', { name: '烫金颜色' }).first();
  const selectedFoilCount = await foilPicker
    .getByRole('button', { pressed: true })
    .count();
  const configuredFoil = foilPicker
    .getByRole('button', { pressed: false })
    .first();
  await expect(configuredFoil).toBeVisible();
  await configuredFoil.click();
  await expect(
    foilPicker.getByRole('button', { pressed: true }),
  ).toHaveCount(selectedFoilCount + 1);

  const fileName =
    '超长设计图文件名ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789最终确认版.png';
  await form.getByLabel('第 1 款 设计图', { exact: true }).setInputFiles({
    name: fileName,
    mimeType: 'image/png',
    buffer: Buffer.from(
      'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=',
      'base64',
    ),
  });
  await expect(
    form.getByRole('img', {
      name: `第 1 款设计图预览：${fileName}`,
      exact: true,
    }),
  ).toBeVisible();
  await expect(form.getByText(fileName, { exact: false })).toBeVisible();
}
