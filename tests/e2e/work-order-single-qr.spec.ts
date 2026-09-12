import { requireReleasePrerequisite } from './release-prerequisite';
import { randomUUID } from 'node:crypto';
import { writeFileSync } from 'node:fs';
import { Client } from 'pg';
import Decimal from 'decimal.js';
import { expect, test, type Page } from '@playwright/test';
import {
  E2E_PASSWORD, E2E_USERS, login, productionOperationE2eIsolationFailure,
} from './_helpers';

async function withDb<T>(run: (db: Client) => Promise<T>): Promise<T> {
  const db = new Client({ connectionString: process.env.DATABASE_URL });
  await db.connect();
  try { return await run(db); } finally { await db.end(); }
}

async function createFixture() {
  const id = `e2e-single-qr-${randomUUID()}`;
  return withDb(async (db) => {
    const owner = await db.query<{ id: string }>('SELECT id FROM "User" WHERE username = $1', [E2E_USERS.owner!.username]);
    if (!owner.rows[0]) throw new Error('E2E owner account missing');
    await db.query('BEGIN');
    try {
      await db.query(`INSERT INTO "Order" (id,"orderNo","submitterId","submitterRole","createdById","settlementType",status,"workOrderVersion","customName","scheduledAt","createdAt","updatedAt") VALUES ($1,$1,$2,'ADMIN',$2,'FACTORY_DIRECT','RELEASED',2,'统一扫码计件测试',timezone('UTC',CURRENT_TIMESTAMP)-interval '1 day',NOW(),NOW())`, [id, owner.rows[0].id]);
      await db.query(`INSERT INTO "ProductionOperation" (id,"orderId","operationType",unit,status,"plannedQty","workOrderVersion","createdAt","updatedAt") VALUES ($1,$2,'PARTIAL','PER_PASS','PENDING',400,2,NOW(),NOW())`, [`${id}-foil`, id]);
      for (const sequence of [1, 2]) {
        const itemId = `${id}-item-${sequence}`;
        const groupId = `${id}-group-${sequence}`;
        const operationId = `${id}-pack-${sequence}`;
        await db.query(`INSERT INTO "OrderItem" (id,"orderId",sequence,fig,name,"pricingRoute","productStructure","foilTechnique",quantity,"frontFoilColors","backFoilColors","foilColors",crafts,"createdAt","updatedAt") VALUES ($1,$2,$3,$3,$4,'STOCK_BLANK','STANDARD_ENVELOPE','FLAT',200,ARRAY['亚金'],ARRAY[]::text[],ARRAY['亚金'],ARRAY[]::text[],NOW(),NOW())`, [itemId, id, sequence, sequence === 1 ? '花好月圆' : '阖家团圆']);
        await db.query(`INSERT INTO "OrderPackagingGroup" (id,"orderId",sequence,name,mode,"actualBagCount","createdAt","updatedAt") VALUES ($1,$2,$3,$4,'SINGLE_STYLE',20,NOW(),NOW())`, [groupId, id, sequence, `独立包装${sequence}`]);
        await db.query(`INSERT INTO "OrderPackagingGroupLine" (id,"orderId","packagingGroupId","orderItemId","unitsPerBag") VALUES ($1,$2,$3,$4,10)`, [`${id}-line-${sequence}`, id, groupId, itemId]);
        await db.query(`INSERT INTO "ProductionOperation" (id,"orderId","operationType",unit,status,"plannedQty","workOrderVersion","createdAt","updatedAt") VALUES ($1,$2,'PACKING','PER_BAG','PENDING',20,2,NOW(),NOW())`, [operationId, id]);
        await db.query(`INSERT INTO "ProductionOperationSource" (id,"operationId","sourceType","orderItemId","sourceQty") VALUES ($1,$2,'ORDER_ITEM',$3,200)`, [`${id}-foil-source-${sequence}`, `${id}-foil`, itemId]);
        await db.query(`INSERT INTO "ProductionOperationSource" (id,"operationId","sourceType","packagingGroupId","sourceQty") VALUES ($1,$2,'PACKAGING_GROUP',$3,20)`, [`${id}-pack-source-${sequence}`, operationId, groupId]);
      }
      await db.query('COMMIT');
    } catch (error) {
      await db.query('ROLLBACK');
      throw error;
    }
    return { id, foilId: `${id}-foil`, packId: `${id}-pack-1` };
  });
}

