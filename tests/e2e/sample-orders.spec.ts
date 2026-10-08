import { expect, test, type Page } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import { Client } from 'pg';
import bcrypt from 'bcryptjs';
import { login as loginWithIsolatedClient } from './_helpers';
import {
  assertActivatedE2eDatabase,
  postgresDatabaseIdentity,
  isDisposableE2eDatabaseName,
} from '../../scripts/lib/e2e-environment';

const password = 'e2e-test-password-1234';
async function login(page: Page, username: string, path = '/workbench') {
  await loginWithIsolatedClient(page, { username, password, from: path });
  // Auth navigation resolves on commit; detail content streams afterwards.
  if (/^\/orders\/(?!new$)[a-z0-9]+$/.test(path)) await expect(page.getByRole('heading', { level: 1 })).toBeVisible({ timeout: 30_000 });
}
async function database() {
  const explicit = process.env.SAMPLE_TEST_DATABASE_URL;
  const target = explicit ?? assertActivatedE2eDatabase().url;
  const identity = postgresDatabaseIdentity(target);
  if (!identity || !isDisposableE2eDatabaseName(identity.databaseName))
    throw new Error('请使用独立样品测试数据库');
  if (
    explicit &&
    identity.target ===
      postgresDatabaseIdentity(process.env.DATABASE_URL ?? '')?.target
  )
    throw new Error('样品测试数据库不能与普通数据库相同');
  const db = new Client({ connectionString: target });
  await db.connect();
  return db;
}
test.beforeAll(async () => {
  const db = await database();
  try {
    const hash = await bcrypt.hash(password, 10);
    for (const [username, role] of [
      ['e2e-sample-admin', 'ADMIN'],
      ['e2e-sample-sales', 'SALES'],
    ]) {
      await db.query(
        `INSERT INTO "User" (id,username,"displayName",password,role,"isActive","createdAt","updatedAt") VALUES ($1,$2::text,$2::text,$3,$4::"Role",true,NOW(),NOW()) ON CONFLICT (username) DO UPDATE SET password=EXCLUDED.password,"isActive"=true`,
        [crypto.randomUUID(), username, hash, role],
      );
    }
  } finally {
    await db.end();
  }
});

async function contact(page: Page) {
  await page.getByLabel('收货人', { exact: true }).fill('浏览器验收');
  await page.getByLabel('手机号', { exact: true }).fill('13800000000');
  await page.getByLabel('收件省份').selectOption('浙江');
  await page
    .getByLabel('收货地址', { exact: true })
    .fill('浙江省杭州市测试地址');
}

