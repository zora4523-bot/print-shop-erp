import { randomUUID } from 'node:crypto';
import { Client } from 'pg';
import { test, expect } from '@playwright/test';
import { E2E_PASSWORD, E2E_USERS, login, productionOperationE2eIsolationFailure } from './_helpers';

async function withDb<T>(run: (db: Client) => Promise<T>) {
  const db = new Client({ connectionString: process.env.DATABASE_URL });
  await db.connect();
  try { return await run(db); } finally { await db.end(); }
}
async function fixture(mismatch = false) {
  return withDb(async (db) => {
    const id = `e2e-readiness-${randomUUID()}`;
    const user = await db.query<{ id: string }>('SELECT id FROM "User" WHERE username=$1', [E2E_USERS.owner!.username]);
    await db.query('BEGIN');
    try {
      await db.query(`INSERT INTO "Order" (id,"orderNo","submitterId","submitterRole","createdById","settlementType",status,"pricingStatus","pricingConfirmedAt","customName","receiverAddress","receiverPhone","processingAmount","packagingAmount","totalAmount","createdAt","updatedAt") VALUES ($1,$1,$2,'SALES',$2,'EXTERNAL_SALES','SUBMITTED','AUTO_CONFIRMED',NOW(),'自动接单测试','广东省广州市测试路','13800000000',12.30,2.20,$3,NOW(),NOW())`, [id, user.rows[0].id, mismatch ? '999.00' : '12.30']);
      await db.query(`INSERT INTO "OrderItem" (id,"orderId",sequence,fig,name,"pricingRoute","productStructure",craft,"foilTechnique",quantity,"hasLocalFoil","frontFoilColors","backFoilColors","foilColors",crafts,"unitPrice","subtotal","createdAt","updatedAt") VALUES ($1,$2,1,1,'团圆红包','STOCK_BLANK','STANDARD_ENVELOPE','PARTIAL','FLAT',100,true,ARRAY['亚金'],ARRAY[]::text[],ARRAY['亚金'],ARRAY[]::text[],0.1010,10.10,NOW(),NOW())`, [`${id}-item`, id]);
      await db.query(`INSERT INTO "OrderPackagingGroup" (id,"orderId",sequence,mode,"actualBagCount","unitPrice",subtotal,"createdAt","updatedAt") VALUES ($1,$2,1,'SINGLE_STYLE',10,0.2200,2.20,NOW(),NOW())`, [`${id}-pack`, id]);
      await db.query(`INSERT INTO "OrderPackagingGroupLine" (id,"orderId","packagingGroupId","orderItemId","unitsPerBag") VALUES ($1,$2,$3,$4,10)`, [`${id}-line`, id, `${id}-pack`, `${id}-item`]);
      await db.query('COMMIT');
    } catch (error) { await db.query('ROLLBACK'); throw error; }
    return id;
  });
}
async function state(id: string) {
  return withDb(async (db) => (await db.query(`SELECT status,"confirmedFee"::text,"totalAmount"::text,"settledFee"::text,"quotedFee"::text,
    (SELECT count(*)::int FROM "ProductionOperation" WHERE "orderId"=$1) AS operations,
    (SELECT count(*)::int FROM "OrderPrintJob" WHERE "orderId"=$1) AS prints,
    (SELECT count(*)::int FROM "OrderLog" WHERE "orderId"=$1 AND action='ORDER_READY_FOR_PRODUCTION') AS readiness
    FROM "Order" WHERE id=$1`, [id])).rows[0]);
}
test.describe('自动准备与直接安排生产', () => {
  test.beforeEach(() => { test.skip(Boolean(productionOperationE2eIsolationFailure()), '只在隔离数据库写入新测试工单'); });
  test('直接排单创建待打印任务；刷新不会重计价', async ({ page }) => {
    test.setTimeout(120_000);
    const id = await fixture();
    await login(page, { from: `/orders/${id}`, username: E2E_USERS.owner!.username, password: E2E_PASSWORD });
    await expect(page.getByRole('heading', { level: 1, name: '自动接单测试', exact: true })).toBeVisible({ timeout: 30_000 });
    await expect(page.getByRole('button', { name: '下发生产', exact: true })).toHaveCount(0);
    await page.getByRole('link', { name: '安排生产师傅', exact: true }).first().click();
    const worker = await withDb(async db => (await db.query('SELECT id FROM "User" WHERE username=$1', [E2E_USERS.workerHandPress.username])).rows[0]);
    await page.getByRole('combobox', { name: '局部烫金 · 100 个' }).selectOption(worker.id);
    await page.getByRole('button', { name: '核对排单' }).click();
    await page.getByRole('button', { name: '发布排单', exact: true }).click();
    await expect(page.getByRole('region', { name: '排单结果' })).toBeVisible({ timeout: 30_000 });
    await expect.poll(async () => (await state(id)).status).toBe('RELEASED');
    const released = await state(id);
    expect(released).toMatchObject({ operations: 2, prints: 1, readiness: 1, totalAmount: '12.30', confirmedFee: '12.30', settledFee: null });
    await page.goto(`/orders/${id}`);
    expect(await state(id)).toEqual(released);
    // 排单已创建待打印请求；实际打印后追加回执，不重复创建请求。
    await expect(page.getByRole('button', { name: '加入待打印', exact: true })).toHaveCount(0);
    await expect(page.locator(`a[href="/print/orders/${encodeURIComponent(id)}?autoprint=1"]`).first()).toBeVisible();
    expect(await state(id)).toEqual(released);
    const printPage = await page.context().newPage();
    await printPage.addInitScript(() => {
      window.print = () => { document.documentElement.dataset.e2ePrinted = 'true'; };
    });
    await printPage.goto(`/print/orders/${encodeURIComponent(id)}?autoprint=1`);
    await expect(printPage.locator('html')).toHaveAttribute('data-e2e-printed', 'true', { timeout: 30_000 });
    await printPage.evaluate(() => window.dispatchEvent(new Event('afterprint')));
    await expect.poll(async () => (await state(id)).prints).toBe(2);
    expect(await state(id)).toEqual({ ...released, prints: 2 });
  });
  test('旧待确认单可直接安排，错误合计展示原因且没有写入', async ({ page }) => {
    test.setTimeout(120_000);
    const invalid = await fixture(true);
    await login(page, { from: `/orders/${invalid}`, username: E2E_USERS.owner!.username, password: E2E_PASSWORD });
    // Login settles on navigation commit; wait for the streamed detail before checking business feedback.
    await expect(page.getByRole('heading', { level: 1, name: '自动接单测试', exact: true })).toBeVisible({ timeout: 30_000 });
    await expect(page.getByText('费用明细与工单合计不一致，请先核对费用', { exact: true })).toBeVisible();
    await expect(page.getByRole('button', { name: '下发生产', exact: true })).toHaveCount(0);
    expect(await state(invalid)).toMatchObject({ status: 'SUBMITTED', operations: 0, prints: 0, readiness: 0, confirmedFee: null });
    const valid = await fixture();
    await page.goto(`/orders/${valid}`);
    await page.getByRole('link', { name: '安排生产师傅', exact: true }).first().click();
    const worker = await withDb(async db => (await db.query('SELECT id FROM "User" WHERE username=$1', [E2E_USERS.workerHandPress.username])).rows[0]);
    await page.getByRole('combobox', { name: '局部烫金 · 100 个' }).selectOption(worker.id);
    await page.getByRole('button', { name: '核对排单' }).click();
    await page.getByRole('button', { name: '发布排单', exact: true }).click();
    await expect(page.getByRole('region', { name: '排单结果' })).toBeVisible({ timeout: 30_000 });
    await expect.poll(async () => (await state(valid)).status).toBe('RELEASED');
    expect(await state(valid)).toMatchObject({ operations: 2, prints: 1, readiness: 1, confirmedFee: '12.30' });
  });
});