async function report(page: Page, quantity: string, progress: string) {
  const section = page.locator('section').filter({ has: page.getByRole('heading', { name: '扫码报工', exact: true }) });
  await section.getByRole('spinbutton', { name: '本次合格完成数', exact: true }).fill(quantity);
  await section.getByRole('spinbutton', { name: '本次工单件数进度', exact: true }).fill(progress);
  await section.getByRole('spinbutton', { name: '缺陷数', exact: true }).fill('0');
  await section.getByRole('spinbutton', { name: '返工数', exact: true }).fill('0');
  await section.getByRole('button', { name: '提交扫码报工', exact: true }).click();
  await expect(section.locator('[role="status"], [role="alert"]')).toContainText('已记录本次报工，计件金额', { timeout: 15_000 });
}

async function hasCurrentRates() {
  return withDb(async (db) => {
    const rows = await db.query<{ count: number; operations: string[] }>(`SELECT count(DISTINCT book.id)::int AS count, array_agg(rule."operationType"::text) AS operations FROM "PieceworkPriceBook" book JOIN "PieceworkPriceRule" rule ON rule."priceBookId"=book.id WHERE book.status='PUBLISHED' AND book."effectiveFrom" <= CURRENT_TIMESTAMP AND (book."effectiveTo" IS NULL OR book."effectiveTo" > CURRENT_TIMESTAMP)`);
    return rows.rows[0]?.count === 1 && ['PARTIAL', 'PACKING'].every((operation) => rows.rows[0]?.operations?.includes(operation));
  });
}

