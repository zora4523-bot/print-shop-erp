import { expect, test, type Locator, type Page } from '@playwright/test';
import sharp from 'sharp';
import { E2E_PASSWORD, E2E_USERS, login, withDb } from './_helpers';

async function choose(page: Page, group: string, label: string) {
  await page.getByRole('group', { name: group, exact: true })
    .getByRole('button', { name: label, exact: true }).click({ timeout: 10_000 });
}

async function expectFee(rail: Locator, label: string | RegExp, amount: string) {
  await expect(rail.locator('dt').filter({ hasText: label }).locator('..').locator('dd'))
    .toContainText(`¥ ${amount}`, { timeout: 30_000 });
}

async function startQuote(page: Page, actor: 'owner' | 'sales') {
  await login(page, {
    from: '/orders/new', username: E2E_USERS[actor].username, password: E2E_PASSWORD,
  });
  await page.getByRole('textbox', { name: '工单名称', exact: true })
    .fill(`自动报价审查 ${actor} ${Date.now()}`);
  await page.getByRole('textbox', { name: '收货地址', exact: true })
    .fill('张先生 13800138000 广东省佛山市南海区测试路1号');
  await page.getByRole('checkbox', { name: /顺丰到付/ }).check({ timeout: 10_000 });
  await choose(page, '纸张材质', '艳红珠光纸');
  await choose(page, '规格', '大号封');
  return page.locator('[data-slot="order-form-rail"]');
}

