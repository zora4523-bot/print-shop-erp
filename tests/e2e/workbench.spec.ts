import { expect, test, type Page } from '@playwright/test';
import { login, E2E_USERS, E2E_PASSWORD } from './_helpers';

async function openWorkbench(
  page: Page,
  role: 'sales' | 'owner' | 'customerService' = 'sales',
) {
  await login(page, {
    from: '/workbench',
    username: E2E_USERS[role]!.username,
    password: E2E_PASSWORD,
  });
  await expect(
    page.getByRole('heading', { name: '款式条件', exact: true }),
  ).toBeVisible();
}
function quote(page: Page) {
  return page.getByRole('region', { name: '报价计算', exact: true });
}
async function ready(page: Page) {
  await expect(quote(page).locator('summary')).toContainText('费用明细');
  await expect(
    quote(page).getByRole('button', { name: '刷新报价', exact: true }),
  ).toBeEnabled();
}
async function choose(page: Page, group: string, value: string) {
  await page
    .getByRole('group', { name: group, exact: true })
    .getByRole('button', { name: value, exact: true })
    .click();
}

test.describe('shared workbench calculator', () => {
  test.describe.configure({ timeout: 90000 });
  test('sales changes markup locally, transfers identical item facts, and sees the same processing lines in order entry', async ({
    page,
  }) => {
    const errors: string[] = [];
    page.on('pageerror', (e) => errors.push(e.message));
    await openWorkbench(page);
    await ready(page);
    await quote(page)
      .getByRole('spinbutton', { name: '数量', exact: true })
      .fill('1000');
    await ready(page);
    const count = { posts: 0 };
    page.on('request', (request) => {
      if (
        request.method() === 'POST' &&
        new URL(request.url()).pathname === '/workbench'
      )
        count.posts++;
    });
    await quote(page)
      .getByRole('spinbutton', { name: '加工费加价比例（%）' })
      .fill('0');
    const base = await quote(page)
      .locator('dl > div')
      .filter({ has: page.locator('dt', { hasText: '基础加工费' }) })
      .locator('dd')
      .innerText();
    expect(base).toMatch(/¥/);
    await expect(quote(page).locator('p.text-3xl')).toHaveText(base);
    expect(count.posts).toBe(0);
    await quote(page).locator('summary').click();
    const lines = await quote(page).locator('details dd').allTextContents();
    const preservedDraftKey = 'workbench-preserve-sentinel';
    await page.evaluate(
      (key) => localStorage.setItem(key, 'unrelated'),
      preservedDraftKey,
    );
    await quote(page).getByRole('button', { name: '按此款式创建工单' }).click();
    await expect(page).toHaveURL(/\/orders\/new\?fromWorkbench=/);
    await expect(
      page.getByRole('spinbutton', { name: '数量', exact: true }),
    ).toHaveValue('1000');
    await expect(
      page
        .getByRole('group', { name: '工艺类型' })
        .getByRole('button', { name: '局部烫金', exact: true }),
    ).toHaveAttribute('aria-pressed', 'true');
    await page
      .getByRole('textbox', { name: '收货地址', exact: true })
      .fill('报价带入测试 13800138000 上海市浦东新区测试路1号');
    const rail = page.locator('[data-slot="order-form-rail"]');
    for (const amount of lines)
      await expect(
        rail.getByText(amount, { exact: true }).first(),
      ).toBeVisible();
    expect(
      await page.evaluate(
        (key) => localStorage.getItem(key),
        preservedDraftKey,
      ),
    ).toBe('unrelated');
    expect(errors).toEqual([]);
    await page.screenshot({
      path: '/tmp/workbench-transfer-order.png',
      fullPage: true,
    });
  });
  test('preserves an existing draft when creating a separate order from a quote', async ({
    page,
  }) => {
    await openWorkbench(page);
    await page.goto('/orders/new');
    await page
      .getByRole('textbox', { name: /工单名称/ })
      .fill('原工单不要覆盖');
    await expect
      .poll(() =>
        page.evaluate(() =>
          Object.keys(localStorage).find(
            (key) =>
              key.includes('order-form') &&
              localStorage.getItem(key)?.includes('原工单不要覆盖'),
          ),
        ),
      )
      .toBeTruthy();
    const original = await page.evaluate(() =>
      Object.fromEntries(
        Object.keys(localStorage)
          .filter((key) => key.includes('order-form'))
          .map((key) => [key, localStorage.getItem(key)]),
      ),
    );
    // Leave through browser navigation after accepting the existing unsaved-change guard.
    page.on('dialog', (dialog) => dialog.accept());
    await page.goto('/workbench');
    await ready(page);
    await quote(page).getByRole('button', { name: '按此款式创建工单' }).click();
    await expect(
      page.getByRole('button', { name: '使用本次报价创建工单' }),
    ).toBeVisible();
    await page.getByRole('button', { name: '使用本次报价创建工单' }).click();
    await expect(
      page.getByRole('spinbutton', { name: '数量', exact: true }),
    ).toBeEnabled();
    for (const [key, value] of Object.entries(original))
      expect(await page.evaluate((key) => localStorage.getItem(key), key)).toBe(
        value,
      );
    await page.reload();
    await expect(
      page.getByRole('spinbutton', { name: '数量', exact: true }),
    ).toBeEnabled();
  });
  test('uses printed lamination and partial/full foil with live prices and recovers from invalid quantity', async ({
    page,
  }) => {
    await openWorkbench(page);
    await ready(page);
    await choose(page, '工艺类型', '彩印');
    await choose(page, '纸张材质', '铜版纸');
    await choose(page, '覆膜', '触感膜');
    await choose(page, '叠加烫金', '局部烫金');
    await ready(page);
    await expect(
      page
        .getByRole('group', { name: '覆膜' })
        .getByRole('button', { name: '触感膜' }),
    ).toHaveAttribute('aria-pressed', 'true');
    await choose(page, '叠加烫金', '专版烫金');
    await ready(page);
    await quote(page)
      .getByRole('spinbutton', { name: '数量', exact: true })
      .fill('0');
    await expect(quote(page).locator('p.text-3xl')).toHaveCount(0);
    await quote(page)
      .getByRole('spinbutton', { name: '数量', exact: true })
      .fill('2000');
    await ready(page);
    await expect(
      quote(page).getByRole('button', { name: '按此款式创建工单' }),
    ).toBeEnabled();
    await page.screenshot({
      path: '/tmp/workbench-printed.png',
      fullPage: true,
    });
  });
  for (const role of ['owner', 'customerService'] as const)
    test(`${role} can calculate without impersonating an external sales account`, async ({
      page,
    }) => {
      await openWorkbench(page, role);
      await ready(page);
      await expect(quote(page).locator('p.text-3xl')).toContainText(/¥|待核价/);
    });
  test('rejects a worker and retains sales knowledge search', async ({
    page,
    browser,
  }) => {
    await openWorkbench(page);
    await page.getByRole('button', { name: '话术应对', exact: true }).click();
    await page.getByRole('textbox', { name: '搜索销售话术' }).fill('太贵');
    await expect(
      page.getByText('太贵了，能不能优惠点', { exact: true }),
    ).toBeVisible();
    const context = await browser.newContext();
    const worker = await context.newPage();
    await login(worker, {
      from: '/workbench',
      username: E2E_USERS.workerHandPress!.username,
      password: E2E_PASSWORD,
    });
    await expect(worker.getByRole('heading', { name: '款式条件' })).toHaveCount(
      0,
    );
    await context.close();
  });
});
