import { randomUUID } from 'node:crypto';
import { Client } from 'pg';
import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Page } from '@playwright/test';
import { assertActivatedE2eDatabase } from '../../scripts/lib/e2e-environment';
import { login, E2E_PASSWORD, seedE2eProductionOperationFixture } from './_helpers';
import { detachedActionHeaders } from './_action-replay';

test.use({ hasTouch: true });
type Book = { id: string; version: number; effectiveFrom: Date; effectiveTo: Date | null; ruleSetSha256: string; updatedAt: Date };
async function latest(c: Client, workerId: string | null): Promise<Book> {
  return (await c.query('SELECT * FROM "PieceworkPriceBook" WHERE "workerId" IS NOT DISTINCT FROM $1 AND status=\'PUBLISHED\' ORDER BY version DESC LIMIT 1', [workerId])).rows[0];
}
function region(page: Page) { return page.getByRole('region', { name: '计件工价', exact: true }); }
function card(page: Page, book: Book) { return region(page).locator('details').filter({ has: page.locator('summary', { hasText: new RegExp(`第 ${book.version} 版`) }) }); }
async function publish(page: Page, workerId: string | null, at: string | null, rate: string | null = '0.1234') {
  await page.goto(workerId ? `/owner/accounts/${workerId}` : '/owner/rules/employee-pay');
  const r = region(page);
  // In release streaming, load may precede the account section. Only inspect
  // the presence of a draft after its containing server-rendered UI arrives.
  await expect(r).toBeVisible();
  const create = r.getByRole('button', { name: '新建调价草稿', exact: true });
  if (await create.count()) { await create.click(); await expect(r.getByRole('status')).toContainText('草稿已创建'); }
  if (workerId) await r.getByLabel('工价模式', { exact: true }).selectOption(rate === null ? 'true' : 'false');
  if (rate !== null) await r.getByLabel('局部烫金（元/下）').fill(rate);
  if (!workerId) {
    await r.getByLabel('专版烫金（元/个）').fill('0.0125');
    await r.getByLabel('调价依据', { exact: true }).fill('取消计划自动回归');
  }
  await r.getByLabel('调整说明').fill('取消计划自动回归');
  await r.getByLabel('生效方式').selectOption(at ? 'scheduled' : 'immediate');
  if (at) await r.getByLabel('生效时间（北京时间）').fill(at);
  await r.getByRole('button', { name: '保存草稿', exact: true }).click();
  await expect(r.getByRole('status')).toContainText('草稿已保存');
  await r.getByRole('button', { name: '核对并发布', exact: true }).click();
  await r.getByRole('form', { name: '发布工价', exact: true }).getByRole('button', { name: '发布工价', exact: true }).click();
  await expect(r.getByRole('status')).toContainText('工价已发布');
}
async function startCancel(page: Page, book: Book) {
  // Future plans expose their action without requiring an undisclosed expansion.
  await expect(card(page, book).getByRole('button', { name: '取消调价计划', exact: true })).toBeVisible();
  await card(page, book).getByRole('button', { name: '取消调价计划', exact: true }).click();
  const review = card(page, book).getByRole('form', { name: '取消调价计划复核', exact: true });
  await expect(review).toBeVisible(); return review;
}
async function cancel(page: Page, book: Book) {
  const review = await startCancel(page, book);
  await review.getByLabel('取消原因（2 至 500 字）').fill('取消误填的调价计划');
  await review.getByRole('button', { name: '取消调价计划', exact: true }).click();
  await expect(card(page, book).locator('summary')).toContainText('已取消');
  await expect(region(page).getByRole('status')).toContainText('调价计划已取消');
  await expect(card(page, book).locator('summary')).toBeFocused();
  await expect(card(page, book)).toHaveAttribute('open', '');
}
async function report(page: Page) {
  const form = page.locator('section').filter({ has: page.getByRole('heading', { name: '扫码报工', exact: true }) });
  for (const [name, value] of [['本次合格完成数', '10'], ['本次工单件数进度', '0'], ['不良数', '0'], ['返工数', '0']]) await form.getByRole('spinbutton', { name, exact: true }).fill(value);
  await form.getByRole('button', { name: '提交扫码报工', exact: true }).click(); await form.getByRole('button', { name: '确认报工', exact: true }).click();
  await expect(form.getByRole('status')).toContainText('已记录本次报工');
}

