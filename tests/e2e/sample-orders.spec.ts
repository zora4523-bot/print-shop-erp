import { expect, test, type Page } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import { Client } from 'pg';
import bcrypt from 'bcryptjs';
import {
  assertActivatedE2eDatabase,
  postgresDatabaseIdentity,
  isDisposableE2eDatabaseName,
} from '../../scripts/lib/e2e-environment';

const password = 'e2e-test-password-1234';
async function login(page: Page, username: string, path = '/workbench') {
  await page.goto(`/login?from=${encodeURIComponent(path)}`);
  await page.locator('#username').fill(username);
  await page.locator('#password').fill(password);
  await page.getByRole('button', { name: /登.*录/ }).click();
  await page.waitForURL((url) => !url.pathname.startsWith('/login'));
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

for (const purpose of ['寄样品', '打样'] as const) {
  test(`外部销售创建${purpose}，管理员核价与用途标签`, async ({
    page,
    browser,
  }) => {
    test.setTimeout(120_000);
    const errors: string[] = [];
    page.on('pageerror', (error) => errors.push(error.message));
    await login(page, 'e2e-sample-sales');
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
    await expect(save).toBeEnabled();
    await save.click();
    await page
      .getByRole('button', { name: '查看已保存工单', exact: true })
      .click();
    await page.waitForURL(/\/orders\/[a-z0-9]+$/);
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
        )
        .not.toBe('DRAFT');
      await expect(page.getByLabel('整单总价（元）')).toHaveCount(0);
      await page.goto('/workbench');
      await expect(page.getByRole('button', { name: '寄样品', exact: true })).toBeEnabled();
      await expect(page.getByRole('button', { name: '查看已保存工单', exact: true })).toHaveCount(0);
      const context = await browser.newContext();
      const adminPage = await context.newPage();
      adminPage.on('pageerror', (error) => errors.push(error.message));
      await login(adminPage, 'e2e-sample-admin', `/orders/${orderId}`);
      await expect(
        adminPage
          .locator('[data-slot="badge"]')
          .filter({ hasText: purpose })
          .first(),
      ).toBeVisible();
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
      }
      await adminPage.goto('/orders');
      await expect(
        adminPage
          .locator('[data-slot="badge"]')
          .filter({ hasText: purpose })
          .first(),
      ).toBeVisible();
      await context.close();
      expect(errors).toEqual([]);
    } finally {
      await db.end();
    }
  });
}

test('样品入口六视口、明暗主题、触控和无障碍', async ({ page }) => {
  test.setTimeout(180_000);
  await login(page, 'e2e-sample-admin');
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
            path: `/tmp/erp-${purpose}-${theme}-${width}.png`,
            fullPage: true,
          });
      }
    }
  }
});
