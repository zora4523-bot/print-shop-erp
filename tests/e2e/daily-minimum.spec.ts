import { randomUUID } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { expect, test } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import { assertActivatedE2eDatabase } from '../../scripts/lib/e2e-environment';
import { todayShanghai } from '../../lib/dashboard/shanghai-clock';
import { E2E_PASSWORD, login, withDb } from './_helpers';

test.use({ hasTouch: true });

test('出勤日薪预览、锁定保护、发放、本人明细及九视口', async ({ page, browser }) => {
  test.setTimeout(240_000);
  const date = todayShanghai();
  const workerId = `daily-minimum-${randomUUID()}`;
  const otherId = `daily-other-${randomUUID()}`;
  const errors: string[] = [];
  await page.setViewportSize({ width: 375, height: 812 });
  await page.emulateMedia({ reducedMotion: 'reduce' });
  page.on('pageerror', error => errors.push(error.message));
  await withDb(async db => {
    for (const id of [workerId, otherId]) await db.query(`INSERT INTO "User" (id, username, password, "displayName", role, "workerType", "machineType", "employmentType", "updatedAt") SELECT $1::text, $1::text::citext, password, $2, 'WORKER', 'MACHINE', 'HAND_PRESS', 'FULL_TIME', now() FROM "User" WHERE username='e2e-worker-hand'`, [id, id === workerId ? '日薪验收师傅' : '其他师傅']);
    await db.query(`INSERT INTO "Attendance" (id,"workerId",date,"normalHours","workUnits","roleSnapshot","workerTypeSnapshot","identitySnapshotVerified","createdById","updatedAt") SELECT $1,$2,$3::date,4,0.5,'WORKER','MACHINE',true,id,now() FROM "User" WHERE username='e2e-owner'`, [randomUUID(), workerId, date]);
  });
  await login(page, { from: `/owner/salary/piecework?date=${date}` });
  const candidate = page.locator('tr').filter({ hasText: workerId });
  await expect(candidate).toContainText('100.00');
  await expect(candidate).toContainText('日薪补足');
  const lockButton = candidate.getByRole('button', { name: '锁定结算', exact: true });
  await lockButton.tap();
  const dialog = page.getByRole('alertdialog');
  await expect(dialog).toContainText('出勤日薪');
  await expect(dialog).toContainText('100.00');
  expect((await new AxeBuilder({ page }).include('[role="alertdialog"]').analyze()).violations).toEqual([]);
  await page.keyboard.press('Escape');
  await expect(lockButton).toBeFocused();
  await lockButton.press('Enter');
  await dialog.getByRole('button', { name: '锁定结算', exact: true }).click();
  await expect(page.getByText(/不能锁定当前或未来日期/)).toBeVisible();
  // Exercise the domain's explicit clock seam; production actions retain the real clock.
  const receipt = execFileSync(process.execPath, ['--conditions=react-server', '--import', 'tsx', '-e', `
    const { db } = require('./lib/db.ts');
    const { lockPieceworkSettlement } = require('./lib/salary/piecework-settlement.ts');
    const { currentDispatchTargets } = require('./lib/production/dispatch-targets.ts');
    const { publishProductionDispatch } = require('./lib/production/dispatch.ts');
    const { registerProductionCompletion } = require('./lib/production/completion-registration.ts');
    const { randomUUID } = require('node:crypto');
    (async () => {
      const actor = await db.user.findFirstOrThrow({ where: { username: 'e2e-owner' } });
      const date = process.argv[2];
      const result = await lockPieceworkSettlement({ reporterId: process.argv[1], workDate: date, actor, now: new Date(new Date(date + 'T12:00:00+08:00').getTime() + 86400000) });
      if (result.payableAmount !== '100.00' || result.adjustmentAmount !== '100.00') throw Error('Unexpected daily salary');
      const craft = await db.craft.findUniqueOrThrow({ where: { code: 'FLAT_FOIL_PARTIAL' } });
      const sales = await db.user.findFirstOrThrow({ where: { username: 'e2e-sales' } });
      const order = await db.order.create({ data: { orderNo: 'MINIMUM-' + randomUUID(), customName: '保底补登记验收', submitterId: sales.id, createdById: actor.id,
        submitterRole: 'SALES', settlementType: 'EXTERNAL_SALES', status: 'CONFIRMED', pricingStatus: 'ADMIN_CONFIRMED', pricingConfirmedAt: new Date(), pricingConfirmedById: actor.id,
        confirmedFee: '100', totalAmount: '100', items: { create: { name: '验收款', sequence: 1, quantity: 1000, craft: 'PARTIAL', pricingRoute: 'CUSTOM_SINGLE_FLAT_FOIL',
          productStructure: 'STANDARD_ENVELOPE', foilTechnique: 'FLAT', frontFoilColors: ['亚金'], crafts: [craft.id], paperType: '珠光纸' } } }, include: { items: true } });
      await db.orderPackagingGroup.create({ data: { orderId: order.id, sequence: 1, mode: 'SINGLE_STYLE', actualBagCount: 1000,
        lines: { create: { orderItemId: order.items[0].id, unitsPerBag: 1 } } } });
      const { targets } = await currentDispatchTargets(db, order.id);
      await publishProductionDispatch({ requestKey: randomUUID(), orders: [{ id: order.id, revision: order.revision, version: order.workOrderVersion,
        assignments: Object.fromEntries(targets.map(target => [target.key, process.argv[1]])) }] }, actor);
      const job = await db.productionJob.findFirstOrThrow({ where: { orderId: order.id, operationId: { not: null } } });
      await registerProductionCompletion({ jobId: job.id, revision: job.revision, quantity: '1000', mode: 'BACKFILL', workDate: date, reason: '工资锁定后补登记', confirmedSettledDay: true }, actor);
      console.log('LATE_ORDER:' + order.id);
    })().catch(error => { console.error(error); process.exitCode = 1; }).finally(() => db.$disconnect());
  `, workerId, date], { cwd: process.cwd(), env: { ...process.env, DATABASE_URL: assertActivatedE2eDatabase().url }, encoding: 'utf8', timeout: 30_000 });
  const lateOrderId = /LATE_ORDER:(\S+)/.exec(receipt)?.[1];
  expect(lateOrderId).toBeTruthy();
  const settlementId = await withDb(async db => (await db.query('SELECT id FROM "PieceworkSettlement" WHERE "reporterId"=$1', [workerId])).rows[0].id as string);
  await page.reload();
  await expect(page.locator('tr').filter({ hasText: workerId }).getByRole('button', { name: '锁定结算', exact: true })).toHaveCount(0);
  await page.goto(`/owner/salary/piecework/${settlementId}`);
  await page.setViewportSize({ width: 1280, height: 800 });
  await expect(page.getByRole('main').getByText('日薪补足', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: '标记已发', exact: true }).click();
  await page.getByRole('alertdialog').getByRole('button', { name: '标记已发', exact: true }).click();
  await expect(page.getByText('已发放', { exact: true }).first()).toBeVisible();
  const workerContext = await browser.newContext({ baseURL: test.info().project.use.baseURL });
  const workerPage = await workerContext.newPage();
  try {
    await login(workerPage, { username: workerId, password: E2E_PASSWORD, from: `/worker/salary/${settlementId}?source=piecework` });
    await expect(workerPage.getByRole('main').getByText('日薪补足', { exact: true })).toBeVisible();
    const widths = process.env.GITHUB_EVENT_NAME === 'pull_request' ? [375, 1280] : [320, 375, 390, 393, 430, 768, 1024, 1280, 1920];
    for (const width of widths) {
      for (const theme of ['light', 'dark']) {
        if ([320, 1280].includes(width)) {
          await page.setViewportSize({ width, height: 900 });
          await page.goto(`/orders/${lateOrderId}`);
          await page.evaluate(theme => { document.documentElement.classList.toggle('dark', theme === 'dark'); }, theme);
          const panel = page.getByRole('region', { name: '生产安排与提成', exact: true });
          await expect(panel.getByText(/抵扣原日保底/)).toContainText('100.00');
          expect((await new AxeBuilder({ page }).include('section[aria-label="生产安排与提成"]').analyze()).violations).toEqual([]);
          await panel.screenshot({ path: test.info().outputPath(`${width}-${theme}-supplement.png`) });
        }
        for (const [target, path] of [[page, `/owner/salary/piecework?date=${date}`], [page, `/owner/salary/piecework/${settlementId}`], [workerPage, '/worker/salary'], [workerPage, `/worker/salary/${settlementId}?source=piecework`], [page, '/owner/rules/employee-pay']] as const) {
          await target.setViewportSize({ width, height: 900 });
          await target.goto(path);
          await target.evaluate(theme => { document.documentElement.classList.toggle('dark', theme === 'dark'); }, theme);
          await expect.poll(() => target.evaluate(() => document.getAnimations().filter(a => a.playState === 'running' || a.pending).length)).toBe(0);
          const layout = await target.evaluate(() => ({ width: innerWidth, scroll: document.documentElement.scrollWidth,
            outside: [...document.querySelectorAll('body *')].filter(node => {
              const rect = node.getBoundingClientRect();
              return rect.width > 0 && rect.right > innerWidth + 1 && !node.closest('[data-slot="admin-table-scroll"]');
            }).slice(0, 8).map(node => ({ tag: node.tagName, className: node.className, text: node.textContent?.slice(0, 80) })) }));
          expect(layout.scroll, `${path} ${theme} ${JSON.stringify(layout)}`).toBeLessThanOrEqual(layout.width);
          expect((await new AxeBuilder({ page: target }).include('main').analyze()).violations).toEqual([]);
          if ([320, 1280].includes(width)) await target.screenshot({ path: test.info().outputPath(`${width}-${theme}-${path.split('?')[0].replaceAll('/', '_')}.png`), fullPage: true });
        }
      }
    }
    await workerPage.goto(`/worker/salary/${settlementId}?source=piecework`);
    await expect(workerPage.getByRole('main').getByText('日薪补足', { exact: true })).toBeVisible();
  } finally { await workerContext.close(); }
  const otherContext = await browser.newContext({ baseURL: test.info().project.use.baseURL });
  try {
    const other = await otherContext.newPage();
    await login(other, { username: otherId, password: E2E_PASSWORD, from: `/worker/salary/${settlementId}?source=piecework` });
    await expect(other.getByText('日薪补足', { exact: true })).toHaveCount(0);
  } finally { await otherContext.close(); }
  expect(errors).toEqual([]);
});