for (const entry of ['/workbench', '/orders/new']) for (const purpose of ['寄样品', '打样'] as const) {
  test(`${entry} 外部销售创建${purpose}，管理员核价与用途标签`, async ({
    page,
    browser,
  }) => {
    test.setTimeout(120_000);
    const errors: string[] = [];
    page.on('pageerror', (error) => errors.push(error.message));
    await login(page, 'e2e-sample-sales', entry);
    await page.getByRole('button', { name: purpose, exact: true }).click();
    if (purpose === '寄样品') {
      await page.getByLabel('样品名称').fill(`浏览器寄样 ${Date.now()}`);
      await page.getByLabel('样品数量').fill('2');
      await contact(page);
      await page.getByRole('button', { name: '打样', exact: true }).click();
      await expect(page.getByLabel('收货人', { exact: true })).toHaveValue(
        '浏览器验收',
      );
      await page.getByRole('button', { name: '寄样品', exact: true }).click();
      await page.reload();
      await expect(page.getByLabel('样品数量')).toHaveValue('2');
      await expect(page.getByLabel('收货人', { exact: true })).toHaveValue(
        '浏览器验收',
      );
      await page
        .getByRole('checkbox', { name: '顺丰到付', exact: true })
        .check();
    } else {
      await page
        .getByRole('spinbutton', { name: '数量', exact: true })
        .fill('3');
      await contact(page);
      await expect(page.getByLabel('整单总价（元）')).toHaveCount(0);
    }
    await page.getByRole('button', { name: '核对费用', exact: true }).click();
    const save = page.getByRole('button', { name: '保存工单', exact: true });
    await expect(save).toBeEnabled({ timeout: 30_000 });
    await save.click();
    await page
      .getByRole('button', { name: '查看已保存工单', exact: true })
      .click();
    await page.waitForURL(/\/orders\/(?!new$)[a-z0-9]+$/);
    const orderId = page.url().split('/').pop()!;
    const db = await database();
    try {
      if (purpose === '打样') {
        // OSS credentials are not part of this isolated environment. Use a
        // design fixture; missing-design rejection is covered by the domain test.
        await db.query(
          `INSERT INTO "OrderItemDesign" (id,"orderItemId","fileType","fileUrl","fileName","fileSize","uploadedBy") SELECT $1,i.id,'IMAGE',$2,'fixture.png',68,o."createdById" FROM "OrderItem" i JOIN "Order" o ON o.id=i."orderId" WHERE o.id=$3`,
          [
            crypto.randomUUID(),
            'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aMioAAAAASUVORK5CYII=',
            orderId,
          ],
        );
        await page.reload();
      }
      await page.getByRole('button', { name: '提交工单', exact: true }).click();
      await page
        .getByRole('button', { name: '确认最新报价并提交', exact: true })
        .click();
      await expect
        .poll(
          async () =>
            (
              await db.query('SELECT status FROM "Order" WHERE id=$1', [
                orderId,
              ])
            ).rows[0].status,
          { timeout: 30_000 },
        )
        .not.toBe('DRAFT');
      await expect(page.getByLabel('整单总价（元）')).toHaveCount(0);
      await page.goto(entry);
      await expect(page.getByRole('button', { name: '寄样品', exact: true })).toBeEnabled();
      await expect(page.getByRole('button', { name: '查看已保存工单', exact: true })).toHaveCount(0);
      const context = await browser.newContext();
      const adminPage = await context.newPage();
      adminPage.on('pageerror', (error) => errors.push(error.message));
      await login(adminPage, 'e2e-sample-admin', `/orders/${orderId}`);
      if (purpose === '寄样品') {
        expect((await db.query('SELECT status FROM "Order" WHERE id=$1', [orderId])).rows[0].status).toBe('PACKING');
        expect((await db.query('SELECT id FROM "ProductionOperation" WHERE "orderId"=$1', [orderId])).rowCount).toBe(0);
        await expect(adminPage.getByRole('link', { name: '安排生产师傅', exact: true })).toHaveCount(0);
        await expect(adminPage.getByRole('button', { name: '下发生产', exact: true })).toHaveCount(0);
      }
      await expect(
        adminPage
          .locator('[data-slot="badge"]')
          .filter({ hasText: purpose })
          .first(),
      ).toBeVisible({ timeout: 30_000 });
      if (purpose === '打样') {
        const amount = adminPage.getByLabel('整单总价（元）');
        await adminPage
          .getByRole('button', { name: '录入人工核价', exact: true })
          .click();
        await amount.fill('88.00');
        await adminPage
          .getByLabel('定价依据', { exact: true })
          .fill('打样整单价');
        await adminPage
          .getByRole('button', { name: '确认工厂核价', exact: true })
          .click();
        await expect
          .poll(
            async () =>
              (
                await db.query(
                  'SELECT "confirmedFee"::text AS fee FROM "Order" WHERE id=$1',
                  [orderId],
                )
              ).rows[0].fee,
          )
          .toBe('88.00');
        await expect(adminPage.locator('#pricing-review').getByText('管理员已确认', { exact: true })).toBeVisible();
      }
      // 业主 2026-10-02：「计价与收费维护」没有待处理事项时默认收起，先展开再编辑收费。
      const pricing = adminPage.locator('#detail-pricing-tools');
      if (await pricing.getAttribute('open') === null) await pricing.locator(':scope > summary').click();
      await adminPage.getByRole('button', { name: '编辑全部收费', exact: true }).click();
      const fees = adminPage.locator('#admin-fee-editor');
      await expect(fees.getByLabel('收费金额（元）').first()).toBeVisible();
      const originalLastFee = await fees.getByLabel('收费金额（元）').last().inputValue();
      const originalConfirmedFee = (await db.query('SELECT "confirmedFee"::text AS fee FROM "Order" WHERE id=$1', [orderId])).rows[0].fee;
      await fees.getByLabel('收费金额（元）').last().fill(purpose === '打样' ? '99.00' : '3.00');
      await fees.getByLabel('定价依据').fill('管理员调整样品收费');
      await fees.getByRole('button', { name: '保存收费', exact: true }).click();
      await expect.poll(async () => (await db.query('SELECT "confirmedFee"::text AS fee FROM "Order" WHERE id=$1', [orderId])).rows[0].fee).toBe(purpose === '打样' ? '99.00' : '3.00');
      // 按工单号定位：其他夹具（看板夹具按上海「今天中午」建单、原生 SQL 以
      // Asia/Shanghai 会话 NOW() 写入无时区列）会产生晚于当前 UTC 的 createdAt，
      // 上海时间 0–12 点跑全套时把本单挤出默认队列首页（每页 20 条）。
      const { orderNo } = (await db.query('SELECT "orderNo" FROM "Order" WHERE id=$1', [orderId])).rows[0];
      await adminPage.goto(`/orders?queue=all&q=${encodeURIComponent(orderNo)}`);
      await expect(
        adminPage
          .locator('[data-slot="badge"]')
          .filter({ hasText: purpose })
          .first(),
      ).toBeVisible({ timeout: 30_000 });
      if (purpose === '寄样品') {
        // 同一收货入口兼容已有待安排寄样；不要求先排单或单独下发。
        if (entry === '/orders/new') await db.query('UPDATE "Order" SET status=\'CONFIRMED\', revision=revision+1 WHERE id=$1', [orderId]);
        await adminPage.goto(`/orders/${orderId}`);
        const delivery = adminPage.locator('#detail-delivery-records');
        const shipment = delivery.locator('li').filter({ has: adminPage.getByRole('textbox', { name: '运单号', exact: true }) }).first();
        await shipment.getByRole('textbox', { name: '运单号', exact: true }).fill(`SF-SAMPLE-${Date.now()}`);
        await shipment.getByRole('combobox', { name: '物流公司', exact: true }).selectOption('SF');
        await shipment.getByRole('button', { name: '确认该地址已发货', exact: true }).click();
        await adminPage.getByRole('alertdialog').getByRole('button', { name: '确认发货', exact: true }).click();
        await expect(delivery.getByText('物流费用有变化，请先确认物流费用，再登记发货', { exact: true })).toBeVisible();
        expect((await db.query('SELECT status FROM "Order" WHERE id=$1', [orderId])).rows[0].status).toBe(entry === '/orders/new' ? 'CONFIRMED' : 'PACKING');
        expect((await db.query('SELECT status FROM "OrderShipment" WHERE "orderId"=$1', [orderId])).rows.every(row => row.status !== 'SHIPPED')).toBe(true);
        // 本用例的任意改价先恢复为原价目簿费用，再验证正常直接发货。
        if (await pricing.getAttribute('open') === null) await pricing.locator(':scope > summary').click();
        await adminPage.getByRole('button', { name: '编辑全部收费', exact: true }).click();
        await fees.getByLabel('收费金额（元）').last().fill(originalLastFee);
        await fees.getByLabel('定价依据').fill('恢复已核对的原物流费用');
        await fees.getByRole('button', { name: '保存收费', exact: true }).click();
        await expect.poll(async () => (await db.query('SELECT "confirmedFee"::text AS fee FROM "Order" WHERE id=$1', [orderId])).rows[0].fee).toBe(originalConfirmedFee);
        await adminPage.reload();
        await shipment.getByRole('textbox', { name: '运单号', exact: true }).fill(`SF-SAMPLE-${Date.now()}`);
        await shipment.getByRole('combobox', { name: '物流公司', exact: true }).selectOption('SF');
        await shipment.getByRole('button', { name: '确认该地址已发货', exact: true }).click();
        await adminPage.getByRole('alertdialog').getByRole('button', { name: '确认发货', exact: true }).click();
        await expect.poll(async () => (await db.query('SELECT status FROM "Order" WHERE id=$1', [orderId])).rows[0].status).toBe('SETTLED');
        expect((await db.query('SELECT id FROM "ProductionJob" WHERE "orderId"=$1', [orderId])).rowCount).toBe(0);
        expect((await db.query('SELECT id FROM "ProductionOperation" WHERE "orderId"=$1', [orderId])).rowCount).toBe(0);
      }
      await context.close();
      expect(errors).toEqual([]);
    } finally {
      await db.end();
    }
  });
}

