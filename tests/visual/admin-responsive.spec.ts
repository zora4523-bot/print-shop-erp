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

function ownerRoutes(data: WorkerUiFixture): readonly AdminRoute[] {
  return [
    { name: 'dashboard', path: '/owner', readyHeading: 'Dashboard' },
    { name: 'orders', path: '/orders', readyHeading: '工单' },
    {
      name: 'order-detail',
      path: `/orders/${data.orderId}`,
      readyHeading: /^GD-260719-WORKER-RESPONSIVE-LONG-IDENTIFIER-0123456789/,
      prepareGateState: prepareOrderDetailDesignPreview,
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
    { name: 'accounts', path: '/owner/accounts', readyHeading: '账号管理' },
    { name: 'materials', path: '/owner/materials', readyHeading: '物料字典' },
    { name: 'products', path: '/owner/products', readyHeading: '产品字典' },
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
    {
      name: 'not-found',
      path: '/orders/e2e-admin-ui-missing',
      readyHeading: '没有找到这条记录',
    },
  ];
}

function salesRoutes(data: WorkerUiFixture): readonly AdminRoute[] {
  return [
    { name: 'sales-orders', path: '/orders', readyHeading: '工单' },
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
    { name: 'sales-bills', path: '/sales/bills', readyHeading: '我的应收账单' },
  ];
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

async function prepareOrderDetailDesignPreview(page: Page) {
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
