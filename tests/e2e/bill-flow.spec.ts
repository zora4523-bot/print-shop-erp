import { Client } from 'pg';
import { test, expect, type Page } from '@playwright/test';
import {
  login,
  uniqueSuffix,
  E2E_PASSWORD,
  E2E_USERS,
  seedSettledExternalSalesOrder,
  midPreviousShanghaiMonth,
} from './_helpers';

// Keep immutable financial facts in a fresh E2E-only ownership scope. These
// fixtures are never deleted or recycled to make a later run pass.
function requireIsolatedDatabase(): void {
  if (process.env.E2E_APPEND_ONLY_DATABASE_ISOLATED !== '1') {
    throw new Error('账单事务测试必须使用独立 E2E_DATABASE_URL');
  }
}

async function readBill(agentUserId: string, period: string) {
  requireIsolatedDatabase();
  const db = new Client({ connectionString: process.env.DATABASE_URL });
  await db.connect();
  try {
    const bills = await db.query<{
      id: string;
      status: string;
      totalAmount: string;
      confirmedAt: Date | null;
      paidAt: Date | null;
    }>(
      'SELECT id, status::text, "totalAmount"::text, "confirmedAt", "paidAt" FROM "AgentMonthlyBill" WHERE "agentUserId"=$1 AND period=$2',
      [agentUserId, period],
    );
    expect(bills.rows).toHaveLength(1);
    const bill = bills.rows[0]!;
    const items = await db.query(
      'SELECT "orderId", "settledFeeSnapshot"::text, "orderNoSnapshot", "settledAtSnapshot", "workOrderVersionSnapshot", "settlementDetailSnapshot" FROM "AgentMonthlyBillItem" WHERE "billId"=$1 ORDER BY id',
      [bill.id],
    );
    const receipts = await db.query(
      'SELECT id, amount::text, "idempotencyKey", "referenceNo", "receivedAt" FROM "AgentMonthlyBillReceipt" WHERE "billId"=$1',
      [bill.id],
    );
    const credits = await db.query(
      'SELECT credit.id, credit."requestedAmount"::text, credit.reason FROM "AgentMonthlyBillCredit" credit JOIN "AgentMonthlyBillItem" item ON item.id=credit."sourceItemId" WHERE item."billId"=$1 ORDER BY credit.id',
      [bill.id],
    );
    return { bill, items: items.rows, receipts: receipts.rows, credits: credits.rows };
  } finally {
    await db.end();
  }
}

async function generateDraft(page: Page, period: string, scriptsPending = false): Promise<void> {
  const form = page.locator('form').filter({ has: page.locator('#agent-bill-period') });
  await page.getByLabel('结算发生月（上海时区）', { exact: true }).fill(period);
  await page.getByRole('button', { name: '生成或更新草稿', exact: true }).click({ noWaitAfter: scriptsPending });
  await expect(form.getByText(new RegExp(`^已生成或更新 \\d+ 张 ${period} 账单$`, 'u'))).toBeVisible();
  await expect(form).toHaveAttribute('aria-busy', 'false');
  await expect(page.getByRole('button', { name: '生成或更新草稿', exact: true })).toBeEnabled();
}

