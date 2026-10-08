import { expect, test } from '@playwright/test';
import { Client } from 'pg';
import sharp from 'sharp';
import { E2E_PASSWORD, E2E_USERS, login, selectExternalSalesForAdminOrder } from './_helpers';

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
      // 业主 2026-09-24：管理员建单必须归属一个外部销售。
      if (actor === 'owner') await selectExternalSalesForAdminOrder(page);
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
      if (variant.mode === 'BOX_TACTILE') {
        const viewport = page.viewportSize()!;
        await page.evaluate(() => { document.documentElement.style.fontSize = '200%'; });
        try {
          for (const width of [viewport.width, 390, 320]) {
            await page.setViewportSize({ width, height: viewport.height });
            await expect.poll(() => page.evaluate(() => ({
              fits: document.documentElement.scrollWidth <= window.innerWidth + 1,
              overflowing: [...document.querySelectorAll('body *')].flatMap((element) => {
                const rect = element.getBoundingClientRect();
                return rect.width > 0 && rect.right > window.innerWidth + 1
                  ? [{ tag: element.tagName, slot: element.getAttribute('data-slot'), className: element.className, right: rect.right }]
                  : [];
              }).slice(-12),
            })), { message: `${actor}: 200% text at ${width}px must fit` }).toMatchObject({ fits: true });
            const designName = page.getByRole('textbox', { name: '设计款名称', exact: true });
            expect((await designName.boundingBox())!.width).toBeGreaterThan(100);
            const perBox = page.getByRole('spinbutton', { name: '每盒数量', exact: true });
            await perBox.fill('7');
            await expect(perBox).toHaveValue('7');
            await perBox.fill('8');
            await expect(perBox).toHaveValue('8');
            // 滚动到费用区域，确保延迟渲染的页面末尾也接受溢出检查。
            await page.locator('[data-slot="order-form-rail"]').scrollIntoViewIfNeeded();
            await expect.poll(() => page.evaluate(
              () => document.documentElement.scrollWidth <= window.innerWidth + 1,
            ), { message: `${actor}: price rail at 200% / ${width}px must fit` }).toBe(true);
            if (width === 320) {
              for (const trigger of [
                page.getByRole('button', { name: '切换界面主题', exact: true }),
                page.getByRole('button', { name: /^用户菜单：/ }),
              ]) {
                await trigger.focus();
                await page.keyboard.press('Enter');
                const menu = page.getByRole('menu');
                await expect(menu).toBeVisible();
                await expect.poll(async () => {
                  const box = await menu.boundingBox();
                  return !!box && box.x >= 0 && box.x + box.width <= width + 1;
                }).toBe(true);
                await page.keyboard.press('Escape');
                await expect(menu).toBeHidden();
                await expect(trigger).toBeFocused();
              }
              const navigation = page.getByRole('button', { name: '打开/关闭侧边栏菜单', exact: true });
              await navigation.focus();
              await page.keyboard.press('Space');
              const drawer = page.getByRole('dialog');
              await expect(drawer).toBeVisible();
              await expect.poll(async () => {
                const box = await drawer.boundingBox();
                return !!box && box.x >= 0 && box.x + box.width <= width + 1;
              }).toBe(true);
              await page.keyboard.press('Escape');
              await expect(drawer).toBeHidden();
              await expect(navigation).toBeFocused();
            }
          }
        } finally {
          await page.evaluate(() => { document.documentElement.style.fontSize = ''; });
          await page.setViewportSize(viewport);
        }
      }
      const receiverAddress = '张先生 13800138000 广东省佛山市南海区包装测试路1号';
      await page
        .getByRole('textbox', { name: '收货地址', exact: true })
        .fill(receiverAddress);
      await expect
        .poll(() =>
          page.evaluate(
            ({ mode, address }) =>
              Object.entries(localStorage).some(
                ([key, value]) => key.includes('order') && value.includes(mode) && value.includes(address),
              ),
            { mode: variant.mode, address: receiverAddress },
          ),
        )
        .toBe(true);
      await page.reload();
      // 外部销售自动恢复本地草稿；管理员须在恢复/放弃提示里明确选择。
      if (actor === 'owner') await page.getByRole('button', { name: /恢复.*草稿/ }).click();
      await expect(page.getByRole('textbox', { name: '收货地址', exact: true })).toHaveValue(receiverAddress);
      await expect(
        type.getByRole('button', {
          name: variant.mode === 'UNPACKED' ? '不包装' : '装盒',
          exact: true,
        }),
      ).toHaveAttribute('aria-pressed', 'true');
      // 管理员代外部销售与销售本人一样，包装在提交时按权威价目定价。
      {
        if (actor === 'owner') await page.getByLabel('承诺交期', { exact: true }).fill('2099-01-01');
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
        {
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
      await page.goto(`/orders/${id}`);
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
  await selectExternalSalesForAdminOrder(page);
  await page.getByRole('textbox', {name: '工单名称', exact: true}).fill('分址装盒验证');
  // 显式选纸：全套 spec 共库时表单默认纸张会变成别的 spec 造的夹具纸（CI 第六轮选中了
  // blank-paper-pricing 的「验证纸…」，其 4 位小数单价让金额守卫拒绝保存）。
  await page.getByRole('group', {name: '纸张材质'}).getByRole('button', {name: '艳红珠光纸', exact: true}).click();
  await page.getByRole('group', {name: '克重'}).getByRole('button', {name: '160g', exact: true}).click();
  await page.getByRole('group', {name: '规格'}).getByRole('button', {name: '大号封', exact: true}).click();
  await page.getByRole('spinbutton', {name: '数量', exact: true}).fill('10');
  await page.getByRole('group', {name: '包装类型', exact: true}).getByRole('button', {name: '装盒', exact: true}).click();
  await page.getByRole('textbox', {name: '收货地址', exact: true}).fill('张先生 13800138000 广东省佛山市南海区测试路1号');
  await page.getByRole('button', {name: '添加地址 2', exact: true}).click();
  const extra = page.getByRole('group', {name: '多地址发货', exact: true});
  await extra.getByLabel('详细地址').fill('李先生 13900139000 江西省南昌市测试路2号');
  await extra.getByRole('spinbutton').fill('5');
  await expect(page.getByText('共 2 盒', {exact: true})).toBeVisible();
  const save = page.getByRole('button', {name: '保存草稿', exact: true});
  await expect(save).toBeEnabled({timeout: 30_000});
  await save.click();
  // CI 上两轮都在此处等跳转直到超时而本地秒过；失败时把页面上的错误提示与
  // 字段级校验信息带进错误信息，而不是只留一句 waitForURL 超时。
  await expect
    .poll(
      async () => {
        if (/\/orders\/(?!new\b)[a-z0-9]+$/.test(page.url())) return 'navigated';
        const notices = await page
          .locator('[role="alert"], [aria-invalid="true"], [data-slot="order-form-rail"] p')
          .allInnerTexts();
        return `still on ${page.url()}\n${notices.filter(Boolean).join('\n')}`;
      },
      {timeout: 60_000, message: '保存草稿后应跳转到工单详情'},
    )
    .toBe('navigated');
  const db = new Client({connectionString: process.env.DATABASE_URL});
  await db.connect();
  try {
    const id = page.url().split('/').pop();
    const result = await db.query('SELECT mode,"actualBagCount",subtotal::text FROM "OrderPackagingGroup" WHERE "orderId"=$1', [id]);
    // 代外部销售的草稿在提交时才定价；这里核对分址各自进位后的盒数。
    expect(result.rows).toHaveLength(1);
    expect(result.rows[0]).toMatchObject({mode: 'BOX_RED_CARD', actualBagCount: 2});
  } finally { await db.end(); }
});