test('个人调价按单版取消、保留草稿和后继、重复请求只记一次、取消后立即恢复统一并报工', async ({ page, browser }) => {
  test.setTimeout(240_000);
  const seeded = await seedE2eProductionOperationFixture(); if (!seeded.ready) throw new Error(seeded.reason);
  const c = new Client({ connectionString: assertActivatedE2eDatabase().url }); await c.connect();
  const workerId = `e2e-cancel-${randomUUID().slice(0, 12)}`;
  const errors: string[] = []; page.on('pageerror', (e) => errors.push(e.message));
  const workerContext = await browser.newContext({ baseURL: test.info().project.use.baseURL });
  try {
    await c.query(`INSERT INTO "User" (id,username,password,"displayName",role,"workerType","machineType","machineCapabilities","updatedAt") SELECT $1::text,$1::text::citext,password,'取消计划回归师傅',role,"workerType","machineType","machineCapabilities",now() FROM "User" WHERE username='e2e-worker-hand'`, [workerId]);
    const operationId = randomUUID();
    await c.query(`INSERT INTO "ProductionOperation" (id,"orderId","operationType",unit,status,"plannedQty","createdAt","updatedAt") SELECT $1,"orderId","operationType",unit,'PENDING',"plannedQty",now(),now() FROM "ProductionOperation" WHERE id=$2`, [operationId, seeded.fixture.operationId]);
    await c.query(`INSERT INTO "ProductionOperationSource" (id,"operationId","sourceType","orderItemId","sourceQty") SELECT $1,$2,"sourceType","orderItemId","sourceQty" FROM "ProductionOperationSource" WHERE "operationId"=$3`, [randomUUID(), operationId, seeded.fixture.operationId]);
    await login(page, { from: `/owner/accounts/${workerId}` });
    await publish(page, workerId, null); const p = await latest(c, workerId);
    const workerPage = await workerContext.newPage(); await login(workerPage, { username: workerId, password: E2E_PASSWORD, from: `/worker/tasks/${operationId}` }); await report(workerPage);
    const history = (await c.query('SELECT * FROM "ProductionReport" WHERE "reporterId"=$1 ORDER BY id', [workerId])).rows;
    await publish(page, workerId, '2035-01-01T08:00', '0.4567'); const s = await latest(c, workerId);
    await publish(page, workerId, '2036-01-01T08:00', null); const n = await latest(c, workerId);
    await region(page).getByRole('button', { name: '新建调价草稿', exact: true }).click(); await expect(region(page).getByRole('status')).toContainText('草稿已创建');
    const draft = (await c.query('SELECT * FROM "PieceworkPriceBook" WHERE "workerId"=$1 AND status=\'DRAFT\'', [workerId])).rows[0];
    const review = await startCancel(page, s);
    await expect(review).toContainText(`第 ${n.version} 版仍按原计划`);
    await expect(review.getByRole('button', { name: '取消调价计划', exact: true })).toBeDisabled();
    await review.getByLabel('取消原因（2 至 500 字）').fill('误填时间，保留后一版计划');
    for (const [width, height] of [[375, 667], [393, 852], [768, 1024], [1024, 768], [1280, 800], [1920, 1080]]) {
      await page.setViewportSize({ width, height });
      for (const theme of ['浅色', '暗色']) {
        const toggle = page.getByRole('button', { name: '切换界面主题' }); await toggle.click(); await page.getByRole('menuitemradio', { name: theme, exact: true }).press('Enter'); await page.keyboard.press('Escape');
        await expect(toggle).toBeFocused();
        await expect.poll(() => page.evaluate(() => document.getAnimations().filter((x) => x.playState === 'running' || x.pending).length)).toBe(0);
        expect((await new AxeBuilder({ page }).include('section:has(#piecework-heading)').analyze()).violations).toEqual([]);
        expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
        if (width <= 768) {
          for (const control of await review.locator('button, textarea').all()) { const rect = await control.boundingBox(); expect(rect!.width).toBeGreaterThanOrEqual(44); expect(rect!.height).toBeGreaterThanOrEqual(44); }
          await review.getByLabel('取消原因（2 至 500 字）').tap(); await expect(review.getByLabel('取消原因（2 至 500 字）')).toBeFocused();
        }
        if (width === 375 || width === 1280) await page.screenshot({ path: test.info().outputPath(`cancel-${width}-${theme}.png`), fullPage: true });
      }
    }
    const requestPromise = page.waitForRequest((request) => request.method() === 'POST' && Boolean(request.headers()['next-action']));
    await review.getByRole('button', { name: '取消调价计划', exact: true }).click(); const request = await requestPromise;
    await expect(card(page, s).locator('summary')).toContainText('已取消');
    await expect(region(page).getByRole('status')).toContainText('调价计划已取消');
    await expect(card(page, s).locator('summary')).toBeFocused();
    await expect(card(page, s).getByRole('link', { name: '继续编辑调价草稿' })).toBeVisible();
    const replay = await page.request.fetch(request, { headers: detachedActionHeaders(request) }); expect(replay.status()).toBe(200); expect(await replay.text()).toContain('此前已取消'); await replay.dispose();
    expect((await c.query('SELECT * FROM "PieceworkPriceBook" WHERE id=$1', [n.id])).rows[0]).toEqual(n);
    expect((await c.query('SELECT * FROM "PieceworkPriceBook" WHERE id=$1', [draft.id])).rows[0]).toEqual(draft);
    expect((await c.query('SELECT "effectiveTo" FROM "PieceworkPriceBook" WHERE id=$1', [p.id])).rows[0].effectiveTo).toEqual(n.effectiveFrom);
    expect((await c.query('SELECT count(*)::int AS n FROM "BusinessAuditLog" WHERE "entityId"=$1 AND action=\'CANCEL_SCHEDULE\'', [s.id])).rows[0].n).toBe(1);
    await cancel(page, n);
    await publish(page, workerId, null, null);
    await workerPage.goto(`/worker/tasks/${operationId}`); await expect(workerPage.getByText(/本人适用工价/)).toContainText('统一工价'); await report(workerPage);
    expect((await c.query('SELECT * FROM "ProductionReport" WHERE id=ANY($1::text[]) ORDER BY id', [history.map((r) => r.id)])).rows).toEqual(history);
    await publish(page, workerId, '2037-01-01T08:00'); const inactivePlan = await latest(c, workerId);
    await c.query('UPDATE "User" SET "isActive"=false WHERE id=$1', [workerId]); await page.reload();
    await expect(region(page).getByRole('button', { name: '新建调价草稿', exact: true })).toHaveCount(0); await cancel(page, inactivePlan);
    expect(errors).toEqual([]);
  } finally { await workerContext.close(); await c.end(); }
});

test('统一未来工价可取消，随后立即发布纠正价', async ({ page }) => {
  test.setTimeout(120_000); const c = new Client({ connectionString: assertActivatedE2eDatabase().url }); await c.connect();
  const errors: string[] = []; page.on('pageerror', (e) => errors.push(e.message));
  try {
    await login(page, { from: '/owner/rules/employee-pay' });
    await publish(page, null, '2038-01-01T08:00', '0.2000'); const s = await latest(c, null);
    await cancel(page, s); await publish(page, null, null, '0.0075');
    const corrected = await latest(c, null); expect(corrected.version).toBeGreaterThan(s.version); expect(corrected.effectiveTo).toBeNull();
    expect((await c.query('SELECT status,"effectiveFrom" FROM "PieceworkPriceBook" WHERE id=$1', [s.id])).rows[0]).toEqual({ status: 'CANCELLED', effectiveFrom: s.effectiveFrom });
    expect(errors).toEqual([]);
  } finally { await c.end(); }
});
