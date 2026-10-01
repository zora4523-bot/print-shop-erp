import sharp from 'sharp';
import { test, expect } from '@playwright/test';
import { Client } from 'pg';
import { randomUUID } from 'node:crypto';
import Decimal from 'decimal.js';
import {
  login,
  E2E_PASSWORD,
  E2E_USERS,
  getUserIdByUsername,
} from './_helpers';

test('管理员添加分货地址，预览不落库，保存后详情与费用一致，旧页面不能重复保存', async ({
  page,
  context,
  browser,
}) => {
  test.setTimeout(120_000);
  const client = new Client({ connectionString: process.env.DATABASE_URL });
  await client.connect();
  const id = `e2e-multi-address-${randomUUID()}`;
  const sales = await getUserIdByUsername(E2E_USERS.sales.username);
  const admin = await getUserIdByUsername(E2E_USERS.owner.username);
  try {
    const book = (
      await client.query(
        `SELECT id FROM "CustomerPriceBook" WHERE purpose='LOGISTICS' AND "settlementType"='EXTERNAL_SALES' AND "isActive" ORDER BY "effectiveFrom" DESC LIMIT 1`,
      )
    ).rows[0];
    expect(book, '开发库应有物流价目').toBeTruthy();
    await client.query('BEGIN');
    await client.query(
      `INSERT INTO "Order" (id,"orderNo","submitterId","submitterRole","createdById","settlementType",status,"customName","receiverName","receiverPhone","receiverAddress","processingAmount","totalAmount","updatedAt") VALUES ($1,$1,$2,'SALES',$2,'EXTERNAL_SALES','SUBMITTED','多地址回归工单','原收件人','13800138000','广东省佛山市测试路1号',100,130,NOW())`,
      [id, sales],
    );
    await client.query(
      `INSERT INTO "OrderItem" (id,"orderId",sequence,name,"pricingRoute","productStructure","paperType","paperWeightGsm",quantity,crafts,"foilTechnique","subtotal","updatedAt") VALUES ($1,$2,1,'分货测试款','STOCK_BLANK','STANDARD_ENVELOPE','珠光艳闪',160,1000,ARRAY[]::text[],'FLAT',100,NOW())`,
      [`${id}-item`, id],
    );
    await client.query(
      `INSERT INTO "OrderShipment" (id,"orderId",sequence,"receiverName","receiverPhone","receiverAddress","destinationProvince","carrierCode","updatedAt") VALUES ($1,$2,1,'原收件人','13800138000','广东省佛山市测试路1号','广东','ZTO',NOW())`,
      [`${id}-source`, id],
    );
    await client.query(
      `INSERT INTO "OrderShipmentLine" (id,"shipmentId","orderItemId",quantity) VALUES ($1,$2,$3,1000)`,
      [`${id}-line`, `${id}-source`, `${id}-item`],
    );
    for (const [code, amount] of [
      ['SHIPPING_FEE', '20'],
      ['PACKING_MATERIAL', '10'],
    ]) {
      await client.query(
        `INSERT INTO "OrderCustomerCharge" (id,"orderId","shipmentId","categoryId","priceBookId","businessKey",description,amount,"createdById","updatedAt") SELECT $1,$2,$3,c.id,$4,$5,c.name,$6,$7,NOW() FROM "CustomerChargeCategory" c WHERE code=$8`,
        [
          `${id}-${code}`,
          id,
          `${id}-source`,
          book.id,
          `SHIPMENT:1:${code}`,
          amount,
          admin,
          code,
        ],
      );
    }
    await client.query('UPDATE "Order" SET remark=$2 WHERE id=$1', [id, '先核对样稿\n再安排生产']);
    await client.query('COMMIT');
    const read = async () =>
      (
        await client.query(
          `SELECT "totalAmount"::text, "priceRevision", "editVersion", (SELECT count(*)::int FROM "OrderShipment" WHERE "orderId"=$1) AS count FROM "Order" WHERE id=$1`,
          [id],
        )
      ).rows[0];
    await login(page, {
      username: E2E_USERS.owner.username,
      password: E2E_PASSWORD,
      from: `/orders/${id}/edit`,
    });
    const stale = await context.newPage();
    await stale.goto(`/orders/${id}/edit`);
    const fill = async (target: typeof page) => {
      await target
        .getByRole('button', { name: '添加地址 2', exact: true })
        .click();
      const form = target.getByRole('region', { name: '添加收货地址' });
      await form.getByLabel('收件人', { exact: true }).fill('第二地址收件人');
      await form.getByLabel('收货电话', { exact: true }).fill('13900139000');
      await form
        .getByRole('textbox', { name: '收货地址', exact: true })
        .fill('江西省南昌市测试路2号');
      await form.getByLabel('计费省份').fill('江西');
      await form.getByRole('spinbutton').fill('400');
      await form.getByRole('button', { name: '预览费用' }).click();
      await expect(
        form.getByRole('button', { name: '保存地址' }),
      ).toBeVisible();
      return form;
    };
    const before = await read();
    const form = await fill(page);
    const staleForm = await fill(stale);
    expect(await read()).toEqual(before);
    await expect(form).toContainText('1000 → 600');
    await form.getByRole('button', { name: '保存地址' }).click();
    await expect.poll(async () => (await read()).count).toBe(2);
    await staleForm.getByRole('button', { name: '保存地址' }).click();
    await expect(staleForm.getByRole('alert')).toContainText('已变化');
    expect((await read()).count).toBe(2);
    const charges = (
      await client.query(
        `SELECT amount::text FROM "OrderCustomerCharge" WHERE "orderId"=$1`,
        [id],
      )
    ).rows;
    expect(charges).toHaveLength(4);
    const sum = charges.reduce(
      (sum, row) => sum.plus(row.amount),
      new Decimal(100),
    );
    expect((await read()).totalAmount).toBe(sum.toFixed(2));
    const allocations = (
      await client.query(
        `SELECT s.sequence,l.quantity FROM "OrderShipment" s JOIN "OrderShipmentLine" l ON l."shipmentId"=s.id WHERE s."orderId"=$1 ORDER BY s.sequence`,
        [id],
      )
    ).rows;
    expect(allocations).toEqual([
      { sequence: 1, quantity: 600 },
      { sequence: 2, quantity: 400 },
    ]);
    await page.goto(`/orders/${id}`);
    await expect(
      page
        .locator('#detail-delivery-records')
        .getByText('江西省南昌市测试路2号', { exact: false }),
    ).toBeVisible();
    await expect(page.locator('#detail-delivery-records')).toContainText(
      '第二地址收件人',
    );
    await expect(page.locator('[data-slot="order-remark"]')).toContainText('先核对样稿\n再安排生产');
    await page.goto(`/orders/${id}/edit`);
    await expect(page.getByRole('textbox', { name: /工单备注/ })).toHaveValue('先核对样稿\n再安排生产');
    const salesContext = await browser.newContext({ baseURL: new URL(page.url()).origin });
    try {
      const salesPage = await salesContext.newPage();
      await login(salesPage, { username: E2E_USERS.sales.username, password: E2E_PASSWORD, from: `/orders/${id}` });
      await expect(salesPage.getByRole('heading', { name: '发货与收货（2）' })).toBeVisible();
      await expect(salesPage.getByText('江西省南昌市测试路2号', { exact: true })).toBeVisible();
      await expect(salesPage.getByText('第二地址收件人', { exact: false })).toHaveCount(1);
      await expect(salesPage.getByText(/地址 2 ·/).first()).toBeVisible();
      await expect(salesPage.locator('[data-slot="order-remark"]')).toContainText('先核对样稿');
      await expect(salesPage.locator('[data-slot="admin-route-error"]')).toHaveCount(0);
    } finally { await salesContext.close(); }
    await stale.close();
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    await client.end();
  }
});

