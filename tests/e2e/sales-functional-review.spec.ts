import { randomUUID } from 'node:crypto';
import { expect, test, type Page } from '@playwright/test';
import { Client } from 'pg';
import AxeBuilder from '@axe-core/playwright';
import { E2E_PASSWORD, E2E_USERS, getUserIdByUsername, login } from './_helpers';

test.use({ hasTouch: true });

// Each case owns a fresh, append-only historical fixture. Never mutate a real
// salesperson's order or weaken the database's immediate quote constraints.
async function seed(status = 'SUBMITTED', username = E2E_USERS.sales.username, prefix = 'e2e-sales-review') {
  const id = `${prefix}-${randomUUID()}`;
  const salesId = await getUserIdByUsername(username);
  const db = new Client({ connectionString: process.env.DATABASE_URL });
  await db.connect();
  try {
    await db.query('BEGIN');
    const { rows: books } = await db.query(`SELECT id FROM "CustomerPriceBook" WHERE purpose='LOGISTICS' AND "settlementType"='EXTERNAL_SALES' AND "isActive" ORDER BY "effectiveFrom" DESC LIMIT 1`);
    expect(books).not.toHaveLength(0);
    await db.query(`INSERT INTO "Order" (id,"orderNo","submitterId","submitterRole","createdById","settlementType",status,"customName","receiverName","receiverPhone","receiverAddress","processingAmount","totalAmount","confirmedFee","pricingStatus","pricingConfirmedAt","updatedAt","settlementContractVersion","settledFee","settledAt") VALUES ($1,$1,$2,'SALES',$2,'EXTERNAL_SALES',$3::"OrderStatus",$1,'测试收件人','13800138000','广东省佛山市测试路1号',100,130,130,'LEGACY_CONFIRMED',NOW(),NOW(),CASE WHEN $3::text='SETTLED' THEN 2 END,CASE WHEN $3::text='SETTLED' THEN 130 END,CASE WHEN $3::text='SETTLED' THEN NOW() END)`, [id, salesId, status]);
    await db.query(`INSERT INTO "OrderItem" (id,"orderId",sequence,name,"pricingRoute","productStructure","paperType","paperWeightGsm",quantity,crafts,"foilTechnique",subtotal,"updatedAt") VALUES ($1,$2,1,'销售回归测试款','STOCK_BLANK','STANDARD_ENVELOPE','珠光艳闪',160,1000,ARRAY[]::text[],'FLAT',100,NOW())`, [`${id}-item`, id]);
    await db.query(`INSERT INTO "OrderShipment" (id,"orderId",sequence,"receiverName","receiverPhone","receiverAddress","destinationProvince","carrierCode","updatedAt") VALUES ($1,$2,1,'测试收件人','13800138000','广东省佛山市测试路1号','广东','ZTO',NOW())`, [`${id}-shipment`, id]);
    await db.query(`INSERT INTO "OrderShipmentLine" (id,"shipmentId","orderItemId",quantity) VALUES ($1,$2,$3,1000)`, [`${id}-line`, `${id}-shipment`, `${id}-item`]);
    for (const [code, amount] of [['SHIPPING_FEE', '20'], ['PACKING_MATERIAL', '10']]) {
      await db.query(`INSERT INTO "OrderCustomerCharge" (id,"orderId","shipmentId","categoryId","priceBookId","businessKey",description,amount,"overrideReason","createdById","updatedAt") SELECT $1,$2,$3,c.id,$4,$5,c.name,$6,'测试历史约定收费',$7,NOW() FROM "CustomerChargeCategory" c WHERE code=$8`, [`${id}-${code}`, id, `${id}-shipment`, books[0].id, `SHIPMENT:1:${code}`, amount, salesId, code]);
    }
    await db.query('COMMIT');
    return id;
  } catch (error) { await db.query('ROLLBACK'); throw error; }
  finally { await db.end(); }
}

