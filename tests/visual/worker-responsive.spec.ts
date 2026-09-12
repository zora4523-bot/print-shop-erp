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

// Each project exercises seven routes serially, including axe, geometry and a
// full-page candidate screenshot per route. Keep gate-level thresholds strict
// while giving the complete matrix the same explicit budget as the admin suite.
test.describe.configure({ timeout: 90_000 });

test.beforeAll(async ({}, testInfo) => {
  fixture = await seedWorkerUiFixture(`worker-${testInfo.project.name}`);
});

test.afterAll(async () => {
  await cleanupWorkerUiFixture(fixture);
});

test.beforeEach(async ({ page }) => {
  await login(page, {
    from: '/worker/tasks',
    username: E2E_USERS.workerHandPress!.username,
    password: E2E_PASSWORD,
  });
});

test('worker routes pass overflow, clipping, touch-target and axe gates', async ({ page }, testInfo) => {
  await checkWorkerRoutes(page, testInfo, fixture, 'light');
});

test('worker routes pass the same layout gate with dark tokens', async ({ page }, testInfo) => {
  await checkWorkerRoutes(page, testInfo, fixture, 'dark');
});

async function checkWorkerRoutes(
  page: Page,
  testInfo: TestInfo,
  data: WorkerUiFixture,
  theme: 'light' | 'dark',
) {
  await page.emulateMedia({ colorScheme: theme, reducedMotion: 'reduce' });
  await page.addInitScript((requestedTheme) => {
    localStorage.setItem('erp-theme', requestedTheme);
  }, theme);

  for (const route of workerRoutes(data)) {
    await test.step(route.name, async () => {
      await page.goto(route.path);
      await expect(
        page.getByRole('heading', { name: route.readyHeading, exact: true }),
      ).toBeVisible();
      await expect(page.locator('html')).toHaveAttribute('data-theme', theme);
      if (theme === 'dark') {
        await expect(page.locator('html')).toHaveClass(/\bdark\b/);
      } else {
        await expect(page.locator('html')).not.toHaveClass(/\bdark\b/);
      }
      await route.assertGateState?.(page);
      // The route is server-rendered, but its reduced-motion color transitions
      // can still be created during the next paint. Let consecutive paints and
      // any newly-created transitions settle before axe samples the palette.
      for (let paint = 0; paint < 3; paint += 1) {
        await page.evaluate(() => new Promise<void>((resolve) => requestAnimationFrame(() => resolve())));
        // Streaming can replace an animation whose finished promise was
        // captured earlier. Observe the current document, as the admin gate
        // does, and report still-running targets within the assertion budget.
        await expect.poll(() => page.evaluate(() => document.getAnimations()
          .filter((animation) => animation.playState === 'running' || animation.pending)
          .map((animation) => ({
            state: animation.playState,
            target: animation.effect instanceof KeyframeEffect && animation.effect.target instanceof Element
              ? animation.effect.target.outerHTML.slice(0, 180) : null,
          }))), { message: `${route.name}: animations must settle before visual gates` }).toEqual([]);
      }
      await expectViewportGate(page, testInfo);
      await expectA11yGate(page);
      await attachCandidateScreenshot(
        page,
        testInfo,
        'worker',
        `${route.name}-${theme}`,
      );
    });
  }
}

type WorkerRoute = {
  name: string;
  path: string;
  readyHeading: string;
  assertGateState?: (page: Page) => Promise<void>;
};

function workerRoutes(data: WorkerUiFixture): readonly WorkerRoute[] {
  return [
    { name: 'tasks', path: '/worker/tasks', readyHeading: '生产工序' },
    {
      name: 'task-detail-reporting',
      path: `/worker/tasks/${data.activeTaskId}`,
      readyHeading: '局部烫金',
      assertGateState: assertTaskProductionContext,
    },
    { name: 'orders', path: '/worker/orders', readyHeading: '我的工单' },
    {
      name: 'order-detail',
      path: `/worker/orders/${data.orderId}`,
      readyHeading: '工序工单',
      assertGateState: assertProductionContext,
    },
    { name: 'salary', path: '/worker/salary', readyHeading: '我的工资' },
    {
      name: 'salary-detail',
      path: `/worker/salary/${data.salaryId}`,
      readyHeading: '计件任务（1）',
    },
    {
      name: 'not-found',
      path: '/worker/tasks/e2e-worker-ui-missing',
      readyHeading: '找不到这个页面，或你没有访问权限',
    },
  ];
}

async function assertTaskProductionContext(page: Page) {
  await assertProductionContext(page, { expectFoilColors: false });
}

async function assertProductionContext(
  page: Page,
  options: { expectFoilColors?: boolean } = {},
) {
  await expect(
    page.getByText(
      '自定义工单名称：七夕红包加急批次ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789',
      { exact: true },
    ),
  ).toBeVisible();
  if (options.expectFoilColors !== false) {
    await expect(page.getByText(/哑金、红金、潘通 871C/).first()).toBeVisible();
  }
  await expect(
    page.getByText(
      '款式备注包含连续文本ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789防止隐式裁切',
      { exact: true },
    ).first(),
  ).toBeVisible();
  await expect(
    page.getByRole('link', {
      name: '查看设计图：生产设计图超长文件名ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789最终确认版.png',
      exact: true,
    }),
  ).toBeVisible();
}