test.describe('工单单码跨岗位入口', () => {
  test.beforeEach(() => {
    const isolationFailure = productionOperationE2eIsolationFailure();
    requireReleasePrerequisite(isolationFailure);
    test.skip(Boolean(isolationFailure), '需要明确隔离的 E2E 数据库；不向开发工单写测试事实');
    test.setTimeout(120_000);
  });

  test('单工序直达、多包装组选择、旧版拦截和跨岗任务拒绝', async ({ browser }) => {
    const fixture = await createFixture();
    const workerContext = await browser.newContext();
    const packerContext = await browser.newContext();
    try {
      const workerPage = await workerContext.newPage();
      await login(workerPage, { from: '/worker/tasks', username: E2E_USERS.workerHandPress!.username, password: E2E_PASSWORD });
      await expect(workerPage.getByRole('heading', { name: '生产工序', exact: true })).toBeVisible({ timeout: 30_000 });
      await workerPage.goto(`/wo/${fixture.id}?v=2`);
      await expect(workerPage).toHaveURL(`/worker/tasks/${fixture.foilId}`, { timeout: 30_000 });
      const packerPage = await packerContext.newPage();
      await login(packerPage, { from: '/worker/tasks', username: E2E_USERS.workerPacker!.username, password: E2E_PASSWORD });
      await expect(packerPage.getByRole('heading', { name: '生产工序', exact: true })).toBeVisible({ timeout: 30_000 });
      await packerPage.goto(`/wo/${fixture.id}?v=2`);
      await expect(packerPage).toHaveURL(`/worker/orders/${fixture.id}`);
      await expect(packerPage.getByRole('heading', { name: '选择本次报工工序' })).toBeVisible();
      await expect(packerPage.getByRole('link', { name: /包装组 #1/ })).toContainText('花好月圆');
      await expect(packerPage.getByRole('link', { name: /包装组 #2/ })).toContainText('阖家团圆');
      await expect(packerPage.getByRole('link', { name: /包装组 #1/ })).toContainText('剩余 20 袋');
      await expect(packerPage.getByRole('link', { name: /局部烫金/ })).toHaveCount(0);
      await packerPage.getByRole('link', { name: /包装组 #1/ }).click();
      await expect(packerPage).toHaveURL(`/worker/tasks/${fixture.packId}`);
      await expect(packerPage.getByText('#1 · 花好月圆 · 每袋 10 个')).toBeVisible();
      await workerPage.goto(`/wo/${fixture.id}?v=1&task=${fixture.foilId}`);
      await expect(workerPage.getByRole('main').getByRole('alert').filter({ hasText: '此工单已作废' })).toContainText('此工单已作废，当前版本 v2');
      await packerPage.goto(`/wo/${fixture.id}?v=2&task=${fixture.foilId}`);
      await expect(packerPage.getByRole('heading', { name: '找不到这个页面，或你没有访问权限' })).toBeVisible();
      const facts = await withDb((db) => db.query('SELECT id FROM "ProductionScanClaim" WHERE "orderId"=$1', [fixture.id]));
      expect(facts.rowCount, '仅打开扫码页不能产生开工或计薪事实').toBe(0);
    } catch (error) {
      for (const [role, context] of [['worker', workerContext], ['packer', packerContext]] as const) {
        for (const [index, page] of context.pages().entries()) {
          try {
            writeFileSync(test.info().outputPath(`${role}-${index}.html`), await page.content());
            await page.screenshot({ path: test.info().outputPath(`${role}-${index}.png`), fullPage: true });
          } catch {
            // A redirect may still be committing; preserve the original failure.
          }
        }
      }
      throw error;
    } finally {
      await workerContext.close(); await packerContext.close();
    }
  });

  test('师傅开工后打包人仍可报工，首开工不变且工资各归本人', async ({ browser }) => {
    const hasRates = await hasCurrentRates();
    const priceFailure = hasRates ? null : '隔离库缺少已发布的烫金/打包工价；用例不修改受保护价表';
    requireReleasePrerequisite(priceFailure);
    test.skip(!hasRates, priceFailure ?? '');
    const fixture = await createFixture();
    const workerContext = await browser.newContext();
    const packerContext = await browser.newContext();
    try {
      const workerPage = await workerContext.newPage();
      await login(workerPage, { from: `/wo/${fixture.id}?v=2`, username: E2E_USERS.workerHandPress!.username, password: E2E_PASSWORD });
      await report(workerPage, '20', '20');
      const packerPage = await packerContext.newPage();
      await login(packerPage, { from: `/wo/${fixture.id}?v=2`, username: E2E_USERS.workerPacker!.username, password: E2E_PASSWORD });
      await packerPage.getByRole('link', { name: /包装组 #1/ }).click();
      await report(packerPage, '2', '20');
      const result = await withDb(async (db) => ({
        claims: (await db.query(`SELECT account.username FROM "ProductionScanClaim" claim JOIN "User" account ON account.id=claim."reporterId" WHERE claim."orderId"=$1`, [fixture.id])).rows,
        reports: (await db.query(`SELECT account.username, operation."operationType", report."reportedCompletedQty"::text AS quantity, report.rate::text, report.amount::text, report."chargeableQty"::text, report.unit, report."priceBookId" FROM "ProductionReport" report JOIN "ProductionOperation" operation ON operation.id=report."operationId" JOIN "User" account ON account.id=report."reporterId" WHERE operation."orderId"=$1 ORDER BY report."reportedAt"`, [fixture.id])).rows,
      }));
      expect(result.claims).toEqual([{ username: E2E_USERS.workerHandPress!.username }]);
      expect(result.reports.map(({ username, operationType, quantity }) => ({ username, operationType, quantity }))).toEqual([
        { username: E2E_USERS.workerHandPress!.username, operationType: 'PARTIAL', quantity: '20.000' },
        { username: E2E_USERS.workerPacker!.username, operationType: 'PACKING', quantity: '2.000' },
      ]);
      for (const report of result.reports) {
        expect(new Decimal(report.rate).isPositive(), '真实工价必须为正').toBe(true);
        expect(report.amount).toBe(new Decimal(report.chargeableQty).times(report.rate).toFixed(2, Decimal.ROUND_HALF_UP));
        expect(report.priceBookId).toBeTruthy();
        expect(report.unit).toBe(report.operationType === 'PACKING' ? 'PER_BAG' : 'PER_PASS');
      }
    } finally {
      await workerContext.close(); await packerContext.close();
      test.info().annotations.push({ type: 'isolated-append-only', description: `${fixture.id} 保留隔离测试库的不可变报工事实，随测试库销毁；不删除历史工资记录。` });
    }
  });
});
