import { expect, test, type Page } from '@playwright/test';
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
  for (const route of workerRoutes(fixture)) {
    await test.step(route.name, async () => {
      await page.goto(route.path);
      await expect(
        page.getByRole('heading', { name: route.readyHeading, exact: true }),
      ).toBeVisible();
      await route.assertGateState?.(page);
      await expectViewportGate(page, testInfo);
      await expectA11yGate(page);
      await attachCandidateScreenshot(
        page,
        testInfo,
        'worker',
        `${route.name}-light`,
      );
    });
  }
});

test('worker routes pass the same layout gate with dark tokens', async ({ page }, testInfo) => {
  await page.addInitScript(() => document.documentElement.classList.add('dark'));
  for (const route of workerRoutes(fixture)) {
    await test.step(route.name, async () => {
      await page.goto(route.path);
      await expect(
        page.getByRole('heading', { name: route.readyHeading, exact: true }),
      ).toBeVisible();
      await route.assertGateState?.(page);
      await expectViewportGate(page, testInfo);
      await expectA11yGate(page);
      await attachCandidateScreenshot(
        page,
        testInfo,
        'worker',
        `${route.name}-dark`,
      );
    });
  }
});

type WorkerRoute = {
  name: string;
  path: string;
  readyHeading: string;
  assertGateState?: (page: Page) => Promise<void>;
};

function workerRoutes(data: WorkerUiFixture): readonly WorkerRoute[] {
  return [
    { name: 'tasks', path: '/worker/tasks', readyHeading: '待处理任务' },
    {
      name: 'task-detail-reporting',
      path: `/worker/tasks/${data.activeTaskId}`,
      readyHeading: '报工',
      assertGateState: assertProductionContext,
    },
    { name: 'orders', path: '/worker/orders', readyHeading: '我的工单' },
    {
      name: 'order-detail',
      path: `/worker/orders/${data.orderId}`,
      readyHeading: '我的工单任务',
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
      readyHeading: '没有找到这条记录',
    },
  ];
}

async function assertProductionContext(page: Page) {
  await expect(
    page.getByText(
      '自定义工单名称：七夕红包加急批次ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789',
      { exact: true },
    ),
  ).toBeVisible();
  await expect(page.getByText(/哑金、红金、潘通 871C/).first()).toBeVisible();
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
