import { randomBytes } from 'node:crypto';
import { test, expect, type Page } from '@playwright/test';
import { Client } from 'pg';
import { E2E_PASSWORD, E2E_USERS, login } from './_helpers';

const cases = [
  { key: 'manual', status: 'PENDING_FACTORY', amount: '13.30', manual: true },
  { key: 'quote', status: 'PENDING_FACTORY', amount: '28.00' },
  { key: 'confirmed', status: 'CONFIRMED', amount: '45.00' },
  { key: 'released', status: 'RELEASED', amount: '60.00' },
  { key: 'hold', status: 'ON_HOLD', amount: '35.00' },
  { key: 'shipped', status: 'SHIPPED', amount: '75.00' },
  { key: 'settled', status: 'SETTLED', amount: '80.00' },
  { key: 'cancelled', status: 'CANCELLED', amount: '0.00' },
] as const;

let prefix: string;
let orderIds: string[] = [];

async function withDb<T>(work: (db: Client) => Promise<T>): Promise<T> {
  if (process.env.E2E_APPEND_ONLY_DATABASE_ISOLATED !== '1') {
    throw new Error('列表与金额回归必须使用独立测试数据库');
  }
  const db = new Client({ connectionString: process.env.DATABASE_URL });
  await db.connect();
  try { return await work(db); } finally { await db.end(); }
}

test.beforeAll(async () => {
  prefix = `e2e-admin-audit-${randomBytes(8).toString('hex')}`;
  await withDb(async (db) => {
    const owner = await db.query<{ id: string }>('SELECT id FROM "User" WHERE username = $1', [E2E_USERS.owner!.username]);
    if (!owner.rows[0]) throw new Error('缺少 E2E 管理员');
    await db.query('BEGIN');
    try {
      for (const entry of cases) {
        const id = `${prefix}-${entry.key}`;
        const manual = 'manual' in entry;
        const confirmed = !['manual', 'quote'].includes(entry.key);
        await db.query(
          `INSERT INTO "Order" (
             id, "orderNo", "customName", "submitterId", "submitterRole", "createdById",
             "settlementType", status, "customerRef", "receiverName", "receiverPhone", "receiverAddress",
             "totalAmount", "processingAmount", "confirmedFee", "settledFee",
             "settlementContractVersion", "settledAt", "pricingStatus", "pricingConfirmedAt", "pricingConfirmedById",
             "submittedAt", "createdAt", "updatedAt"
           ) VALUES (
             $1, $2, $3, $4, 'SALES', $4, 'EXTERNAL_SALES', $5::"OrderStatus",
             $6, '测试收件人', '13800138000', '隔离测试地址',
             $7::numeric, $8::numeric, $9::numeric, $10::numeric,
             CASE WHEN $5 = 'SETTLED' THEN 2 ELSE NULL END,
             CASE WHEN $5 = 'SETTLED' THEN NOW() ELSE NULL END,
             $11::"OrderPricingStatus",
             CASE WHEN $11 = 'PENDING_ADMIN_CONFIRMATION' THEN NULL ELSE NOW() END,
             CASE WHEN $11 = 'ADMIN_CONFIRMED' THEN $4 ELSE NULL END,
             NOW(), NOW(), NOW()
           )`,
          [id, id.toUpperCase(), `后台审查 ${entry.key}`, owner.rows[0].id, entry.status, prefix,
            entry.amount, manual ? '0.00' : entry.amount, confirmed ? entry.amount : null,
            entry.key === 'settled' ? entry.amount : null,
            manual ? 'PENDING_ADMIN_CONFIRMATION' : confirmed ? 'ADMIN_CONFIRMED' : 'AUTO_CONFIRMED'],
        );
        if (!confirmed) {
          const revisionId = `${id}-price-revision`;
          const completeness = manual ? 'EXCLUDES_MANUAL_ITEMS' : 'COMPLETE';
          await db.query(
            `INSERT INTO "OrderPricingRevision" (
               id, "orderId", revision, status, source, snapshot, "createdById", "createdAt"
             ) VALUES ($1, $2, 1, $3::"OrderPricingStatus", 'E2E_ADMIN_AUDIT', $4::jsonb, $5, NOW())`,
            [revisionId, id, manual ? 'PENDING_ADMIN_CONFIRMATION' : 'AUTO_CONFIRMED',
              JSON.stringify({ fixture: prefix, quotedFee: entry.amount, completeness }), owner.rows[0].id],
          );
          await db.query(
            `UPDATE "Order" SET "quotedFee" = $2::numeric,
               "quotedFeeCompleteness" = $3::"OrderQuotedFeeCompleteness", "quotedPricingRevisionId" = $4
             WHERE id = $1`,
            [id, entry.amount, completeness, revisionId],
          );
        }
        await db.query(
          `INSERT INTO "OrderItem" (
             id, "orderId", sequence, name, "pricingRoute", "productStructure", specification,
             "paperType", "paperWeightGsm", quantity, "quoteDisposition", "quotedAmount", "unitPrice", subtotal,
             "foilColors", "frontFoilColors", "foilTechnique", crafts, "createdAt", "updatedAt"
           ) VALUES ($1, $2, 1, '红包测试款', 'CUSTOM_SINGLE_FLAT_FOIL', 'STANDARD_ENVELOPE',
             '大号封 90×165', '160g珠光艳闪', 160, 1000, $3::"OrderItemQuoteDisposition", $5::numeric,
             $4::numeric / 1000, $4::numeric, ARRAY['亚金'], ARRAY['亚金'], 'FLAT', ARRAY[]::text[], NOW(), NOW())`,
          [`${id}-item`, id, manual ? 'MANUAL_PRICING_REQUIRED' : 'PRICED', manual ? '0.00' : entry.amount, manual ? null : entry.amount],
        );
      }
      await db.query('COMMIT');
      orderIds = cases.map((entry) => `${prefix}-${entry.key}`);
    } catch (error) { await db.query('ROLLBACK'); throw error; }
  });
});

