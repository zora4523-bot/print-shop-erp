import { randomUUID } from 'node:crypto';
import { expect, test, type Page } from '@playwright/test';
import { assertActivatedE2eDatabase } from '../../scripts/lib/e2e-environment';
import { E2E_PASSWORD, E2E_USERS, getUserIdByUsername, login, withDb } from './_helpers';

test.use({ hasTouch: true });

// Append-only historical fixtures in the explicitly isolated database. No production or shared data.
async function seedHistoricalOrder(colors = ['哑金', '亚金']) {
  assertActivatedE2eDatabase();
  const id = `e2e-foil-history-${randomUUID()}`;
  const salesId = await getUserIdByUsername(E2E_USERS.sales.username);
  await withDb(async (db) => {
    await db.query('BEGIN');
    try {
      const craft = (await db.query(`SELECT id FROM "Craft" WHERE code='FLAT_FOIL_PARTIAL' AND "isActive" LIMIT 1`)).rows[0];
      expect(craft).toBeTruthy();
      await db.query(`INSERT INTO "Order" (id,"orderNo","submitterId","submitterRole","createdById","settlementType",status,"customName","receiverName","receiverPhone","receiverAddress","processingAmount","totalAmount","confirmedFee","pricingStatus","pricingConfirmedAt","updatedAt")
        VALUES ($1,$1,$2,'SALES',$2,'EXTERNAL_SALES','SUBMITTED','历史颜色回归','测试收件人','13800138000','广东省佛山市测试路1号',100,100,100,'LEGACY_CONFIRMED',NOW(),NOW())`, [id, salesId]);
      await db.query(`INSERT INTO "OrderItem" (id,"orderId",sequence,fig,name,"pricingRoute","productStructure",specification,"paperType","paperWeightGsm",quantity,pack,crafts,"frontFoilColors","backFoilColors","foilColors","foilTechnique","hasLocalFoil","isDoubleColor","actualWidthMm","actualHeightMm","unitPrice",subtotal,"suggestedSubtotal","pricingSnapshot","updatedAt")
        VALUES ($1,$2,1,1,'历史款式','STOCK_BLANK','STANDARD_ENVELOPE','大号封90×165','珠光艳闪',160,1000,10,ARRAY[$3]::text[],$4,ARRAY[]::text[],$4,'FLAT',true,$5,90,165,0.1,100,100,'{"version":1,"complete":true,"suggestedSubtotal":"100.00","source":"historical-fixture"}',NOW())`,
      [`${id}-item`, id, craft.id, colors, colors.length > 1]);
      await db.query(`INSERT INTO "OrderShipment" (id,"orderId",sequence,"receiverName","receiverPhone","receiverAddress","destinationProvince","carrierCode","updatedAt")
        VALUES ($1,$2,1,'测试收件人','13800138000','广东省佛山市测试路1号','广东','ZTO',NOW())`, [`${id}-shipment`, id]);
      await db.query(`INSERT INTO "OrderShipmentLine" (id,"shipmentId","orderItemId",quantity) VALUES ($1,$2,$3,1000)`, [`${id}-line`, `${id}-shipment`, `${id}-item`]);
      await db.query('COMMIT');
    } catch (error) {
      await db.query('ROLLBACK');
      throw error;
    }
  });
  return id;
}

async function facts(id: string) {
  return withDb(async (db) => (await db.query(`SELECT i.name,i.quantity,i."frontFoilColors",i."backFoilColors",i."foilColors",i."isDoubleSided",i."isDoubleColor",i."unitPrice"::text,i.subtotal::text,i."suggestedSubtotal"::text,i."pricingSnapshot",
    o."processingAmount"::text,o."totalAmount"::text,o."confirmedFee"::text,o."priceRevision",
    (SELECT count(*)::int FROM "OrderPricingRevision" WHERE "orderId"=o.id) AS "priceHistoryCount"
    FROM "OrderItem" i JOIN "Order" o ON o.id=i."orderId" WHERE o.id=$1`, [id])).rows[0]);
}

async function approve(page: Page, id: string) {
  await login(page, { username: E2E_USERS.owner.username, password: E2E_PASSWORD, from: `/orders/${id}` });
  await page.getByRole('button', { name: '批准变更', exact: true }).click();
  const dialog = page.getByRole('alertdialog');
  await expect(dialog).toContainText('款式');
  await dialog.getByRole('button', { name: '批准', exact: true }).click();
  await expect.poll(() => withDb(async (db) => (await db.query(
    `SELECT status FROM "OrderChangeRequest" WHERE "orderId"=$1 ORDER BY "createdAt" DESC LIMIT 1`, [id],
  )).rows[0]?.status)).toBe('APPROVED');
}

