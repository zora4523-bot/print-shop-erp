import { readFile } from 'node:fs/promises';
import { test, expect, type Page } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import { E2E_USERS, E2E_PASSWORD, login, withDb, seedDraftAgentMonthlyBill, seedSettledExternalSalesOrder, midPreviousShanghaiMonth } from './_helpers';
import { selectBillTheme } from './_bill-ui';

async function downloadCsv(page: Page, label: string) {
  const downloadPromise = page.waitForEvent('download');
  await page.getByText(label, { exact: true }).click();
  const download = await downloadPromise;
  expect(download.suggestedFilename()).toMatch(/\.csv$/);
  const path = await download.path();
  expect(path).toBeTruthy();
  return readFile(path!, 'utf8');
}

test('销售总览联动列表、跨页账单导出和失败重试保持账号隔离', async ({ page, browser, baseURL }) => {
  test.setTimeout(240_000);
  expect(process.env.E2E_APPEND_ONLY_DATABASE_ISOLATED).toBe('1');
  const source = await seedSettledExternalSalesOrder({ customerRef: '总览导出回归', settledFee: '123.45', settledAt: midPreviousShanghaiMonth() });
  const foreign = await seedSettledExternalSalesOrder({ customerRef: '另一账号独立订单', settledFee: '999.99', settledAt: midPreviousShanghaiMonth() });
  const billId = await seedDraftAgentMonthlyBill(source);
  const foreignBillId = await seedDraftAgentMonthlyBill(foreign);
  await withDb(async (db) => {
    await db.query('UPDATE "Order" SET "customName"=$2, "createdAt"=$3 WHERE id=$1', [source.orderId, '导出时的工单名称', '2026-06-30T16:00:00Z']);
    // Append-only facts in a fresh test account: one bill exceeds a 30-row page.
    // Prisma stores UTC in timestamp-without-time-zone columns; avoid session-zone conversion.
    await db.query(`INSERT INTO "Order" (id,"orderNo","submitterId","submitterRole","createdById","settlementType","billingMode",status,"customName","processingAmount","totalAmount","confirmedFee","settledFee","settledAt","settlementContractVersion","pricingStatus","pricingConfirmedAt","pricingConfirmedById","createdAt","updatedAt")
      SELECT source.id || '-extra-' || n, source."orderNo" || '-extra-' || n, source."submitterId", source."submitterRole", source."createdById", source."settlementType", source."billingMode", source.status, '分页测试工单 ' || n,
      1.25, 1.25, 1.25, 1.25, source."settledAt", 2, source."pricingStatus", source."pricingConfirmedAt", source."pricingConfirmedById",
      CASE WHEN n=32 THEN TIMESTAMP '2026-07-31 16:00:00' ELSE TIMESTAMP '2026-07-31 15:59:59' END, NOW()
      FROM "Order" source CROSS JOIN generate_series(1,32) n WHERE source.id=$1`, [source.orderId]);
  });
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await login(page, { from: `/owner/agent-bills/${billId}`, username: E2E_USERS.owner.username, password: E2E_PASSWORD });
  await page.getByRole('button', { name: '确认账单', exact: true }).click();
  await expect(page.getByRole('button', { name: '标记已收', exact: true })).toBeVisible();
  await page.goto(`/owner/agent-bills/${foreignBillId}`);
  await page.getByRole('button', { name: '确认账单', exact: true }).click();
  await expect(page.getByRole('button', { name: '标记已收', exact: true })).toBeVisible();
  await withDb(async (db) => {
    await db.query('UPDATE "Order" SET "customName"=$2 WHERE id=$1', [source.orderId, '后来改过的名称']);
  });
  await page.context().clearCookies();
  await login(page, { from: '/sales/overview', username: source.agentUsername, password: E2E_PASSWORD });
  await expect(page.getByRole('heading', { name: '我的总览', exact: true })).toBeVisible();
  await expect(page.getByRole('link', { name: /全部工单 33 张/ })).toBeVisible();
  await expect(page.getByRole('link', { name: /^待付款.*163\.45/ })).toBeVisible();
  await expect(page.getByRole('list', { name: '我的账期概览' })).toBeVisible();
  await page.getByRole('link', { name: /全部工单 33 张/ }).click();
  await page.getByLabel('下单月份', { exact: true }).fill('2026-07');
  await page.getByRole('button', { name: '应用筛选', exact: true }).click();
  await expect(page).toHaveURL(/createdMonth=2026-07/);
  await expect(page.getByText('共 32 条', { exact: false }).first()).toBeVisible();
  await expect(page.locator(`[data-order-id="${source.orderId}-extra-32"]:visible`)).toHaveCount(0);
  await page.goto(`/sales/bills?period=${source.period}&status=CONFIRMED`);
  const summary = await downloadCsv(page, '导出当前筛选 CSV');
  expect(summary).toContain(source.period);
  expect(summary).toContain('"163.45"');
  expect(summary).not.toContain('"999.99"');
  expect(summary.trim().split('\r\n')).toHaveLength(2);
  await page.getByRole('link', { name: `查看 ${source.period} 账单详情`, exact: true }).click();
  await expect(page.getByRole('region', { name: '账单明细', exact: true }).getByText('33 单', { exact: true })).toBeVisible();
  await page.setViewportSize({ width: 1280, height: 900 });
  const memberTable = page.getByRole('table');
  await expect(memberTable.getByRole('row')).toHaveCount(31);
  await expect(memberTable.getByRole('columnheader', { name: '工单金额', exact: true })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.screenshot({ path: test.info().outputPath('sales-bill-records-1280.png'), fullPage: false });
  const csv = await downloadCsv(page, '导出账单明细 CSV');
  expect(csv).toContain('导出时的工单名称');
  expect(csv).not.toContain('后来改过的名称');
  expect(csv).toContain(`${source.orderNo}-extra-32`);
  expect(csv).not.toContain(foreign.orderNo);
  // 表头 + 33 张工单 + 3 行账单合计（工单合计 / 抵扣 / 账单金额，取账单冻结值）。
  const csvLines = csv.trim().split('\r\n');
  expect(csvLines).toHaveLength(37);
  expect(csvLines.filter((line) => line.startsWith('"合计"')).map((line) => line.split(',')[5])).toEqual(['"工单合计"', '"抵扣 / 补收"', '"账单金额"']);
  expect(csv).toContain(`"${source.orderNo}"`);
  for (let n = 1; n <= 32; n += 1) expect(csv).toContain(`"${source.orderNo}-extra-${n}"`);
  await page.getByLabel('查找账单内工单', { exact: true }).fill('导出时的工单名称');
  await page.getByRole('button', { name: '搜索', exact: true }).click();
  const filteredCsv = await downloadCsv(page, '导出匹配明细 CSV');
  expect(filteredCsv).toContain('导出时的工单名称');
  expect(filteredCsv).not.toContain(`${source.orderNo}-extra-`);
  // 筛选导出只标注「非全账单」，不输出整单合计。
  expect(filteredCsv).toContain('筛选结果，非全账单');
  expect(filteredCsv.split('\r\n').some((line) => line.startsWith('"合计"'))).toBe(false);
  // A non-file error must be shown in place and must not be downloaded as CSV.
  await page.route('**/api/sales/bills/*/export?*', (route) => route.fulfill({ status: 503, contentType: 'application/json', body: JSON.stringify({ message: '导出暂时不可用，请重试' }) }));
  await page.getByText('导出匹配明细 CSV', { exact: true }).click();
  await expect(page.locator('#admin-main').getByRole('alert')).toBeVisible();
  await expect(page.getByRole('heading', { name: `${source.period} 货款账单`, exact: true })).toBeVisible();
  await page.unroute('**/api/sales/bills/*/export?*');
  expect(await downloadCsv(page, '导出匹配明细 CSV')).toContain('导出时的工单名称');
  await expect(page.locator('#admin-main').getByRole('alert')).toHaveCount(0);
  const otherContext = await browser.newContext({ baseURL });
  const other = await otherContext.newPage();
  await login(other, { from: '/sales/overview', username: foreign.agentUsername, password: E2E_PASSWORD });
  await expect(other.getByRole('link', { name: /全部工单 1 张/ })).toBeVisible();
  const denied = await other.request.get(`/api/sales/bills/${billId}/export`);
  expect(denied.status()).toBe(404);
  expect(await denied.text()).not.toContain(source.orderNo);
  const forged = await other.request.get(`/api/sales/bills/export?agentUserId=${source.agentUserId}`);
  expect(forged.status()).toBe(200);
  expect(forged.headers()['content-type']).toContain('text/csv');
  const ownCsv = await forged.text();
  expect(ownCsv).toContain('"999.99"');
  expect(ownCsv).not.toContain('"163.45"');
  expect(ownCsv.trim().split('\r\n')).toHaveLength(2);
  await otherContext.close();
  expect(errors).toEqual([]);
});

test('销售总览六视口明暗主题：范围与导航可见、无溢出且键盘触控可用', async ({ page }) => {
  test.setTimeout(180_000);
  const source = await seedSettledExternalSalesOrder({ customerRef: '看板响应式', settledFee: '1.00', settledAt: midPreviousShanghaiMonth() });
  await seedDraftAgentMonthlyBill(source);
  await login(page, { from: '/sales/overview', username: source.agentUsername, password: E2E_PASSWORD });
  for (const [width, height] of [[375,667], [393,852], [768,1024], [1024,768], [1280,800], [1920,1080]]) {
    await page.setViewportSize({ width, height });
    for (const theme of ['light', 'dark'] as const) {
      await selectBillTheme(page, theme);
      await expect(page.getByRole('heading', { name: '我的总览', exact: true })).toBeVisible();
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
      const cardWidths = await page.locator('[data-slot="dashboard-kpi"]').evaluateAll((cards) => cards.map((card) => ({ card: card.getBoundingClientRect().width, link: card.parentElement!.getBoundingClientRect().width })));
      for (const widths of cardWidths) expect(Math.abs(widths.card - widths.link)).toBeLessThan(1);
      const smallTargets = await page.locator('#admin-main').evaluate((element, mobile) => mobile ? [...element.querySelectorAll<HTMLElement>('a[href], button:not([disabled]), input:not([type=hidden]), select')].filter((el) => el.checkVisibility()).filter((el) => { const box = el.getBoundingClientRect(); return box.width < 44 || box.height < 44; }).map((el) => el.textContent) : [], width <= 768);
      expect(smallTargets).toEqual([]);
      expect((await new AxeBuilder({ page }).include('#admin-main').analyze()).violations).toEqual([]);
      await page.screenshot({ path: test.info().outputPath(`sales-overview-${width}-${theme}.png`), fullPage: true });
    }
  }
});
