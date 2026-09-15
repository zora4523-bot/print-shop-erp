import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { Client } from 'pg';
import { expect, test } from '@playwright/test';
import { assertActivatedE2eDatabase } from '../../scripts/lib/e2e-environment';
import { E2E_PASSWORD, E2E_USERS, login } from './_helpers';
import { expectA11yGate, expectViewportGate } from '../visual/ui-gates';
import { calculateCreateOrderQuote, type CreateOrderPriceSnapshot } from '../../lib/price/create-order';
import { createGoldenOrderInput, createGoldenOrderItem } from '../../lib/price/__tests__/fixtures/create-order-golden-fixtures';

const exec = promisify(execFile);
const nodeArgs = ['--conditions=react-server', '--import', 'tsx'];
const route = '/owner/rules/customer-pricing?section=tiers';

test('confirmed custom prices publish once, preserve history and render eleven tiers', async ({ page, browser }, testInfo) => {
  test.setTimeout(180_000);
  const isolated = assertActivatedE2eDatabase();
  const client = new Client({ connectionString: isolated.url });
  await client.connect();
  try {
    const history = await client.query(`SELECT rule.* FROM "CustomerPriceRule" rule
      JOIN "CustomerPriceBook" book ON book.id = rule."priceBookId"
      WHERE book."isActive" ORDER BY rule.id`);
    const command = [...nodeArgs, 'scripts/publish-confirmed-custom-tiers.ts', '--apply', '--actor=e2e-owner'];
    await exec(process.execPath, command, { env: process.env });
    const historyAfter = await client.query('SELECT * FROM "CustomerPriceRule" WHERE id = ANY($1::text[]) ORDER BY id', [history.rows.map(row => row.id)]);
    expect(historyAfter.rows).toEqual(history.rows);
    const repeat = await exec(process.execPath, command, { env: process.env });
    expect(repeat.stdout).toContain('ALREADY_PUBLISHED');
    const output = await exec(process.execPath, [...nodeArgs, '-e', `
      const {db}=require('./lib/db.ts');
      const {readPublishedCreateOrderPriceProjection}=require('./lib/order/create-order-published-rule-adapter.ts');
      readPublishedCreateOrderPriceProjection(db).then(p=>console.log(JSON.stringify(p.snapshot))).finally(()=>db.$disconnect());
    `], { env: process.env });
    const snapshot = JSON.parse(output.stdout) as CreateOrderPriceSnapshot;
    expect(snapshot.full.unitPrices).toHaveLength(22);
    for (const [quantity, price] of [[200, '1.0000'], [499, '1.0000'], [500, '0.5200'],
      [800, '0.5200'], [999, '0.5200'], [1000, '0.3250'], [1999, '0.3250'],
      [2000, '0.2850'], [4600, '0.2450'], [4999, '0.2450'], [5000, '0.2200'],
      [49999, '0.1900'], [50000, '0.1800']] as const) {
      const item = createGoldenOrderItem({ craft: 'FULL', pricingGroup: 'LARGE', specification: '大号封',
        paperType: '珠光艳闪', paperWeightGsm: 160, quantity, frontColors: ['哑金'], backColors: [] });
      const result = calculateCreateOrderQuote(createGoldenOrderInput([item]), snapshot);
      expect(result.items[0]?.unitPrice, `${quantity} pieces`).toBe(price);
    }
  } finally { await client.end(); }

  await exec(process.execPath, [...nodeArgs, '-e', `
    const {db}=require('./lib/db.ts');
    const admin=require('./lib/price/customer-price-book-admin.ts');
    (async()=>{const versions=await admin.listCustomerPriceBookVersionsAndDrafts();
      if(!versions.some(v=>v.purpose==='PROCESSING'&&v.status==='DRAFT')) {
        const actor=await db.user.findUniqueOrThrow({where:{username:'e2e-owner'}});
        await admin.createCustomerPriceBookDraft({purpose:'PROCESSING',changeReason:'验证十一档边界保存'},actor);
      }
    })().finally(()=>db.$disconnect());
  `], { env: process.env });
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  await login(page, { from: route, username: E2E_USERS.owner!.username, password: E2E_PASSWORD });
  await expect(page.getByRole('table', { name: '专版烫金阶梯单价', exact: true })).toBeVisible();
  await expect(page.getByText('≥ 500 且 < 1,000 个', { exact: true })).toBeVisible();
  await expect(page.getByText('4千档', { exact: true })).toHaveCount(1);
  const boundary = page.getByRole('spinbutton', { name: /^500个档上界/ });
  const large = page.getByRole('spinbutton', { name: /^1千档大号组单价/ });
  await expect(large).toHaveValue('0.325');
  for (const upper of ['1100', '999']) {
    await boundary.fill(upper);
    await page.getByRole('button', { name: '保存调价草稿', exact: true }).click();
    await expect(page.getByText('调价草稿已保存。', { exact: true })).toBeVisible();
    await page.reload();
    await expect(boundary).toHaveValue(upper);
    await expect(large).toHaveValue('0.325');
  }
  // Verify four-decimal prices survive native form submission and reload.
  for (const price of ['0.3251', '0.325']) {
    await large.fill(price);
    await page.getByRole('button', { name: '保存调价草稿', exact: true }).click();
    await expect(page.getByText('调价草稿已保存。', { exact: true })).toBeVisible();
    await page.reload();
    await expect(large).toHaveValue(price);
  }
  await expect(page.getByText('档位取档', { exact: false })).toHaveCount(0);
  for (const [width, height] of [[375, 667], [393, 852], [768, 1024], [1024, 768], [1280, 800], [1920, 1080]]) {
    const context = await browser.newContext({
      storageState: await page.context().storageState(), viewport: { width, height },
      hasTouch: width <= 768, isMobile: width <= 768, reducedMotion: 'reduce',
    });
    const viewportPage = await context.newPage();
    viewportPage.on('pageerror', error => errors.push(error.message));
    await viewportPage.goto(new URL(route, page.url()).href);
    const currentTestInfo = { ...testInfo, project: { ...testInfo.project,
      use: { ...testInfo.project.use, viewport: { width, height } } } };
    if (width <= 768) {
      const priceInput = viewportPage.getByRole('spinbutton', { name: /^1千档大号组单价/ });
      await priceInput.tap();
      await expect(priceInput).toBeFocused();
      await expect(priceInput).toHaveValue('0.325');
    }
    for (const theme of ['light', 'dark']) {
      await viewportPage.emulateMedia({ colorScheme: theme as 'light' | 'dark', reducedMotion: 'reduce' });
      await viewportPage.evaluate(value => {
        localStorage.setItem('erp-theme', value);
        document.documentElement.dataset.theme = value;
        document.documentElement.classList.toggle('dark', value === 'dark');
      }, theme);
      // Match the shared visual gate: wait for actual palette transitions,
      // including transitions created by the next hydration paint.
      for (let paint = 0; paint < 3; paint += 1) {
        await viewportPage.evaluate(() => new Promise<void>(resolve => requestAnimationFrame(() => resolve())));
        await expect.poll(() => viewportPage.evaluate(() => document.getAnimations()
          .filter(animation => animation.playState === 'running' || animation.pending).length)).toBe(0);
      }
      await expectViewportGate(viewportPage, currentTestInfo);
      await expectA11yGate(viewportPage);
      await viewportPage.screenshot({ path: testInfo.outputPath(`tiers-${width}-${theme}.png`), fullPage: true });
    }
    await context.close();
  }
  expect(errors).toEqual([]);
});
