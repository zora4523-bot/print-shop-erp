import { test, expect } from '@playwright/test';
import { Client } from 'pg';
import { E2E_USERS, E2E_PASSWORD, getUserIdByUsername, login, uniqueSuffix } from './_helpers';

async function orderSnapshot(id: string) {
  const db = new Client({ connectionString: process.env.DATABASE_URL });
  await db.connect();
  try {
    const { rows } = await db.query(`SELECT to_jsonb(o) AS "order",
      (SELECT jsonb_agg(to_jsonb(r) ORDER BY r.id) FROM "OrderPricingRevision" r WHERE r."orderId" = o.id) AS prices,
      (SELECT jsonb_agg(to_jsonb(s) ORDER BY s.id) FROM "OrderShipment" s WHERE s."orderId" = o.id) AS shipments,
      (SELECT jsonb_agg(l."changedFields") FROM "OrderLog" l WHERE l."orderId" = o.id AND l.action = 'UPDATE') AS logs
      FROM "Order" o WHERE o.id = $1`, [id]);
    expect(rows).toHaveLength(1);
    return rows[0];
  } finally {
    await db.end();
  }
}

test('管理员更换关联外部销售：保存归属、审计与访问范围同步，原价保持', async ({ page, browser }, testInfo) => {
  test.setTimeout(90_000);
  test.skip(process.env.E2E_APPEND_ONLY_DATABASE_ISOLATED !== '1', '归属变更仅使用独立测试数据库');
  const salesUserId = await getUserIdByUsername(E2E_USERS.sales.username);
  const targetId = await getUserIdByUsername(E2E_USERS.billingSales.username);
  const orderId = `e2e-association-${uniqueSuffix()}`;
  const db = new Client({ connectionString: process.env.DATABASE_URL });
  await db.connect();
  try {
    // A fresh historical order owned by the signed-in sales account. Its
    // nonzero recorded price must survive without a current catalog reprice.
    await db.query(`INSERT INTO "Order" (
      id, "orderNo", "submitterId", "submitterRole", "settlementType", "createdById",
      status, "customName", "customerRef", "processingAmount", "totalAmount", "confirmedFee", "createdAt", "updatedAt"
    ) VALUES ($1, $1, $2, 'SALES', 'EXTERNAL_SALES', $2, 'SUBMITTED',
      '外部销售归属核对', '保留客户简称', 2800, 3000, 3000, NOW(), NOW())`, [orderId, salesUserId]);
  } finally { await db.end(); }
  const before = await orderSnapshot(orderId);
  await login(page, { from: `/orders/${orderId}/edit`, username: E2E_USERS.owner.username, password: E2E_PASSWORD });
  const association = page.getByRole('combobox', { name: '关联外部销售', exact: true });
  await expect(association).toHaveValue(salesUserId);
  await expect(page.getByRole('combobox', { name: '关联客户', exact: true })).toHaveCount(0);
  await association.selectOption(targetId);
  await page.screenshot({ path: testInfo.outputPath('external-sales-selection.png'), fullPage: true });
  await page.getByRole('button', { name: '保存修改…', exact: true }).click();
  await page.getByRole('button', { name: '确认保存', exact: true }).click();
  await expect(page).toHaveURL(`/orders/${orderId}`);
  const after = await orderSnapshot(orderId);
  expect(after.order.submitterId).toBe(targetId);
  expect(after.order.editVersion).toBeGreaterThan(before.order.editVersion);
  const editableMetadata = ['submitterId', 'editVersion', 'updatedAt'];
  const stableFields = (order: Record<string, unknown>) => Object.fromEntries(Object.entries(order).filter(([key]) => !editableMetadata.includes(key)));
  expect(stableFields(after.order)).toEqual(stableFields(before.order));
  expect(after.prices).toEqual(before.prices);
  expect(after.shipments).toEqual(before.shipments);
  expect(after.logs).toEqual([expect.objectContaining({ submitterId: {
    before: { id: salesUserId, displayName: E2E_USERS.sales.displayName, username: E2E_USERS.sales.username },
    after: { id: targetId, displayName: E2E_USERS.billingSales.displayName, username: E2E_USERS.billingSales.username },
  } })]);
  await page.goto(`/orders/${orderId}/edit`);
  await expect(association).toHaveValue(targetId);

  for (const [user, canAccess] of [[E2E_USERS.sales, false], [E2E_USERS.billingSales, true]] as const) {
    const context = await browser.newContext({ baseURL: new URL(page.url()).origin });
    try {
      const salesPage = await context.newPage();
      await login(salesPage, { from: `/orders/${orderId}/edit`, username: user.username, password: E2E_PASSWORD });
      if (canAccess) {
        await expect(salesPage.getByRole('textbox', { name: '工单名称', exact: true })).toHaveValue('外部销售归属核对');
        await expect(salesPage.getByRole('combobox', { name: '关联外部销售' })).toHaveCount(0);
      } else {
        await expect(salesPage.locator('[data-kind="no-access"]')).toBeVisible();
        await expect(salesPage.getByRole('textbox', { name: '工单名称', exact: true })).toHaveCount(0);
      }
    } finally { await context.close(); }
  }
});