for (const mode of ['hydrated', 'native'] as const) {
  test.describe(`代理商月度账单 v2 全链 — ${mode}`, () => {
    if (mode === 'native') test.use({ javaScriptEnabled: false });

    test('生成 → 冻结 → 收款与重试 → 负项，保持金额和历史成员', async ({ page }) => {
      test.setTimeout(90_000);
      requireIsolatedDatabase();
      const fixture = await seedSettledExternalSalesOrder({
        customerRef: `e2e-agent-bill-${uniqueSuffix()}`,
        settledFee: '5000.00',
        settledAt: midPreviousShanghaiMonth(),
      });
      const pageErrors: string[] = [];
      page.on('pageerror', (error) => pageErrors.push(error.message));

      await test.step('旧入口切换到月账单，验证真实页面已可交互', async () => {
        await login(page, { from: '/owner/bills', username: E2E_USERS.owner!.username, password: E2E_PASSWORD });
        await page.waitForURL(/\/owner\/agent-bills(?:\?.*)?$/);
        await expect(page.getByRole('heading', { name: '外部销售月账单', exact: true })).toBeVisible();
        if (mode === 'hydrated') {
          // Opening the real client dropdown proves hydration before submitting.
          await page.locator('button[aria-label^="用户菜单"]').click();
          await expect(page.getByRole('menu')).toBeVisible();
          await page.keyboard.press('Escape');
        } else {
          await expect(page.locator('input[name^="$ACTION_"]').first()).toBeAttached();
        }
      });

      await test.step('生成草稿与重复生成均完成，不重复归集成员', async () => {
        await generateDraft(page, fixture.period);
        await generateDraft(page, fixture.period);
        const state = await readBill(fixture.agentUserId, fixture.period);
        expect(state.bill.status).toBe('DRAFT');
        expect(state.bill.totalAmount).toBe('5000.00');
        expect(state.items).toHaveLength(1);
        expect(state.items[0]).toMatchObject({ orderId: fixture.orderId, settledFeeSnapshot: '5000.00', settlementDetailSnapshot: { schemaVersion: 1, processingAmount: '5000.00' } });
        expect(state.receipts).toHaveLength(0);
        await page.goto(`/owner/agent-bills?period=${fixture.period}&agentUserId=${fixture.agentUserId}`);
        await expect(page.getByRole('button', { name: /导出当前结果/u })).toBeVisible();
        const row = page.locator('table tbody tr').filter({ hasText: fixture.agentDisplayName });
        await expect(row).toContainText('草稿');
        await row.getByRole('link', { name: '详情', exact: true }).click();
        await page.waitForURL((url) => url.pathname === `/owner/agent-bills/${state.bill.id}`);
        await expect(page.getByRole('heading', { name: '账单明细', exact: true })).toBeVisible();
        await expect(page.locator('table tbody').getByText(fixture.orderNo, { exact: true })).toBeVisible();
      });

      await test.step('确认冻结后记录数据库成员和总额', async () => {
        await page.getByRole('button', { name: '确认账单', exact: true }).click();
        await expect(page.locator('[data-slot="badge"]').filter({ hasText: /^已确认·待收$/ })).toBeVisible();
        const state = await readBill(fixture.agentUserId, fixture.period);
        expect(state.bill.status).toBe('CONFIRMED');
        expect(state.bill.confirmedAt).not.toBeNull();
        expect(state.bill.totalAmount).toBe('5000.00');
        expect(state.receipts).toHaveLength(0);
      });
      const frozen = await readBill(fixture.agentUserId, fixture.period);

      await test.step('非法客户端金额仍被拒绝，返回中文且没有收款', async () => {
        await page.getByLabel('收款方式', { exact: true }).fill('银行转账');
        const form = page.locator('form').filter({ has: page.getByRole('button', { name: '标记已收', exact: true }) });
        // Exercise the real action protocol with a tampered business field.
        await form.evaluate((element) => {
          const input = document.createElement('input');
          input.type = 'hidden'; input.name = 'amount'; input.value = '0.01';
          element.appendChild(input);
        });
        await form.getByRole('button', { name: '标记已收', exact: true }).click({ timeout: 10_000 });
        await expect(form.getByText('提交内容包含页面不支持的字段，请刷新后重试', { exact: true })).toBeVisible();
        const state = await readBill(fixture.agentUserId, fixture.period);
        expect(state.bill.status).toBe('CONFIRMED');
        expect(state.receipts).toHaveLength(0);
        expect(state.items).toEqual(frozen.items);
        await page.reload();
      });

      await test.step('整单收款并重放同一真实请求，只保留一张回执', async () => {
        await page.getByLabel('收款方式', { exact: true }).fill('银行转账');
        const referenceNo = `E2E-${uniqueSuffix()}`;
        await page.getByLabel('流水号', { exact: true }).fill(referenceNo);
        const requestPromise = page.waitForRequest((request) => request.method() === 'POST' && new URL(request.url()).pathname === `/owner/agent-bills/${frozen.bill.id}`);
        await page.getByRole('button', { name: '标记已收', exact: true }).click();
        const receiptRequest = await requestPromise;
        await expect(page.locator('[data-slot="badge"]').filter({ hasText: /^已收$/ })).toBeVisible();
        const receiptSection = page.locator('section').filter({ has: page.getByRole('heading', { name: '收款记录', exact: true }) });
        await expect(receiptSection).toContainText('5,000.00');
        await expect(receiptSection).toContainText(referenceNo);
        const paid = await readBill(fixture.agentUserId, fixture.period);
        expect(paid.receipts).toHaveLength(1);
        expect(paid.receipts[0]).toMatchObject({ amount: '5000.00', referenceNo });
        expect(paid.items).toEqual(frozen.items);
        expect(paid.bill.status).toBe('PAID');
        expect(paid.bill.paidAt).not.toBeNull();
        const replay = await page.request.fetch(receiptRequest);
        expect(replay.status()).toBe(200);
        await replay.dispose();
        expect(await readBill(fixture.agentUserId, fixture.period)).toEqual(paid);
        await page.reload();
        await expect(page.getByRole('button', { name: '标记已收', exact: true })).toHaveCount(0);
      });

      await test.step('记录负项通过同一协议，不重写已收金额和历史成员', async () => {
        await page.getByRole('link', { name: '录入抵扣或补收', exact: true }).click();
        await page.getByLabel(/^抵扣金额/).fill('10.00');
        await page.getByLabel('原因', { exact: true }).fill('质量调整');
        await page.getByRole('button', { name: '录入抵扣', exact: true }).click();
        await expect(page.getByText('抵扣已记录，后续账单生成时计入', { exact: true })).toBeVisible();
        const state = await readBill(fixture.agentUserId, fixture.period);
        expect(state.credits).toHaveLength(1);
        expect(state.credits[0]).toMatchObject({ requestedAmount: '-10.00', reason: '质量调整' });
        expect(state.items).toEqual(frozen.items);
        expect(state.bill.totalAmount).toBe('5000.00');
        expect(state.receipts[0]).toMatchObject({ amount: '5000.00' });
      });

      await test.step('历史入口保持归档且没有财务写入表单', async () => {
        await page.goto('/owner/bills/archive');
        await expect(page.getByRole('heading', { name: '历史账单归档', exact: true })).toBeVisible();
        await expect(page.getByRole('button', { name: /生成月账单|发单|录入收款|录入付款/u })).toHaveCount(0);
        await expect(page.locator('input[name="amount"]')).toHaveCount(0);
      });
      expect(pageErrors).toEqual([]);
    });
  });
}

