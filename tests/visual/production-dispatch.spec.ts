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

test('历史计薪次数异常显示表单提示并保持生产记录不变', async ({ page, browser }, info) => {
  const errors: string[] = [];
  const fixture = await seedProductionDispatchFixture();
  await login(page, { from: `/orders/production?ids=${fixture.id}` });
  await page.getByRole('combobox', { name: '局部烫金 · 1000 个' }).selectOption(fixture.workerId);
  await page.getByRole('button', { name: '核对排单' }).click();
  await page.getByRole('button', { name: '发布排单', exact: true }).click();
  await expect(page.getByRole('status')).toContainText('已安排 1 张工单');
  const job = await withDb(async db => {
    const original = (await db.query<{ id: string; revision: number; snapshot: Record<string, unknown> }>(
      'SELECT id, revision, snapshot FROM "ProductionJob" WHERE "orderId"=$1', [fixture.id],
    )).rows[0];
    // 只在隔离夹具中建立历史异常资料，生产应用不提供修改快照的入口。
    const snapshot = { ...original.snapshot, registrationPricing: {
      mode: 'AUTOMATIC', priceBookId: 'historical-fixture', priceBookVersion: 1, ruleSetSha256: 'a'.repeat(64),
      source: 'UNIFIED', policyBookId: null, policyBookVersion: null, useUnifiedRates: true,
      rate: '0.0070', smallOrderAmount: '12', setupAmount: '5', multiplier: 1.5,
    } };
    await db.query('UPDATE "ProductionJob" SET snapshot=$2::jsonb WHERE id=$1', [original.id, JSON.stringify(snapshot)]);
    return original;
  });
  const context = await browser.newContext({ ...info.project.use, baseURL: info.project.use.baseURL });
  const workerPage = await context.newPage();
  workerPage.on('pageerror', error => errors.push(error.message));
  try {
    await login(workerPage, { from: `/worker/tasks/${job.id}`, username: E2E_USERS.workerHandPress.username, password: E2E_PASSWORD });
    await workerPage.getByRole('button', { name: '完成生产', exact: true }).click();
    await workerPage.getByRole('button', { name: '确认完成 1000 个', exact: true }).click();
    await expect(workerPage.getByRole('status')).toContainText('计薪数量与次数须为正整数，次数最多 999');
    await expect(workerPage.getByRole('button', { name: '确认完成 1000 个', exact: true })).toBeEnabled();
    await gates(workerPage, info, 'historical-pricing-error');
    await withDb(async db => {
      expect((await db.query('SELECT status, revision FROM "ProductionJob" WHERE id=$1', [job.id])).rows[0])
        .toEqual({ status: 'PENDING', revision: job.revision });
      expect((await db.query('SELECT id FROM "ProductionWage" WHERE "jobId"=$1', [job.id])).rowCount).toBe(0);
      await db.query('UPDATE "ProductionJob" SET snapshot=$2::jsonb WHERE id=$1', [job.id, JSON.stringify(job.snapshot)]);
    });
    await workerPage.reload();
    await workerPage.getByRole('button', { name: '完成生产', exact: true }).click();
    await workerPage.getByRole('button', { name: '确认完成 1000 个', exact: true }).click();
    await expect(workerPage.getByText('已登记完成', { exact: true })).toBeVisible();
    expect(await withDb(async db => (await db.query('SELECT id FROM "ProductionWage" WHERE "jobId"=$1', [job.id])).rowCount)).toBe(1);
    expect(errors).toEqual([]);
  } finally {
    await context.close();
  }
});

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
  await expect(page.getByRole('heading', { name: '发布排单', exact: true })).toBeFocused();
  await gates(page, info, 'dispatch-review');
  await page.getByRole('button', { name: '发布排单', exact: true }).click();
  await expect(page.getByRole('status')).toContainText('已安排 1 张工单');
  await expect(page.getByRole('region', { name: '排单结果', exact: true })).toBeFocused();
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


