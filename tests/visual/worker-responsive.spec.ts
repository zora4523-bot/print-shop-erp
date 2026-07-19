import AxeBuilder from '@axe-core/playwright';
import { mkdir } from 'node:fs/promises';
import path from 'node:path';
import { expect, test, type Page, type TestInfo } from '@playwright/test';
import { E2E_PASSWORD, E2E_USERS, login } from '../e2e/_helpers';
import {
  cleanupWorkerUiFixture,
  seedWorkerUiFixture,
  type WorkerUiFixture,
} from './worker-ui-fixture';

let fixture: WorkerUiFixture;

test.beforeAll(async () => {
  fixture = await seedWorkerUiFixture();
});

test.afterAll(async () => {
  await cleanupWorkerUiFixture();
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
      await expectWorkerViewportGate(page, testInfo);
      await expectA11yGate(page);
      await attachCandidateScreenshot(page, testInfo, `${route.name}-light`);
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
      await expectWorkerViewportGate(page, testInfo);
      await expectA11yGate(page);
      await attachCandidateScreenshot(page, testInfo, `${route.name}-dark`);
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

async function expectWorkerViewportGate(page: Page, testInfo: TestInfo) {
  const mobile = testInfo.project.use.viewport?.width
    ? testInfo.project.use.viewport.width <= 768
    : false;
  const failures = await page.evaluate(({ mobile }) => {
    const viewportWidth = document.documentElement.clientWidth;
    const viewportHeight = window.innerHeight;
    const issues: string[] = [];
    const describe = (element: HTMLElement) => {
      const id = element.id ? `#${element.id}` : '';
      const classes = [...element.classList].slice(0, 3).join('.');
      return `${element.tagName.toLowerCase()}${id}${classes ? `.${classes}` : ''}`;
    };
    const isVisible = (element: HTMLElement) => {
      const style = getComputedStyle(element);
      const rect = element.getBoundingClientRect();
      return style.visibility !== 'hidden' && style.display !== 'none' && rect.width > 0 && rect.height > 0;
    };

    if (document.documentElement.scrollWidth > viewportWidth + 1) {
      issues.push(
        `root-horizontal-overflow:${document.documentElement.scrollWidth}>${viewportWidth}`,
      );
    }

    const elements = [...document.querySelectorAll<HTMLElement>('body *')].filter(isVisible);
    for (const element of elements) {
      const rect = element.getBoundingClientRect();
      const style = getComputedStyle(element);
      if (rect.right > viewportWidth + 1 || rect.left < -1) {
        issues.push(
          `viewport-x:${describe(element)}:[${rect.left.toFixed(1)},${rect.right.toFixed(1)}]/${viewportWidth}`,
        );
      }
      if (
        (style.position === 'fixed' || style.position === 'sticky') &&
        rect.top < viewportHeight &&
        rect.bottom > viewportHeight + 1
      ) {
        issues.push(
          `viewport-y:${describe(element)}:${rect.bottom.toFixed(1)}>${viewportHeight}`,
        );
      }

      const clipsX = style.overflowX === 'hidden' || style.overflowX === 'clip';
      const clipsY = style.overflowY === 'hidden' || style.overflowY === 'clip';
      const clipped =
        (clipsX && element.scrollWidth > element.clientWidth + 1) ||
        (clipsY && element.scrollHeight > element.clientHeight + 1);
      const hasAccessibleFullText = Boolean(
        element.classList.contains('sr-only') ||
        element.title ||
          element.getAttribute('aria-label') ||
          element.getAttribute('aria-describedby'),
      );
      if (clipped && element.textContent?.trim() && !hasAccessibleFullText) {
        issues.push(
          `hidden-clipping:${describe(element)}:${element.scrollWidth}x${element.scrollHeight}>${element.clientWidth}x${element.clientHeight}`,
        );
      }
    }

    if (mobile) {
      const interactives = [
        ...document.querySelectorAll<HTMLElement>(
          'a[href], button:not([disabled]), input:not([type="hidden"]):not([disabled]), select:not([disabled]), textarea:not([disabled]), [role="button"]:not([aria-disabled="true"])',
        ),
      ].filter(isVisible);
      for (const element of interactives) {
        const rect = element.getBoundingClientRect();
        if (rect.width < 44 || rect.height < 44) {
          issues.push(
            `touch-target:${describe(element)}:${rect.width.toFixed(1)}x${rect.height.toFixed(1)}`,
          );
        }
      }
    }

    return [...new Set(issues)];
  }, { mobile });

  expect(failures, failures.join('\n')).toEqual([]);
}

async function expectA11yGate(page: Page) {
  const results = await new AxeBuilder({ page })
    .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'])
    .analyze();
  const failures = results.violations.map((violation) => ({
    id: violation.id,
    impact: violation.impact,
    help: violation.help,
    targets: violation.nodes.map((node) => ({
      selector: node.target.join(' '),
      summary: node.failureSummary,
    })),
  }));
  expect(failures, JSON.stringify(failures, null, 2)).toEqual([]);
}

async function attachCandidateScreenshot(page: Page, testInfo: TestInfo, name: string) {
  const screenshotPath = path.join(
    process.cwd(),
    'test-results',
    'worker-ui-baseline-candidates',
    testInfo.project.name,
    `${name}.png`,
  );
  await mkdir(path.dirname(screenshotPath), { recursive: true });
  await page.screenshot({
    path: screenshotPath,
    fullPage: true,
    animations: 'disabled',
    style: 'nextjs-portal { display: none !important; }',
  });
  await testInfo.attach(name, { path: screenshotPath, contentType: 'image/png' });
}
