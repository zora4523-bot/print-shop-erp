import { test, expect, type Page } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import { Client } from 'pg';
import bcrypt from 'bcryptjs';
import { selectExternalSalesForAdminOrder, submitDraftOrderAndWait } from './_helpers';
import { assertActivatedE2eDatabase, postgresDatabaseIdentity, isDisposableE2eDatabaseName } from '../../scripts/lib/e2e-environment';
async function database() {
  // The standard runner already replaces DATABASE_URL with the validated
  // isolated target. Only the standalone override still needs this comparison.
  const explicit = process.env.SAMPLE_TEST_DATABASE_URL;
  const target = explicit ?? assertActivatedE2eDatabase().url;
  const identity = postgresDatabaseIdentity(target);
  if (!identity || !isDisposableE2eDatabaseName(identity.databaseName) || (explicit && identity.target === postgresDatabaseIdentity(process.env.DATABASE_URL ?? '')?.target)) throw new Error('请使用独立收费验收数据库');
  const db = new Client({ connectionString: target }); await db.connect(); return db;
}
async function login(page: Page, username: string, path: string) {
  await page.goto(`/login?from=${encodeURIComponent(path)}`);
  await page.locator('#username').fill(username); await page.locator('#password').fill('e2e-test-password-1234');
  await page.getByRole('button', { name: /登.*录/ }).click();
  await page.waitForURL((url) => !url.pathname.startsWith('/login'));
}

test.beforeAll(async () => {
  const db = await database();
  try {
    const password = await bcrypt.hash('e2e-test-password-1234', 10);
    for (const [username, role] of [['e2e-sample-admin', 'ADMIN'], ['e2e-sample-sales', 'SALES']]) {
      await db.query('INSERT INTO "User" (id,username,"displayName",password,role,"isActive","createdAt","updatedAt") VALUES ($1,$2::text,$2::text,$3,$4::"Role",true,NOW(),NOW()) ON CONFLICT (username) DO UPDATE SET password=EXCLUDED.password,"isActive"=true', [crypto.randomUUID(), username, password, role]);
    }
  } finally { await db.end(); }
});

test('管理员新建后编辑完整收费，重载保留且外部销售无入口', async ({ page, browser }) => {
  test.setTimeout(180_000);
  const errors: string[] = []; page.on('pageerror', (error) => errors.push(error.message));
  // Object storage is outside this boundary: the artwork PUT fails on purpose
  // and a DB design fixture completes the submission (same as blank-price-only).
  await page.route((url) => url.hostname.endsWith('.aliyuncs.com'), (route) =>
    route.request().method() === 'PUT' ? route.abort('failed') : route.continue());
  await login(page, 'e2e-sample-admin', '/orders/new');
  // 业主 2026-09-24：管理员建单必须归属一个外部销售；“创建并编辑收费”同时提交，须有设计图。
  await selectExternalSalesForAdminOrder(page);
  const orderName = `收费验收 ${Date.now()}`;
  await page.getByRole('textbox', { name: '工单名称', exact: true }).fill(orderName);
  await page.getByPlaceholder('粘贴电商后台地址串，自动拆分').fill('张三，13800000000，浙江省杭州市西湖区测试路1号');
  await page.getByLabel('承诺交期', { exact: true }).fill('2026-10-01');
  const png = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aMioAAAAASUVORK5CYII=';
  await page.locator('input[type="file"]').first().setInputFiles({ name: 'fees.png', mimeType: 'image/png', buffer: Buffer.from(png, 'base64') });
  await page.getByRole('button', { name: '创建并编辑收费', exact: true }).click();
  await page.getByRole('dialog').getByRole('button', { name: /^确认/ }).click();
  await expect(page.getByRole('dialog').getByRole('button', { name: '继续完成', exact: true })).toBeVisible();
  const fixtureDb = await database();
  let orderId = '';
  try {
    orderId = (await fixtureDb.query('SELECT id FROM "Order" WHERE "customName"=$1', [orderName])).rows[0].id;
    await fixtureDb.query(`INSERT INTO "OrderItemDesign" (id,"orderItemId","fileType","fileUrl","fileName","fileSize","uploadedBy") SELECT $1||i.id,i.id,'IMAGE',$2,'fees.png',68,o."createdById" FROM "OrderItem" i JOIN "Order" o ON o.id=i."orderId" WHERE o.id=$3`, [`${orderId}-design-`, `data:image/png;base64,${png}`, orderId]);
  } finally { await fixtureDb.end(); }
  await page.goto(`/orders/${orderId}`);
  await submitDraftOrderAndWait(page);
  await page.goto(`/orders/${orderId}#admin-fee-editor`);
  await page.getByRole('button', { name: '编辑全部收费', exact: true }).click();
  const editor = page.locator('#admin-fee-editor');
  await expect(editor.getByLabel('加工单价（元）', { exact: true })).toBeVisible();
  await editor.getByLabel('加工单价（元）', { exact: true }).fill('0.2');
  await editor.getByLabel('一次性费用（元）').fill('15');
  const freight = editor.locator('div.rounded-lg').filter({ has: page.getByRole('heading', { name: '地址 1 · 快递费', exact: true }) });
  const packing = editor.locator('div.rounded-lg').filter({ has: page.getByRole('heading', { name: '地址 1 · 包装耗材费', exact: true }) });
  await freight.getByLabel('收费金额（元）').fill('6');
  await packing.getByLabel('收费金额（元）').fill('2');
  await editor.getByLabel('定价依据').fill('管理员确认全项收费');
  const db = await database();
  try {
    const before = (await db.query('SELECT "priceRevision", "totalAmount"::text AS total FROM "Order" WHERE id=$1', [orderId])).rows[0];
    await editor.getByRole('button', { name: '保存收费', exact: true }).click();
    await expect.poll(async () => (await db.query('SELECT "priceRevision" FROM "Order" WHERE id=$1', [orderId])).rows[0].priceRevision).toBeGreaterThan(before.priceRevision);
    const fees = (await db.query('SELECT c.amount::text, k.code FROM "OrderCustomerCharge" c JOIN "CustomerChargeCategory" k ON k.id=c."categoryId" WHERE c."orderId"=$1', [orderId])).rows;
    expect(fees).toEqual(expect.arrayContaining([{ amount: '6.00', code: 'SHIPPING_FEE' }, { amount: '2.00', code: 'PACKING_MATERIAL' }]));
    await page.reload(); await page.getByRole('button', { name: '编辑全部收费', exact: true }).click();
    await expect(editor.getByLabel('加工单价（元）', { exact: true })).toHaveValue('0.2000');
    for (const width of [375, 390, 768, 1024, 1440, 1920]) for (const dark of [false, true]) {
      await page.setViewportSize({ width, height: 1000 });
      await page.emulateMedia({ colorScheme: dark ? 'dark' : 'light', reducedMotion: 'reduce' });
      await page.evaluate((dark) => {
        const theme = dark ? 'dark' : 'light';
        localStorage.setItem('erp-theme', theme);
        document.documentElement.classList.toggle('dark', dark);
        document.documentElement.dataset.theme = theme;
        document.documentElement.style.colorScheme = theme;
      }, dark);
      await expect(editor.locator('fieldset')).toBeEnabled();
      await expect(page.locator('html')).toHaveAttribute('data-theme', dark ? 'dark' : 'light');
      for (let paint = 0; paint < 3; paint += 1) {
        await page.evaluate(() => new Promise<void>(resolve => requestAnimationFrame(() => resolve())));
        await expect.poll(() => page.evaluate(() => document.getAnimations()
          .filter(animation => animation.playState === 'running' || animation.pending).length)).toBe(0);
      }
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1)).toBe(true);
      const heights = await editor.locator('button').evaluateAll((nodes) => nodes.filter((node) => node.getBoundingClientRect().height > 0).map((node) => node.getBoundingClientRect().height));
      expect(heights.every((height) => height >= 44)).toBe(true);
      expect((await new AxeBuilder({ page }).include('#admin-fee-editor').analyze()).violations).toEqual([]);
    }
    await page.screenshot({ path: '/tmp/admin-fees-editor.png', fullPage: true });
    expect(errors).toEqual([]);
    const context = await browser.newContext(); const sales = await context.newPage();
    await login(sales, 'e2e-sample-sales', '/orders/new');
    await expect(sales.getByRole('button', { name: '创建并编辑收费', exact: true })).toHaveCount(0);
    await context.close();
  } finally { await db.end(); }
});

