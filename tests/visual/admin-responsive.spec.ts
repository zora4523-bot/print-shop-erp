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
    await checkRoutes(page, testInfo, salesRoutes, 'light');
  });

  test('sales routes pass the same gates with dark tokens', async ({ page }, testInfo) => {
    await checkRoutes(page, testInfo, salesRoutes, 'dark');
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
    },
    {
      name: 'order-new',
      path: '/orders/new',
      readyHeading: '新建工单',
      prepareGateState: prepareOrderCreationComponentState,
    },
    { name: 'scheduling', path: '/foreman/scheduling', readyHeading: '待排产' },
    { name: 'inventory', path: '/foreman/materials', readyHeading: '物料库存' },
    { name: 'outsource', path: '/foreman/outsource', readyHeading: '外协单' },
    { name: 'accounts', path: '/owner/accounts', readyHeading: '账号管理' },
    { name: 'materials', path: '/owner/materials', readyHeading: '物料字典' },
    { name: 'products', path: '/owner/products', readyHeading: '产品字典' },
    { name: 'bills', path: '/owner/bills', readyHeading: '销售应收账单' },
    { name: 'salary', path: '/owner/salary', readyHeading: '薪资总览' },
    { name: 'warehouses', path: '/owner/warehouses', readyHeading: '仓库作业台' },
    { name: 'pigsty', path: '/owner/pigsty', readyHeading: 'Pigsty 运维' },
    {
      name: 'not-found',
      path: '/orders/e2e-admin-ui-missing',
      readyHeading: '没有找到这条记录',
    },
  ];
}

const salesRoutes: readonly AdminRoute[] = [
  { name: 'sales-orders', path: '/orders', readyHeading: '工单' },
  {
    name: 'sales-order-new',
    path: '/orders/new',
    readyHeading: '新建工单',
    prepareGateState: prepareOrderCreationComponentState,
  },
  { name: 'sales-bills', path: '/sales/bills', readyHeading: '我的应收账单' },
];

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
}
