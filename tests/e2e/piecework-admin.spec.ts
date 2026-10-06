import Decimal from 'decimal.js';
import { expect, test, type Browser } from '@playwright/test';
import { Client } from 'pg';
import { assertActivatedE2eDatabase } from '../../scripts/lib/e2e-environment';
import AxeBuilder from '@axe-core/playwright';
import { login, E2E_PASSWORD, seedE2eProductionOperationFixture } from './_helpers';

async function reportTen(browser: Browser, operationId: string) {
  const workerContext = await browser.newContext({ baseURL: test.info().project.use.baseURL });
  try {
    const workerPage = await workerContext.newPage();
    await login(workerPage, { username: 'e2e-worker-hand', password: E2E_PASSWORD, from: `/worker/tasks/${operationId}` });
    const form = workerPage.locator('section').filter({ has: workerPage.getByRole('heading', { name: '扫码报工', exact: true }) });
    await form.getByRole('spinbutton', { name: '本次合格完成数', exact: true }).fill('10');
    await form.getByRole('spinbutton', { name: '本次工单件数进度', exact: true }).fill('0');
    await form.getByRole('spinbutton', { name: '不良数', exact: true }).fill('0');
    await form.getByRole('spinbutton', { name: '返工数', exact: true }).fill('0');
    await form.getByRole('button', { name: '提交扫码报工', exact: true }).click();
    await form.getByRole('button', { name: '确认报工', exact: true }).click();
    await expect(form.getByRole('status')).toContainText('已记录本次报工，计件金额');
  } finally { await workerContext.close(); }
}

test('管理员编辑、发布计件工价，重复发布与并发修改不覆盖价格', async ({ page, context, browser }) => {
  test.setTimeout(180_000);
  const seeded = await seedE2eProductionOperationFixture();
  if (!seeded.ready) throw new Error(seeded.reason);
  await reportTen(browser, seeded.fixture.operationId);
  const client = new Client({ connectionString: assertActivatedE2eDatabase().url });
  await client.connect();
  const oldRates = (await client.query('SELECT r.id, r.amount::text FROM "PieceworkPriceRule" r JOIN "PieceworkPriceBook" b ON b.id=r."priceBookId" WHERE b.status=\'PUBLISHED\' ORDER BY r.id')).rows;
  const oldReports = (await client.query('SELECT id, amount::text FROM "ProductionReport" ORDER BY id')).rows;
  await client.end();
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await login(page, { from: '/owner/rules/employee-pay' });
  const section = page.locator('section', { has: page.getByRole('heading', { name: '计件工价', exact: true }) });
  if (await section.getByRole('button', { name: '新建调价草稿' }).isVisible()) await section.getByRole('button', { name: '新建调价草稿' }).click();
  await section.getByLabel('局部烫金（元/下）').fill('0.0075');
  await section.getByLabel('专版烫金（元/个）').fill('0.0125');
  await section.getByLabel('包装入袋（元/袋）').fill('0.3000');
  await section.getByLabel('包装装盒（元/盒）').fill('0.5000');
  await section.getByLabel('调价依据', { exact: true }).fill('隔离测试工价');
  await section.getByLabel('调整说明').fill('仅用于自动验收');
  await section.getByLabel('生效方式').selectOption('scheduled');
  await section.getByLabel('生效时间').fill('2030-01-01T08:00');
  await section.getByRole('button', { name: '保存草稿', exact: true }).click();
  await expect(section.getByRole('status')).toContainText('草稿已保存');
  await page.reload();
  await expect(section.getByLabel('局部烫金（元/下）')).toHaveValue('0.0075');
  await expect(section.getByLabel('生效时间')).toHaveValue('2030-01-01T08:00');
  await section.getByLabel('生效方式').selectOption('immediate');
  await section.getByRole('button', { name: '保存草稿', exact: true }).click();
  await expect(section.getByRole('status')).toContainText('草稿已保存');

  const other = await context.newPage();
  await other.goto('/owner/rules/employee-pay');
  await section.getByLabel('局部烫金（元/下）').fill('0.0080');
  await section.getByRole('button', { name: '保存草稿', exact: true }).click();
  await expect(section.getByRole('status')).toContainText('草稿已保存');
  await other.getByLabel('局部烫金（元/下）').fill('0.0090');
  await other.getByRole('button', { name: '保存草稿', exact: true }).click();
  await expect(other.getByRole('region', { name: '计件工价', exact: true }).getByRole('alert')).toContainText('工价已被修改');
  await other.close();
  await section.getByRole('button', { name: '核对并发布' }).click();
  const confirmation = section.getByRole('form', { name: '发布工价' });
  const publishedVersion = await confirmation.locator('input[name="version"]').inputValue();
  await expect(confirmation).toContainText('0.0080');
  const requestPromise = page.waitForRequest((request) => request.method() === 'POST' && new URL(request.url()).pathname === '/owner/rules/employee-pay');
  await confirmation.getByRole('button', { name: '发布工价', exact: true }).click();
  const request = await requestPromise;
  await expect(section.getByRole('status')).toContainText('工价已发布');
  await expect(section.getByRole('button', { name: '新建调价草稿' })).toBeVisible();
  const response = await page.request.fetch(request);
  expect(response.status()).toBe(200);
  expect(await response.text()).not.toContain('不同 manifest');
  await response.dispose();
  await page.reload();
  await expect(section.locator('details[open]')).toContainText('0.0080');
  await reportTen(browser, seeded.fixture.operationId);
  const check = new Client({ connectionString: assertActivatedE2eDatabase().url });
  await check.connect();
  try {
    expect((await check.query('SELECT id, amount::text FROM "PieceworkPriceRule" WHERE id = ANY($1::text[]) ORDER BY id', [oldRates.map((r) => r.id)])).rows).toEqual(oldRates);
    expect((await check.query('SELECT id, amount::text FROM "ProductionReport" WHERE id = ANY($1::text[]) ORDER BY id', [oldReports.map((r) => r.id)])).rows).toEqual(oldReports);
    const after = (await check.query('SELECT rate::text, amount::text, \"chargeableQty\"::text FROM \"ProductionReport\" WHERE NOT (id = ANY($1::text[]))', [oldReports.map((r) => r.id)])).rows;
    expect(after).toHaveLength(1);
    expect(after[0].rate).toBe('0.0080');
    expect(after[0].amount).toBe(new Decimal(after[0].chargeableQty).mul('0.0080').toDecimalPlaces(2).toFixed(2));
    expect((await check.query('SELECT count(*)::int AS count FROM "BusinessAuditLog" WHERE action = \'PUBLISH_VERSION\' AND "entityType" = \'PieceworkPriceBook\' AND "entityId" = (SELECT id FROM "PieceworkPriceBook" WHERE version = $1)', [Number(publishedVersion)])).rows[0].count).toBe(1);
  } finally { await check.end(); }
  expect(errors).toEqual([]);
});