for (const actor of ['owner', 'sales'] as const) {
  test(`${actor}: automatic prices match confirmed amounts across all three routes`, async ({ page }) => {
    test.setTimeout(120_000);
    const errors: string[] = [];
    page.on('pageerror', (error) => errors.push(error.message));
    const rail = await startQuote(page, actor);
    const quantity = page.getByRole('spinbutton', { name: '数量', exact: true });
    await choose(page, '纸张材质', '红卡纸');
    await choose(page, '克重', '180g');
    await choose(page, '规格', '中号封');
    await quantity.fill('999');
    await expectFee(rail, /^空白封$/, '134.87');
    await expectFee(rail, /^机烫费$/, '40.00');
    // Cross a rounding boundary, then edit faster than the quote debounce.
    await quantity.fill('1000');
    await expectFee(rail, /^空白封$/, '135.00');
    await quantity.fill('1500');
    await quantity.fill('1999');
    await quantity.fill('2000');
    await expectFee(rail, /^空白封$/, '270.00');
    await expectFee(rail, /^机烫费$/, '80.00');
    await expectFee(rail, /^入袋 /, '20.00');
    await expectFee(rail, /纸箱耗材/, '5.00');
    await expectFee(rail, /快递费/, '0.00');

    await choose(page, '工单类型', '专版烫金');
    await choose(page, '纸张材质', '艳红珠光纸');
    await choose(page, '规格', '大号封');
    await quantity.fill('1000');
    await expectFee(rail, /^专版烫金阶梯价$/, '325.00');
    await expect(rail.getByText('空白封', { exact: true })).toHaveCount(0);

    await choose(page, '工单类型', '彩印');
    await choose(page, '纸张材质', '铜版纸');
    await choose(page, '克重', '200g');
    await choose(page, '规格', '大号 88×165');
    await choose(page, '覆膜', '亚膜');
    await expectFee(rail, /^彩印阶梯总价$/, '310.00');
    await quantity.fill('2000');
    await expectFee(rail, /^彩印阶梯总价$/, '450.00');

    await choose(page, '工单类型', '局部烫金');
    await choose(page, '纸张材质', '红卡纸');
    await choose(page, '克重', '180g');
    await choose(page, '规格', '中号封');
    await expectFee(rail, /^空白封$/, '270.00');
    await expect(rail.getByText('当前合计', { exact: true }).locator('..'))
      .toContainText('¥ 375.00');
    const name = await page.getByRole('textbox', { name: '工单名称', exact: true }).inputValue();
    const png = await sharp({ create: { width: 64, height: 64, channels: 3, background: 'white' } })
      .png().toBuffer();
    if (actor === 'owner') {
      await page.getByLabel('承诺交期', { exact: true }).fill('2099-01-01');
    } else {
      // Object storage is outside the pricing boundary. Use the established
      // saved-draft artwork fixture to exercise authoritative final submission.
      await page.route((url) => url.hostname.endsWith('.aliyuncs.com'), (route) =>
        route.request().method() === 'PUT' ? route.abort('failed') : route.continue());
      await page.locator('input[type="file"]').first().setInputFiles({
        name: 'quote.png', mimeType: 'image/png', buffer: png,
      });
    }
    await page.getByRole('button', { name: '创建并提交', exact: true }).click();
    const dialog = page.getByRole('dialog');
    await expect(dialog.getByRole('region', { name: '费用复核' })).toContainText('¥ 270.00');
    await dialog.getByRole('button', { name: '确认无误，提交', exact: true }).click();
    await withDb(async (db) => {
      let id = '';
      await expect.poll(async () => {
        id = (await db.query('SELECT id FROM "Order" WHERE "customName"=$1', [name])).rows[0]?.id ?? '';
        return id;
      }).not.toBe('');
      if (actor === 'sales') {
        await expect(page.getByRole('dialog').getByRole('button', { name: '继续完成', exact: true }))
          .toBeVisible();
        await db.query(
          `INSERT INTO "OrderItemDesign" (id,"orderItemId","fileType","fileUrl","fileName","fileSize","uploadedBy")
           SELECT $1,i.id,'IMAGE',$2,'quote.png',200,o."createdById" FROM "OrderItem" i
           JOIN "Order" o ON o.id=i."orderId" WHERE o.id=$3`,
          [crypto.randomUUID(), `data:image/png;base64,${png.toString('base64')}`, id],
        );
        await page.goto(`/orders/${id}`);
        await page.getByRole('button', { name: '提交工单', exact: true }).click();
        const latest = page.getByRole('button', { name: '确认最新报价并提交', exact: true });
        await expect.poll(async () => (await latest.isVisible()) ? 'confirm' :
          (await db.query('SELECT status FROM "Order" WHERE id=$1', [id])).rows[0].status).not.toBe('DRAFT');
        if (await latest.isVisible()) await latest.click();
      }
      await expect.poll(async () =>
        (await db.query('SELECT status FROM "Order" WHERE id=$1', [id])).rows[0].status).not.toBe('DRAFT');
      const order = (await db.query('SELECT "quotedFee"::text FROM "Order" WHERE id=$1', [id])).rows[0];
      expect(order.quotedFee).toBe('375.00');
      const items = (await db.query('SELECT "productId",quantity,subtotal::text FROM "OrderItem" WHERE "orderId"=$1', [id])).rows;
      expect(items).toEqual([{ productId: null, quantity: 2000, subtotal: '350.00' }]);
    });
    expect(errors).toEqual([]);
  });

  test(`${actor}: quote transport failure preserves the form and recovers`, async ({ page }) => {
    test.setTimeout(90_000);
    const errors: string[] = [];
    page.on('pageerror', (error) => errors.push(error.message));
    const rail = await startQuote(page, actor);
    await expectFee(rail, /^空白封$/, '130.00');
    let aborted = false;
    await page.route('**/orders/new', async (route) => {
      if (!aborted && route.request().method() === 'POST' && route.request().headers()['next-action']) {
        aborted = true;
        await route.abort('failed');
      } else {
        await route.continue();
      }
    });
    const quantity = page.getByRole('spinbutton', { name: '数量', exact: true });
    await quantity.fill('2000');
    await expect.poll(() => aborted).toBe(true);
    await expect(rail).toContainText('核价失败', { timeout: 15_000 });
    await expect(quantity).toHaveValue('2000');
    await page.getByRole('button', { name: '重新报价', exact: true }).click();
    await expectFee(rail, /^空白封$/, '260.00');
    expect(errors).toEqual([]);
  });
}
