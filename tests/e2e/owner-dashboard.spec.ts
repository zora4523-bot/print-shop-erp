import { test, expect, type Page } from '@playwright/test';
import { ADMIN_PASSWORD, ADMIN_USERNAME, E2E_USERS, expectNoNextErrorOverlay, getUserIdByUsername, login, seedDashboardSnapshot } from './_helpers';

async function findLinkedRecord(page: Page, href: string) {
  // Full lists paginate all qualifying records, including earlier fixture runs.
  for (let attempts = 0; attempts < 100; attempts += 1) {
    const record = page.locator(`main a[href="${href}"]`);
    if (await record.count()) return record.first();
    const next = page.getByRole('link', { name: '下一页', exact: true });
    if (!(await next.count())) break;
    const nextHref = await next.getAttribute('href');
    expect(nextHref).toBeTruthy();
    await next.click();
    await expect(page).toHaveURL(url => `${url.pathname}${url.search}` === nextHref, { timeout: 15_000 });
    await expect(page.locator('main [data-slot="table-body"]')).toBeVisible();
  }
  throw new Error(`Expected fixture record missing from full attention list: ${href}`);
}

test('工作台重点记录、完整关注列表和经营概览可连续使用', async ({ page }) => {
  test.setTimeout(120_000);
  const salesUserId = await getUserIdByUsername(E2E_USERS.sales.username);
  const csUserId = await getUserIdByUsername(E2E_USERS.customerService.username);
  const seeded = await seedDashboardSnapshot({ salesUserId, csUserId });
  await login(page, { from: '/owner', username: ADMIN_USERNAME, password: ADMIN_PASSWORD });
  await expect(page.getByRole('heading', { name: '工作台', exact: true })).toBeVisible();
  const kpis = page.locator('[data-slot="dashboard-kpi"]');
  await expect(kpis).toHaveCount(4);
  await expect(kpis.filter({ hasText: '今日提交工单' })).toContainText(/其中急单 \d+/);
  await expect(kpis.filter({ hasText: '今日完工' })).not.toContainText(/较昨日|与昨日持平/);
  const bill = kpis.filter({ hasText: '本月已出账金额' });
  await expect(bill).toContainText(/已收 ¥ [\d,]+\.\d{2}/);
  const match = /本月已出账金额¥ ([\d,]+\.\d{2})/.exec(await bill.innerText());
  // innerText may contain a line break between label and value.
  const amountText = await bill.textContent();
  const amount = match?.[1] ?? /本月已出账金额¥ ([\d,]+\.\d{2})/.exec(amountText ?? '')?.[1];
  expect(Number(amount?.replace(/,/g, ''))).toBeGreaterThanOrEqual(5000);
  await expect(page.locator('[data-slot="dashboard-queue"]')).toHaveCount(0);
  await expect(page.locator('[data-slot="dashboard-charts-deferred"]')).toHaveCount(0);
  for (const kind of ['due', 'shipments', 'outsource', 'over-reports', 'settlements']) {
    const panel = page.locator(`[data-slot="dashboard-watchlist-${kind}"]`);
    await expect(panel).toBeVisible();
    expect(await panel.locator('li').count()).toBeLessThanOrEqual(3);
  }
  const settlements = page.locator('[data-slot="dashboard-watchlist-settlements"]');
  await expect(settlements).not.toContainText('预测提成');
  await expect(settlements).not.toContainText('预测总收入');

  await page.getByRole('link', { name: '查看全部待发货工单' }).click();
  await expect(page).toHaveURL(/kind=shipments/, { timeout: 15_000 });
  await expect(page.getByRole('columnheader', { name: '待发时长' })).toBeVisible();
  const shipmentLink = await findLinkedRecord(page, `/orders/${seeded.completedOrderIds[0]}`);
  await expect(shipmentLink).toBeVisible();
  await shipmentLink.click();
  await expect(page).toHaveURL(new RegExp(`/orders/${seeded.completedOrderIds[0]}`), { timeout: 15_000 });
  await expectNoNextErrorOverlay(page);

  await page.goto('/owner/attention?kind=outsource');
  await expect(page.locator('main [data-slot="table-body"]')).toBeVisible();
  await expect(await findLinkedRecord(page, `/foreman/outsource/${seeded.outsourceId}`)).toBeVisible();
  if (seeded.csPeriodId) {
    await page.goto('/owner/attention?kind=settlements');
    await expect(page.locator('main [data-slot="table-body"]')).toBeVisible();
    const period = await findLinkedRecord(page, `/owner/salary/cs/${seeded.csPeriodId}`);
    await period.click();
    await expect(page).toHaveURL(new RegExp(`/owner/salary/cs/${seeded.csPeriodId}`), { timeout: 15_000 });
    await expect(page.getByText('预测总收入', { exact: true })).toBeVisible();
  }

  await page.goto('/owner');
  await page.getByRole('navigation', { name: '工作台快捷操作' }).getByRole('link', { name: '经营概览' }).click();
  await expect(page).toHaveURL(/\/owner\/analytics/, { timeout: 15_000 });
  const charts = page.locator('[data-slot="dashboard-chart-deferred"]:visible');
  await expect(charts).toHaveCount(3);
  for (const [index, slot] of ['trend', 'ranking', 'category'].entries()) {
    const card = page.locator(`[data-slot="dashboard-chart-${slot}-card"]`);
    await charts.nth(index).scrollIntoViewIfNeeded();
    await expect(card).toBeVisible();
  }
  await expect(page.locator('svg.recharts-surface').first()).toBeVisible();
  await page.getByRole('link', { name: '返回工作台' }).click();
  await expect(page).toHaveURL(/\/owner$/);
  await expectNoNextErrorOverlay(page);
});
