import { test, expect } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import { selectBillTheme, waitForBillPaint } from './_bill-ui';
import { expectViewportGate } from '../visual/ui-gates';
import { login, withDb, E2E_USERS, E2E_PASSWORD, midPreviousShanghaiMonth, seedSettledExternalSalesOrder, uniqueSuffix } from './_helpers';

test.use({ actionTimeout: 15_000 });

// Independent append-only accounts avoid altering any existing financial history.
test('月账单两端关联、跨月抵扣、历史依据与响应式浏览', async ({ page, browser, baseURL }) => {
  test.setTimeout(360_000);
  expect(process.env.E2E_APPEND_ONLY_DATABASE_ISOLATED).toBe('1');
  const targetDate = midPreviousShanghaiMonth();
  const sourceDate = new Date(targetDate);
  sourceDate.setUTCMonth(sourceDate.getUTCMonth() - 1);
  const source = await seedSettledExternalSalesOrder({ customerRef: `bill-workspace-${uniqueSuffix()}`, settledFee: '100.00', settledAt: sourceDate });
  const target = await seedSettledExternalSalesOrder({ customerRef: `bill-workspace-next-${uniqueSuffix()}`, settledFee: '20.00', settledAt: targetDate });
  await withDb(async (db) => {
    await db.query('UPDATE "Order" SET "submitterId"=$1, "createdById"=$1 WHERE id=$2', [source.agentUserId, target.orderId]);
    await db.query('UPDATE "Order" SET "customName"=$1 WHERE id=$2', ['结算时的礼盒', source.orderId]);
  });
  const pageErrors: string[] = [];
  page.on('pageerror', (error) => pageErrors.push(error.message));
  await login(page, { username: E2E_USERS.owner.username, password: E2E_PASSWORD, from: '/owner/agent-bills' });
  async function generate(period: string) {
    await page.goto(`/owner/agent-bills?period=${period}&agentUserId=${source.agentUserId}`);
    await page.getByLabel('结算发生月（上海时区）', { exact: true }).fill(period);
    await page.getByRole('button', { name: '生成或更新草稿', exact: true }).click();
    await expect(page.getByText(new RegExp(`^已生成或更新 \\d+ 张 ${period} 账单$`))).toBeVisible();
    const bill = await withDb(async (db) => (await db.query<{ id: string }>('SELECT id FROM "AgentMonthlyBill" WHERE "agentUserId"=$1 AND period=$2', [source.agentUserId, period])).rows[0]);
    return bill.id;
  }
  await page.locator('section[aria-label="最近十二个账期金额"]').getByRole('link', { name: new RegExp(`^${source.period}`) }).click();
  await expect(page).toHaveURL(new RegExp(`period=${source.period}`));
  await expect(page.getByLabel('账期', { exact: true })).toHaveValue(source.period);
  await page.goto(`/owner/agent-bills/unbilled?period=${source.period}`);
  await expect(page.locator(`a[href="/orders/${source.orderId}"]`)).toBeVisible();
  const sourceId = await generate(source.period);
  await page.getByRole('link', { name: '详情', exact: true }).click();
  await expect(page.getByText('整单金额（未定稿）', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: '确认账单', exact: true }).click();
  await expect(page.getByRole('button', { name: '标记已收', exact: true })).toBeVisible();
  await page.getByLabel('收款方式', { exact: true }).fill('测试转账');
  await page.getByRole('button', { name: '标记已收', exact: true }).click();
  await expect(page.getByRole('heading', { name: '收款记录', exact: true })).toBeVisible();
  await page.getByRole('link', { name: '录入抵扣', exact: true }).click();
  for (const width of [320, 375, 390, 393, 430, 768, 944, 1024, 1280, 1920]) {
    await page.setViewportSize({ width, height: 900 });
    for (const theme of ['light', 'dark'] as const) {
      await selectBillTheme(page, theme);
      const info = test.info();
      await expectViewportGate(page, {
        ...info,
        project: { ...info.project, use: { ...info.project.use, viewport: { width, height: 900 } } },
      });
      expect((await new AxeBuilder({ page }).include('#admin-main').analyze()).violations).toEqual([]);
    }
  }
  await page.getByLabel(/^抵扣金额/).fill('30.00');
  await page.getByLabel('原因', { exact: true }).fill('仅管理员可见的质量调整');
  await page.getByRole('button', { name: '录入抵扣', exact: true }).click();
  await expect(page.getByRole('status')).toContainText('抵扣已记录');
  await expect(page.getByLabel(/^抵扣金额/)).toHaveAccessibleName(/70\.00/);
  const targetId = await generate(target.period);
  await page.goto(`/owner/agent-bills/${targetId}`);
  await expect(page.getByText('本月抵扣明细')).toBeVisible();
  await page.getByRole('button', { name: '确认账单', exact: true }).click();
  await expect(page.getByRole('heading', { name: '收款记录', exact: true })).toBeVisible();
  await expect(page.getByText('零元自动结清')).toBeVisible();
  await withDb(async (db) => {
    const receipt = await db.query('SELECT amount::text, "paymentMethod" FROM "AgentMonthlyBillReceipt" WHERE "billId"=$1', [targetId]);
    expect(receipt.rows).toEqual([{ amount: '0.00', paymentMethod: '零元自动结清' }]);
    const sum = await db.query('SELECT SUM(amount)::text AS amount FROM "AgentMonthlyBillAdjustment" WHERE "billId"=$1', [targetId]);
    expect(sum.rows[0].amount).toBe('-20.00');
    await expect(db.query('UPDATE "AgentMonthlyBillItem" SET "settlementDetailSnapshot"=NULL WHERE "billId"=$1', [sourceId])).rejects.toThrow(/immutable|DRAFT/);
    await db.query('UPDATE "Order" SET "customName"=$1 WHERE id=$2', ['改名后的工单', source.orderId]);
  });
  await page.goto(`/owner/agent-bills/${sourceId}`);
  await expect(page.getByText('结算时的礼盒', { exact: true })).toBeVisible();
  await expect(page.getByText('改名后的工单', { exact: true })).toHaveCount(0);
  const open = page.getByRole('button', { name: `查看 ${source.orderNo} 明细`, exact: true });
  await open.click();
  const sheet = page.getByRole('dialog');
  await expect(sheet).toContainText('已抵扣 ¥ 20.00 · 待抵扣 ¥ 10.00');
  await expect(sheet.getByRole('link', { name: new RegExp(target.period) })).toHaveAttribute('href', `/owner/agent-bills/${targetId}`);
  await expect(sheet).toContainText('加工费');
  await page.keyboard.press('Escape');
  await expect(open).toBeFocused();

  const salesContext = await browser.newContext({ baseURL, hasTouch: true, reducedMotion: 'reduce' });
  const sales = await salesContext.newPage();
  sales.on('pageerror', (error) => pageErrors.push(error.message));
  await login(sales, { username: source.agentUsername, password: E2E_PASSWORD, from: `/sales/bills?period=${source.period}` });
  await sales.getByRole('link', { name: `查看 ${source.period} 账单详情`, exact: true }).click();
  await expect(sales.getByRole('link', { name: '返回我的货款账单' })).toHaveAttribute('href', `/sales/bills?period=${source.period}`);
  const receiptToggle = sales.locator('summary').filter({ hasText: '工厂收款记录' });
  await expect(receiptToggle).toContainText('已收');
  await expect(sales.getByText('测试转账', { exact: true })).toBeHidden();
  await receiptToggle.focus();
  await sales.keyboard.press('Enter');
  await expect(sales.getByText('测试转账', { exact: true })).toBeVisible();
  await sales.keyboard.press('Enter');
  await expect(sales.getByText('测试转账', { exact: true })).toBeHidden();
  for (const width of [320, 375, 390, 393, 430, 768, 944, 1024, 1280, 1920]) {
    await sales.setViewportSize({ width, height: 900 });
    await page.setViewportSize({ width, height: 900 });
    await page.goto(`/owner/agent-bills?agentUserId=${source.agentUserId}`);
    for (const theme of ['light', 'dark'] as const) {
      await selectBillTheme(page, theme);
      const viewportInfo = test.info();
      await expectViewportGate(page, {
        ...viewportInfo,
        project: { ...viewportInfo.project, use: { ...viewportInfo.project.use, viewport: { width, height: 900 } } },
      });
      const billList = page.getByRole('region', { name: '外部销售月账单列表', exact: true });
      for (const cell of await billList.locator('tbody td:nth-child(4), tbody td:nth-child(5), tbody td:nth-child(6)').all()) {
        const lines = await cell.evaluate((element) => {
          const range = document.createRange();
          range.selectNodeContents(element);
          return new Set([...range.getClientRects()].filter((r) => r.width && r.height).map((r) => Math.round(r.top))).size;
        });
        expect(lines, '金额与货币符号保持同一行').toBe(1);
      }
      await page.getByText('账单概览', { exact: true }).click();
      await page.getByText('查看账期数据表', { exact: true }).click();
      const adminOverflow = await page.evaluate(() => ({
        width: innerWidth,
        scrollWidth: document.documentElement.scrollWidth,
        elements: [...document.querySelectorAll<HTMLElement>('body *')]
          .filter((element) => element.checkVisibility() && element.getBoundingClientRect().right > innerWidth)
          .map((element) => ({ tag: element.tagName, className: element.className, text: element.textContent?.slice(0, 80), right: element.getBoundingClientRect().right })),
      }));
      expect(adminOverflow.scrollWidth, JSON.stringify(adminOverflow)).toBeLessThanOrEqual(adminOverflow.width);
      const adminAxe = await new AxeBuilder({ page }).include('#admin-main').analyze();
      expect(adminAxe.violations).toEqual([]);
      await page.screenshot({ path: test.info().outputPath(`bill-admin-${width}-${theme}.png`), fullPage: true });
      await page.getByText('查看账期数据表', { exact: true }).click();
      await page.getByText('账单概览', { exact: true }).click();
      await sales.goto(`/sales/bills?period=${source.period}`);
      await selectBillTheme(sales, theme);
      await expect(sales.getByRole('region', { name: '我的月账单', exact: true })).toContainText('1 单');
      await expect(sales.getByRole('heading', { name: '账期概览', exact: true })).toBeHidden();
      const billResults = await sales.locator('#sales-bill-results:visible').boundingBox();
      const trendToggle = sales.locator('summary:visible').filter({ hasText: '查看账期金额分布' });
      const toggleBox = await trendToggle.boundingBox();
      expect(billResults!.y + billResults!.height).toBeLessThanOrEqual(toggleBox!.y);
      await trendToggle.click();
      await expect(sales.getByRole('heading', { name: '账期概览', exact: true })).toBeVisible();
      const overview = sales.getByRole('list', { name: '我的账期概览' });
      await expect(overview.getByRole('link')).toHaveCount(2);
      await waitForBillPaint(sales);
      expect(await sales.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
      expect((await new AxeBuilder({ page: sales }).include('#admin-main').analyze()).violations).toEqual([]);
      await sales.screenshot({ path: test.info().outputPath(`bill-sales-list-${width}-${theme}.png`), fullPage: true });
      await overview.getByRole('link', { name: new RegExp(`^${target.period}`) }).tap();
      await expect(sales.getByLabel('账期', { exact: true })).toHaveValue(target.period);
      await sales.goto(`/sales/bills?period=${source.period}`);
      await sales.getByRole('link', { name: `查看 ${source.period} 账单详情`, exact: true }).tap();
      const evidenceTrigger = sales.getByRole('button', { name: `查看 ${source.orderNo} 明细`, exact: true });
      await expect(evidenceTrigger).toHaveText(source.orderNo);
      const triggerBox = await evidenceTrigger.boundingBox();
      expect(triggerBox!.height).toBeGreaterThanOrEqual(44);
      await evidenceTrigger.tap();
      const detail = sales.getByRole('dialog');
      await expect(detail).toBeVisible();
      await expect(detail).toContainText('已抵扣 ¥ 20.00 · 待抵扣 ¥ 10.00');
      await expect(detail).not.toContainText('仅管理员可见的质量调整');
      expect(await sales.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
      const close = detail.getByRole('button', { name: '关闭', exact: true });
      const box = await close.boundingBox();
      expect(box!.width).toBeGreaterThanOrEqual(44);
      expect(box!.height).toBeGreaterThanOrEqual(44);
      const axe = await new AxeBuilder({ page: sales }).include('[role="dialog"]').analyze();
      expect(axe.violations).toEqual([]);
      await sales.screenshot({ path: test.info().outputPath(`bill-detail-${width}-${theme}.png`) });
      await close.tap();
      await expect(sales.getByRole('button', { name: `查看 ${source.orderNo} 明细`, exact: true })).toBeFocused();
    }
  }
  await sales.goto(`/orders?q=${source.orderNo}`);
  const orderCard = sales.locator(`[data-order-id="${source.orderId}"]:visible`);
  await expect(orderCard.getByRole('link', { name: `${source.period} 账单 · 已结清` })).toHaveAttribute('href', `/sales/bills/${sourceId}`);
  // The independently generated account has no ownership of these bills.
  const otherContext = await browser.newContext({ baseURL });
  const other = await otherContext.newPage();
  await login(other, { username: target.agentUsername, password: E2E_PASSWORD, from: '/sales/bills' });
  await other.goto(`/sales/bills/${sourceId}`);
  await expect(other.getByText('结算时的礼盒', { exact: true })).toHaveCount(0);
  await expect(other.getByRole('heading', { name: '找不到这个页面，或你没有访问权限', exact: true })).toBeVisible();
  expect(pageErrors).toEqual([]);
  await otherContext.close();
  await salesContext.close();
});