test('incomplete dispatch orders show recovery without partial publication', async ({ page }, info) => {
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  const valid = await seedProductionDispatchFixture();
  const incomplete = await seedProductionDispatchFixture({ incomplete: true });
  const name = '待完善工单-ABCDEFGHIJKLMNOPQRSTUVWXYZ-包装与工艺资料需要核对';
  await withDb(db => db.query('UPDATE "Order" SET "customName"=$2 WHERE id=$1', [incomplete.id, name]));
  await login(page, { from: `/orders/production?ids=${valid.id},${incomplete.id}` });
  await expect(page.getByRole('status')).toContainText('所选工单暂不能一起安排生产');
  const blocked = page.getByRole('list', { name: '待处理工单' });
  await expect(blocked).toContainText('款式 #1：生产工艺不明确，请完善工艺资料。');
  await expect(blocked).toContainText('未填写包装组，请完善包装资料。');
  await expect(blocked).not.toContainText('canonical');
  await expect(page.getByRole('button', { name: '核对排单' })).toHaveCount(0);
  await expect(page.getByRole('button', { name: '发布排单', exact: true })).toHaveCount(0);
  await expect(page.getByRole('combobox')).toHaveCount(0);
  expect(await withDb(async db => (await db.query('SELECT id FROM "ProductionJob" WHERE "orderId"=ANY($1::text[])', [[valid.id, incomplete.id]])).rowCount)).toBe(0);
  await gates(page, info, 'dispatch-incomplete');
  if ([390, 1280].includes(info.project.use.viewport!.width)) {
    await page.evaluate(() => { document.documentElement.style.zoom = '2'; });
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth + 1)).toBe(true);
    await page.evaluate(() => { document.documentElement.style.zoom = ''; });
  }
  const details = blocked.getByRole('link', { name, exact: true });
  await details.focus();
  await page.keyboard.press('Enter');
  await expect(page).toHaveURL(new RegExp(`/orders/${incomplete.id}$`));
  await page.goBack();
  await page.getByRole('link', { name: '返回工单列表', exact: true }).click();
  await expect(page).toHaveURL(/\/orders$/);
  await page.goto(`/orders/production?ids=${valid.id}`);
  await expect(page.getByRole('combobox', { name: '局部烫金 · 1000 个' })).toBeVisible();
  expect(errors).toEqual([]);
});


test('dispatch invalidated after review rejects the complete batch with a safe reason', async ({ page }, info) => {
  const fixtures = [await seedProductionDispatchFixture(), await seedProductionDispatchFixture()].sort((a, b) => a.id.localeCompare(b.id));
  const ids = fixtures.map(row => row.id);
  const snapshot = () => withDb(async db => (await db.query('SELECT id, status, revision, "simpleProduction" FROM "Order" WHERE id=ANY($1::text[]) ORDER BY id', [ids])).rows);
  const before = await snapshot();
  await login(page, { from: `/orders/production?ids=${ids.join(',')}` });
  await expect(page.getByRole('combobox', { name: '局部烫金 · 1000 个' })).toHaveCount(2);
  for (const select of await page.getByRole('combobox', { name: '局部烫金 · 1000 个' }).all()) await select.selectOption(fixtures[0].workerId);
  await page.getByRole('button', { name: '核对排单', exact: true }).click();
  await expect(page.getByRole('button', { name: '发布排单', exact: true })).toBeVisible();
  // Invalidate the second order after review, so the transaction must roll back
  // the first order's already attempted release and assignment writes as well.
  await withDb(db => db.query('UPDATE "OrderItem" SET craft=NULL, crafts=ARRAY[]::text[] WHERE "orderId"=$1', [ids[1]]));
  await page.getByRole('button', { name: '发布排单', exact: true }).click();
  await expect(page.getByRole('alert', { name: /^排单扫码验收：/ })).toContainText('排单扫码验收：款式 #1：生产工艺不明确，请完善工艺资料。');
  await expect(page.getByRole('alert', { name: /^排单扫码验收：/ })).not.toContainText('canonical');
  await gates(page, info, 'dispatch-invalidated');
  expect(await snapshot()).toEqual(before);
  expect(await withDb(async db => (await db.query('SELECT id FROM "ProductionJob" WHERE "orderId"=ANY($1::text[])', [ids])).rowCount)).toBe(0);
  expect(await withDb(async db => (await db.query('SELECT id FROM "ProductionOperation" WHERE "orderId"=ANY($1::text[])', [ids])).rowCount)).toBe(0);
  expect(await withDb(async db => (await db.query('SELECT id FROM "OrderLog" WHERE "orderId"=ANY($1::text[]) AND action=\'PRODUCTION_ASSIGNED\'', [ids])).rowCount)).toBe(0);
});
