import { test, expect } from '@playwright/test';
import { Client } from 'pg';
import {
  ADMIN_PASSWORD,
  ADMIN_USERNAME,
  E2E_USERS,
  expectNoNextErrorOverlay,
  getUserIdByUsername,
  login,
  seedDashboardSnapshot,
} from './_helpers';

type PricingState = {
  status: string;
  pricingStatus: string;
  revision: number;
  priceRevision: number;
  confirmedFee: string | null;
  settledFee: string | null;
  quotedFee: string | null;
  totalAmount: string;
  processingAmount: string;
  packagingAmount: string;
  pricingRevisions: number;
  operations: number;
  progressSteps: number;
  confirmationLogs: number;
};

async function readPricingState(orderId: string): Promise<PricingState> {
  const db = new Client({ connectionString: process.env.DATABASE_URL });
  await db.connect();
  try {
    const result = await db.query<PricingState>(
      `SELECT o.status, o."pricingStatus", o.revision, o."priceRevision",
              o."confirmedFee", o."settledFee", o."quotedFee", o."totalAmount",
              o."processingAmount", o."packagingAmount",
              (SELECT COUNT(*)::int FROM "OrderPricingRevision" r
                WHERE r."orderId" = o.id) AS "pricingRevisions",
              (SELECT COUNT(*)::int FROM "ProductionOperation" operation
                WHERE operation."orderId" = o.id) AS operations,
              (SELECT COUNT(*)::int FROM "ProductionProgressStep" step
                WHERE step."orderId" = o.id) AS "progressSteps",
              (SELECT COUNT(*)::int FROM "OrderLog" log
                WHERE log."orderId" = o.id
                  AND log.action = 'PRICING_ADMIN_CONFIRMED') AS "confirmationLogs"
         FROM "Order" o WHERE o.id = $1`,
      [orderId],
    );
    expect(result.rows).toHaveLength(1);
    return result.rows[0]!;
  } finally {
    await db.end();
  }
}

test('生产事实缺失时核价局部反馈并完整回滚，详情页面仍可使用', async ({ page }) => {
  test.setTimeout(90_000);
  const salesUserId = await getUserIdByUsername(E2E_USERS.sales.username);
  // The dashboard's minimal legacy submission deliberately lacks production
  // items/packaging. Every invocation owns a fresh order; existing user orders
  // and earlier fixtures are never changed by this failure-path regression.
  const seeded = await seedDashboardSnapshot({ salesUserId });
  const orderId = seeded.urgentOrderId;
  const before = await readPricingState(orderId);
  expect(before).toMatchObject({
    status: 'SUBMITTED',
    pricingStatus: 'PENDING_ADMIN_CONFIRMATION',
    confirmedFee: null,
    pricingRevisions: 0,
    operations: 0,
    progressSteps: 0,
    confirmationLogs: 0,
  });

  await login(page, {
    from: `/orders/${orderId}`,
    username: ADMIN_USERNAME,
    password: ADMIN_PASSWORD,
  });
  const pricing = page.locator('#pricing-review');
  await expect(pricing.getByRole('heading', { name: '工单价格状态' })).toBeVisible();
  const trigger = pricing.getByRole('button', { name: '确认工厂核价', exact: true });
  await expect(trigger).toBeEnabled();
  await trigger.click();
  const dialog = page.getByRole('alertdialog', { name: '确认工厂核价并锁定终价？' });
  await expect(dialog).toBeVisible();
  await dialog.getByRole('button', { name: '确认工厂核价', exact: true }).click();

  await expect(pricing.getByRole('alert')).toHaveText(
    '工单款式或生产信息不完整，无法完成核价。请先核对款式、数量及包装信息。',
  );
  await expect(trigger).toBeEnabled();
  await expect(pricing).not.toContainText('CANONICAL_FACTS_INCOMPLETE');
  await expectNoNextErrorOverlay(page);
  expect(await readPricingState(orderId)).toEqual(before);

  await page.reload();
  await expect(pricing.getByRole('heading', { name: '工单价格状态' })).toBeVisible();
  await expect(pricing).toContainText('待管理员确认');
  await expectNoNextErrorOverlay(page);
  await page.getByRole('link', { name: '工作台', exact: true }).first().click();
  await expect(page).toHaveURL(/\/owner$/);
  await expect(page.getByRole('heading', { name: '工作台', exact: true })).toBeVisible();
});
