import { expect, test, type Locator, type Page } from '@playwright/test';
import { Client } from 'pg';
import { E2E_PASSWORD, E2E_USERS, login } from './_helpers';
import {
  cleanupWorkerUiFixture,
  seedWorkerUiFixture,
  type WorkerUiFixture,
} from '../visual/worker-ui-fixture';

let fixture: WorkerUiFixture;

async function withDb<T>(fn: (db: Client) => Promise<T>): Promise<T> {
  const db = new Client({ connectionString: process.env.DATABASE_URL });
  await db.connect();
  try {
    return await fn(db);
  } finally {
    await db.end();
  }
}

async function setE2EUserActive(
  username: string,
  isActive: boolean,
): Promise<void> {
  if (!username.startsWith('e2e-')) {
    throw new Error(`Refusing to change non-E2E account "${username}"`);
  }
  await withDb(async (db) => {
    const result = await db.query(
      `UPDATE "User"
       SET "isActive" = $2, "updatedAt" = NOW()
       WHERE username = $1`,
      [username, isActive],
    );
    if (result.rowCount !== 1) {
      throw new Error(`E2E user ${username} not found`);
    }
  });
}

async function countTasksForOrder(orderId: string): Promise<number> {
  return withDb(async (db) => {
    const result = await db.query<{ count: string }>(
      `SELECT COUNT(*)::text AS count
       FROM "ProductionTask" task
       JOIN "OrderItem" item ON item.id = task."orderItemId"
       WHERE item."orderId" = $1`,
      [orderId],
    );
    return Number(result.rows[0]?.count ?? 0);
  });
}

async function setWorkerRecommendedForOrder(
  orderId: string,
  username: string,
  recommended: boolean,
): Promise<void> {
  if (!username.startsWith('e2e-') || !orderId.startsWith('e2e-')) {
    throw new Error('Refusing to change non-E2E scheduling capability');
  }
  await withDb(async (db) => {
    const ids = await db.query<{ workerId: string; craftId: string }>(
      `SELECT worker.id AS "workerId", item.crafts[1] AS "craftId"
       FROM "User" worker
       CROSS JOIN "OrderItem" item
       WHERE worker.username = $1 AND item."orderId" = $2
       LIMIT 1`,
      [username, orderId],
    );
    const row = ids.rows[0];
    if (!row) throw new Error('E2E worker/craft pair not found');
    if (recommended) {
      await db.query(
        `INSERT INTO "WorkerCraftCapability" ("workerId", "craftId")
         VALUES ($1, $2) ON CONFLICT DO NOTHING`,
        [row.workerId, row.craftId],
      );
    } else {
      await db.query(
        `DELETE FROM "WorkerCraftCapability"
         WHERE "workerId" = $1 AND "craftId" = $2`,
        [row.workerId, row.craftId],
      );
    }
  });
}

async function latestAssignmentOverrideReason(
  orderId: string,
): Promise<string | null> {
  return withDb(async (db) => {
    const result = await db.query<{ reason: string | null }>(
      `SELECT "changedFields"->'assignmentOverrides'->0->>'reason' AS reason
       FROM "OrderLog"
       WHERE "orderId" = $1
         AND "changedFields" ? 'assignmentOverrides'
       ORDER BY "createdAt" DESC
       LIMIT 1`,
      [orderId],
    );
    return result.rows[0]?.reason ?? null;
  });
}

async function selectWorker(
  select: Locator,
  displayName: string,
) {
  const value = await select
    .locator('option')
    .filter({ hasText: displayName })
    .getAttribute('value');
  expect(value).toBeTruthy();
  await select.selectOption(value!);
}

async function confirmBatchSchedule(page: Page) {
  await page
    .getByRole('button', { name: '确认分配所选工艺', exact: true })
    .click();
  const dialog = page.getByRole('alertdialog');
  await expect(dialog).toBeVisible();
  await dialog
    .getByRole('button', { name: /^确认分配 \d+ 个任务$/ })
    .click();
}

test.beforeAll(async () => {
  fixture = await seedWorkerUiFixture('batch-scheduling-e2e');
});

test.afterAll(async () => {
  if (fixture) {
    await cleanupWorkerUiFixture(fixture);
  }
});

test('账号在页面打开后失效时提示重新登录且排产事务不落数据', async ({
  page,
}) => {
  const ownerUsername = E2E_USERS.owner!.username;
  await login(page, {
    from: '/foreman/scheduling',
    username: ownerUsername,
    password: E2E_PASSWORD,
  });

  const workerSelect = page.getByLabel('接单师傅', { exact: true });
  await selectWorker(workerSelect, E2E_USERS.workerHandPress!.displayName);
  await page
    .getByRole('checkbox', {
      name: `选择工单 ${fixture.schedulingOrderNo}`,
      exact: true,
    })
    .check();

  await setE2EUserActive(ownerUsername, false);
  try {
    await confirmBatchSchedule(page);

    await expect(
      page.getByRole('alert').filter({ hasText: '登录状态已失效' }),
    ).toBeVisible();
    await expect(
      page.getByRole('link', { name: '重新登录', exact: true }),
    ).toHaveAttribute('href', '/login?from=/foreman/scheduling');
    await expect
      .poll(() => countTasksForOrder(fixture.schedulingOrderId))
      .toBe(0);
  } finally {
    await setE2EUserActive(ownerUsername, true);
  }
});