for (const viewport of [{ width: 320, height: 568 }, { width: 375, height: 667 }, { width: 390, height: 844 }, { width: 393, height: 852 }, { width: 430, height: 932 }, { width: 768, height: 1024 }, { width: 1024, height: 768 }, { width: 1280, height: 800 }, { width: 1920, height: 1080 }]) {
  if (process.env.GITHUB_EVENT_NAME === 'pull_request' && ![375, 1280].includes(viewport.width)) continue;
  test.describe(`视口 ${viewport.width}`, () => {
  test.use({ viewport, hasTouch: viewport.width <= 768, isMobile: viewport.width <= 768 });
  test(`计件工价 ${viewport.width} 宽度明暗主题与可访问性`, async ({ page }) => {
    await login(page, { from: '/owner/rules/employee-pay' });
    const create = page.getByRole('button', { name: '新建调价草稿' });
    if (await create.isVisible()) await create.click();
    await expect(page.getByLabel('局部烫金（元/下）')).toBeVisible();
    for (const theme of ['light', 'dark']) {
      const toggle = page.getByRole('button', { name: '切换界面主题' });
      await toggle.focus();
      await toggle.press('Enter');
      const choice = page.getByRole('menuitemradio', { name: theme === 'dark' ? '暗色' : '浅色', exact: true });
      await choice.focus();
      await choice.press('Enter');
      await page.keyboard.press('Escape');
      await expect(choice).not.toBeVisible();
      await expect(toggle).toBeFocused();
      await expect(page.locator('html')).toHaveAttribute('data-theme', theme);
      await expect.poll(() => page.evaluate(() => document.getAnimations().filter((animation) => animation.playState === 'running' || animation.pending).length)).toBe(0);
      const section = page.locator('section', { has: page.getByRole('heading', { name: '计件工价', exact: true }) });
      await expect(section).toBeVisible();
      await expect(section).toContainText('同一生产任务的实际完成件数');
      await expect(section).toContainText('小单：1–1000 个（含 1000 个）');
      await expect(section).toContainText('大单：1001 个及以上');
      const batchSummary = section.locator('summary').filter({ hasText: '分批报工的数量规则' });
      await batchSummary.focus();
      await batchSummary.press('Enter');
      await expect(section.getByText('使用扫码分批报工的工单', { exact: false })).toBeVisible();
      if (viewport.width <= 768) {
        for (const control of await section.locator('input:not([type="hidden"]), button, select, summary').all()) {
          if (await control.isVisible()) {
            const rect = await control.boundingBox();
            expect(rect?.height).toBeGreaterThanOrEqual(44);
            expect(rect?.width).toBeGreaterThanOrEqual(44);
          }
        }
        await section.getByLabel('局部烫金（元/下）').tap();
        await expect(section.getByLabel('局部烫金（元/下）')).toBeFocused();
      }
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
      expect((await new AxeBuilder({ page }).include('section:has(#piecework-heading)').analyze()).violations).toEqual([]);
      await page.screenshot({ path: test.info().outputPath(`piecework-${viewport.width}-${theme}.png`), fullPage: true });
      await batchSummary.press('Enter');
      await expect(section.getByText('使用扫码分批报工的工单', { exact: false })).not.toBeVisible();
    }
  });
  });
}

test('工资数量说明支持键盘、减少动效和文字放大', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 800 });
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await login(page, { from: '/owner/rules/employee-pay' });
  await page.evaluate(() => { document.documentElement.style.fontSize = '200%'; });
  const section = page.getByRole('region', { name: '计件工价', exact: true });
  const summary = section.locator('summary').filter({ hasText: '分批报工的数量规则' });
  await summary.focus();
  await summary.press('Space');
  await expect(section.getByText('使用扫码分批报工的工单', { exact: false })).toBeVisible();
  expect(await section.evaluate(node => node.scrollWidth <= node.clientWidth)).toBe(true);
  await expect(summary).toBeFocused();
  await page.screenshot({ path: test.info().outputPath('piecework-text-200-percent.png'), fullPage: true });
  await summary.press('Space');
  await expect(section.getByText('使用扫码分批报工的工单', { exact: false })).not.toBeVisible();
});

for (const username of ['e2e-sales', 'e2e-worker-hand']) test(`${username}不能打开工价管理`, async ({ page }) => {
  await login(page, { username, password: E2E_PASSWORD, from: '/owner/rules/employee-pay' });
  await expect(page.getByRole('heading', { name: '计件工价', exact: true })).toHaveCount(0);
});
