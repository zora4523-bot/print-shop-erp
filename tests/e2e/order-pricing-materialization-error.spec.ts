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

// 2026-09-14 业主拍板：生产事实缺失不再回滚终价——价格照存（ADMIN_CONFIRMED），
// 就绪缺项以提示块列出，工单停在 SUBMITTED 等管理员补录，不生成任何生产事实。
test('生产事实缺失时终价照存、缺项提示且不生成生产事实，详情页面仍可使用', async ({ page }) => {
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

  // 终价落库后页面按 revalidate 重渲染：人工核价表单随 ADMIN_CONFIRMED 消失，
  // 「下发前检查」面板列出待补录事项，页面不报错。
  await expect(pricing).toHaveCount(0);
  await expect(page.getByText('待处理事项', { exact: true })).toBeVisible();
  await expect(page.getByText('CANONICAL_FACTS_INCOMPLETE')).toHaveCount(0);
  await expectNoNextErrorOverlay(page);
  const after = await readPricingState(orderId);
  expect(after).toMatchObject({
    status: 'SUBMITTED',
    pricingStatus: 'ADMIN_CONFIRMED',
    pricingRevisions: 1,
    operations: 0,
    progressSteps: 0,
    confirmationLogs: 1,
  });
  expect(after.priceRevision).toBeGreaterThan(before.priceRevision);
  // 终价确认把确认金额冻结为当前合计；就绪与否只影响是否进入 CONFIRMED。
  expect(after.confirmedFee).toBe(after.totalAmount);

  await page.reload();
  // 终价已保存，不再提供人工核价入口；刷新后状态不变。
  await expect(page.getByText('待处理事项', { exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: '录入人工核价', exact: true })).toHaveCount(0);
  expect(await readPricingState(orderId)).toEqual(after);
  await expectNoNextErrorOverlay(page);
  const workbenchLink = page.getByRole('link', { name: '管理工作台', exact: true }).first();
  if (!(await workbenchLink.isVisible())) {
    await page.getByRole('button', { name: '打开/关闭侧边栏菜单', exact: true }).click();
  }
  await workbenchLink.click();
  await expect(page).toHaveURL(/\/owner$/);
  await expect(page.getByRole('heading', { name: '管理工作台', exact: true })).toBeVisible();
});

test('管理端旧链接进入详情后终价照存、缺项提示，且不生成生产事实', async ({ page }) => {
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
  await expect(pricing).toHaveCount(0);
  await expect(drawer.getByText('待处理事项', { exact: true })).toBeVisible();
  await expect(page).toHaveURL(`/orders/${seeded.urgentOrderId}`);
  const after = await readPricingState(seeded.urgentOrderId);
  expect(after).toMatchObject({
    status: 'SUBMITTED', pricingStatus: 'ADMIN_CONFIRMED',
    pricingRevisions: 1, operations: 0, progressSteps: 0, confirmationLogs: 1,
  });
  expect(after.confirmedFee).toBe(after.totalAmount);
  await expectNoNextErrorOverlay(page);
});
