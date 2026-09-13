import { randomUUID } from 'node:crypto';
import { Client } from 'pg';
import { test, expect } from '@playwright/test';
import { E2E_USERS, E2E_PASSWORD, getUserIdByUsername, login, productionOperationE2eIsolationFailure } from './_helpers';

for (const role of ['CUSTOMER_SERVICE', 'SALES'] as const) {
test(`${role === 'SALES' ? '业务员' : '客服'}新增配送地址并申请每袋数量，内部备注可由管理员复核`, async ({ page, browser }) => {
  test.skip(Boolean(productionOperationE2eIsolationFailure()), productionOperationE2eIsolationFailure() ?? '');
  test.setTimeout(120000);
  const client = new Client({ connectionString: process.env.DATABASE_URL });
  await client.connect();
  const id = `e2e-field-repair-${randomUUID()}`;
  const username = role === 'SALES' ? E2E_USERS.sales.username : E2E_USERS.customerService.username;
  const owner = await getUserIdByUsername(username);
  try {
    await client.query('BEGIN');
    await client.query(`INSERT INTO "Order" (id,"orderNo","submitterId","submitterRole","createdById","settlementType",status,"customName","receiverName","receiverPhone","receiverAddress","updatedAt") VALUES ($1,$1,$2,$3,$2,$4,'DRAFT','字段修复回归','原收件人','13800138000','广东省佛山市测试路1号',NOW())`, [id, owner, role, role === 'SALES' ? 'EXTERNAL_SALES' : 'INTERNAL_SALES']);
    await client.query(`INSERT INTO "OrderItem" (id,"orderId",sequence,name,"pricingRoute","productStructure","paperType","paperWeightGsm",quantity,pack,crafts,"frontFoilColors","foilColors","foilTechnique",remark,"updatedAt") VALUES ($1,$2,1,'红包','STOCK_BLANK','STANDARD_ENVELOPE','珠光艳闪',160,1000,10,ARRAY[]::text[],ARRAY['亚金'],ARRAY['亚金'],'FLAT','原款式备注',NOW())`, [`${id}-item`, id]);
    const product = (await client.query(`SELECT id,specification,"paperType" FROM "Product" WHERE "isActive" AND category='BLANK_STOCK' AND specification LIKE '%90%' AND "paperType" LIKE '%160%' ORDER BY code LIMIT 1`)).rows[0];
    const craft = (await client.query(`SELECT id FROM "Craft" WHERE code='FLAT_FOIL_PARTIAL' AND "isActive" LIMIT 1`)).rows[0];
    expect(product).toBeTruthy();
    expect(craft).toBeTruthy();
    await client.query(`UPDATE "OrderItem" SET fig=1,"productId"=$2,specification=$3,"paperType"=$4,"pricingGroup"='LARGE',"actualWidthMm"=90,"actualHeightMm"=165,crafts=ARRAY[$5]::text[],"hasLocalFoil"=true WHERE "orderId"=$1`, [id, product.id, product.specification, product.paperType, craft.id]);
    await client.query(`INSERT INTO "OrderPackagingGroup" (id,"orderId",sequence,mode,"actualBagCount","updatedAt") VALUES ($1,$2,1,'SINGLE_STYLE',100,NOW())`, [`${id}-group`, id]);
    await client.query(`INSERT INTO "OrderPackagingGroupLine" (id,"orderId","packagingGroupId","orderItemId","unitsPerBag") VALUES ($1,$2,$3,$4,10)`, [`${id}-group-line`, id, `${id}-group`, `${id}-item`]);
    await client.query(`INSERT INTO "OrderShipment" (id,"orderId",sequence,"receiverName","receiverPhone","receiverAddress","destinationProvince","carrierCode","updatedAt") VALUES ($1,$2,1,'原收件人','13800138000','广东省佛山市测试路1号','广东','ZTO',NOW())`, [`${id}-shipment`, id]);
    await client.query(`INSERT INTO "OrderShipmentLine" (id,"shipmentId","orderItemId",quantity) VALUES ($1,$2,$3,1000)`, [`${id}-line`, `${id}-shipment`, `${id}-item`]);
    await client.query('COMMIT');
    await login(page, { username, password: E2E_PASSWORD, from: `/orders/${id}/edit` });
    if (role === 'CUSTOMER_SERVICE') {
      await page.getByLabel('第 1 款备注', { exact: true }).fill('检查方向\n新版备注');
      await page.getByRole('button', { name: '保存款式备注', exact: true }).click();
      await expect.poll(async () => (await client.query('SELECT remark FROM "OrderItem" WHERE id=$1', [`${id}-item`])).rows[0].remark).toBe('检查方向\n新版备注');
      const admin = await browser.newContext();
      try {
        const adminPage = await admin.newPage();
        await login(adminPage, { username: E2E_USERS.owner.username, password: E2E_PASSWORD, from: `/orders/${id}/edit` });
        await expect(adminPage.getByLabel('第 1 款备注', { exact: true })).toHaveValue('检查方向\n新版备注');
      } finally { await admin.close(); }
    }
    await page.reload();
    await page.getByRole('button', { name: '添加地址 2', exact: true }).click();
    const region = page.getByRole('region', { name: '添加收货地址' });
    await region.getByLabel('收件人', { exact: true }).fill('第二收件人');
    await region.getByLabel('收货电话', { exact: true }).fill('13900139000');
    await region.getByLabel('收货地址', { exact: true }).fill('江西省南昌市测试路2号');
    await region.getByLabel('计费省份', { exact: true }).fill('江西');
    await region.getByRole('spinbutton').fill('400');
    await region.getByRole('button', { name: '预览费用', exact: true }).click();
    expect((await client.query('SELECT count(*)::int AS count FROM "OrderShipment" WHERE "orderId"=$1', [id])).rows[0].count).toBe(1);
    await region.getByRole('button', { name: '保存地址' }).click();
    await expect.poll(async () => (await client.query('SELECT count(*)::int AS count FROM "OrderShipment" WHERE "orderId"=$1', [id])).rows[0].count).toBe(2);
    await expect(page.getByRole('button', { name: '添加地址 3', exact: true })).toBeVisible();
    await page.reload();
    await page.getByRole('checkbox', { name: '选择款式 1：红包' }).check();
    await page.getByLabel('每袋数量', { exact: true }).fill('20');
    // UI-to-command coverage: no approval is executed by this fixture.
    await page.getByLabel('修改原因', { exact: true }).fill('调整包装数量');
    await page.getByRole('button', { name: '提交修改申请' }).click();
    await expect(page.getByRole('status', { name: role === 'SALES' ? '存在待审批申请' : '修改申请待处理', exact: true })).toBeVisible();
    await expect.poll(async () => (await client.query('SELECT count(*)::int AS count FROM "OrderChangeRequest" WHERE "orderId"=$1 AND status=\'PENDING\'', [id])).rows[0].count).toBe(1);
    expect((await client.query('SELECT pack FROM "OrderItem" WHERE id=$1', [`${id}-item`])).rows[0].pack).toBe(10);
  } finally {
    await client.query('ROLLBACK');
    await client.query('DELETE FROM "Order" WHERE id=$1', [id]);
    await client.end();
  }
});

}
