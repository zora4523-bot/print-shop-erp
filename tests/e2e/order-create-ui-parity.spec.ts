import { expect, test, type Page } from '@playwright/test';
import { Client } from 'pg';
import { E2E_PASSWORD, E2E_USERS, login, selectExternalSalesForAdminOrder } from './_helpers';

const PNG =
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aMioAAAAASUVORK5CYII=';

async function setManualProcessingPrice(page: Page) {
  const processing = page.getByRole('group', {
    name: '款式加工费',
    exact: true,
  });
  await processing
    .getByRole('button', { name: '人工定价', exact: true })
    .click();
  await processing.getByLabel('本款加工费（元）').fill('123.45');
  await processing.getByLabel('定价原因').fill('客户协议价');
}

for (const actor of ['owner', 'sales'] as const) {
  test(`${actor}: fee details and leave protection use the shared create page`, async ({
    page,
  }) => {
    test.setTimeout(90_000);
    const errors: string[] = [];
    page.on('pageerror', (error) => errors.push(error.message));
    await login(page, {
      from: '/orders/new',
      username: E2E_USERS[actor].username,
      password: E2E_PASSWORD,
    });
    const rail = page.locator('[data-slot="order-form-rail"]');
    await page
      .getByRole('textbox', { name: '工单名称', exact: true })
      .fill(`费用明细验证 ${Date.now()}`);
    await page
      .getByRole('textbox', { name: '收货地址', exact: true })
      .fill('张先生 13800138000 广东省佛山市南海区测试路1号');
    await expect(rail.getByText('空白封', { exact: true })).toBeVisible({
      timeout: 30_000,
    });
    await expect(rail.getByText('机烫费', { exact: true })).toBeVisible();
    await expect(rail.getByText(/入袋 /)).toBeVisible();
    if (actor === 'owner') {
      // 2026-09-18 起统一物流价目：尚未选择外部销售时也列物流行。
      await expect(rail.getByText(/纸箱耗材/)).toBeVisible();
      await expect(rail.getByText(/快递费/)).toBeVisible();
      await setManualProcessingPrice(page);
      const priceInput = page.getByLabel('本款加工费（元）');
      await priceInput.fill('');
      await rail.getByRole('button', { name: /^款式 #1：/ }).click();
      await expect(priceInput).toBeFocused();
      await priceInput.fill('123.45');
      await expect(rail.getByText('人工价', { exact: true })).toBeVisible();
      await expect(rail.getByText('空白封', { exact: true })).toHaveCount(0);
      await selectExternalSalesForAdminOrder(page);
      await expect(page.getByRole('textbox', { name: '设计款名称', exact: true })).toBeVisible();
      await expect(page.getByLabel('稿件版本', { exact: true })).toBeVisible();
      await expect(
        page.getByRole('group', { name: '款式加工费', exact: true }),
      ).toBeVisible();
      await expect(rail.getByText(/纸箱耗材/)).toBeVisible();
    } else {
      // 业主 2026-09-26：外部销售也填写设计款名称；稿件版本仍只给管理员。
      await expect(page.getByRole('textbox', { name: '设计款名称', exact: true })).toBeVisible();
      await expect(page.getByLabel('稿件版本', { exact: true })).toHaveCount(0);
      await expect(rail.getByText(/纸箱耗材/)).toBeVisible();
      await expect(
        page.getByRole('button', { name: '人工定价', exact: true }),
      ).toHaveCount(0);
    }
    // Browser-native navigation must retain the warning even though local text drafts exist.
    const beforeUnload = await page.evaluate(() => {
      const event = new Event('beforeunload', { cancelable: true });
      window.dispatchEvent(event);
      return event.defaultPrevented;
    });
    expect(beforeUnload).toBe(true);
    expect(errors).toEqual([]);
  });
}

// 业主 2026-09-24：管理员建单必须归属外部销售，提交前先定位到销售下拉。
test('admin submit locates the missing salesperson, reviews the exact manual price, and persists once', async ({
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
  const name = `建单复核验证 ${Date.now()}`;
  await page.getByRole('textbox', { name: '工单名称', exact: true }).fill(name);
  await page
    .getByRole('textbox', { name: '收货地址', exact: true })
    .fill('张先生 13800138000 广东省佛山市南海区测试路1号');
  await page.getByRole('button', { name: '不包装', exact: true }).click();
  await setManualProcessingPrice(page);
  await page.getByLabel('承诺交期', { exact: true }).fill('2099-01-01');
  // Object storage is outside this boundary; the saved-draft artwork fixture
  // below completes the authoritative submission.
  await page.route((url) => url.hostname.endsWith('.aliyuncs.com'), (route) =>
    route.request().method() === 'PUT' ? route.abort('failed') : route.continue());
  await page.locator('input[type="file"]').first().setInputFiles({
    name: 'review.png', mimeType: 'image/png', buffer: Buffer.from(PNG, 'base64'),
  });
  const submit = page.getByRole('button', { name: '创建并提交', exact: true });
  await expect(submit).toBeEnabled({ timeout: 30_000 });
  await submit.click();
  const salesperson = page.getByRole('combobox', { name: '关联外部销售（必填）', exact: true });
  await expect(salesperson).toHaveAttribute('aria-invalid', 'true');
  await expect(page.getByText('请选择关联外部销售').first()).toBeVisible();
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await selectExternalSalesForAdminOrder(page);
  await expect(salesperson).toHaveAttribute('aria-invalid', 'false');
  await submit.click();
  const dialog = page.getByRole('dialog');
  await expect(dialog).toBeVisible();
  const fees = dialog.getByRole('region', { name: '费用复核' });
  await expect(fees.getByText('¥ 123.45', { exact: true })).toBeVisible();
  await expect(fees.getByText('人工价', { exact: true })).toBeVisible();
  await expect(fees.getByText('不包装', { exact: true })).toBeVisible();
  await expect(fees.getByText('¥ 0.00', { exact: true })).toBeVisible();
  await expect(fees.getByText(/纸箱耗材/)).toBeVisible();
  await expect(fees.getByText(/快递费/)).toBeVisible();
  const db = new Client({ connectionString: process.env.DATABASE_URL });
  await db.connect();
  try {
    const orders = async () =>
      (
        await db.query('SELECT id, status FROM "Order" WHERE "customName"=$1', [
          name,
        ])
      ).rows;
    expect(await orders()).toHaveLength(0);
    await dialog.getByRole('button', { name: '返回修改', exact: true }).click();
    await expect(dialog).toHaveCount(0);
    expect(await orders()).toHaveLength(0);
    await submit.click();
    await dialog
      .getByRole('button', { name: '确认无误，提交', exact: true })
      .click();
    await expect.poll(async () => (await orders()).length).toBe(1);
    const [created] = await orders();
    // The aborted artwork upload leaves a saved draft; register the design and
    // finish submission from the detail page exactly once.
    await expect(page.getByRole('dialog').getByRole('button', { name: '继续完成', exact: true }))
      .toBeVisible();
    await db.query(
      `INSERT INTO "OrderItemDesign" (id,"orderItemId","fileType","fileUrl","fileName","fileSize","uploadedBy")
       SELECT $1,i.id,'IMAGE',$2,'review.png',68,o."createdById" FROM "OrderItem" i
       JOIN "Order" o ON o.id=i."orderId" WHERE o.id=$3`,
      [crypto.randomUUID(), `data:image/png;base64,${PNG}`, created.id],
    );
    await page.goto(`/orders/${created.id}`);
    await page.getByRole('button', { name: '提交工单', exact: true }).click();
    const latest = page.getByRole('button', { name: '确认最新报价并提交', exact: true });
    await expect.poll(async () => (await latest.isVisible()) ? 'confirm' : (await orders())[0].status)
      .not.toBe('DRAFT');
    if (await latest.isVisible()) await latest.click();
    await expect.poll(async () => (await orders())[0].status).not.toBe('DRAFT');
    const result = await orders();
    expect(result).toHaveLength(1);
    const item = (
      await db.query(
        'SELECT subtotal::text, "pricingSnapshot" FROM "OrderItem" WHERE "orderId"=$1',
        [result[0].id],
      )
    ).rows[0];
    expect(item.subtotal).toBe('123.45');
    expect(item.pricingSnapshot.source).toBe('ADMIN_SNAPSHOT_CONFIRMATION');
  } finally {
    await db.end();
  }
  expect(errors).toEqual([]);
});
