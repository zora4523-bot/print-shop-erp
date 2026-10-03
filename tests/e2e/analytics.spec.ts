import { test, expect } from '@playwright/test';
import { E2E_USERS, E2E_PASSWORD, getUserIdByUsername, login, seedDashboardSnapshot, expectNoNextErrorOverlay } from './_helpers';

test('analytics filters, detail links, five read-only views and CSV exports work together', async ({ page }) => {
  test.setTimeout(120_000);
  const salesUserId = await getUserIdByUsername(E2E_USERS.sales.username);
  const ownerUserId = await getUserIdByUsername(E2E_USERS.owner.username);
  await seedDashboardSnapshot({ salesUserId, ownerUserId, chartFixture: true });
  await login(page, { from: '/owner/analytics', username: E2E_USERS.owner.username, password: E2E_PASSWORD });
  await expect(page.getByRole('heading', { name: '经营概览', exact: true })).toBeVisible();
  await expect(page.locator('[data-slot="dashboard-chart-deferred"]')).toHaveCount(3);
  await expect(page.locator('svg.recharts-surface').first()).toBeVisible();
  await page.getByRole('button', { name: '提交工单', exact: true }).click();
  await expect(page.getByRole('button', { name: '提交工单', exact: true })).toHaveAttribute('aria-pressed', 'true');
  await page.getByRole('button', { name: '完工工单', exact: true }).click();
  const overviewCsv = await page.request.get('/api/owner/analytics/export');
  expect(overviewCsv.status()).toBe(200); expect(await overviewCsv.text()).toContain('提交工单数');
  for (const [view, label] of [['orders', '订单与收费'], ['costs', '成本与差额'], ['structure', '工艺与纸张'], ['inventory', '采购与库存']]) {
    await page.getByRole('navigation', { name: '经营分析视图' }).getByRole('link', { name: label, exact: true }).click();
    await expect(page).toHaveURL(new RegExp(`view=${view}`));
    await expect(page.locator('[data-slot="analytics-report"]:visible')).toBeVisible();
    const response = await page.request.get(`/api/owner/analytics/export?view=${view}`);
    expect(response.status()).toBe(200); expect(response.headers()['content-type']).toContain('text/csv');
    const csv = await response.text(); expect(csv).toContain(label); expect(csv).toContain('Asia/Shanghai');
    await expectNoNextErrorOverlay(page);
  }
  await page.getByRole('link', { name: '订单与收费', exact: true }).click();
  await page.getByLabel('工单关键词', { exact: true }).fill('NO-SUCH-ANALYTICS-ORDER');
  await page.getByRole('button', { name: '筛选', exact: true }).click();
  await expect(page).toHaveURL(/q=NO-SUCH-ANALYTICS-ORDER/);
  await expect(page.getByRole('navigation', { name: '分析明细分页' })).toContainText('共 0 条');
  await page.reload();
  await expect(page.getByLabel('工单关键词', { exact: true })).toHaveValue('NO-SUCH-ANALYTICS-ORDER');
  await page.getByRole('link', { name: '清除筛选', exact: true }).click();
  await expect(page.getByLabel('工单关键词', { exact: true })).toHaveValue('');
  const details = page.getByRole('region', { name: '工单明细', exact: true });
  const orderLink = details.locator('a[href^="/orders/"]').first();
  const href = await orderLink.getAttribute('href');
  await orderLink.click(); await expect(page).toHaveURL(new RegExp(`${href}$`));
});