for (const purpose of ['寄样品', '打样']) test(`管理员新建${purpose}通过提交并编辑收费进入完整编辑器`, async ({ page }) => {
  test.setTimeout(90_000);
  const name = `收费入口-${crypto.randomUUID()}`;
  await login(page, 'e2e-sample-admin', '/orders/new');
  await selectExternalSalesForAdminOrder(page);
  await page.getByRole('textbox', { name: '工单名称', exact: true }).fill(name);
  await page.getByRole('button', { name: purpose, exact: true }).click();
  if (purpose === '寄样品') await page.getByLabel('样品名称').fill(name);
  await page.getByLabel('收货人', { exact: true }).fill('收费验收');
  await page.getByLabel('手机号', { exact: true }).fill('13800000000');
  await page.getByLabel('收件省份').selectOption('浙江');
  await page.getByLabel('收货地址', { exact: true }).fill('浙江省杭州市测试路1号');
  await page.getByRole('button', { name: '核对费用', exact: true }).click();
  await expect(page.getByRole('button', { name: '保存工单', exact: true })).toBeEnabled();
  await page.getByRole('button', { name: '保存工单', exact: true }).click();
  await expect(page.getByRole('button', { name: '提交并编辑收费', exact: true })).toBeVisible();
  const db = await database();
  try {
    const { rows: [order] } = await db.query('SELECT id FROM "Order" WHERE "customName"=$1', [name]);
    expect(order).toBeTruthy();
    if (purpose === '打样') await db.query(`INSERT INTO "OrderItemDesign" (id,"orderItemId","fileType","fileUrl","fileName","fileSize","uploadedBy") SELECT $1,i.id,'IMAGE',$2,'fixture.png',68,o."createdById" FROM "OrderItem" i JOIN "Order" o ON o.id=i."orderId" WHERE o.id=$3`, [crypto.randomUUID(), 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aMioAAAAASUVORK5CYII=', order.id]);
    await page.getByRole('button', { name: '提交并编辑收费', exact: true }).click();
    await expect(page).toHaveURL(new RegExp(`/orders/${order.id}#admin-fee-editor$`), { timeout: 20_000 });
    await page.getByRole('button', { name: '编辑全部收费', exact: true }).click();
    await expect(page.locator('#admin-fee-editor').getByLabel('收费金额（元）').first()).toBeVisible();
  } finally { await db.end(); }
});
