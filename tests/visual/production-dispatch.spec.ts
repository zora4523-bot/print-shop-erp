import { test, expect, type Page, type TestInfo } from '@playwright/test';
import { login, withDb, E2E_USERS, E2E_PASSWORD } from '../e2e/_helpers';
import { seedProductionDispatchFixture } from './production-dispatch-fixture';
import { expectViewportGate, expectA11yGate, attachCandidateScreenshot } from './ui-gates';

async function gates(page: Page, info: TestInfo, name: string) {
  for (const theme of ['light', 'dark'] as const) {
    await page.emulateMedia({ colorScheme: theme, reducedMotion: 'reduce' });
    await page.evaluate(theme => {
      localStorage.setItem('erp-theme', theme);
      document.documentElement.classList.toggle('dark', theme === 'dark');
      document.documentElement.dataset.theme = theme;
      document.documentElement.style.colorScheme = theme;
    }, theme);
    await expect.poll(() => page.evaluate(() => document.getAnimations().filter(a => a.playState === 'running' || a.pending).length)).toBe(0);
    if (name === 'dispatch-success') {
      const borderColors = await page.getByRole('region', { name: '排单结果' }).getByRole('link')
        .evaluateAll(links => links.map(link => getComputedStyle(link).borderTopColor));
      expect(borderColors).not.toContain('rgba(0, 0, 0, 0)');
    }
    await expectViewportGate(page, info);
    await expectA11yGate(page);
    await attachCandidateScreenshot(page, info, 'production-dispatch', `${name}-${theme}`);
  }
}