test('analytics rejects invalid ranges and unauthorized CSV sessions', async ({ page }) => {
  const anonymous = await page.request.get('/api/owner/analytics/export');
  expect(anonymous.status()).toBe(401);
  await login(page, { from: '/orders', username: E2E_USERS.sales.username, password: E2E_PASSWORD });
  expect((await page.request.get('/api/owner/analytics/export')).status()).toBe(401);
  await page.context().clearCookies();
  await login(page, { from: '/owner/analytics?from=2026-02-30', username: E2E_USERS.owner.username, password: E2E_PASSWORD });
  await expect(page.getByRole('alert').filter({ hasText: '请选择有效日期' })).toBeVisible();
  await page.getByRole('link', { name: '重新选择筛选' }).click();
  await expect(page.locator('[data-slot="dashboard-chart-deferred"]')).toHaveCount(3);
  expect((await page.request.get('/api/owner/analytics/export?view=orders&sales=a&sales=b')).status()).toBe(400);
});

for (const width of [390, 1280]) test(`analytics keyboard, download recovery and reduced motion at ${width}px`, async ({ page }, testInfo) => {
  test.setTimeout(90_000);
  await page.setViewportSize({ width, height: 844 });
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  await login(page, { from: '/owner/analytics?view=orders', username: E2E_USERS.owner.username, password: E2E_PASSWORD });
  const keyword = page.getByLabel('工单关键词', { exact: true });
  await keyword.focus();
  await page.keyboard.type('NO-SUCH-KEYBOARD-ORDER');
  await page.keyboard.press('Enter');
  await expect(page).toHaveURL(/q=NO-SUCH-KEYBOARD-ORDER/);
  await expect(page.getByRole('navigation', { name: '分析明细分页' })).toContainText('共 0 条');
  await page.getByRole('link', { name: '清除筛选', exact: true }).focus();
  await page.keyboard.press('Enter');
  await expect(keyword).toHaveValue('');
  const exportButton = page.getByRole('button', { name: '导出当前分析 CSV', exact: true });
  await page.route('**/api/owner/analytics/export?**', route => route.fulfill({ status: 503, contentType: 'application/json', body: JSON.stringify({ error: '测试导出暂不可用' }) }));
  await exportButton.click();
  await expect(page.getByRole('alert').filter({ hasText: /测试导出|无法|失败/ })).toBeVisible();
  await page.unroute('**/api/owner/analytics/export?**');
  let release!: () => void;
  const pause = new Promise<void>(resolve => { release = resolve; });
  await page.route('**/api/owner/analytics/export?**', async route => { await pause; await route.continue(); });
  await exportButton.click();
  await expect(page.getByRole('button', { name: '正在导出…', exact: true })).toBeDisabled();
  const download = page.waitForEvent('download'); release();
  const file = await download;
  expect(file.suggestedFilename()).toMatch(/^analytics-orders-.*\.csv$/);
  await expect(exportButton).toBeEnabled();
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.getByRole('link', { name: '成本与差额', exact: true }).click();
  await expect(page.locator('[data-slot="analytics-report"]:visible')).toBeVisible();
  await page.evaluate(() => { document.documentElement.style.zoom = '2'; });
  await expect(page.getByRole('heading', { name: '经营概览', exact: true })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth + 1)).toBe(true);
  await page.screenshot({ path: testInfo.outputPath('analytics-zoom-200.png'), fullPage: true });
  expect(errors).toEqual([]);
});


test('analytics offers a working CSV fallback without JavaScript', async ({ page, browser, baseURL }) => {
  await login(page, { from: '/owner/analytics', username: E2E_USERS.owner.username, password: E2E_PASSWORD });
  const context = await browser.newContext({ baseURL, storageState: await page.context().storageState(), javaScriptEnabled: false });
  const native = await context.newPage();
  await native.goto('/owner/analytics?view=orders');
  await expect(native.getByRole('heading', { name: '经营分析导出' })).toBeVisible();
  await native.getByLabel('分析内容', { exact: true }).selectOption('orders');
  await native.getByLabel('关键词', { exact: true }).fill('NATIVE-EMPTY-ANALYTICS');
  const downloading = native.waitForEvent('download');
  await native.getByRole('button', { name: '导出 CSV', exact: true }).click();
  expect((await downloading).suggestedFilename()).toMatch(/^analytics-orders-/);
  await context.close();
});