for (const colors of [['哑金'], ['哑金', '亚金']]) {
  test(`管理员编辑保留历史颜色 ${colors.join('、')} 与已存金额`, async ({ page }) => {
    const id = await seedHistoricalOrder(colors);
    const before = await facts(id);
    const errors: string[] = [];
    page.on('pageerror', (error) => errors.push(error.message));
    await login(page, { username: E2E_USERS.owner.username, password: E2E_PASSWORD, from: `/orders/${id}/edit` });
    const front = page.getByRole('group', { name: '第 1 款正面烫金', exact: true });
    await expect(front.getByRole('button', { name: '哑金', exact: true })).toHaveAttribute('aria-pressed', 'true');
    if (colors.length === 1) {
      await expect(front.getByRole('button', { name: '亚金', exact: true })).toHaveCount(0);
    } else {
      await expect(front.getByRole('button', { name: '亚金', exact: true })).toHaveAttribute('aria-pressed', 'true');
    }
    await page.getByRole('textbox', { name: '第 1 款名称', exact: true }).fill('管理员更正名称');
    await page.getByRole('button', { name: '保存修改…', exact: true }).tap();
    await page.getByRole('alertdialog').getByRole('button', { name: '保存修改', exact: true }).tap();
    await expect(page).toHaveURL(`/orders/${id}`);
    expect(await facts(id)).toEqual({ ...before, name: '管理员更正名称' });
    expect(errors).toEqual([]);
  });
}

test('外销改名申请经真实预览批准，历史颜色及价格不变', async ({ page, browser }) => {
  const id = await seedHistoricalOrder();
  const before = await facts(id);
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await login(page, { username: E2E_USERS.sales.username, password: E2E_PASSWORD, from: `/orders/${id}#change-request` });
  const section = page.locator('#change-request');
  await section.getByRole('checkbox', { name: '选择款式 1：历史款式' }).check();
  await section.getByRole('textbox', { name: '款式名称', exact: true }).fill('销售更正名称');
  await section.getByLabel('修改原因', { exact: true }).fill('核对客户名称');
  await section.getByRole('button', { name: /^提交修改申请/ }).click();
  await expect(page.getByRole('button', { name: '撤回申请', exact: true })).toBeVisible();
  const stored = await withDb(async (db) => (await db.query(`SELECT "proposedChanges" FROM "OrderChangeRequest" WHERE "orderId"=$1`, [id])).rows[0]);
  expect(stored.proposedChanges.items[0]).not.toHaveProperty('frontFoilColors');
  expect(await facts(id)).toEqual(before);
  const context = await browser.newContext();
  try {
    const adminPage = await context.newPage();
    adminPage.on('pageerror', (error) => errors.push(error.message));
    await approve(adminPage, id);
    expect(await facts(id)).toEqual({ ...before, name: '销售更正名称' });
    await page.reload();
    await expect(page.getByRole('button', { name: '撤回申请', exact: true })).toHaveCount(0);
    expect(errors).toEqual([]);
  } finally {
    await context.close();
  }
});

for (const echo of ['sides', 'aggregate'] as const) {
  test(`旧待审申请的 ${echo} 回显可预览批准且保留原申请记录`, async ({ page }) => {
    const id = await seedHistoricalOrder();
    const before = await facts(id);
    const requestId = `${id}-request`;
    const colors = ['哑金', '亚金'];
    const proposedChanges = { items: [{ operation: 'UPDATE', itemId: `${id}-item`, name: '旧申请更正名称', quantity: 1000,
      ...(echo === 'sides' ? { frontFoilColors: colors, backFoilColors: [] } : { foilColors: colors }) }] };
    await withDb((db) => db.query(`INSERT INTO "OrderChangeRequest" (id,"orderId","requesterId","baseRevision","baseWorkOrderVersion",type,"modifyKind",reason,"beforeSnapshot","proposedChanges","updatedAt")
      SELECT $2,id,"submitterId",revision,"workOrderVersion",'MODIFY','OTHER','升级前名称核对',$3::jsonb,$4::jsonb,NOW() FROM "Order" WHERE id=$1`,
    [id, requestId, JSON.stringify({ items: [before] }), JSON.stringify(proposedChanges)]));
    const errors: string[] = [];
    page.on('pageerror', (error) => errors.push(error.message));
    await approve(page, id);
    expect(await facts(id)).toEqual({ ...before, name: '旧申请更正名称' });
    const persisted = await withDb(async (db) => (await db.query(`SELECT "proposedChanges","beforeSnapshot" FROM "OrderChangeRequest" WHERE id=$1`, [requestId])).rows[0]);
    expect(persisted).toEqual({ proposedChanges, beforeSnapshot: { items: [before] } });
    expect(errors).toEqual([]);
  });
}

test('外销显式新增重复别名仍被拒绝，不创建待审申请', async ({ page }) => {
  const id = await seedHistoricalOrder(['哑金']);
  const before = await facts(id);
  await login(page, { username: E2E_USERS.sales.username, password: E2E_PASSWORD, from: `/orders/${id}#change-request` });
  const section = page.locator('#change-request');
  await section.getByRole('checkbox', { name: '选择款式 1：历史款式' }).check();
  await section.getByRole('textbox', { name: '正面烫金颜色（多个用顿号分隔）', exact: true }).fill('哑金、亚金');
  await section.getByLabel('修改原因', { exact: true }).fill('重复颜色回归');
  await section.getByRole('button', { name: /^提交修改申请/ }).click();
  await expect(section.getByRole('alert')).toContainText('同一面的烫金颜色不能重复');
  expect(await facts(id)).toEqual(before);
  expect(await withDb(async (db) => (await db.query(`SELECT count(*)::int AS count FROM "OrderChangeRequest" WHERE "orderId"=$1`, [id])).rows[0].count)).toBe(0);
});
