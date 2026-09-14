import { expect, test } from '@playwright/test';
import { Client } from 'pg';
import sharp from 'sharp';
import { E2E_PASSWORD, E2E_USERS, login } from './_helpers';

for (const actor of ['owner', 'sales'] as const) {
  for (const variant of [
    { label: '不包装', mode: 'UNPACKED', count: 0, amount: '0.00' },
    { label: '红卡盒', mode: 'BOX_RED_CARD', count: 11, amount: '19.80' },
    { label: '触感盒', mode: 'BOX_TACTILE', count: 13, amount: '29.90' },
  ]) {
    test(`${actor}: ${variant.label} defaults, switches, restores and saves authoritative packaging`, async ({
      page,
    }) => {
      test.setTimeout(150_000);
      const errors: string[] = [];
      page.on('pageerror', (error) => errors.push(error.message));
      // Packaging E2E uses a database artwork fixture, matching blank-paper-pricing.
      // Object-storage connectivity is a separate integration boundary.
      if (actor === 'sales')
        await page.route(
          (url) => url.hostname.endsWith('.aliyuncs.com'),
          (route) =>
            route.request().method() === 'PUT' ? route.abort('failed') : route.continue(),
        );
      await login(page, {
        from: '/orders/new',
        username: E2E_USERS[actor].username,
        password: E2E_PASSWORD,
      });
      const type = page.getByRole('group', { name: '包装类型', exact: true });
      await expect(type.getByRole('button', { name: '入袋', exact: true })).toHaveAttribute(
        'aria-pressed',
        'true',
      );
      const orderName = `包装验证 ${actor} ${variant.label} ${Date.now()}`;
      await page.getByRole('textbox', { name: '工单名称', exact: true }).fill(orderName);
      await page.getByRole('spinbutton', { name: '数量', exact: true }).fill('101');
      await type
        .getByRole('button', { name: variant.mode === 'UNPACKED' ? '不包装' : '装盒', exact: true })
        .click();
      if (variant.mode === 'UNPACKED') {
        await expect(page.getByRole('spinbutton', { name: '每包数量', exact: true })).toHaveCount(
          0,
        );
        await expect(page.getByText('包装费 ¥0.00', { exact: true })).toBeVisible();
      } else {
        if (variant.mode === 'BOX_TACTILE')
          await page.getByRole('button', { name: /触感盒子 250g/ }).click();
        const perBox = page.getByRole('spinbutton', { name: '每盒数量', exact: true });
        await expect(perBox).toHaveAttribute('max', variant.mode === 'BOX_TACTILE' ? '8' : '10');
        await expect(perBox).toHaveValue(variant.mode === 'BOX_TACTILE' ? '8' : '10');
      }
      await page
        .getByRole('textbox', { name: '收货地址', exact: true })
        .fill('张先生 13800138000 广东省佛山市南海区包装测试路1号');
      await expect
        .poll(() =>
          page.evaluate(
            (mode) =>
              Object.entries(localStorage).some(
                ([key, value]) => key.includes('order') && value.includes(mode),
              ),
            variant.mode,
          ),
        )
        .toBe(true);
      await page.reload();
      if (actor === 'owner') await page.getByRole('button', { name: /恢复.*草稿/ }).click();
      await expect(
        type.getByRole('button', {
          name: variant.mode === 'UNPACKED' ? '不包装' : '装盒',
          exact: true,
        }),
      ).toHaveAttribute('aria-pressed', 'true');
      if (actor === 'owner') {
        const save = page.getByRole('button', { name: '保存草稿', exact: true });
        await expect(save).toBeEnabled({ timeout: 30_000 });
        await save.click();
        await page.waitForURL(/\/orders\/(?!new\b)[a-z0-9]+$/, { timeout: 45_000 });
      } else {
        await page
          .locator('input[type="file"]')
          .first()
          .setInputFiles({
            name: 'packaging-test.png',
            mimeType: 'image/png',
            buffer: await sharp({
              create: { width: 64, height: 64, channels: 3, background: 'white' },
            })
              .png()
              .toBuffer(),
          });
        await page.getByRole('button', { name: /^(创建并提交|提交并申请管理员终价)$/ }).click();
        await page
          .getByRole('dialog')
          .getByRole('button', { name: /^(确认提交并申请核价|确认无误，提交)$/ })
          .click();
      }
      const db = new Client({ connectionString: process.env.DATABASE_URL });
      await db.connect();
      let id = '';
      await expect
        .poll(
          async () => {
            const result = await db.query('SELECT id FROM "Order" WHERE "customName"=$1', [
              orderName,
            ]);
            id = result.rows[0]?.id ?? '';
            return id;
          },
          { timeout: 30_000 },
        )
        .not.toBe('');
      try {
        if (actor === 'sales') {
          await expect(
            page.getByRole('dialog').getByRole('button', { name: '继续完成', exact: true }),
          ).toBeVisible();
          const png = await sharp({
            create: { width: 64, height: 64, channels: 3, background: 'white' },
          })
            .png()
            .toBuffer();
          await db.query(
            `INSERT INTO "OrderItemDesign" (id,"orderItemId","fileType","fileUrl","fileName","fileSize","uploadedBy")
            SELECT $1,i.id,'IMAGE',$2,'fixture.png',200,o."createdById" FROM "OrderItem" i JOIN "Order" o ON o.id=i."orderId" WHERE o.id=$3`,
            [crypto.randomUUID(), `data:image/png;base64,${png.toString('base64')}`, id],
          );
          await page.goto(`/orders/${id}`);
          await page.getByRole('button', { name: '提交工单', exact: true }).click();
          const latest = page.getByRole('button', { name: '确认最新报价并提交', exact: true });
          const status = async () =>
            (await db.query('SELECT status FROM "Order" WHERE id=$1', [id])).rows[0].status;
          await expect
            .poll(async () => ((await latest.isVisible()) ? 'confirm' : await status()))
            .not.toBe('DRAFT');
          if (await latest.isVisible()) await latest.click();
          await expect.poll(status).not.toBe('DRAFT');
        }
        const groups = await db.query(
          'SELECT mode,"actualBagCount",subtotal::text,"unitPrice"::text,"pricingSnapshot" FROM "OrderPackagingGroup" WHERE "orderId"=$1',
          [id],
        );
        expect(groups.rows).toHaveLength(1);
        expect(groups.rows[0]).toMatchObject({
          mode: variant.mode,
          actualBagCount: variant.count,
          subtotal: variant.amount,
        });
        expect(groups.rows[0].pricingSnapshot.line.basis.mode).toBe(variant.mode);
        if (variant.mode !== 'UNPACKED') {
          expect(groups.rows[0].pricingSnapshot.line.basis.packingRate).toBe('0.5000');
          expect(groups.rows[0].pricingSnapshot.line.code).toBe('BOX_PACKAGING');
        }
      } finally {
        await db.end();
      }
      if (actor === 'sales') await page.goto(`/orders/${id}`);
      await expect(
        page
          .getByText(
            variant.mode === 'UNPACKED'
              ? '不包装'
              : variant.mode === 'BOX_TACTILE'
                ? '触感盒子 250g'
                : '红卡盒子 230g',
            { exact: false },
          )
          .first(),
      ).toBeVisible({ timeout: 20_000 });
      expect(errors).toEqual([]);
    });
  }
}