test('账单脚本仍在加载时原生提交能结束并显示生成结果', async ({ browser, page, baseURL }) => {
  requireIsolatedDatabase();
  const fixture = await seedSettledExternalSalesOrder({
    customerRef: `e2e-agent-bill-slow-${uniqueSuffix()}`,
    settledFee: '25.00',
    settledAt: midPreviousShanghaiMonth(),
  });
  await login(page, { username: E2E_USERS.owner!.username, password: E2E_PASSWORD });
  const context = await browser.newContext({ baseURL, storageState: await page.context().storageState() });
  const slowPage = await context.newPage();
  let blockedScripts = 0;
  const pendingScripts: Array<() => Promise<void>> = [];
  await slowPage.route(/\/_next\/static\/.*\.js(?:\?|$)/, (route) => {
    blockedScripts += 1;
    pendingScripts.push(() => route.continue());
  });
  try {
    await slowPage.goto('/owner/agent-bills', { waitUntil: 'commit' });
    await expect(slowPage.getByRole('button', { name: '生成或更新草稿', exact: true })).toBeVisible();
    await expect.poll(() => blockedScripts).toBeGreaterThan(0);
    await generateDraft(slowPage, fixture.period, true);
    const state = await readBill(fixture.agentUserId, fixture.period);
    expect(state.bill.status).toBe('DRAFT');
    expect(state.bill.totalAmount).toBe('25.00');
  } finally {
    // Controlled network release, not a timing sleep. The result above must be
    // visible before any intercepted application script is allowed to finish.
    await slowPage.unrouteAll({ behavior: 'ignoreErrors' });
    await Promise.allSettled(pendingScripts.map((release) => release()));
    await context.close();
  }
});