test.afterAll(async () => {
  if (!orderIds.length) return;
  // Quote revisions are immutable. Retain this unique fixture population in
  // the disposable database; reruns never reuse its IDs or delete its history.
  await withDb(async (db) => {
    const result = await db.query<{ orders: number; revisions: number }>(
      `SELECT (SELECT COUNT(*)::int FROM "Order" WHERE id = ANY($1::text[])) AS orders,
              (SELECT COUNT(*)::int FROM "OrderPricingRevision" WHERE "orderId" = ANY($1::text[])) AS revisions`,
      [orderIds],
    );
    expect(result.rows[0]).toEqual({ orders: cases.length, revisions: 2 });
  });
});

async function expectWorkspace(page: Page, params: Record<string, string>, keys: string[], amount: string) {
  const query = new URLSearchParams({ q: prefix, ...params });
  const response = await page.goto(`/orders?${query}`);
  expect(response?.status()).toBe(200);
  await expect(page.getByRole('heading', { name: '工单管理', exact: true })).toBeVisible();
  const list = page.getByRole('list', { name: '管理端工单列表', exact: true });
  await expect(list.locator(':scope > li')).toHaveCount(keys.length);
  for (const key of keys) await expect(list.getByText(`后台审查 ${key}`, { exact: true })).toBeVisible();
  const summary = page.getByRole('region', { name: '当前筛选合计' });
  await expect(summary).toContainText(`当前筛选 ${keys.length} 单`);
  await expect(summary).toContainText(`共 ${(keys.length * 1000).toLocaleString('zh-CN')} 个`);
  await expect(summary).toContainText(amount);
  await expect(page.getByText(/Transaction already closed|P2028|Application error/)).toHaveCount(0);
}

test('列表队列、信号与搜索连续切换保持真实数据库统计一致', async ({ page }) => {
  test.setTimeout(120_000);
  await login(page, { from: `/orders?queue=all&q=${prefix}`, username: E2E_USERS.owner!.username, password: E2E_PASSWORD });
  await expectWorkspace(page, { queue: 'all' }, cases.map((entry) => entry.key), '323.00');
  await expectWorkspace(page, { queue: 'todo' }, ['manual', 'quote', 'confirmed', 'hold'], '108.00');
  await expectWorkspace(page, { queue: 'production' }, ['confirmed', 'released'], '105.00');
  await expectWorkspace(page, { queue: 'print' }, ['released'], '60.00');
  await expectWorkspace(page, { queue: 'shipped' }, ['shipped'], '75.00');
  await expectWorkspace(page, { queue: 'done' }, ['settled', 'cancelled'], '80.00');
  await expectWorkspace(page, { queue: 'all', signal: 'pending-pricing' }, ['manual'], '0.00');
  await expect(page.getByRole('region', { name: '当前筛选合计' })).toContainText('1 单待核价未计入');
  await expectWorkspace(page, { queue: 'all', signal: 'pending-release' }, ['confirmed'], '45.00');
  await expectWorkspace(page, { queue: 'all', signal: 'on-hold' }, ['hold'], '35.00');
  await expectWorkspace(page, { queue: 'all', q: `${prefix}-quote` }, ['quote'], '28.00');
  await page.getByLabel('搜索工单', { exact: true }).fill(`${prefix}-released`);
  await page.getByRole('button', { name: '应用筛选', exact: true }).click();
  await expect(page).toHaveURL((url) => url.pathname === '/orders' && url.searchParams.get('q') === `${prefix}-released`);
  await expect(page.getByRole('list', { name: '管理端工单列表', exact: true }).locator(':scope > li')).toHaveCount(1);
  await expect(page.getByRole('region', { name: '当前筛选合计' })).toContainText('60.00');
});

