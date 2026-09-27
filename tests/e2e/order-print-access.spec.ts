import { randomBytes } from 'node:crypto';
import { Client } from 'pg';
import { expect, test, type Page } from '@playwright/test';
import { E2E_PASSWORD, E2E_USERS, login } from './_helpers';
import { EMPTY_NO_ACCESS_TITLE } from '../../components/ui-business/empty-state-copy';

// Read-only printing must authorize current production facts without historical
// task assignments. Every row below belongs to this run in a disposable DB.
const runId = randomBytes(6).toString('hex');
const prefix = `e2e-print-access-${runId}`;
const cases = ['current', 'other-lane', 'old-version', 'cancelled', 'draft', 'progress', 'sales-own'] as const;
type Case = typeof cases[number];
const orderId = (kind: Case) => `${prefix}-${kind}`;
const orderNo = (kind: Case) => `PA-${runId}-${kind}`;
const disabledUserId = `${prefix}-disabled`;

async function withDb<T>(action: (db: Client) => Promise<T>): Promise<T> {
  if (process.env.E2E_APPEND_ONLY_DATABASE_ISOLATED !== '1') {
    throw new Error('打印权限测试必须使用独立 E2E_DATABASE_URL');
  }
  const db = new Client({ connectionString: process.env.DATABASE_URL });
  await db.connect();
  try { return await action(db); } finally { await db.end(); }
}

test.beforeAll(async () => {
  await withDb(async (db) => {
    const accounts = await db.query<{ id: string; username: string; role: string }>(
      'SELECT id, username::text, role::text FROM "User" WHERE username = ANY($1::citext[])',
      [[E2E_USERS.owner!.username, E2E_USERS.sales!.username]],
    );
    const owner = accounts.rows.find((account) => account.username === E2E_USERS.owner!.username)!;
    const sales = accounts.rows.find((account) => account.username === E2E_USERS.sales!.username)!;
    expect(owner && sales, '独立数据库应具备角色测试账号').toBeTruthy();
    await db.query('BEGIN');
    try {
      await db.query(
        `INSERT INTO "User" (id, username, password, role, "displayName", "isActive", "createdAt", "updatedAt")
         SELECT $1::text, $1::text::citext, password, 'ADMIN', '打印权限测试管理员', TRUE, NOW(), NOW()
           FROM "User" WHERE id = $2`,
        [disabledUserId, owner.id],
      );
      for (const kind of cases) {
        // 收费工单都归属外部销售（业主 2026-09-24）；打印权限与提交人无关。
        const submitter = sales;
        const id = orderId(kind);
        const itemId = `${id}-item`;
        await db.query(
          `INSERT INTO "Order" (
             id, "orderNo", "submitterId", "submitterRole", "createdById", "settlementType",
             status, "workOrderVersion", "customName", "customerRef", "createdAt", "updatedAt"
           ) VALUES ($1,$2,$3,'SALES'::"Role",$3,'EXTERNAL_SALES'::"OrderSettlementType",$4::"OrderStatus",$5,'打印权限回归','权限测试客户',NOW(),NOW())`,
          [id, orderNo(kind), submitter.id, kind === 'draft' ? 'SUBMITTED' : 'RELEASED', kind === 'old-version' ? 1 : 2],
        );
        await db.query(
          `INSERT INTO "OrderItem" (
             id, "orderId", sequence, name, "pricingRoute", "productStructure", specification,
             "paperType", "paperWeightGsm", quantity, "frontFoilColors", "foilColors", "foilTechnique",
             crafts, "createdAt", "updatedAt"
           ) VALUES ($1,$2,1,'权限回归款','CUSTOM_SINGLE_FLAT_FOIL','STANDARD_ENVELOPE','大号','珠光纸',160,1000,ARRAY['金色'],ARRAY['金色'],'FLAT',ARRAY[]::text[],NOW(),NOW())`,
          [itemId, id],
        );
        if (kind === 'progress') {
          await db.query(
            `INSERT INTO "ProductionProgressStep" (
               id,"orderId","workOrderVersion","orderItemId","craftId","craftCode","craftName",status,"plannedQty","createdAt","updatedAt"
             ) VALUES ($1,$2,2,$3,$4,'PRINT_ACCESS_PROGRESS','覆膜','PENDING',1000,NOW(),NOW())`,
            [`${id}-progress`, id, itemId, `${prefix}-progress-craft`],
          );
        } else {
          const operationId = `${id}-operation`;
          await db.query(
            `INSERT INTO "ProductionOperation" (
               id,"orderId","workOrderVersion","operationType",unit,status,"plannedQty","createdAt","updatedAt"
             ) VALUES ($1,$2,$3,$4::"PieceworkOperationType",$5::"PieceworkRateUnit",$6::"ProductionOperationStatus",1000,NOW(),NOW())`,
            [operationId, id, kind === 'old-version' ? 1 : 2, kind === 'other-lane' ? 'FULL' : 'PARTIAL', kind === 'other-lane' ? 'PER_PIECE' : 'PER_PASS', kind === 'cancelled' ? 'CANCELLED' : 'PENDING'],
          );
          await db.query(
            `INSERT INTO "ProductionOperationSource" (id,"operationId","sourceType","orderItemId","sourceQty")
             VALUES ($1,$2,'ORDER_ITEM',$3,1000)`,
            [`${operationId}-source`, operationId, itemId],
          );
          if (kind === 'old-version') {
            // Create v1 while it is current, then advance the order. Never
            // disable generation validation to insert a historical child.
            await db.query('UPDATE "Order" SET "workOrderVersion"=2,"updatedAt"=NOW() WHERE id=$1 AND "workOrderVersion"=1', [id]);
          }
        }
      }
      await db.query('COMMIT');
    } catch (error) {
      await db.query('ROLLBACK'); throw error;
    }
  });
});

