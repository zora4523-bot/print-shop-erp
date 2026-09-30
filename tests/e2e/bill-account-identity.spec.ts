import { test, expect, type Page } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import Decimal from 'decimal.js';
import { formatMoney } from '../../lib/dashboard/format';
import { selectBillTheme } from './_bill-ui';
import { E2E_PASSWORD, E2E_USERS, login, midPreviousShanghaiMonth, seedSettledExternalSalesOrder, withDb } from './_helpers';

test.use({ actionTimeout: 15_000 });

test('同名大表哥账号：未出账定位、排行、操作与销售隔离', async ({ page, browser, baseURL }) => {
  test.setTimeout(180_000);
  expect(process.env.E2E_APPEND_ONLY_DATABASE_ISOLATED).toBe('1');
  const settledAt = midPreviousShanghaiMonth();
  // Append-only fixtures from earlier runs must not push these accounts out of the top ten.
  const highestReceivable = await withDb(async (db) => (await db.query<{ amount: string }>(
    `SELECT COALESCE(MAX(amount), 0)::text AS amount FROM (
      SELECT SUM("totalAmount") AS amount FROM "AgentMonthlyBill"
      WHERE status='CONFIRMED' GROUP BY "agentUserId"
    ) totals`,
  )).rows[0].amount);
  const firstFee = new Decimal(highestReceivable).plus('101.01').toFixed(2);
  const secondFee = new Decimal(highestReceivable).plus('202.02').toFixed(2);
  const first = await seedSettledExternalSalesOrder({ customerRef: '模拟大表哥订单 A', settledFee: firstFee, settledAt });
  const second = await seedSettledExternalSalesOrder({ customerRef: '模拟大表哥订单 B', settledFee: secondFee, settledAt });
  await withDb(async (db) => {
    await db.query('UPDATE "User" SET "displayName"=$1 WHERE id=ANY($2::text[])', ['大表哥', [first.agentUserId, second.agentUserId]]);
  });
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await login(page, { username: E2E_USERS.owner.username, password: E2E_PASSWORD, from: `/owner/agent-bills/unbilled?period=${first.period}` });
  const unbilled = page.getByRole('region', { name: '未出账工单列表' });
  for (const account of [first, second]) {
    const row = unbilled.getByRole('row').filter({ hasText: account.orderNo });
    await expect(row).toContainText('大表哥');
    await expect(row).toContainText(account.agentUsername);
    const href = new URL(await row.getByRole('link', { name: `查看 ${first.period} 账单` }).getAttribute('href') as string, baseURL);
    expect(href.searchParams.get('agentUserId')).toBe(account.agentUserId);
    expect(href.searchParams.get('period')).toBe(first.period);
  }
  async function checkResponsive(target: Page, name: string) {
    for (const width of [375, 393, 768, 1024, 1280, 1920]) {
      await target.setViewportSize({ width, height: 900 });
      for (const theme of ['light', 'dark'] as const) {
        await selectBillTheme(target, theme);
        expect(await target.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
        if (name === 'unbilled-accounts') {
          const accountCell = unbilled.getByRole('row').filter({ hasText: first.orderNo }).getByRole('cell').nth(1);
          expect((await accountCell.boundingBox())!.width).toBeGreaterThanOrEqual(192);
        }
        expect((await new AxeBuilder({ page: target }).include('#admin-main').analyze()).violations).toEqual([]);
        await target.screenshot({ path: test.info().outputPath(`${name}-${width}-${theme}.png`) });
      }
    }
  }
  await checkResponsive(page, 'unbilled-accounts');
  await unbilled.getByRole('row').filter({ hasText: first.orderNo }).getByRole('link', { name: `查看 ${first.period} 账单` }).click();
  await expect(page.getByRole('combobox', { name: '外部销售', exact: true })).toHaveValue(first.agentUserId);
  await page.getByRole('button', { name: '生成或更新草稿', exact: true }).click();
  await expect(page.getByText(new RegExp(`^已生成或更新 \\d+ 张 ${first.period} 账单$`))).toBeVisible();
  const bills = await withDb(async (db) => (await db.query<{ id: string; agentUserId: string; total: string }>(
    'SELECT id, "agentUserId", "totalAmount"::text AS total FROM "AgentMonthlyBill" WHERE period=$1 AND "agentUserId"=ANY($2::text[])',
    [first.period, [first.agentUserId, second.agentUserId]],
  )).rows);
  expect(bills).toHaveLength(2);
  const firstBill = bills.find((bill) => bill.agentUserId === first.agentUserId)!;
  const secondBill = bills.find((bill) => bill.agentUserId === second.agentUserId)!;
  expect(firstBill.total).toBe(firstFee);
  expect(secondBill.total).toBe(secondFee);
  for (const bill of bills) {
    await page.goto(`/owner/agent-bills/${bill.id}`);
    await page.getByRole('button', { name: '确认并冻结账单', exact: true }).click();
    await expect(page.getByRole('button', { name: '标记已收', exact: true })).toBeVisible();
  }
  await page.goto('/owner/agent-bills');
  const ranking = page.getByRole('region', { name: '外部销售待收分布' });
  for (const account of [first, second]) {
    await expect(ranking.getByRole('link').filter({ hasText: account.agentUsername })).toContainText('大表哥');
  }
  await checkResponsive(page, 'ranked-accounts');
  await ranking.getByRole('link').filter({ hasText: first.agentUsername }).click();
  await expect(page.getByRole('combobox', { name: '外部销售', exact: true })).toHaveValue(first.agentUserId);
  await expect(page.getByRole('combobox', { name: '状态', exact: true })).toHaveValue('CONFIRMED');
  const exportForm = page.locator('form').filter({ has: page.getByRole('button', { name: /导出当前结果/ }) });
  await expect(exportForm.locator('input[name="agentUserId"]')).toHaveValue(first.agentUserId);
  await page.getByRole('link', { name: '详情', exact: true }).click();
  await page.getByRole('link', { name: '录入抵扣', exact: true }).click();
  await expect(page.getByText(first.agentUsername, { exact: true })).toBeVisible();
  await expect(page.getByText(second.agentUsername, { exact: true })).toHaveCount(0);

  const salesContext = await browser.newContext({ baseURL });
  try {
    const sales = await salesContext.newPage();
    sales.on('pageerror', (error) => errors.push(error.message));
    await login(sales, { username: first.agentUsername, password: E2E_PASSWORD, from: `/sales/bills?period=${first.period}&agentUserId=${second.agentUserId}` });
    await expect(sales.getByRole('region', { name: '我的月账单' })).toContainText(formatMoney(firstFee));
    await expect(sales.getByRole('region', { name: '我的月账单' })).not.toContainText(formatMoney(secondFee));
    await sales.goto(`/sales/bills/${secondBill.id}`);
    await expect(sales.getByRole('heading', { name: '找不到这个页面，或你没有访问权限', exact: true })).toBeVisible();
    expect((await sales.request.get(`/api/owner/agent-bills/${secondBill.id}`)).status()).toBe(401);
    expect((await sales.request.get('/api/owner/agent-bills/exports/foreign')).status()).toBe(401);
  } finally {
    await salesContext.close();
  }
  expect(errors).toEqual([]);
});