test('待核价详情不把部分报价当应收，完整报价在上下两处标为估价', async ({ page }) => {
  test.setTimeout(90_000);
  await login(page, { from: `/orders/${prefix}-manual`, username: E2E_USERS.owner!.username, password: E2E_PASSWORD });
  const basic = page.getByRole('heading', { name: '基本信息', exact: true }).locator('..');
  for (const label of ['款式加工费', '加工费合计', '对客应收总额']) {
    const value = basic.locator('dt').filter({ hasText: new RegExp(`^${label}$`) }).locator('..').locator('dd');
    await expect(value).toContainText('待工厂核价');
    await expect(value).not.toContainText(/13\.30|0\.00/);
  }
  const fees = page.getByRole('region', { name: '订单级费用', exact: true });
  await expect(fees).toContainText('待工厂核价');
  await expect(fees).not.toContainText('13.30');
  await expect(page.getByTestId('admin-order-detail')).not.toContainText(/160g艳红珠光纸\s*[·/]\s*160g/);

  const response = await page.goto(`/orders/${prefix}-quote`);
  expect(response?.status()).toBe(200);
  const quotedBasic = page.getByRole('heading', { name: '基本信息', exact: true }).locator('..');
  const total = quotedBasic.locator('dt').filter({ hasText: /^对客应收总额$/ }).locator('..').locator('dd');
  await expect(total).toContainText('28.00');
  await expect(total).toContainText('估');
  await expect(page.getByRole('region', { name: '订单级费用', exact: true })).toContainText(/28\.00.*估/);
});

test('队列切换仅延迟显示按钮图标，连续点击只采用最后选择', async ({ page }) => {
  await login(page, { from: `/orders?queue=all&q=${prefix}`, username: E2E_USERS.owner!.username, password: E2E_PASSWORD });
  const queues = page.getByRole('navigation', { name: '工单队列' });
  await expect(queues.getByRole('link', { name: /^全部/ })).toHaveAttribute('aria-current', 'page');
  const releases = new Map<string, () => void>();
  let printSettled = false;
  const recordPrintEnd = (request: import('@playwright/test').Request) => {
    if (new URL(request.url()).searchParams.get('queue') === 'print' && request.headers().rsc === '1') printSettled = true;
  };
  page.on('requestfinished', recordPrintEnd);
  page.on('requestfailed', recordPrintEnd);
  await page.evaluate(() => {
    document.addEventListener('click', (event) => {
      if ((event.target as Element).closest('nav[aria-label="工单队列"] a')) performance.mark('queue-click');
    }, { capture: true });
    const observer = new MutationObserver(() => {
      if (document.querySelector('[data-order-queue-pending="true"]') && performance.getEntriesByName('queue-click').length) {
        performance.measure('queue-feedback', 'queue-click');
        observer.disconnect();
      }
    });
    observer.observe(document.body, { attributes: true, childList: true, subtree: true });
  });
  await page.route('**/orders?**', async (route) => {
    const queue = new URL(route.request().url()).searchParams.get('queue');
    if (route.request().headers().rsc !== '1' || !['print', 'production'].includes(queue ?? '')) return route.continue();
    await new Promise<void>((resolve) => releases.set(queue!, resolve));
    await route.continue();
  });
  try {
    const began = performance.now();
    await queues.getByRole('link', { name: /^待打印/ }).click();
    await expect(page.getByText('正在切换，当前仍显示切换前的结果', { exact: true })).toHaveCount(0);
    await expect(queues.getByRole('link', { name: /^待打印/ }).locator('svg')).toBeVisible();
    console.log('QUEUE_FEEDBACK_MS', { automation: performance.now() - began, browser: await page.evaluate(() => performance.getEntriesByName('queue-feedback')[0]?.duration) });
    await expect(page.getByRole('region', { name: '当前筛选合计' })).toContainText('当前筛选 8 单');
    await expect(queues.getByRole('link', { name: /^全部/ })).toHaveAttribute('aria-current', 'page');
    await queues.getByRole('link', { name: /^生产中/ }).focus();
    await page.keyboard.press('Enter');
    await expect(page.getByRole('status').filter({ hasText: '正在切换至生产中' })).toBeVisible();
    await expect(page.getByRole('status').filter({ hasText: '正在切换至待打印' })).toHaveCount(0);
    await expect.poll(() => releases.has('production')).toBe(true);
    releases.get('production')!();
    await expect(queues.getByRole('link', { name: /^生产中/ })).toHaveAttribute('aria-current', 'page');
    await expect(page.getByRole('region', { name: '当前筛选合计' })).toContainText('当前筛选 2 单');
    releases.get('print')?.();
    await expect.poll(() => printSettled).toBe(true);
    await expect(page.getByText('正在切换，当前仍显示切换前的结果', { exact: true })).toBeHidden();
    await expect(page).toHaveURL(/queue=production/);
    await expect(page.getByRole('list', { name: '管理端工单列表', exact: true }).locator(':scope > li')).toHaveCount(2);
  } finally {
    releases.forEach((release) => release());
    await page.unrouteAll({ behavior: 'wait' });
  }
});