test('外部销售建单页添加地址并纳入报价和提交复核', async ({ page }) => {
  test.setTimeout(90_000);
  await login(page, {
    username: E2E_USERS.sales.username,
    password: E2E_PASSWORD,
    from: '/orders/new',
  });
  await page
    .getByRole('textbox', { name: '工单名称', exact: true })
    .fill(`E2E 多地址建单 ${randomUUID()}`);
  const form = page.locator('[data-slot="order-form-b"]');
  const note = '先核对样稿\n再安排生产';
  await form.getByRole('textbox', { name: '工单备注', exact: true }).fill(note);
  await expect.poll(() => page.evaluate(() => Object.values(localStorage).some((value) => typeof value === 'string' && value.includes('先核对样稿')))).toBe(true);
  await page.reload();
  await expect(form.getByRole('textbox', { name: '工单备注', exact: true })).toHaveValue(note);

  await form
    .getByRole('group', { name: '工单类型' })
    .getByRole('button', { name: '局部烫金', exact: true })
    .click();
  await form
    .getByRole('group', { name: '纸张材质' })
    .getByRole('button', { name: '艳红珠光纸', exact: true })
    .click();
  await form
    .getByRole('group', { name: '规格' })
    .getByRole('button', { name: '大号封', exact: true })
    .click();
  await form
    .getByRole('group', { name: '克重' })
    .getByRole('button', { name: '160g', exact: true })
    .click();
  await form
    .getByRole('spinbutton', { name: '数量', exact: true })
    .fill('1000');
  await form
    .getByRole('spinbutton', { name: '每包数量', exact: true })
    .fill('10');
  await form
    .getByRole('textbox', { name: '收货地址', exact: true })
    .fill('原收件人 13800138000 广东省佛山市南海区测试路1号');
  await form.getByRole('button', { name: '添加地址 2', exact: true }).click();
  const extra = form.getByRole('group', { name: '多地址发货', exact: true });
  await extra
    .getByLabel('详细地址')
    .fill('第二收件人 13900139000 江西省南昌市测试路2号');
  await extra.getByRole('spinbutton').fill('400');
  await expect(extra.getByLabel('联系电话')).toHaveValue('13900139000');
  await expect(
    page.getByText('快递费 中通 · 2 个地址', { exact: false }),
  ).toBeVisible();
  await form.locator('input[type="file"]').first().setInputFiles({ name: 'design.png', mimeType: 'image/png', buffer: await sharp({ create: { width: 64, height: 64, channels: 3, background: 'white' } }).png().toBuffer() });
  await extra.getByLabel('联系电话').fill('');
  await page.getByRole('button', { name: /^(创建并提交|提交并申请管理员终价)$/ }).click();
  await expect(extra.getByLabel('联系电话')).toHaveAttribute('aria-invalid', 'true');
  await expect(extra.getByText('请填写联系电话', { exact: true })).toBeVisible();
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await extra.getByLabel('联系电话').fill('13900139000');
  await page.getByRole('button', { name: /^(创建并提交|提交并申请管理员终价)$/ }).click();
  const review = page.getByRole('dialog');
  await expect(review).toContainText('江西省南昌市测试路2号');
  await expect(review.getByRole('region', { name: '工单备注', exact: true })).toContainText(note);
  await expect(review).toContainText('地址 1 · 600 件');
  await expect(review).toContainText('地址 2 · 400 件');
  await review.getByRole('button', { name: '返回修改', exact: true }).click();
  await expect(extra.getByRole('spinbutton')).toHaveValue('400');
});