test('新建工单样品入口六视口、明暗主题、触控和无障碍', async ({ page }) => {
  test.setTimeout(180_000);
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await login(page, 'e2e-sample-admin', '/orders/new');
  for (const [width, height] of [
    [375, 667],
    [393, 852],
    [768, 1024],
    [1024, 768],
    [1280, 800],
    [1920, 1080],
  ]) {
    await page.setViewportSize({ width, height });
    for (const theme of ['light', 'dark']) {
      await page.evaluate(
        (value) =>
          document.documentElement.classList.toggle('dark', value === 'dark'),
        theme,
      );
      for (const purpose of ['寄样品', '打样']) {
        const choice = page.getByRole('button', { name: purpose, exact: true });
        await choice.click();
        await expect(page.getByLabel('收货人', { exact: true })).toBeVisible();
        await expect.poll(() => page.evaluate(() => document.getAnimations().filter((animation) => animation.playState === 'running' || animation.pending).length)).toBe(0);
        const box = await choice.boundingBox();
        expect(box!.height).toBeGreaterThanOrEqual(44);
        expect(
          await page.evaluate(
            () => document.documentElement.scrollWidth <= window.innerWidth,
          ),
        ).toBe(true);
        const results = await new AxeBuilder({ page })
          .include('main')
          .withTags(['wcag2a', 'wcag2aa', 'wcag21aa'])
          .analyze();
        expect(results.violations).toEqual([]);
        if (width === 375 || width === 1280)
          await page.screenshot({
            path: test.info().outputPath(`erp-${purpose}-${theme}-${width}.png`),
            fullPage: true,
          });
      }
    }
  }
});