async function readOrder(id: string) {
  const db = new Client({ connectionString: process.env.DATABASE_URL });
  await db.connect();
  try {
    const { rows } = await db.query(`SELECT o.status, o."isSfCollect", o."remark", o."promisedDate", o."processingAmount"::text, o."totalAmount"::text, o."quotedFee"::text, o."quotedFeeCompleteness", o."quotedPricingRevisionId", o."confirmedFee"::text, o."priceRevision", o.revision,
      (SELECT snapshot->'order'->>'quotedFee' FROM "OrderPricingRevision" WHERE id=o."quotedPricingRevisionId") AS "snapshotFee",
      (SELECT jsonb_agg(jsonb_build_object('type',r.type,'status',r.status) ORDER BY r."createdAt") FROM "OrderChangeRequest" r WHERE r."orderId"=o.id) AS requests,
      (SELECT amount::text FROM "OrderCustomerCharge" c WHERE c."orderId"=o.id AND c."businessKey"='SHIPMENT:1:PACKING_MATERIAL') AS packing
      FROM "Order" o WHERE o.id=$1`, [id]);
    return rows[0];
  } finally { await db.end(); }
}

function trackErrors(page: Page) {
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  page.on('console', (message) => {
    if (message.type() !== 'error') return;
    const text = message.text();
    // Rapid full navigations can abort Next dev's HMR handshake. This is not
    // application traffic; keep every other console error and all page errors.
    if (/^WebSocket connection to 'wss?:\/\/[^']+\/_next\/hmr\?[^']*' failed: Error during WebSocket handshake: net::ERR_CONNECTION_RESET$/.test(text)) return;
    errors.push(text);
  });
  return errors;
}
async function salesLogin(page: Page, from: string) {
  await login(page, { from, username: E2E_USERS.sales.username, password: E2E_PASSWORD });
}
async function healthy(page: Page) {
  await expect(page.locator('[data-slot="admin-route-error"]')).toHaveCount(0);
  await expect(page.locator('nextjs-portal [data-nextjs-dialog]')).toHaveCount(0);
}

test('销售旧工单顺丰到付往返切换，报价三字段与不可变记录一致', async ({ page }) => {
  const id = await seed();
  const errors = trackErrors(page);
  const before = await readOrder(id);
  expect(before.quotedPricingRevisionId).toBeNull();
  await salesLogin(page, `/orders/${id}#change-request`);
  await page.getByRole('button', { name: '标记顺丰到付', exact: true }).click();
  await expect(page.getByRole('button', { name: '取消顺丰到付', exact: true })).toBeVisible();
  const waived = await readOrder(id);
  expect(waived).toMatchObject({ isSfCollect: true, totalAmount: '110.00', quotedFee: '110.00', confirmedFee: null });
  expect(Number(waived.snapshotFee)).toBe(Number(waived.quotedFee));
  expect(waived.quotedFeeCompleteness).not.toBeNull();
  expect(waived.quotedPricingRevisionId).not.toBeNull();
  await page.getByRole('button', { name: '取消顺丰到付', exact: true }).click();
  await expect(page.getByRole('button', { name: '标记顺丰到付', exact: true })).toBeVisible();
  const prepaid = await readOrder(id);
  expect(prepaid.isSfCollect).toBe(false);
  expect(prepaid.priceRevision).toBe(waived.priceRevision + 1);
  expect(Number(prepaid.snapshotFee)).toBe(Number(prepaid.quotedFee));
  expect(prepaid.packing).toBe(before.packing);
  expect(prepaid.processingAmount).toBe(before.processingAmount);
  await healthy(page);
  expect(errors).toEqual([]);
});

test('待下发生产的销售工单抽屉定位工厂处理，不提前显示完成', async ({ page }) => {
  const id = await seed('CONFIRMED');
  const errors = trackErrors(page);
  await salesLogin(page, `/orders#wo=${id}`);
  const drawer = page.getByRole('dialog');
  await expect(drawer).toBeVisible();
  await expect(drawer.getByText('待下发生产', { exact: true })).toBeVisible();
  const progress = drawer.getByRole('list', { name: '工单进度' });
  await expect(progress.locator('[aria-current="step"]')).toHaveText('工厂处理');
  await expect(progress.getByText('完成', { exact: true })).not.toHaveAttribute('aria-current', 'step');
  expect((await readOrder(id)).status).toBe('CONFIRMED');
  await drawer.getByRole('link', { name: '查看完整详情', exact: true }).click();
  await expect(page).toHaveURL(`/orders/${id}`);
  await expect(page.locator('#change-request')).toBeVisible();
  await healthy(page);
  expect(errors).toEqual([]);
});

