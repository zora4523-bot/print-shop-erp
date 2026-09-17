import { randomUUID } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { expect, test, type Page } from '@playwright/test';
import { Client } from 'pg';
import AxeBuilder from '@axe-core/playwright';
import { assertActivatedE2eDatabase } from '../../scripts/lib/e2e-environment';
import { login, E2E_PASSWORD, seedE2eProductionOperationFixture } from './_helpers';

test.use({ hasTouch: true });
async function publish(page: Page, workerId: string, full = false, setup?: string) {
  await page.goto(`/owner/accounts/${workerId}`);
  const panel = page.getByRole('region', { name: '计件工价', exact: true });
  await panel.getByRole('button', { name: '新建调价草稿' }).click();
  await expect(panel.getByRole('status')).toContainText('草稿已创建');
  await panel.getByLabel('工价模式', { exact: true }).selectOption('false');
  await panel.getByLabel(full ? '专版烫金（元/个）' : '局部烫金（元/下）').fill(full ? '0.01' : '0.007');
  if (setup) await panel.getByLabel('局部大单装版费（元/次）').fill(setup);
  await expect(panel.getByLabel('调价依据', { exact: true })).toHaveCount(0);
  await panel.getByLabel('调整说明').fill('分档计薪验收');
  await panel.getByRole('button', { name: '保存草稿', exact: true }).click();
  await expect(panel.getByRole('status')).toContainText('草稿已保存');
  await panel.getByRole('button', { name: '核对并发布' }).click();
  await panel.getByRole('form', { name: '发布工价', exact: true }).getByRole('button', { name: '发布工价', exact: true }).click();
  await expect(panel.getByRole('status')).toContainText('工价已发布');
}
async function report(page: Page, id: string, qty: number, c: Client) {
  await page.goto(`/worker/tasks/${id}`);
  const panel = page.locator('section').filter({ has: page.getByRole('heading', { name: '扫码报工', exact: true }) });
  for (const [name, value] of [['本次合格完成数', String(qty)], ['本次工单件数进度', '0'], ['缺陷数', '0'], ['返工数', '0']]) await panel.getByRole('spinbutton', { name, exact: true }).fill(value);
  const before = Number((await c.query('SELECT count(*) AS n FROM \"ProductionReport\" WHERE \"operationId\"=$1', [id])).rows[0].n);
  await panel.getByRole('button', { name: '提交扫码报工' }).click();
  await expect.poll(async () => Number((await c.query('SELECT count(*) AS n FROM \"ProductionReport\" WHERE \"operationId\"=$1', [id])).rows[0].n)).toBe(before + 1);
}
test('分档工资、多人转人工核定、不可变差额和页面响应式', async ({ page, browser }) => {
  test.setTimeout(240_000);
  const seeded = await seedE2eProductionOperationFixture(); if (!seeded.ready) throw Error(seeded.reason);
  const sourceFixture = seeded.fixture;
  const c = new Client({ connectionString: assertActivatedE2eDatabase().url }); await c.connect();
  const workers = [0, 1, 2].map(() => `foil-${randomUUID().slice(0, 12)}`);
  const contexts = await Promise.all(workers.map(() => browser.newContext({ baseURL: test.info().project.use.baseURL })));
  try {
    for (const [i, id] of workers.entries()) await c.query(`INSERT INTO "User" (id, username, password, "displayName", role, "workerType", "machineType", "machineCapabilities", "updatedAt") SELECT $1::text, $1::text::citext, password, $2, role, "workerType", $3::"MachineType", "machineCapabilities", now() FROM "User" WHERE username='e2e-worker-hand'`, [id, `分档师傅${i + 1}`, i === 2 ? 'WINDMILL' : 'HAND_PRESS']);
    await login(page, { from: `/owner/accounts/${workers[0]}` });
    for (const [i, id] of workers.entries()) await publish(page, id, i === 2);
    const pages = await Promise.all(contexts.map((context) => context.newPage()));
    for (const [i, p] of pages.entries()) await login(p, { username: workers[i]!, password: E2E_PASSWORD, from: '/worker/tasks' });
    async function fixture(qty: number, full = false, colors = 2) {
      const order = randomUUID(), item = randomUUID(), op = randomUUID();
      await c.query(`INSERT INTO "Order" (id,"orderNo","submitterId","submitterRole","settlementType","createdById",status,"pricingStatus","pricingConfirmedById","pricingConfirmedAt","customName","createdAt","updatedAt") SELECT $1,$2,"submitterId","submitterRole","settlementType","createdById",'SCHEDULING',"pricingStatus","pricingConfirmedById",now(),'分档工资验收',now(),now() FROM "Order" WHERE id=$3`, [order, `FOIL-${order.slice(0, 12)}`, sourceFixture.orderId]);
      await c.query(`INSERT INTO "OrderItem" (id,"orderId",sequence,fig,name,"pricingRoute",craft,"productStructure",specification,"actualWidthMm","actualHeightMm","paperType","paperWeightGsm",quantity,pack,crafts,"frontFoilColors","backFoilColors","foilColors","foilTechnique","hasLocalFoil","createdAt","updatedAt") SELECT $1,$2,1,1,'验收款',"pricingRoute",$4::"OrderCraft","productStructure",specification,"actualWidthMm","actualHeightMm","paperType","paperWeightGsm",$3,pack,crafts,$5::text[],ARRAY[]::text[],$5::text[],"foilTechnique",$6,now(),now() FROM "OrderItem" WHERE id=$7`, [item, order, qty, full ? 'FULL' : 'PARTIAL', ['金', '银', '红'].slice(0, colors), !full, sourceFixture.orderItemId]);
      await c.query(`INSERT INTO "ProductionOperation" (id,"orderId","operationType",unit,status,"plannedQty","createdAt","updatedAt") VALUES ($1,$2,$3::"PieceworkOperationType",$4::"PieceworkRateUnit",'PENDING',$5,now(),now())`, [op, order, full ? 'FULL' : 'PARTIAL', full ? 'PER_PIECE' : 'PER_PASS', qty * (full ? 1 : colors)]);
      await c.query(`INSERT INTO "ProductionOperationSource" (id,"operationId","sourceType","orderItemId","sourceQty") VALUES ($1,$2,'ORDER_ITEM',$3,$4)`, [randomUUID(), op, item, qty * (full ? 1 : colors)]);
      return { order, op };
    }
    for (const [qty, full, colors, expected] of [[800, false, 2, '24.00'], [1000, false, 2, '24.00'], [1001, false, 2, '24.01'], [800, true, 2, '40.00'], [800, true, 3, '60.00'], [1000, true, 2, '40.00'], [1001, true, 2, '40.02'], [2000, true, 2, '60.00']] as const) {
      const f = await fixture(qty, full, colors); await report(pages[full ? 2 : 0]!, f.op, qty, c);
      expect((await c.query('SELECT amount::text FROM "ProductionReport" WHERE "operationId"=$1', [f.op])).rows[0].amount).toBe(expected);
    }
    const f = await fixture(2000); await report(pages[0]!, f.op, 1000, c);
    // Simulate the next closed day through the domain clock seam; never rewrite reports.
    const probe = execFileSync(process.execPath, ['--conditions=react-server', '--import', 'tsx', '-e', `
      const { db } = require('./lib/db.ts');
      const { lockPieceworkSettlement } = require('./lib/salary/piecework-settlement.ts');
      const { formatDateInputShanghai } = require('./lib/format/dates.ts');
      (async () => {
        const actor = await db.user.findFirstOrThrow({ where: { role: 'ADMIN', isActive: true } });
        const row = await db.productionReport.findFirstOrThrow({ where: { operationId: process.argv[1] } });
        try {
          await lockPieceworkSettlement({ reporterId: row.reporterId, workDate: formatDateInputShanghai(row.reportedAt), actor,
            now: new Date(row.reportedAt.getTime() + 86400000) });
          throw Error('Unexpected early settlement');
        } catch (error) {
          if (error.code !== 'SETTLEMENT_STATE_CONFLICT' || !error.message.includes('尚未结束')) throw error;
          console.log('EARLY_SETTLEMENT_BLOCKED');
        }
      })().catch(error => { console.error(error); process.exitCode = 1; }).finally(() => db.$disconnect());
    `, f.op], { cwd: process.cwd(), env: { ...process.env, DATABASE_URL: assertActivatedE2eDatabase().url }, encoding: 'utf8', timeout: 30000 });
    expect(probe).toContain('EARLY_SETTLEMENT_BLOCKED');
    expect((await c.query('SELECT count(*)::int AS n FROM "PieceworkSettlement" WHERE "reporterId"=$1', [workers[0]])).rows[0].n).toBe(0);
    await report(pages[1]!, f.op, 1000, c);
    const originals = (await c.query('SELECT id, amount::text FROM "ProductionReport" WHERE "operationId"=$1 ORDER BY "createdAt"', [f.op])).rows;
    expect(originals.map((r) => r.amount)).toEqual(['24.00', '14.00']);
    expect((await c.query('SELECT "payrollReviewRequired" FROM "ProductionOperation" WHERE id=$1', [f.op])).rows[0].payrollReviewRequired).toBe(true);
    await page.goto(`/orders/${f.order}`);
    const disclosure = page.getByRole('button', { name: /生产、用料与计件记录/ }); if (await disclosure.count()) await disclosure.click();
    const panel = page.getByRole('region', { name: '工单提成明细', exact: true }); await expect(panel).toBeVisible();
    await expect(panel.getByText('需人工核定', { exact: true })).toBeVisible();
    const inputs = panel.getByRole('textbox', { name: /核定提成/ }); await expect(inputs).toHaveCount(2);
    await inputs.nth(0).fill('19'); await inputs.nth(1).fill('19'); await panel.getByLabel('核定原因').fill('两位师傅各完成一半，均分提成');
    await panel.getByRole('button', { name: '核对提成' }).click(); await expect(panel.getByText(/差额.*5/).first()).toBeVisible();
    await panel.getByRole('button', { name: '保存核定' }).click(); await expect(panel.getByText('需人工核定', { exact: true })).toHaveCount(0);
    expect((await c.query('SELECT id, amount::text FROM "ProductionReport" WHERE id=ANY($1::text[]) ORDER BY "createdAt"', [originals.map((r) => r.id)])).rows).toEqual(originals);
    const totals = (await c.query('SELECT sum(amount)::text AS amount FROM "ProductionReport" WHERE "operationId"=$1 GROUP BY "reporterId"', [f.op])).rows;
    expect(totals.map((r) => r.amount)).toEqual(['19.00', '19.00']);
    expect((await c.query('SELECT count(*)::int AS n FROM "ProductionReport" WHERE "operationId"=$1 AND "entryType"=\'ADJUSTMENT\' AND "reportedCompletedQty"=0', [f.op])).rows[0].n).toBe(2);
    // Independent SQL guards: an arbitrary supplement and a worker-authored adjustment both fail.
    const forged = `INSERT INTO "ProductionReport" (id,"operationId","reporterId","entryType","reportedCompletedQty","chargeableQty",unit,rate,amount,"wageSupplement","priceBookId","priceBookVersion","ruleSetSha256",snapshot,"idempotencyKey") SELECT $1::text,"operationId","reporterId",'REPORT',1,2,unit,rate,100.01,100,"priceBookId","priceBookVersion","ruleSetSha256",snapshot,$1::text FROM "ProductionReport" WHERE id=$2`;
    await expect(c.query(forged, [randomUUID(), originals[0].id])).rejects.toThrow(/Foil wage/);
    const adjustment = `INSERT INTO "ProductionReport" (id,"operationId","reporterId","entryType","adjustedById","reportedCompletedQty","chargeableQty",unit,rate,amount,"wageSupplement","priceBookId","priceBookVersion","ruleSetSha256","reportedAt",snapshot,"idempotencyKey") SELECT $1::text,"operationId","reporterId",'ADJUSTMENT',$3,0,0,unit,rate,1,1,"priceBookId","priceBookVersion","ruleSetSha256","reportedAt",jsonb_build_object('anchorReportId',id,'reason','测试核定'),$1::text FROM "ProductionReport" WHERE id=$2`;
    await expect(c.query(adjustment, [randomUUID(), originals[0].id, workers[0]])).rejects.toThrow(/Invalid manual/);
    const admin = (await c.query(`SELECT id FROM "User" WHERE role='ADMIN' AND "isActive" LIMIT 1`)).rows[0].id;
    await c.query('BEGIN');
    try {
      await c.query(`INSERT INTO "PieceworkSettlement" (id,"reporterId","workDate",status,"reportAmount","payableAmount",snapshot,"lockedAt","updatedAt") SELECT $1,"reporterId",("reportedAt" AT TIME ZONE 'Asia/Shanghai')::date,'LOCKED',19,19,'{}',now(),now() FROM "ProductionReport" WHERE id=$2`, [randomUUID(), originals[0].id]);
      await expect(c.query(adjustment, [randomUUID(), originals[0].id, admin])).rejects.toThrow(/Settled wages/);
    } finally { await c.query('ROLLBACK'); }
    for (const width of [375, 393, 768, 1024, 1280, 1920]) {
      await page.setViewportSize({ width, height: 1000 });
      for (const theme of ['浅色', '暗色']) {
        await page.getByRole('button', { name: '切换界面主题' }).click(); await page.getByRole('menuitemradio', { name: theme, exact: true }).press('Enter'); await page.keyboard.press('Escape');
        await expect.poll(() => page.evaluate(() => document.getAnimations().filter((a) => a.playState === 'running' || a.pending).length)).toBe(0);
        expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
        for (const control of await panel.locator('input:not([type=hidden]), button').all()) if (await control.isVisible()) { const box = await control.boundingBox(); expect(box!.height).toBeGreaterThanOrEqual(44); }
        expect((await new AxeBuilder({ page }).include('[aria-label="工单提成明细"]').analyze()).violations).toEqual([]);
      }
    }
    await publish(page, workers[0]!, false, '5.0026');
    const precise = await fixture(2000); await report(pages[0]!, precise.op, 2000, c);
    expect((await c.query('SELECT amount::text FROM "ProductionReport" WHERE "operationId"=$1', [precise.op])).rows[0].amount).toBe('38.01');
    const pending = await fixture(2000); const worker = pages[0]!;
    for (const width of [375, 393, 768, 1024, 1280, 1920]) {
      await worker.setViewportSize({ width, height: 1000 });
      for (const theme of ['light', 'dark']) {
        await worker.emulateMedia({ colorScheme: theme as 'light' | 'dark', reducedMotion: 'reduce' });
        await worker.evaluate((value) => localStorage.setItem('erp-theme', value), theme);
        await worker.goto(`/worker/tasks/${pending.op}`);
        await expect(worker.locator('html')).toHaveAttribute('data-theme', theme);
        expect(await worker.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
        for (const control of await worker.locator('main input:not([type=hidden]), main button').all()) if (await control.isVisible()) { const box = await control.boundingBox(); expect(box!.height).toBeGreaterThanOrEqual(44); }
        expect((await new AxeBuilder({ page: worker }).include('main').analyze()).violations).toEqual([]);
      }
    }
    // A reversal on another Shanghai day remains read-only but must be acknowledgeable.
    const reversed = await fixture(800);
    await report(pages[1]!, reversed.op, 800, c);
    await c.query(`INSERT INTO "ProductionReport" (id,"operationId","reporterId","entryType","reversalOfId","reportedCompletedQty","defectQty","reworkQty","chargeableQty",unit,rate,amount,"wageSupplement","priceBookId","priceBookVersion","ruleSetSha256","reportedAt",snapshot,"idempotencyKey") SELECT $1::text,"operationId","reporterId",'REVERSAL',id,-"reportedCompletedQty",-"defectQty",-"reworkQty",-"chargeableQty",unit,rate,-amount,-"wageSupplement","priceBookId","priceBookVersion","ruleSetSha256","reportedAt"+interval '1 day',snapshot,$1::text FROM "ProductionReport" WHERE "operationId"=$2 AND "entryType"='REPORT'`, [randomUUID(), reversed.op]);
    await page.goto(`/orders/${reversed.order}`);
    const reversalDisclosure = page.getByRole('button', { name: /生产、用料与计件记录/ });
    if (await reversalDisclosure.count()) await reversalDisclosure.click();
    const negative = panel.getByRole('textbox', { name: /核定提成/ }).nth(1);
    await expect(negative).toHaveValue('-24.00');
    await expect(negative).toHaveAttribute('readonly', '');
    await panel.getByLabel('核定原因').fill('确认跨日冲正原额');
    await panel.getByRole('button', { name: '核对提成' }).click();
    await panel.getByRole('button', { name: '保存核定' }).click();
    await expect(panel.getByText('需人工核定', { exact: true })).toHaveCount(0);
    expect((await c.query('SELECT count(*)::int AS n FROM "ProductionReport" WHERE "operationId"=$1', [reversed.op])).rows[0].n).toBe(2);
  } finally { await Promise.all(contexts.map((context) => context.close())); await c.end(); }
});