for (const purpose of ['寄样品', '打样'] as const) {
  test(`管理员新建页保存并提交${purpose}，类型与费用正确`, async ({ page }) => {
    test.setTimeout(120_000);
    await login(page, 'e2e-sample-admin', '/orders/new');
    // 业主 2026-09-24：管理员建单必须归属一个外部销售。
    const lookup = await database();
    const sales = (await lookup.query('SELECT id FROM "User" WHERE username=$1', ['e2e-sample-sales'])).rows[0].id;
    await lookup.end();
    await page.getByLabel('关联外部销售', { exact: true }).selectOption(sales);
    await page.getByLabel('工单名称', { exact: false }).fill('管理员样品工单名称');
    await page.getByRole('button', { name: purpose, exact: true }).click();
    await contact(page);
    if (purpose === '寄样品') {
      await page.getByLabel('样品名称').fill('管理员寄样验收');
      await page.getByLabel('样品数量').fill('2');
      await page.getByRole('checkbox', { name: '顺丰到付', exact: true }).check();
    } else {
      await page.getByRole('spinbutton', { name: '数量', exact: true }).fill('3');
    }
    await page.getByRole('button', { name: '核对费用', exact: true }).click();
    await expect(page.getByRole('button', { name: '保存工单', exact: true })).toBeEnabled();
    await page.getByRole('button', { name: '保存工单', exact: true }).click();
    await expect(page.getByRole('button', { name: '查看已保存工单', exact: true })).toBeVisible();
    await expect(page.getByRole('button', { name: '寄样品', exact: true })).toBeDisabled();
    await page.reload();
    // Saved workspaces recover the existing order instead of reopening a create command.
    await expect(page.getByRole('link', { name: '查看工单', exact: true })).toBeVisible();
    await page.getByRole('link', { name: '查看工单', exact: true }).click();
    await page.waitForURL(/\/orders\/(?!new$)[a-z0-9]+$/);
    const id = page.url().split('/').pop()!;
    const db = await database();
    try {
      const { rows: [order] } = await db.query('SELECT purpose, "pricingMode", "confirmedFee", "createdById", "submitterRole", "customName" FROM "Order" WHERE id=$1', [id]);
      expect(order.purpose).toBe(purpose === '寄样品' ? 'SAMPLE_SHIPMENT' : 'PROOF');
      expect(order.submitterRole).toBe('SALES');
      if (purpose === '打样') {
        expect(order.customName).toBe('管理员样品工单名称');
        expect(order.pricingMode).toBe('MANUAL_TOTAL');
        expect(order.confirmedFee).toBeNull();
        await db.query(`INSERT INTO "OrderItemDesign" (id,"orderItemId","fileType","fileUrl","fileName","fileSize","uploadedBy") SELECT $1,i.id,'IMAGE',$2,'fixture.png',68,o."createdById" FROM "OrderItem" i JOIN "Order" o ON o.id=i."orderId" WHERE o.id=$3`, [crypto.randomUUID(), 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aMioAAAAASUVORK5CYII=', id]);
        await page.reload();
      }
      await page.getByRole('button', { name: '提交工单', exact: true }).click();
      await page.getByRole('button', { name: '确认最新报价并提交', exact: true }).click();
      await expect.poll(async () => (await db.query('SELECT status FROM "Order" WHERE id=$1', [id])).rows[0].status).not.toBe('DRAFT');
    } finally { await db.end(); }
  });
}

test('新建页五入口切换保留普通单与收件信息', async ({ page }) => {
  await login(page, 'e2e-sample-sales', '/orders/new');
  for (const label of ['局部烫金', '专版烫金', '彩印', '寄样品', '打样']) {
    await expect(page.getByRole('button', { name: label, exact: true })).toBeVisible();
  }
  await page.getByLabel('工单名称', { exact: false }).fill('切换保留验收');
  await page.getByRole('button', { name: '寄样品', exact: true }).click();
  await contact(page);
  await page.getByRole('button', { name: '局部烫金', exact: true }).click();
  await expect(page.getByLabel('工单名称', { exact: false })).toHaveValue('切换保留验收');
  await page.getByRole('button', { name: '打样', exact: true }).click();
  await expect(page.getByLabel('收货人', { exact: true })).toHaveValue('浏览器验收');
  await page.reload();
  await expect(page.getByRole('heading', { name: '打样工单', exact: true })).toBeVisible();
  await expect(page.getByLabel('收货人', { exact: true })).toHaveValue('浏览器验收');
});

test('管理员关联销售后切换寄样、刷新仍保留工单归属', async ({ page }) => {
  test.setTimeout(120_000);
  await login(page, 'e2e-sample-admin', '/orders/new');
  const db = await database();
  try {
    const sales = (await db.query('SELECT id FROM "User" WHERE username=$1', ['e2e-sample-sales'])).rows[0].id;
    await page.getByLabel('关联外部销售', { exact: true }).selectOption(sales);
    await page.getByRole('button', { name: '寄样品', exact: true }).click();
    await page.getByLabel('样品名称').fill('归属保留验收');
    await contact(page);
    await page.getByRole('checkbox', { name: '顺丰到付', exact: true }).check();
    await page.reload();
    await expect(page.getByLabel('样品名称')).toHaveValue('归属保留验收');
    await page.getByRole('button', { name: '核对费用', exact: true }).click();
    await expect(page.getByRole('button', { name: '保存工单', exact: true })).toBeEnabled();
    await page.getByRole('button', { name: '保存工单', exact: true }).click();
    await page.getByRole('button', { name: '查看已保存工单', exact: true }).click();
    await page.waitForURL(/\/orders\/(?!new$)[a-z0-9]+$/);
    const id = page.url().split('/').pop()!;
    const order = (await db.query('SELECT "submitterId", "createdById", "settlementType" FROM "Order" WHERE id=$1', [id])).rows[0];
    expect(order.submitterId).toBe(sales);
    expect(order.createdById).not.toBe(sales);
    expect(order.settlementType).toBe('EXTERNAL_SALES');
  } finally { await db.end(); }
});

// 业主 2026-09-24：管理员建单必须归属外部销售。直接进入样品流程（工作台选用途，
// 或新建页未先选销售就切到样品）时，样品表单自身必须提供同一个必填选择。
for (const entry of ['/workbench', '/orders/new']) for (const purpose of ['寄样品', '打样'] as const) {
  test(`${entry} 管理员直接进入${purpose}，在样品表单选择外部销售后保存`, async ({ page }) => {
    test.setTimeout(120_000);
    const errors: string[] = [];
    page.on('pageerror', (error) => errors.push(error.message));
    await login(page, 'e2e-sample-admin', entry);
    await page.evaluate(() => sessionStorage.clear());
    await page.reload();
    await page.getByRole('button', { name: purpose, exact: true }).click();
    const sales = page.getByLabel('关联外部销售', { exact: true });
    await expect(sales).toBeVisible();
    await expect(sales).toHaveValue('');
    if (purpose === '寄样品') {
      await page.getByLabel('样品名称').fill(`管理员直入寄样 ${Date.now()}`);
      await page.getByLabel('样品数量').fill('2');
    } else {
      await page.getByRole('spinbutton', { name: '数量', exact: true }).fill('3');
    }
    await contact(page);
    await page.getByRole('button', { name: '核对费用', exact: true }).click();
    const save = page.getByRole('button', { name: '保存工单', exact: true });
    await expect(save).toBeEnabled({ timeout: 30_000 });
    await save.click();
    await expect(page.getByText('请选择关联外部销售', { exact: true })).toBeVisible();
    await expect(sales).toBeFocused();
    const db = await database();
    try {
      const salesId = (await db.query('SELECT id FROM "User" WHERE username=$1', ['e2e-sample-sales'])).rows[0].id;
      await sales.selectOption(salesId);
      await expect(page.getByText('请选择关联外部销售', { exact: true })).toHaveCount(0);
      await page.getByRole('button', { name: '核对费用', exact: true }).click();
      await expect(save).toBeEnabled({ timeout: 30_000 });
      await save.click();
      await page.getByRole('button', { name: '查看已保存工单', exact: true }).click();
      await page.waitForURL(/\/orders\/(?!new$)[a-z0-9]+$/);
      const id = page.url().split('/').pop()!;
      const order = (await db.query('SELECT purpose, "submitterId", "createdById", "settlementType", "submitterRole" FROM "Order" WHERE id=$1', [id])).rows[0];
      expect(order.purpose).toBe(purpose === '寄样品' ? 'SAMPLE_SHIPMENT' : 'PROOF');
      expect(order.submitterId).toBe(salesId);
      expect(order.createdById).not.toBe(salesId);
      expect(order.settlementType).toBe('EXTERNAL_SALES');
      expect(order.submitterRole).toBe('SALES');
      expect(errors).toEqual([]);
    } finally { await db.end(); }
  });
}