test('销售搜索、分类、抽屉、详情和草稿编辑回显', async ({ page }) => {
  const id = await seed('DRAFT');
  const errors = trackErrors(page);
  await salesLogin(page, '/orders');
  await page.getByRole('searchbox').fill(id);
  await page.getByRole('button', { name: '搜索', exact: true }).click();
  const card = page.locator(`[data-order-id="${id}"]`);
  await expect(card).toBeVisible();
  await page.getByRole('navigation', { name: '销售工单视图' }).getByRole('link', { name: /^草稿/ }).click();
  await expect(card).toBeVisible();
  await card.getByRole('button', { name: id, exact: true }).click();
  await expect(page.getByRole('dialog')).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await expect(page).not.toHaveURL(/#wo=/);
  await card.getByRole('link', { name: '查看草稿', exact: true }).click();
  await expect(page).toHaveURL(`/orders/${id}`);
  await page.getByRole('link', { name: '编辑工单', exact: true }).click();
  const note = '销售回归备注\n请核对包装';
  await page.getByRole('textbox', { name: /工单备注/ }).fill(note);
  await page.getByRole('button', { name: '保存', exact: true }).click();
  await expect.poll(async () => (await readOrder(id)).remark?.replace(/\r\n/g, '\n')).toBe(note);
  await page.goto(`/orders/${id}/edit`);
  await expect(page.getByRole('textbox', { name: /工单备注/ })).toHaveValue(note);
  await healthy(page);
  expect(errors).toEqual([]);
});

test('管理员保存后，已打开的销售详情可刷新看到名称、备注、包装及收件人', async ({ page, browser }) => {
  test.setTimeout(60_000);
  const id = await seed('DRAFT');
  await salesLogin(page, `/orders/${id}`);
  const errors = trackErrors(page);
  const adminContext = await browser.newContext({ baseURL: new URL(page.url()).origin });
  try {
    const adminPage = await adminContext.newPage();
    await login(adminPage, { username: E2E_USERS.owner.username, password: E2E_PASSWORD, from: `/orders/${id}/edit` });
    await adminPage.getByRole('textbox', { name: '工单名称', exact: true }).fill('管理员更新可见工单');
    await adminPage.getByRole('textbox', { name: /工单备注/ }).fill('管理员修改备注\n请核对后发货');
    await adminPage.getByLabel('包装补充说明（选填）').fill('贴客户标签后封口');
    await adminPage.getByRole('textbox', { name: '收件人', exact: true }).fill('更新收件人');
    await adminPage.getByRole('button', { name: '保存修改…', exact: true }).click();
    const confirm = adminPage.getByRole('button', { name: '保存修改', exact: true });
    await expect(confirm).toBeVisible();
    await confirm.click();
    await expect(adminPage).toHaveURL(`/orders/${id}`);
    await page.getByRole('button', { name: '刷新工单详情', exact: true }).click();
    await expect(page.getByRole('heading', { name: '管理员更新可见工单', exact: true })).toBeVisible();
    await expect(page.getByRole('region', { name: '工单备注', exact: true })).toContainText('管理员修改备注');
    await expect(page.getByRole('region', { name: '包装明细', exact: true })).toContainText('贴客户标签后封口');
    await expect(page.getByText('更新收件人', { exact: false })).toHaveCount(1);
    await expect(page.getByText('设计图可在草稿状态上传或删除')).toHaveCount(0);
    await healthy(page);
    expect(errors).toEqual([]);
  } finally { await adminContext.close(); }
});

test('销售交期修改与取消申请可提交撤回，原工单不提前变更', async ({ page }) => {
  const id = await seed('CONFIRMED');
  const errors = trackErrors(page);
  await salesLogin(page, `/orders/${id}#change-request`);
  const section = page.locator('#change-request');
  await section.getByLabel('修改类别').selectOption('DUE_DATE');
  await section.getByRole('textbox', { name: /^新的承诺交期/ }).fill('2026-12-20');
  await section.getByLabel('修改原因').fill('测试客户调整交期');
  await section.getByRole('button', { name: /^提交修改申请/ }).click();
  await expect(page.getByRole('button', { name: '撤回申请', exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: '标记顺丰到付', exact: true })).toHaveCount(0);
  expect((await readOrder(id)).promisedDate).toBeNull();
  await page.getByRole('button', { name: '撤回申请', exact: true }).click();
  await expect(section).toBeVisible();
  await section.getByLabel('取消原因').fill('测试取消申请可撤回');
  await section.getByRole('button', { name: '提交取消申请', exact: true }).click();
  await expect(page.getByRole('button', { name: '撤回申请', exact: true })).toBeVisible();
  expect((await readOrder(id)).status).toBe('CONFIRMED');
  await page.goto(`/orders?q=${id}`);
  const card = page.locator(`[data-order-id="${id}"]`);
  await expect(card.getByText('取消申请中', { exact: true })).toBeVisible();
  await expect(card.getByText('修改申请中', { exact: true })).toHaveCount(0);
  await card.getByRole('link', { name: '查看详情', exact: true }).click();
  await expect(page).toHaveURL(`/orders/${id}`);
  await expect(page.locator('#change-request').getByRole('heading', { name: '最近申请' })).toBeVisible();
  await page.getByRole('button', { name: '撤回申请', exact: true }).click();
  await expect.poll(async () => (await readOrder(id)).requests).toEqual([
    { type: 'MODIFY', status: 'WITHDRAWN' }, { type: 'CANCEL', status: 'WITHDRAWN' },
  ]);
  await healthy(page);
  expect(errors).toEqual([]);
});

test('销售全部状态均能打开详情，分类结果和汇总计数一致', async ({ page }) => {
  test.setTimeout(90_000);
  const batch = `e2e-sales-status-${randomUUID()}`;
  const groups = {
    doing: ['PENDING_FACTORY', 'REJECTED', 'CONFIRMED', 'ON_HOLD', 'RELEASED', 'FOILING', 'PACKING', 'SUBMITTED', 'SCHEDULING', 'IN_PRODUCTION', 'COMPLETED'],
    shipped: ['SHIPPED'], done: ['SETTLED', 'FINISHED'], cancelled: ['CANCELLED'], draft: ['DRAFT'],
  };
  const ids = new Map<string, string>();
  for (const status of Object.values(groups).flat()) ids.set(status, await seed(status, E2E_USERS.sales.username, batch));
  const errors = trackErrors(page);
  await salesLogin(page, `/orders?q=${batch}`);
  const cards = page.locator('[data-sales-order-card]');
  await expect(cards).toHaveCount(16);
  const db = new Client({ connectionString: process.env.DATABASE_URL });
  await db.connect();
  const counts = new Map<string, number>();
  try {
    const salesId = await getUserIdByUsername(E2E_USERS.sales.username);
    const { rows } = await db.query('SELECT status, COUNT(*)::int AS count FROM "Order" WHERE "submitterId"=$1 GROUP BY status', [salesId]);
    for (const row of rows) counts.set(row.status, row.count);
  } finally { await db.end(); }
  const labels = { doing: '进行中', shipped: '已发货', done: '已完成', cancelled: '已取消', draft: '草稿' };
  for (const [view, statuses] of Object.entries(groups)) {
    const tab = page.getByRole('navigation', { name: '销售工单视图' }).getByRole('link', { name: new RegExp(`^${labels[view as keyof typeof labels]}`) });
    await expect(tab).toHaveText(`${labels[view as keyof typeof labels]}${statuses.reduce((sum, status) => sum + (counts.get(status) ?? 0), 0)}`);
    await tab.click();
    await expect(page).toHaveURL(new RegExp(`view=${view}(?:&|$)`));
    await expect(cards).toHaveCount(statuses.length);
    await expect.poll(async () => (await cards.evaluateAll((elements) => elements.map((element) => element.getAttribute('data-order-id')))).sort()).toEqual(statuses.map((status) => ids.get(status)).sort());
    for (const status of statuses) {
      const id = ids.get(status)!;
      const card = page.locator(`[data-order-id="${id}"]`);
      await expect(card.getByRole('link', { name: /查看详情|查看草稿|查看原因/ })).toHaveAttribute('href', `/orders/${id}`);
      await card.getByRole('button', { name: id, exact: true }).click();
      const drawer = page.getByRole('dialog');
      await expect(drawer.getByRole('link', { name: '查看完整详情' })).toHaveAttribute('href', `/orders/${id}`);
      await drawer.getByRole('button', { name: '关闭预览', exact: true }).click();
      await expect(drawer).toHaveCount(0);
      await expect(page).not.toHaveURL(/#wo=/);
      await card.getByRole('link', { name: /查看详情|查看草稿|查看原因/ }).click();
      await expect(page).toHaveURL(`/orders/${id}`);
      await expect(page.locator('[data-slot="sales-order-detail"]')).toBeVisible();
      await healthy(page);
      await page.goBack();
      await expect(page).toHaveURL(new RegExp(`view=${view}(?:&|$)`));
      await expect(card).toBeVisible();
      await expect(page.getByRole('dialog')).toHaveCount(0);
    }
  }
  await page.goto(`/orders/${ids.get('CANCELLED')}`);
  await expect(page.locator('[data-slot="sales-order-detail"]')).toBeVisible();
  await expect(page.getByText('已取消', { exact: true })).toBeVisible();
  await expect(page.getByRole('link', { name: '编辑工单', exact: true })).toHaveCount(0);
  await expect(page.getByRole('button', { name: '提交修改申请', exact: true })).toHaveCount(0);
  await healthy(page);
  expect(errors).toEqual([]);
});

test('销售异常筛选、账单入口及他人工单详情和编辑拒绝访问', async ({ page }) => {
  const foreignId = await seed('DRAFT', E2E_USERS.billingSales.username);
  await salesLogin(page, '/orders');
  for (const url of ['/orders?view=unknown&page=-1&pageSize=bad', '/sales/bills?period=2026-99&status=BAD']) {
    await page.goto(url);
    await healthy(page);
    await expect(page.locator('h1')).toBeVisible();
  }
  for (const url of [`/orders/${foreignId}`, `/orders/${foreignId}/edit`]) {
    await page.goto(url);
    await expect(page.locator('[data-slot="sales-order-detail"]')).toHaveCount(0);
    await expect(page.getByRole('textbox', { name: /工单备注/ })).toHaveCount(0);
    await healthy(page);
  }
  await page.goto('/');
  await expect(page).toHaveURL('/orders');
});

test('销售列表、详情和编辑页在六视口及明暗主题下可用', async ({ page }) => {
  test.setTimeout(120_000);
  const id = await seed('DRAFT');
  const errors = trackErrors(page);
  await salesLogin(page, `/orders/${id}`);
  for (const dark of [false, true]) for (const [width, height] of [
    [375, 667], [393, 852], [768, 1024], [1024, 768], [1280, 800], [1920, 1080],
  ]) {
    await page.setViewportSize({ width, height });
    await page.emulateMedia({ colorScheme: dark ? 'dark' : 'light', reducedMotion: 'reduce' });
    for (const path of [`/orders?q=${id}`, `/orders/${id}`, `/orders/${id}/edit`]) {
      await page.goto(path);
      await page.evaluate(async (enabled) => {
        const theme = enabled ? 'dark' : 'light';
        localStorage.setItem('erp-theme', theme);
        document.documentElement.classList.toggle('dark', enabled);
        document.documentElement.dataset.theme = theme;
        document.documentElement.style.colorScheme = theme;
        // Sample the settled palette, not a frame midway through theme transitions.
        for (let paint = 0; paint < 3; paint += 1) {
          await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
          await Promise.all(document.getAnimations().map((animation) => animation.finished.catch(() => undefined)));
        }
      }, dark);
      await healthy(page);
      await expect(page.locator('h1:visible')).toBeVisible();
      expect(await page.evaluate(() => document.documentElement.scrollWidth), `${path}: initial ${width} dark=${dark}`).toBeLessThanOrEqual(width);
      if (path.startsWith('/orders?')) {
        await expect(page.locator(`[data-order-id="${id}"]:visible`)).toBeVisible();
      } else if (path.endsWith('/edit')) {
        await expect(page.getByRole('textbox', { name: /工单备注/ })).toBeVisible();
      } else {
        await expect(page.locator('[data-slot="sales-order-detail"]:visible')).toBeVisible();
      }
      expect(await page.evaluate(() => document.documentElement.scrollWidth), `${path}: loaded ${width} dark=${dark}`).toBeLessThanOrEqual(width);
      const result = await new AxeBuilder({ page }).include('#admin-main').analyze();
      expect(result.violations.map(({ id: rule, nodes }) => ({ rule, nodes: nodes.map(({ target, failureSummary }) => ({ target, failureSummary })) })), `${path}: ${width} dark=${dark}`).toEqual([]);
      if (width <= 393 && path.startsWith('/orders?')) {
        await page.locator(`[data-order-id="${id}"]`).getByRole('button', { name: id, exact: true }).tap();
        await expect(page.getByRole('dialog'), `touch: ${width} dark=${dark}, url=${page.url()}`).toBeVisible();
        await page.getByRole('button', { name: '关闭', exact: true }).tap();
        await expect(page.getByRole('dialog')).toHaveCount(0);
        await expect(page).toHaveURL(new RegExp(`/orders\\?q=${id}$`));
      }
    }
  }
  expect(errors).toEqual([]);
});
