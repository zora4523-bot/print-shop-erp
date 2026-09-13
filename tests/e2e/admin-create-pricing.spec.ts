import { expect, test } from '@playwright/test';
import { Client } from 'pg';
import sharp from 'sharp';
import { E2E_PASSWORD, E2E_USERS, login } from './_helpers';

for (const behalf of [false, true]) {
  test(`管理员${behalf ? '代外部销售' : ''}建单保留人工价格并校验改量`, async ({
    page,
  }) => {
    test.setTimeout(120_000);
    const errors: string[] = [];
    page.on('pageerror', (error) => errors.push(error.message));
    await login(page, {
      from: '/orders/new',
      username: E2E_USERS.owner.username,
      password: E2E_PASSWORD,
    });
    if (behalf)
      await page
        .getByLabel('关联外部销售')
        .selectOption({ label: 'E2E 销售 · e2e-sales' });
    await page
      .getByRole('textbox', { name: '工单名称', exact: true })
      .fill(`人工定价验证 ${Date.now()}`);
    await page
      .getByRole('textbox', { name: '收货地址', exact: true })
      .fill('张先生 13800138000 广东省佛山市南海区测试路1号');
    const processing = page.getByRole('group', {
      name: '款式加工费',
      exact: true,
    });
    await processing
      .getByRole('button', { name: '人工定价', exact: true })
      .click();
    await processing.getByLabel('本款加工费（元）').fill('123.45');
    await processing.getByLabel('定价原因').fill('客户协议加工价');
    const packaging = page.getByRole('group', {
      name: '包装组 1 单价',
      exact: true,
    });
    await packaging
      .getByRole('button', { name: '人工定价', exact: true })
      .click();
    await packaging.getByLabel('包装单价（元 / 袋）').fill('0');
    await packaging.getByLabel('定价原因').fill('本次免入袋费');
    await page
      .getByRole('spinbutton', { name: '数量', exact: true })
      .fill('101');
    await expect(
      processing.getByRole('button', { name: '确认当前人工价格' }),
    ).toBeVisible();
    await processing.getByRole('button', { name: '确认当前人工价格' }).click();
    await packaging.getByRole('button', { name: '确认当前人工价格' }).click();
    await page.getByRole('button', { name: '保存草稿', exact: true }).click();
    await page.waitForURL(/\/orders\/(?!new\b)[a-z0-9]+$/, { timeout: 45_000 });
    const db = new Client({ connectionString: process.env.DATABASE_URL });
    await db.connect();
    try {
      const id = page.url().split('/').pop();
      if (behalf) {
        const png = await sharp({
          create: { width: 64, height: 64, channels: 3, background: 'white' },
        })
          .png()
          .toBuffer();
        await db.query(
          `INSERT INTO "OrderItemDesign" (id,"orderItemId","fileType","fileUrl","fileName","fileSize","uploadedBy")
            SELECT $1,i.id,'IMAGE',$2,'fixture.png',200,o."createdById" FROM "OrderItem" i JOIN "Order" o ON o.id=i."orderId" WHERE o.id=$3`,
          [
            crypto.randomUUID(),
            `data:image/png;base64,${png.toString('base64')}`,
            id,
          ],
        );
        await page.goto(`/orders/${id}`);
        await page
          .getByRole('button', { name: '提交工单', exact: true })
          .click();
        await page
          .getByRole('button', { name: '确认最新报价并提交', exact: true })
          .click();
        await expect
          .poll(
            async () =>
              (await db.query('SELECT status FROM "Order" WHERE id=$1', [id]))
                .rows[0].status,
          )
          .not.toBe('DRAFT');
      }
      const item = (
        await db.query(
          'SELECT subtotal::text,"pricingSnapshot" FROM "OrderItem" WHERE "orderId"=$1',
          [id],
        )
      ).rows[0];
      expect(item.subtotal).toBe('123.45');
      expect(item.pricingSnapshot.source).toBe('ADMIN_SNAPSHOT_CONFIRMATION');
      const group = (
        await db.query(
          'SELECT subtotal::text,"pricingSnapshot" FROM "OrderPackagingGroup" WHERE "orderId"=$1',
          [id],
        )
      ).rows[0];
      expect(group.subtotal).toBe('0.00');
      expect(group.pricingSnapshot.source).toBe('ADMIN_SNAPSHOT_CONFIRMATION');
    } finally {
      await db.end();
    }
    expect(errors).toEqual([]);
  });
}

test('外部销售建单不显示工厂人工定价入口', async ({ page }) => {
  await login(page, {
    from: '/orders/new',
    username: E2E_USERS.sales.username,
    password: E2E_PASSWORD,
  });
  await expect(
    page.getByRole('group', { name: '包装类型', exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole('button', { name: '人工定价', exact: true }),
  ).toHaveCount(0);
});
