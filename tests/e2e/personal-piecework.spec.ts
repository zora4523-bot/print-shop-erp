import { randomUUID } from 'node:crypto';
import { expect, test, type Page } from '@playwright/test';
import { Client } from 'pg';
import Decimal from 'decimal.js';
import AxeBuilder from '@axe-core/playwright';
import { assertActivatedE2eDatabase } from '../../scripts/lib/e2e-environment';
import { login, E2E_PASSWORD, seedE2eProductionOperationFixture } from './_helpers';

test.use({ hasTouch: true, actionTimeout: 15_000 });
async function publish(page: Page, workerId: string, rate: string | null, future = false) {
  await page.goto(`/owner/accounts/${workerId}`);
  const region = page.getByRole('region', { name: '计件工价', exact: true });
  await region.getByRole('button', { name: '新建调价草稿' }).click();
  await expect(region.getByRole('status')).toContainText('草稿已创建');
  await region.getByLabel('工价模式', { exact: true }).selectOption(rate === null ? 'true' : 'false');
  if (rate !== null) await region.getByLabel('局部烫金（元/下）').fill(rate);
  await expect(region.getByLabel('专版烫金（元/个）')).toHaveCount(0);
  await expect(region.getByLabel('调价依据', { exact: true })).toHaveCount(0);
  await region.getByLabel('调整说明').fill('账号个人工价验收');
  if (future) {
    await region.getByLabel('生效方式').selectOption('scheduled');
    await region.getByLabel('生效时间（北京时间）').fill('2030-01-01T08:00');
  }
  await region.getByRole('button', { name: '保存草稿', exact: true }).click();
  await expect(region.getByRole('status')).toContainText('草稿已保存');
  await region.getByRole('button', { name: '核对并发布' }).click();
  await region.getByRole('form', { name: '发布工价', exact: true }).getByRole('button', { name: '发布工价', exact: true }).click();
  await expect(region.getByRole('status')).toContainText('工价已发布');
}
async function report(page: Page, success = true) {
  const section = page.locator('section').filter({ has: page.getByRole('heading', { name: '扫码报工', exact: true }) });
  for (const [name, value] of [['本次合格完成数', '10'], ['本次工单件数进度', '0'], ['缺陷数', '0'], ['返工数', '0']]) await section.getByRole('spinbutton', { name, exact: true }).fill(value);
  await section.getByRole('button', { name: '提交扫码报工' }).click();
  await section.getByRole('button', { name: '确认报工', exact: true }).click();
  if (success) await expect(section.getByRole('status')).toContainText('已记录本次报工');
  else await expect(section.getByRole('alert')).toContainText('适用工价已调整');
}
test('不同师傅个人价、未来生效、切回统一价、历史和账号隔离', async ({ page, browser }) => {
  test.setTimeout(180_000);
  const seeded = await seedE2eProductionOperationFixture();
  if (!seeded.ready) throw new Error(seeded.reason);
  const c = new Client({ connectionString: assertActivatedE2eDatabase().url }); await c.connect();
  const workerA = `e2e-personal-${randomUUID().slice(0, 12)}`; const workerB = `e2e-personal-${randomUUID().slice(0, 12)}`;
  for (const id of [workerA, workerB]) await c.query(`INSERT INTO "User" (id, username, password, "displayName", role, "workerType", "machineType", "machineCapabilities", "updatedAt") SELECT $1::text, $1::text::citext, password, '个人工价验收', role, "workerType", "machineType", "machineCapabilities", now() FROM "User" WHERE username='e2e-worker-hand'`, [id]);
  const aContext = await browser.newContext({ baseURL: test.info().project.use.baseURL });
  const bContext = await browser.newContext({ baseURL: test.info().project.use.baseURL });
  try {
    const a = await aContext.newPage(); const b = await bContext.newPage();
    // Keep personal reporters out of the durable main-flow fixture.
    const operationId = randomUUID();
    await c.query(`INSERT INTO "ProductionOperation" (id, "orderId", "operationType", unit, status, "plannedQty", "createdAt", "updatedAt") SELECT $1, "orderId", "operationType", unit, 'PENDING', "plannedQty", now(), now() FROM "ProductionOperation" WHERE id=$2`, [operationId, seeded.fixture.operationId]);
    await c.query(`INSERT INTO "ProductionOperationSource" (id, "operationId", "sourceType", "orderItemId", "sourceQty") SELECT $1, $2, "sourceType", "orderItemId", "sourceQty" FROM "ProductionOperationSource" WHERE "operationId"=$3`, [randomUUID(), operationId, seeded.fixture.operationId]);
    const task = `/worker/tasks/${operationId}`;
    await login(a, { username: workerA, password: E2E_PASSWORD, from: task });
    await report(a);
    const old = (await c.query('SELECT id, amount::text, snapshot FROM "ProductionReport" WHERE "reporterId"=$1', [workerA])).rows;
    await a.reload();
    await login(page, { from: `/owner/accounts/${workerA}` });
    await publish(page, workerA, '0.1234');
    await report(a, false);
    await a.reload(); await expect(a.getByText(/本人适用工价/)).toContainText('0.1234'); await report(a);
    await publish(page, workerB, '0.4321');
    await login(b, { username: workerB, password: E2E_PASSWORD, from: task }); await report(b);
    const rows = (await c.query('SELECT "reporterId", rate::text, amount::text, "chargeableQty"::text, snapshot FROM "ProductionReport" WHERE "reporterId"=ANY($1::text[]) AND snapshot#>>\'{payroll,rateSource}\'=\'PERSONAL\'', [[workerA, workerB]])).rows;
    expect(rows).toHaveLength(2);
    for (const row of rows) {
      expect(row.rate).toBe(row.reporterId === workerA ? '0.1234' : '0.4321');
      expect(row.amount).toBe(new Decimal(row.rate).mul(row.chargeableQty).toDecimalPlaces(2).toFixed(2));
      expect(row.snapshot.payroll.rateWorkerId).toBe(row.reporterId);
    }
    expect((await c.query('SELECT id, amount::text, snapshot FROM "ProductionReport" WHERE id=ANY($1::text[])', [old.map((r) => r.id)])).rows).toEqual(old);
    await publish(page, workerA, null);
    await a.reload(); await expect(a.getByText(/本人适用工价/)).toContainText('统一工价'); await report(a);
    await publish(page, workerB, '0.9000', true);
    await b.reload(); await expect(b.getByText(/本人适用工价/)).toContainText('0.4321');
    // Database guard must independently reject using a different account's price.
    const wrongBook = (await c.query('SELECT * FROM "PieceworkPriceBook" WHERE "workerId"=$1 AND status=\'PUBLISHED\' AND "effectiveFrom" <= now() ORDER BY version DESC LIMIT 1', [workerB])).rows[0];
    await expect(c.query('UPDATE "PieceworkPriceBook" SET "useUnifiedRates"=true WHERE id=$1', [wrongBook.id])).rejects.toThrow(/immutable/);
    await expect(c.query(`INSERT INTO "ProductionReport" (id, "operationId", "reporterId", "reportedCompletedQty", "chargeableQty", unit, rate, amount, "priceBookId", "priceBookVersion", "ruleSetSha256", snapshot, "idempotencyKey") VALUES ($1::text,$2,$3,1,1,'PER_PASS',0.4321,0.43,$4,$5,$6,'{}',$1::text)`, [randomUUID(), operationId, workerA, wrongBook.id, wrongBook.version, wrongBook.ruleSetSha256])).rejects.toThrow(/effective personal policy/);
    await a.goto(`/owner/accounts/${workerB}`); await expect(a.getByRole('heading', { name: '计件工价', exact: true })).toHaveCount(0);
    await page.goto(`/owner/accounts/${workerA}`);
    await page.getByRole('button', { name: '新建调价草稿' }).click();
    for (const width of [375, 393, 768, 1024, 1280, 1920]) {
      await page.setViewportSize({ width, height: 1000 });
      for (const theme of ['浅色', '暗色']) {
        const toggle = page.getByRole('button', { name: '切换界面主题' }); await toggle.click();
        const choice = page.getByRole('menuitemradio', { name: theme, exact: true });
        await choice.press('Enter');
        await page.keyboard.press('Escape');
        await expect(choice).not.toBeVisible();
        await expect(toggle).toBeFocused();
        await expect.poll(() => page.evaluate(() => document.getAnimations().filter((x) => x.playState === 'running' || x.pending).length)).toBe(0);
        const section = page.locator('section:has(#piecework-heading)');
        if (width <= 768) {
          for (const control of await section.locator('input:not([type="hidden"]), button, select, summary').all()) {
            if (await control.isVisible()) {
              const rect = await control.boundingBox();
              expect(rect?.height).toBeGreaterThanOrEqual(44);
              expect(rect?.width).toBeGreaterThanOrEqual(44);
            }
          }
          await section.getByLabel('工价模式', { exact: true }).tap();
          await expect(section.getByLabel('工价模式', { exact: true })).toBeFocused();
          await page.keyboard.press('Escape');
          await page.keyboard.press('Tab');
        }
        expect((await new AxeBuilder({ page }).include('section:has(#piecework-heading)').analyze()).violations).toEqual([]);
        expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
        if (width === 375 || width === 1280) await page.screenshot({ path: test.info().outputPath(`personal-${width}-${theme}.png`), fullPage: true });
      }
    }
  } finally { await aContext.close(); await bContext.close(); await c.end(); }
});