test('管理员可将两张工单的兼容工艺批量排给同一师傅', async ({ page }) => {
  await login(page, {
    from: '/foreman/scheduling',
    username: E2E_USERS.owner!.username,
    password: E2E_PASSWORD,
  });
  await expect(
    page.getByRole('heading', { name: '待排产', exact: true }),
  ).toBeVisible();

  const workerSelect = page.getByLabel('接单师傅', { exact: true });
  await selectWorker(workerSelect, E2E_USERS.workerHandPress!.displayName);
  for (const orderNo of [
    fixture.schedulingOrderNo,
    fixture.schedulingOrderTwoNo,
  ]) {
    await page
      .getByRole('checkbox', {
        name: `选择工单 ${orderNo}`,
        exact: true,
      })
      .check();
  }
  await expect(page.getByText('已选 2 张', { exact: false })).toBeVisible();

  await confirmBatchSchedule(page);

  await expect(
    page.getByRole('status').filter({ hasText: '已为 2 张工单分配' }),
  ).toBeVisible();
  for (const orderNo of [
    fixture.schedulingOrderNo,
    fixture.schedulingOrderTwoNo,
  ]) {
    await expect(
      page.getByRole('checkbox', {
        name: `选择工单 ${orderNo}`,
        exact: true,
      }),
    ).toHaveCount(0);
  }
});

test('混合机型工单可分两次派给不同师傅，全部完成后才离开待排产', async ({
  page,
}) => {
  await login(page, {
    from: '/foreman/scheduling',
    username: E2E_USERS.owner!.username,
    password: E2E_PASSWORD,
  });
  const workerSelect = page.getByLabel('接单师傅', { exact: true });
  const orderCheckbox = page.getByRole('checkbox', {
    name: `选择工单 ${fixture.mixedSchedulingOrderNo}`,
    exact: true,
  });

  await selectWorker(workerSelect, E2E_USERS.workerHandPress!.displayName);
  await orderCheckbox.check();
  await expect(page.getByText('本次将分配 1 个匹配任务')).toBeVisible();
  await confirmBatchSchedule(page);

  await expect(
    page.getByRole('status').filter({ hasText: '其中 0 张已完成全部排产' }),
  ).toBeVisible();
  const mixedRow = page
    .getByRole('row')
    .filter({ hasText: fixture.mixedSchedulingOrderNo });
  await expect(mixedRow).toContainText('无可派');
  await expect(orderCheckbox).toBeDisabled();

  await selectWorker(workerSelect, E2E_USERS.workerWindmill!.displayName);
  await expect(mixedRow).toContainText('可派 1 项');
  await expect(orderCheckbox).toBeEnabled();
  await orderCheckbox.check();
  await confirmBatchSchedule(page);

  await expect(
    page.getByRole('status').filter({ hasText: '其中 1 张已完成全部排产' }),
  ).toBeVisible();
  await expect(orderCheckbox).toHaveCount(0);
});

test('管理员越过熟练工艺推荐时必须填写原因并写入审计日志', async ({
  page,
}) => {
  const worker = E2E_USERS.workerHandPress!;
  await setWorkerRecommendedForOrder(
    fixture.overrideSchedulingOrderId,
    worker.username,
    false,
  );
  try {
    await login(page, {
      from: '/foreman/scheduling',
      username: E2E_USERS.owner!.username,
      password: E2E_PASSWORD,
    });
    const workerSelect = page.getByLabel('接单师傅', { exact: true });
    await selectWorker(workerSelect, worker.displayName);
    await page
      .getByRole('checkbox', {
        name: `选择工单 ${fixture.overrideSchedulingOrderNo}`,
        exact: true,
      })
      .check();

    await expect(page.getByText('需说明 1 项', { exact: false })).toBeVisible();
    const submit = page.getByRole('button', {
      name: '确认分配所选工艺',
      exact: true,
    });
    await expect(submit).toBeDisabled();

    const reason = '临时支援，管理员已确认设备与人员安全';
    await page
      .getByLabel('非推荐派工原因（1 项）', { exact: true })
      .fill(reason);
    await expect(submit).toBeEnabled();
    await confirmBatchSchedule(page);

    await expect(
      page.getByRole('status').filter({ hasText: '已为 1 张工单分配' }),
    ).toBeVisible();
    await expect
      .poll(() =>
        latestAssignmentOverrideReason(fixture.overrideSchedulingOrderId),
      )
      .toBe(reason);
  } finally {
    await setWorkerRecommendedForOrder(
      fixture.overrideSchedulingOrderId,
      worker.username,
      true,
    );
  }
});
