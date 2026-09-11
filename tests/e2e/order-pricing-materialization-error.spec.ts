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
  orderNo: string;
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
      `SELECT o."orderNo", o.status, o."pricingStatus", o.revision, o."priceRevision",
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
  await page.getByRole('button', { name: '录入人工核价', exact: true }).click();
  const pricing = page.getByRole('region', { name: '待你处理', exact: true }).locator('[data-slot="order-pricing-review"]');
  await expect(pricing.getByRole('heading', { name: '待管理员补录' })).toBeVisible();
  const trigger = pricing.getByRole('button', { name: '确认工厂核价', exact: true });
  await expect(trigger).toBeEnabled();
  await trigger.click();
  // 文案与确认第 10 条：核价已有完整复核层，直接提交，不再嵌套确认。
  await expect(page.getByRole('alertdialog')).toHaveCount(0);

  await expect(pricing.getByRole('alert')).toContainText('核价未完成：');
  await expect(trigger).toBeEnabled();
  await expect(pricing).not.toContainText('CANONICAL_FACTS_INCOMPLETE');
  await expectNoNextErrorOverlay(page);
  expect(await readPricingState(orderId)).toEqual(before);

  await page.reload();
  await expect(page.getByRole('button', { name: '录入人工核价', exact: true })).toBeVisible();
  expect(await readPricingState(orderId)).toEqual(before);
  await expectNoNextErrorOverlay(page);
  await page.getByRole('link', { name: '工作台', exact: true }).first().click();
  await expect(page).toHaveURL(/\/owner$/);
  await expect(page.getByRole('heading', { name: '工作台', exact: true })).toBeVisible();
});

test('管理端旧链接进入详情后核价失败保留表单，且不会改写工单', async ({ page }) => {
  test.setTimeout(90_000);
  const salesUserId = await getUserIdByUsername(E2E_USERS.sales.username);
  const seeded = await seedDashboardSnapshot({ salesUserId });
  const before = await readPricingState(seeded.urgentOrderId);
  await login(page, {
    from: `/orders?queue=all#wo=${encodeURIComponent(before.orderNo)}`,
    username: ADMIN_USERNAME,
    password: ADMIN_PASSWORD,
  });
  await expect(page).toHaveURL(`/orders/${seeded.urgentOrderId}`);
  const drawer = page.locator('[data-testid="admin-order-detail"]');
  await expect(drawer).toBeVisible();
  await drawer.getByRole('button', { name: '录入人工核价', exact: true }).click();
  const pricing = drawer.locator('[data-slot="order-pricing-review"]');
  const trigger = pricing.getByRole('button', { name: '确认工厂核价', exact: true });
  await expect(trigger).toBeEnabled();
  await trigger.click();
  await expect(page.getByRole('alertdialog')).toHaveCount(0);
  await expect(pricing.getByRole('alert')).toContainText('核价未完成：');
  await expect(trigger).toBeEnabled();
  await expect(page).toHaveURL(`/orders/${seeded.urgentOrderId}`);
  expect(await readPricingState(seeded.urgentOrderId)).toEqual(before);
  await expectNoNextErrorOverlay(page);
});