test('single owner dispatch, quantity approval, wages and external sales state', async ({ page, browser }, info) => {
  test.setTimeout(180000);
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  page.on('console', message => { if (message.type() === 'error') errors.push(message.text()); });
  const fixture = await seedProductionDispatchFixture();
  await login(page, { from: `/orders/production?ids=${fixture.id}` });
  await expect(page.getByRole('navigation', { name: '面包屑导航' }).locator('[aria-current="page"]')).toContainText('安排生产师傅');
  await page.getByRole('combobox', { name: '局部烫金 · 1000 个' }).selectOption(fixture.workerId);
  await page.getByRole('button', { name: '保存草稿' }).click();
  await page.reload();
  await page.getByRole('button', { name: '恢复草稿' }).click();
  await expect(page.getByRole('combobox', { name: '局部烫金 · 1000 个' })).toHaveValue(fixture.workerId);
  await page.getByRole('button', { name: '核对排单' }).click();
  await gates(page, info, 'dispatch-review');
  await page.getByRole('button', { name: '发布排单', exact: true }).click();
  await expect(page.getByRole('status')).toContainText('已安排 1 张工单');
  await expect(page.getByRole('combobox')).toHaveCount(0);
  await expect(page.getByRole('button', { name: '返回修改' })).toHaveCount(0);
  await expect(page.getByRole('button', { name: /草稿/ })).toHaveCount(0);
  const resultLink = page.getByRole('link', { name: /查看排单结果/ });
  await expect(resultLink).toHaveAttribute('href', `/orders/${fixture.id}#detail-production-records`);
  await gates(page, info, 'dispatch-success');
  await resultLink.click();
  await expect(page).toHaveURL(new RegExp(`/orders/${fixture.id}#detail-production-records$`));
  await expect(page.getByRole('heading', { name: '生产安排与提成' })).toBeVisible();
  const job = await withDb(async db => (await db.query<{ id: string }>('SELECT id FROM "ProductionJob" WHERE "orderId"=$1', [fixture.id])).rows[0]);
  const workerContext = await browser.newContext({ ...info.project.use, baseURL: info.project.use.baseURL });
  const workerPage = await workerContext.newPage();
  workerPage.on('pageerror', error => errors.push(error.message));
  workerPage.on('console', message => { if (message.type() === 'error') errors.push(message.text()); });
  try {
    await login(workerPage, { from: `/worker/tasks/${job.id}`, username: E2E_USERS.workerHandPress.username, password: E2E_PASSWORD });
    // 师傅默认一键按计划数量完成，不显示数量输入（业主 2026-10-01）。
    await expect(workerPage.getByRole('button', { name: '完成生产', exact: true })).toBeVisible();
    await expect(workerPage.getByLabel('实际完成数量')).toBeHidden();
    await expect(workerPage.getByRole('link', { name: '返回工序工单', exact: true })).toHaveAttribute('href', '/worker/tasks');
    await gates(workerPage, info, 'worker-completion');
    await workerPage.getByRole('link', { name: '返回工序工单', exact: true }).click();
    await expect(workerPage).toHaveURL(/\/worker\/tasks$/);
    await expect(workerPage.getByRole('region', { name: '已安排的生产' }).getByRole('link', { name: /排单扫码验收/ }).first()).toBeVisible();
    await expect(workerPage.getByText('暂无待处理工序', { exact: true })).toHaveCount(0);
    await gates(workerPage, info, 'worker-tasks');
    await expect(workerPage.getByRole('region', { name: '已安排的生产' }).getByRole('button', { name: '完成生产', exact: true }).first()).toBeVisible();
    await workerPage.goto(`/worker/tasks/${job.id}`);
    await workerPage.getByText('实际数量与计划不一致？上报数量').click();
    await workerPage.getByLabel('实际完成数量').fill('990');
    await workerPage.getByLabel('数量修改原因').fill('核实实际成品');
    await workerPage.getByRole('button', { name: '提交数量审批', exact: true }).click();
    await expect(workerPage.getByRole('status')).toContainText('数量待审批');
    expect(await withDb(async db => (await db.query('SELECT id FROM "ProductionWage" WHERE "jobId"=$1', [job.id])).rowCount)).toBe(0);
    // The result link already opened this exact URL. Reload to fetch the worker's
    // new request; navigating to the same fragment would keep the old document.
    await page.reload();
    await expect(page.getByRole('button', { name: '核定并登记完成' })).toBeVisible();
    await page.getByLabel('核定或补登记说明').fill('已核实数量');
    await gates(page, info, 'admin-quantity-approval');
    await page.getByRole('button', { name: '核定并登记完成' }).click();
    await expect(page.getByRole('heading', { name: '登记最终提成' })).toBeVisible();
    await page.getByLabel('E2E 开机仔最终提成（元）').fill('190');
    await page.getByLabel('金额依据').fill('核定本次生产最终提成');
    await page.getByRole('button', { name: '添加协作师傅提成' }).click();
    await page.getByRole('button', { name: '移除协作师傅' }).click();
    await page.getByRole('button', { name: '核对提成', exact: true }).click();
    await gates(page, info, 'admin-wage-review');
    await page.getByRole('button', { name: '登记提成', exact: true }).click();
    await expect.poll(() => withDb(async db => (await db.query<{ amount: string }>('SELECT amount FROM "ProductionWage" WHERE "jobId"=$1', [job.id])).rows[0]?.amount)).toBe('190.00');
    await page.getByRole('button', { name: '更正误登记', exact: true }).click();
    await expect(page.getByRole('alertdialog')).toBeVisible();
    await gates(page, info, 'correction-dialog');
    await page.keyboard.press('Escape');
    await expect(page.getByRole('alertdialog')).toBeHidden();
    await workerPage.goto('/worker/salary');
    await expect(workerPage.getByRole('heading', { name: '完工提成 · 待结算' })).toBeVisible();
    await gates(workerPage, info, 'worker-wages');
    const states = await withDb(async db => (await db.query('SELECT o.status, p.status AS packing FROM "Order" o JOIN "ProductionOperation" p ON p."orderId"=o.id AND p."operationType"=\'PACKING\' WHERE o.id=$1', [fixture.id])).rows[0]);
    expect(states).toEqual({ status: 'PACKING', packing: 'PENDING' });
    await workerContext.clearCookies();
    await login(workerPage, { from: `/orders/${fixture.id}`, username: E2E_USERS.sales.username, password: E2E_PASSWORD });
    await expect(workerPage.getByText('待打包发货', { exact: true }).first()).toBeVisible();
    await expect(workerPage.getByRole('heading', { name: '生产安排与提成' })).toHaveCount(0);
    await expect(workerPage.getByText('190.00', { exact: true })).toHaveCount(0);
    await page.goto(`/print/orders/${fixture.id}`);
    await expect(page.locator('.work-order-document')).toContainText('生产师傅：E2E 开机仔');
    await expect(page.locator('.hd .line')).toContainText('待打包发货');
    expect(errors).toEqual([]);
  } finally { await workerContext.close(); }
});