test('管理员多地址装盒分别进位，保存两盒而非一盒', async ({page}) => {
  // 与同文件其它装盒用例一致：CI 的 2 核 runner 上登录 + 报价 + 保存跳转超过默认 30 秒。
  test.setTimeout(150_000);
  await login(page, {from: '/orders/new', username: E2E_USERS.owner.username, password: E2E_PASSWORD});
  await page.getByRole('textbox', {name: '工单名称', exact: true}).fill('分址装盒验证');
  await page.getByRole('spinbutton', {name: '数量', exact: true}).fill('10');
  await page.getByRole('group', {name: '包装类型', exact: true}).getByRole('button', {name: '装盒', exact: true}).click();
  await page.getByRole('textbox', {name: '收货地址', exact: true}).fill('张先生 13800138000 广东省佛山市南海区测试路1号');
  await page.getByRole('button', {name: '添加地址 2', exact: true}).click();
  const extra = page.getByRole('group', {name: '多地址发货', exact: true});
  await extra.getByLabel('详细地址').fill('李先生 13900139000 江西省南昌市测试路2号');
  await extra.getByRole('spinbutton').fill('5');
  await expect(page.getByText('共 2 盒', {exact: true})).toBeVisible();
  await page.getByRole('button', {name: '保存草稿', exact: true}).click();
  await page.waitForURL(/\/orders\/(?!new\b)[a-z0-9]+$/);
  const db = new Client({connectionString: process.env.DATABASE_URL});
  await db.connect();
  try {
    const id = page.url().split('/').pop();
    const result = await db.query('SELECT mode,"actualBagCount",subtotal::text FROM "OrderPackagingGroup" WHERE "orderId"=$1', [id]);
    expect(result.rows).toEqual([{mode: 'BOX_RED_CARD', actualBagCount: 2, subtotal: '3.60'}]);
  } finally { await db.end(); }
});