test.afterAll(async () => {
  await withDb(async (db) => {
    const ids = cases.map(orderId);
    // Never delete append-only reports, claims or pricing revisions to clean up
    // a fixture. Unexpected business history makes teardown fail closed.
    const history = await db.query<{ count: string }>(
      `SELECT COUNT(*)::text AS count FROM (
         SELECT r.id FROM "ProductionReport" r JOIN "ProductionOperation" o ON o.id=r."operationId" WHERE o."orderId"=ANY($1::text[])
         UNION ALL SELECT r.id FROM "ProductionProgressReport" r JOIN "ProductionProgressStep" s ON s.id=r."progressStepId" WHERE s."orderId"=ANY($1::text[])
         UNION ALL SELECT id FROM "ProductionScanClaim" WHERE "orderId"=ANY($1::text[])
         UNION ALL SELECT id FROM "OrderPricingRevision" WHERE "orderId"=ANY($1::text[])
       ) history`, [ids],
    );
    expect(history.rows[0]!.count, '只清理没有业务历史的本次打印夹具').toBe('0');
    await db.query('BEGIN');
    try {
      await db.query('DELETE FROM "ProductionOperationSource" WHERE "operationId" IN (SELECT id FROM "ProductionOperation" WHERE "orderId"=ANY($1::text[]))', [ids]);
      await db.query('DELETE FROM "ProductionOperation" WHERE "orderId"=ANY($1::text[])', [ids]);
      await db.query('DELETE FROM "ProductionProgressStep" WHERE "orderId"=ANY($1::text[])', [ids]);
      await db.query('DELETE FROM "Order" WHERE id=ANY($1::text[])', [ids]);
      await db.query('DELETE FROM "User" WHERE id=$1 AND username=$1::text::citext', [disabledUserId]);
      await db.query('COMMIT');
    } catch (error) {
      await db.query('ROLLBACK'); throw error;
    }
  });
});

async function expectAllowed(page: Page, kind: Case) {
  await page.goto(`/print/orders/${orderId(kind)}`);
  await expect(page.locator('.work-order-document')).toBeVisible();
  await expect(page).toHaveTitle(new RegExp(orderNo(kind)));
  await expect(page.locator('html')).toHaveAttribute('data-print-pagination', 'ready');
}

async function expectDenied(page: Page, kind: Case) {
  await page.goto(`/print/orders/${orderId(kind)}`);
  await expect(page.getByText(EMPTY_NO_ACCESS_TITLE, { exact: true })).toBeVisible();
  await expect(page.locator('.work-order-document')).toHaveCount(0);
  await expect(page).not.toHaveTitle(new RegExp(orderNo(kind)));
  await expect(page.locator('body')).not.toContainText(orderNo(kind));
  const pdf = await page.request.get(`/api/orders/${orderId(kind)}/pdf`);
  expect(pdf.status()).toBe(404);
  expect(await pdf.json()).toEqual({ error: 'Not found' });
}

test('未登录不能读取打印页或 PDF', async ({ page }) => {
  await page.goto(`/print/orders/${orderId('current')}`);
  await expect(page).toHaveURL(/\/login\?/);
  const pdf = await page.request.get(`/api/orders/${orderId('current')}/pdf`);
  expect(pdf.status()).toBe(401);
  await expect(page).not.toHaveTitle(new RegExp(orderNo('current')));
});

test('师傅仅可打印当前有效岗位工序；旧版、已取消、其它岗位和草稿均拒绝', async ({ page }) => {
  test.setTimeout(90_000);
  await login(page, { from: `/print/orders/${orderId('current')}`, username: E2E_USERS.workerHandPress!.username, password: E2E_PASSWORD });
  await expectAllowed(page, 'current');
  const pdf = await page.request.get(`/api/orders/${orderId('current')}/pdf`);
  expect(pdf.status()).toBe(200);
  expect(pdf.headers()['content-type']).toBe('application/pdf');
  expect((await pdf.body()).subarray(0, 5).toString()).toBe('%PDF-');
  for (const kind of ['other-lane', 'old-version', 'cancelled', 'draft'] as const) await expectDenied(page, kind);
});

test('其它固定岗位可读取公共进度，但不会因此获得仅含局部烫金工单的权限', async ({ page }) => {
  await login(page, { from: `/print/orders/${orderId('progress')}`, username: E2E_USERS.workerWindmill!.username, password: E2E_PASSWORD });
  await expectAllowed(page, 'progress');
  await expectDenied(page, 'current');
});

test('销售即使是录单人也不可读取生产工单标题、正文或 PDF', async ({ page }) => {
  await login(page, { from: `/print/orders/${orderId('sales-own')}`, username: E2E_USERS.sales!.username, password: E2E_PASSWORD });
  await expectDenied(page, 'sales-own');
});

test('已有登录令牌的账号停用后不能继续下载 PDF', async ({ page }) => {
  await login(page, { from: `/print/orders/${orderId('current')}`, username: disabledUserId, password: E2E_PASSWORD });
  await expectAllowed(page, 'current');
  await withDb((db) => db.query('UPDATE "User" SET "isActive"=FALSE,"updatedAt"=NOW() WHERE id=$1', [disabledUserId]));
  const pdf = await page.request.get(`/api/orders/${orderId('current')}/pdf`);
  expect(pdf.status()).toBe(401);
  expect(pdf.headers()['content-type']).not.toBe('application/pdf');
});