test('admin batch-completes dispatched production at plan from the order list', async ({ page }, info) => {
  test.setTimeout(120000);
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  const fixture = await seedProductionDispatchFixture();
  await login(page, { from: `/orders/production?ids=${fixture.id}` });
  await page.getByRole('combobox', { name: '局部烫金 · 1000 个' }).selectOption(fixture.workerId);
  await page.getByRole('button', { name: '核对排单' }).click();
  await page.getByRole('button', { name: '发布排单', exact: true }).click();
  await expect(page.getByRole('status')).toContainText('已安排 1 张工单');
  // 业主 2026-10-01：师傅没点完成时，管理员在工单列表批量按计划数量完成。
  await page.goto(`/orders?queue=all&q=${fixture.id}`);
  await page.getByRole('checkbox', { name: new RegExp(`选择工单 .*${fixture.id}`) }).check();
  const batch = page.getByRole('region', { name: '工单批量操作' });
  await batch.getByRole('button', { name: /批量完成生产/ }).click();
  const dialog = page.getByRole('alertdialog');
  await expect(dialog).toContainText('师傅：E2E 开机仔');
  await expect(dialog).toContainText('生产日期记为今天');
  await gates(page, info, 'batch-complete-confirm');
  await dialog.getByRole('button', { name: '确认完成生产' }).click();
  await expect(page.getByText('已按计划数量登记生产完成').first()).toBeVisible();
  const job = await withDb(async db => (await db.query<{ status: string; recordSource: string; completedQty: string }>('SELECT status, "recordSource", "completedQty"::text AS "completedQty" FROM "ProductionJob" WHERE "orderId"=$1', [fixture.id])).rows[0]);
  expect(job).toEqual({ status: 'COMPLETED', recordSource: 'ADMIN_BATCH', completedQty: '1000.000' });
  const wage = await withDb(async db => (await db.query<{ amount: string | null }>('SELECT w.amount::text AS amount FROM "ProductionWage" w JOIN "ProductionJob" j ON j.id=w."jobId" WHERE j."orderId"=$1', [fixture.id])).rows);
  expect(wage).toHaveLength(1);
  expect(wage[0].amount).not.toBeNull();
  expect((await withDb(async db => (await db.query<{ status: string }>('SELECT status FROM "Order" WHERE id=$1', [fixture.id])).rows[0])).status).toBe('PACKING');
  expect(errors).toEqual([]);
});

test('confirming the first address ships and registers the unreported production at plan', async ({ page }, info) => {
  test.setTimeout(120000);
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  const fixture = await seedProductionDispatchFixture();
  await withDb(async db => {
    for (const sequence of [1, 2]) {
      await db.query(`INSERT INTO "OrderShipment" (id,"orderId",sequence,"receiverName","receiverPhone","receiverAddress","destinationProvince","updatedAt") VALUES ($1,$2,$3,$4,'13800138000',$5,'广东',NOW())`,
        [`${fixture.id}-ship-${sequence}`, fixture.id, sequence, `收件人${sequence}`, `广东省佛山市测试路${sequence}号`]);
      await db.query(`INSERT INTO "OrderShipmentLine" (id,"shipmentId","orderItemId",quantity) VALUES ($1,$2,$3,500)`, [`${fixture.id}-line-${sequence}`, `${fixture.id}-ship-${sequence}`, `${fixture.id}-item`]);
    }
  });
  await login(page, { from: `/orders/production?ids=${fixture.id}` });
  await page.getByRole('combobox', { name: '局部烫金 · 1000 个' }).selectOption(fixture.workerId);
  await page.getByRole('button', { name: '核对排单' }).click();
  await page.getByRole('button', { name: '发布排单', exact: true }).click();
  await expect(page.getByRole('status')).toContainText('已安排 1 张工单');
  // 业主 2026-10-01：师傅没扫码报工，管理员填运单号确认发货即视为生产完成。
  await page.goto(`/orders/${fixture.id}`);
  const delivery = page.locator('#detail-delivery-records');
  const first = delivery.locator('li').filter({ has: page.getByRole('textbox', { name: '运单号', exact: true }) }).nth(0);
  await expect(first.getByText('确认发货时将按计划数量代师傅登记并计提成')).toBeVisible();
  await first.getByRole('textbox', { name: '运单号', exact: true }).fill('ZTO-PLANNED-1');
  await first.getByRole('combobox', { name: '物流公司', exact: true }).selectOption('ZTO');
  await first.getByRole('button', { name: '确认该地址已发货', exact: true }).click();
  const dialog = page.getByRole('alertdialog');
  await expect(dialog).toContainText('生产未报完，将按计划数量代师傅登记并计提成：E2E 开机仔（局部烫金 1000 个）');
  await gates(page, info, 'ship-completes-production-confirm');
  await dialog.getByRole('button', { name: '确认发货', exact: true }).click();
  await expect.poll(() => withDb(async db => (await db.query<{ status: string }>('SELECT status FROM "OrderShipment" WHERE id=$1', [`${fixture.id}-ship-1`])).rows[0].status)).toBe('SHIPPED');
  const job = await withDb(async db => (await db.query<{ status: string; recordSource: string }>('SELECT status, "recordSource" FROM "ProductionJob" WHERE "orderId"=$1', [fixture.id])).rows[0]);
  expect(job).toEqual({ status: 'COMPLETED', recordSource: 'SHIPMENT_AUTO' });
  expect((await withDb(async db => (await db.query('SELECT 1 FROM "ProductionWage" w JOIN "ProductionJob" j ON j.id=w."jobId" WHERE j."orderId"=$1 AND w.amount IS NOT NULL', [fixture.id])).rowCount))).toBe(1);
  expect((await withDb(async db => (await db.query<{ status: string }>('SELECT status FROM "Order" WHERE id=$1', [fixture.id])).rows[0])).status).toBe('PACKING');
  expect(errors).toEqual([]);
});
