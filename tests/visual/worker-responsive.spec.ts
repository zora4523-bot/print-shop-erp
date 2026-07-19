import { expect, test } from '@playwright/test';
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

function workerRoutes(data: WorkerUiFixture) {
  return [
    { name: 'tasks', path: '/worker/tasks', readyHeading: '待处理任务' },
    {
      name: 'task-detail-reporting',
      path: `/worker/tasks/${data.activeTaskId}`,
      readyHeading: '报工',
    },
    { name: 'orders', path: '/worker/orders', readyHeading: '我的工单' },
    {
      name: 'order-detail',
      path: `/worker/orders/${data.orderId}`,
      readyHeading: '我的工单任务',
    },
    { name: 'salary', path: '/worker/salary', readyHeading: '我的计件工资' },
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
  ] as const;
}
