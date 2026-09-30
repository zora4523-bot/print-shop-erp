import { randomUUID } from 'node:crypto';
import { expect, test, type Page } from '@playwright/test';
import { Client } from 'pg';
import AxeBuilder from '@axe-core/playwright';
import { selectBillTheme, waitForBillPaint } from './_bill-ui';
import { E2E_PASSWORD, E2E_USERS, getUserIdByUsername, login, seedSettledExternalSalesOrder } from './_helpers';

test.use({ hasTouch: true });

const testArtwork = `data:image/svg+xml,${encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" width="300" height="400"><rect width="300" height="400" fill="#fff"/><rect x="20" y="20" width="260" height="360" fill="#a20a1c"/><text x="150" y="210" fill="#fff" text-anchor="middle" font-size="30">TEST</text></svg>')}`;

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
    await db.query(`INSERT INTO "Order" (id,"orderNo","submitterId","submitterRole","createdById","settlementType",status,"customName","receiverName","receiverPhone","receiverAddress","processingAmount","totalAmount","confirmedFee","pricingStatus","pricingConfirmedAt","updatedAt","settlementContractVersion","settledFee","settledAt") VALUES ($1,$1,$2,'SALES',$2,'EXTERNAL_SALES',$3::"OrderStatus",$4,'测试收件人','13800138000','广东省佛山市测试路1号',100,130,130,'LEGACY_CONFIRMED',NOW(),NOW(),CASE WHEN $3::text='SETTLED' THEN 2 END,CASE WHEN $3::text='SETTLED' THEN 130 END,CASE WHEN $3::text='SETTLED' THEN NOW() END)`, [id, salesId, status, `销售回归工单 · ${status}`]);
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
  await card.getByRole('button', { name: /销售回归工单/, exact: false }).click();
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
  await expect(page).toHaveURL(`/orders/${id}`);
  await expect(page.locator('[data-slot="sales-order-detail"]')).toBeVisible();
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
    await adminPage.getByLabel('包装补充说明', { exact: true }).fill('贴客户标签后封口');
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
    shipped: ['SHIPPED', 'SETTLED', 'FINISHED'], done: ['SETTLED', 'FINISHED'], cancelled: ['CANCELLED'], draft: ['DRAFT'],
  };
  const ids = new Map<string, string>();
  for (const status of new Set(Object.values(groups).flat())) ids.set(status, await seed(status, E2E_USERS.sales.username, batch));
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
  const labels = { doing: '进行中', shipped: '已发货', done: '已结算', cancelled: '已取消', draft: '草稿' };
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
      await card.getByRole('button', { name: /销售回归工单/, exact: false }).click();
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
      await selectBillTheme(page, dark ? 'dark' : 'light');
      await healthy(page);
      await expect(page.locator('h1:visible')).toBeVisible();
      expect(await page.evaluate(() => document.documentElement.scrollWidth), `${path}: initial ${width} dark=${dark}`).toBeLessThanOrEqual(width);
      if (path.startsWith('/orders?')) {
        await expect(page.locator(`[data-order-id="${id}"]:visible`)).toBeVisible();
        const views = page.getByRole('navigation', { name: '销售工单视图' });
        for (const tab of await views.getByRole('link').all()) {
          const box = await tab.boundingBox();
          expect(box).not.toBeNull();
          expect(box!.x).toBeGreaterThanOrEqual(0);
          expect(box!.x + box!.width).toBeLessThanOrEqual(width);
        }
      } else if (path.endsWith('/edit')) {
        await expect(page.getByRole('textbox', { name: /工单备注/ })).toBeVisible();
      } else {
        await expect(page.locator('[data-slot="sales-order-detail"]:visible')).toBeVisible();
      }
      expect(await page.evaluate(() => document.documentElement.scrollWidth), `${path}: loaded ${width} dark=${dark}`).toBeLessThanOrEqual(width);
      await waitForBillPaint(page);
      const result = await new AxeBuilder({ page }).include('#admin-main').analyze();
      expect(result.violations.map(({ id: rule, nodes }) => ({ rule, nodes: nodes.map(({ target, failureSummary }) => ({ target, failureSummary })) })), `${path}: ${width} dark=${dark}`).toEqual([]);
      if (width <= 393 && path.startsWith('/orders?')) {
        await page.locator(`[data-order-id="${id}"]`).getByRole('button', { name: /销售回归工单/, exact: false }).tap();
        await expect(page.getByRole('dialog'), `touch: ${width} dark=${dark}, url=${page.url()}`).toBeVisible();
        await page.getByRole('button', { name: '关闭', exact: true }).tap();
        await expect(page.getByRole('dialog')).toHaveCount(0);
        await expect(page).toHaveURL(new RegExp(`/orders\\?q=${id}$`));
      }
    }
  }
  expect(errors).toEqual([]);
});

async function fixtureSql<T>(run: (db: Client) => Promise<T>): Promise<T> {
  const db = new Client({ connectionString: process.env.DATABASE_URL });
  await db.connect();
  try { await db.query('BEGIN'); const result = await run(db); await db.query('COMMIT'); return result; }
  catch (error) { await db.query('ROLLBACK'); throw error; }
  finally { await db.end(); }
}

test('销售客户响应按身份隔离，详情与编辑均不暴露内部改价说明', async ({ page }) => {
  const id = await seed('DRAFT');
  const foreignId = await seed('DRAFT', E2E_USERS.billingSales.username);
  const own = `e2e-own-customer-${randomUUID()}`;
  const other = `e2e-other-customer-${randomUUID()}`;
  const privatePhone = '13900009991';
  await fixtureSql(async (db) => {
    for (const partyId of [own, other]) {
      await db.query(`INSERT INTO "Party" (id,type,code,name,"updatedAt") VALUES ($1::text,'CUSTOMER',$1::text,$1::text,NOW())`, [partyId]);
      await db.query(`INSERT INTO "PartyContact" (id,"partyId",name,phone,"isPrimary","updatedAt") VALUES ($1,$2,'隐私联系人',$3,true,NOW())`, [`${partyId}-contact`, partyId, privatePhone]);
    }
    await db.query(`UPDATE "Order" SET "customerPartyId"=$2 WHERE id=$1`, [id, own]);
    await db.query(`UPDATE "Order" SET "customerPartyId"=$2 WHERE id=$1`, [foreignId, other]);
    // Exercise the previously untested non-null Decimal shipment boundary.
    await db.query(`UPDATE "OrderShipment" SET "quotedWeightKg"=1.234 WHERE "orderId"=$1`, [id]);
  });
  await salesLogin(page, '/orders/new');
  const created = await page.goto('/orders/new');
  const response = await created!.text();
  // 业主 2026-09-24：建单页只剩外部销售表单，从未展示客户下拉，
  // 因此不再下发任何客户列表（含自己的客户）。
  expect(response).not.toContain(own);
  expect(response).not.toContain(other);
  expect(response).not.toContain(privatePhone);
  const errors = trackErrors(page);
  for (const suffix of ['', '/edit']) {
    const result = await page.goto(`/orders/${id}${suffix}`);
    const body = await result!.text();
    expect(body).not.toContain('测试历史约定收费');
    expect(body).not.toContain(other);
    expect(body).not.toContain(privatePhone);
    await healthy(page);
  }
  await expect(page.getByLabel('客户名称/简称（选填）')).toHaveCount(0);
  await expect(page.getByLabel('关联客户', { exact: true })).toHaveCount(0);
  const savedCustomer = await fixtureSql(async (db) => (await db.query('SELECT "customerRef", "customerPartyId" FROM "Order" WHERE id=$1', [id])).rows[0]);
  await page.getByRole('textbox', { name: /工单备注/ }).fill('移除客户入口后保存备注');
  await page.getByRole('button', { name: '保存', exact: true }).click();
  await expect(page).toHaveURL(`/orders/${id}`);
  const afterCustomer = await fixtureSql(async (db) => (await db.query('SELECT "customerRef", "customerPartyId" FROM "Order" WHERE id=$1', [id])).rows[0]);
  expect(afterCustomer).toEqual(savedCustomer);
  expect(errors).toEqual([]);
});

test('销售可取消草稿、待工厂处理和驳回单，理由持久化', async ({ page }) => {
  await salesLogin(page, '/orders');
  for (const status of ['DRAFT', 'PENDING_FACTORY', 'REJECTED']) {
    const id = await seed(status);
    await page.goto(`/orders/${id}`);
    await page.getByRole('button', { name: '取消工单', exact: true }).click();
    const dialog = page.getByRole('alertdialog');
    await dialog.getByLabel('取消原因', { exact: false }).fill('销售测试取消');
    await dialog.getByRole('button', { name: '取消工单', exact: true }).click();
    await expect.poll(async () => (await readOrder(id)).status).toBe('CANCELLED');
    await healthy(page);
  }
});

test('驳回展示补正原因和图稿入口，暂停可申请取消，包装组限制新增款式', async ({ page }) => {
  const rejected = await seed('REJECTED');
  const held = await seed('ON_HOLD');
  const admin = await getUserIdByUsername(E2E_USERS.owner.username);
  await fixtureSql(async (db) => {
    for (const [id, action, fromStatus, toStatus] of [[rejected, 'REJECT', 'PENDING_FACTORY', 'REJECTED'], [held, 'HOLD', 'CONFIRMED', 'ON_HOLD']]) {
      await db.query(`INSERT INTO "OrderWorkflowDecision" (id,"orderId","fromStatus","toStatus",action,"reasonCode","reasonNote","affectedFigs","actorId","idempotencyKey") VALUES ($1::text,$2,$3::"OrderStatus",$4::"OrderStatus",$5::"OrderWorkflowAction",'DESIGN_ERROR','请修正第1款文字','[1]'::jsonb,$6,$1::text)`, [`${id}-decision`, id, fromStatus, toStatus, action, admin]);
    }
    await db.query(`INSERT INTO "OrderPackagingGroup" (id,"orderId",sequence,mode,"actualBagCount","updatedAt") VALUES ($1,$2,1,'SINGLE_STYLE',100,NOW())`, [`${held}-group`, held]);
    await db.query(`INSERT INTO "OrderPackagingGroupLine" (id,"orderId","packagingGroupId","orderItemId","unitsPerBag") VALUES ($1,$4,$2,$3,10)`, [`${held}-packline`, `${held}-group`, `${held}-item`, held]);
  });
  await salesLogin(page, `/orders/${rejected}`);
  await expect(page.getByText('请修正第1款文字', { exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: '提交工单', exact: true })).toBeVisible();
  await expect(page.locator('input[type=file]').first()).toBeAttached();
  await page.goto(`/orders/${held}#change-request`);
  await expect(page.getByText('请修正第1款文字', { exact: true })).toBeVisible();
  await expect(page.getByLabel('本次申请需要添加一款')).toHaveCount(0);
  await page.locator('#change-request').getByLabel('取消原因').fill('客户申请暂停后取消');
  await page.getByRole('button', { name: '提交取消申请', exact: true }).click();
  await expect(page.getByRole('button', { name: '撤回申请', exact: true })).toBeVisible();
  expect((await readOrder(held)).status).toBe('ON_HOLD');
  await page.getByRole('button', { name: '撤回申请', exact: true }).click();
  await healthy(page);
});

test('管理员确认月账单后销售查看同一金额和冻结明细，其他销售不可访问', async ({ page }) => {
  const fixture = await seedSettledExternalSalesOrder({ customerRef: '销售账单隔离验收', settledFee: '123.45', settledAt: new Date('2026-08-15T00:00:00Z') });
  const billId = `e2e-sales-bill-${randomUUID()}`;
  await fixtureSql(async (db) => {
    await db.query(`INSERT INTO "AgentMonthlyBill" (id,"agentUserId",period,"agentUsernameSnapshot","agentDisplayNameSnapshot","updatedAt") VALUES ($1,$2,$3,$4,$5,NOW())`, [billId, fixture.agentUserId, fixture.period, fixture.agentUsername, fixture.agentDisplayName]);
  });
  // Confirmation invokes the administrator's real scoped synchronization and freezing command.
  await login(page, { from: `/owner/agent-bills/${billId}`, username: E2E_USERS.owner.username, password: E2E_PASSWORD });
  await page.getByRole('button', { name: /确认.*账单/ }).click();
  await expect(page.getByRole('button', { name: '标记已收' })).toBeVisible();
  await page.context().clearCookies();
  await login(page, { from: '/sales/bills', username: fixture.agentUsername, password: E2E_PASSWORD });
  await page.getByRole('link', { name: `查看 ${fixture.period} 账单详情`, exact: true }).click();
  await expect(page).toHaveURL((url) => url.pathname === `/sales/bills/${billId}` && url.searchParams.get('returnTo') === '/sales/bills?page=1', { timeout: 20_000 });
  await expect(page.getByText(fixture.orderNo, { exact: true })).toBeVisible();
  await expect(page.getByText(/¥\s*123\.45/).first()).toBeVisible();
  await healthy(page);
  await page.context().clearCookies();
  await salesLogin(page, `/sales/bills/${billId}`);
  await expect(page.getByText(fixture.orderNo, { exact: true })).toHaveCount(0);
});

test('驳回补正重新计价确认后提交，缺图阻止提交，旧图删除有审计', async ({ page }) => {
  const id = await seed('REJECTED');
  const salesId = await getUserIdByUsername(E2E_USERS.sales.username);
  await fixtureSql(async (db) => {
    const product = (await db.query(`SELECT p.id,p.specification,p."paperType" FROM "Product" p WHERE p."isActive" AND p.category='BLANK_STOCK' AND p.specification LIKE '%90%' AND p."paperType" LIKE '%160%' ORDER BY p.code LIMIT 1`)).rows[0];
    expect(product).toBeTruthy();
    const craft = (await db.query(`SELECT id FROM "Craft" WHERE code='FLAT_FOIL_PARTIAL' AND "isActive" LIMIT 1`)).rows[0];
    expect(craft).toBeTruthy();
    await db.query(`UPDATE "OrderItem" SET fig=1,"productId"=$2,specification=$3,"paperType"=$4,"pricingGroup"='LARGE',"actualWidthMm"=90,"actualHeightMm"=165,crafts=ARRAY[$5]::text[],"foilColors"=ARRAY['哑金'],"frontFoilColors"=ARRAY['哑金'],"hasLocalFoil"=true WHERE "orderId"=$1`, [id, product.id, product.specification, product.paperType, craft.id]);
    await db.query(`INSERT INTO "OrderPackagingGroup" (id,"orderId",sequence,mode,"actualBagCount","updatedAt") VALUES ($1,$2,1,'SINGLE_STYLE',100,NOW())`, [`${id}-group`, id]);
    await db.query(`INSERT INTO "OrderPackagingGroupLine" (id,"orderId","packagingGroupId","orderItemId","unitsPerBag") VALUES ($1,$2,$3,$4,10)`, [`${id}-packline`, id, `${id}-group`, `${id}-item`]);
    await db.query(`INSERT INTO "OrderItemDesign" (id,"orderItemId","fileName","fileUrl","fileType","fileSize","uploadedBy") VALUES ($1,$2,'旧图稿.png',$4,'IMAGE',100,$3)`, [`${id}-old-art`, `${id}-item`, salesId, testArtwork]);
  });
  await salesLogin(page, `/orders/${id}`);
  await page.getByRole('button', { name: '删除', exact: true }).click();
  await page.getByRole('button', { name: '提交工单', exact: true }).click();
  await expect(page.getByRole('alert').filter({ hasText: '缺少设计图片' })).toBeVisible();
  expect((await readOrder(id)).status).toBe('REJECTED');
  // OSS transport is separately tested with HEAD/ownership/TOCTOU boundaries;
  // this fixture supplies the newly registered image for the real submit flow.
  await fixtureSql(async (db) => {
    const log = await db.query(`SELECT "changedFields" FROM "OrderLog" WHERE "orderId"=$1 AND "changedFields"->'design'->'before'->>'id'=$2`, [id, `${id}-old-art`]);
    expect(log.rows).toHaveLength(1);
    await db.query(`INSERT INTO "OrderItemDesign" (id,"orderItemId","fileName","fileUrl","fileType","fileSize","uploadedBy") VALUES ($1,$2,'补正图稿.png',$4,'IMAGE',100,$3)`, [`${id}-new-art`, `${id}-item`, salesId, testArtwork]);
  });
  await page.reload();
  await page.getByRole('button', { name: '提交工单', exact: true }).click();
  await expect(page.getByRole('button', { name: '确认最新报价并提交', exact: true })).toBeVisible();
  await page.getByRole('button', { name: '确认最新报价并提交', exact: true }).click();
  await expect.poll(async () => (await readOrder(id)).status).toBe('PENDING_FACTORY');
  const after = await readOrder(id);
  expect(Number(after.snapshotFee)).toBe(Number(after.quotedFee));
  await healthy(page);
});

test('销售编辑新增地址先分货复核费用，保存后地址与总价同步', async ({ page }) => {
  const id = await seed('CONFIRMED');
  const errors = trackErrors(page);
  await salesLogin(page, `/orders/${id}/edit`);
  await expect(page.getByRole('heading', { name: '已保存的基本信息', exact: true })).toBeVisible();
  const add = page.getByRole('region', { name: '添加收货地址', exact: true });
  await page.getByRole('textbox', { name: '工单备注', exact: true }).fill('先保存备注');
  await add.getByRole('button', { name: '添加地址 2' }).click();
  await expect(page.getByRole('alertdialog')).toContainText('请先保存当前修改');
  await page.getByRole('button', { name: '继续编辑', exact: true }).click();
  await page.getByRole('button', { name: '保存', exact: true }).click();
  await expect(page).toHaveURL(`/orders/${id}`);
  await page.goto(`/orders/${id}/edit`);
  await add.getByRole('button', { name: '添加地址 2' }).click();

  await add.getByLabel('收件人', { exact: true }).fill('地址二收件人');
  await add.getByLabel('收货电话', { exact: true }).fill('13800138001');
  await add.getByRole('textbox', { name: '收货地址', exact: true }).fill('江西省南昌市测试路2号');
  await add.getByLabel('计费省份', { exact: true }).fill('江西');
  await add.getByLabel(/分配数量/).fill('400');
  await expect(add.getByLabel(/人工/)).toHaveCount(0);
  await add.getByRole('button', { name: '预览费用' }).click();
  await expect(add.getByRole('button', { name: '保存地址' })).toBeVisible();
  await add.getByRole('button', { name: '保存地址' }).click();
  await expect(page.getByRole('heading', { name: '配送信息 · 2 票' })).toBeVisible();
  const rows = await fixtureSql(async (db) => (await db.query('SELECT s.sequence, sum(l.quantity)::int AS quantity FROM "OrderShipment" s JOIN "OrderShipmentLine" l ON l."shipmentId"=s.id WHERE s."orderId"=$1 GROUP BY s.sequence ORDER BY s.sequence', [id])).rows);
  expect(rows).toEqual([{ sequence: 1, quantity: 600 }, { sequence: 2, quantity: 400 }]);
  const saved = await readOrder(id);
  expect(Number(saved.totalAmount)).toBe(Number(saved.quotedFee));
  expect(Number(saved.quotedFee)).toBe(Number(saved.snapshotFee));
  await page.goto(`/orders/${id}`);
  await expect(page.getByText('地址二收件人', { exact: false })).toBeVisible();
  await healthy(page);
  expect(errors).toEqual([]);
});

test('销售文字字段直接保存且统一保护拦截开关刷新路由和弹窗', async ({ page }) => {
  const id = await seed('DRAFT');
  await fixtureSql(async (db) => {
    await db.query(`INSERT INTO "OrderPackagingGroup" (id,"orderId",sequence,name,mode,"actualBagCount","updatedAt") VALUES ($1,$2,1,'原包装组','SINGLE_STYLE',100,NOW())`, [`${id}-group`,id]);
    await db.query(`INSERT INTO "OrderPackagingGroupLine" (id,"orderId","packagingGroupId","orderItemId","unitsPerBag") VALUES ($1,$2,$3,$4,10)`, [`${id}-group-line`,id,`${id}-group`,`${id}-item`]);
  });
  await salesLogin(page, `/orders/${id}/edit`);
  const before = await readOrder(id);
  await page.getByRole('form', { name: '款式名称', exact: true }).getByRole('textbox').fill('直接编辑新款式名称');
  for (const name of ['标记为急单', '标记顺丰到付', '刷新工单详情']) {
    await page.getByRole('button', { name, exact: true }).click();
    await expect(page.getByRole('alertdialog')).toContainText('请先保存当前修改');
    await page.getByRole('button', { name: '继续编辑', exact: true }).click();
  }
  await page.getByRole('link', { name: '返回工单', exact: true }).click();
  await expect(page.getByRole('alertdialog')).toContainText('未保存的修改将丢失');
  await page.getByRole('button', { name: '继续编辑', exact: true }).click();
  await expect(page.getByRole('form', { name: '款式名称', exact: true }).getByRole('textbox')).toHaveValue('直接编辑新款式名称');
  const cancelReload = page.waitForEvent('dialog').then(async (dialog) => { expect(dialog.type()).toBe('beforeunload'); await dialog.dismiss(); });
  await page.reload({ timeout: 2000 }).catch(() => undefined);
  await cancelReload;
  await page.getByRole('button', { name: '保存款式名称', exact: true }).click();
  await expect(page.getByRole('heading', { name: /直接编辑新款式名称/ })).toBeVisible();
  await page.getByRole('form', { name: '款式备注', exact: true }).getByRole('textbox').fill('新增款式说明');
  await page.getByRole('button', { name: '保存款式备注', exact: true }).click();
  await expect(page.getByText('新增款式说明', { exact: true })).toBeVisible();
  await expect(page.getByRole('form', { name: '包装组名称', exact: true }).locator('input[name=expectedEditVersion]')).toHaveValue('2');
  await page.getByRole('form', { name: '包装组名称', exact: true }).getByRole('textbox').fill('包装组新名称');
  await page.getByRole('button', { name: '保存包装组名称', exact: true }).click();
  await expect(page.getByRole('heading', { name: /包装组新名称/ })).toBeVisible();
  await page.getByRole('button', { name: '取消工单', exact: true }).click();
  await page.getByRole('textbox', { name: /取消原因/ }).fill('未保存的取消原因');
  await page.keyboard.press('Escape');
  await expect(page.locator('.sales-edit-notice')).toContainText('请先保存当前修改');
  await page.getByRole('button', { name: '继续编辑', exact: true }).click();
  await expect(page.getByRole('textbox', { name: /取消原因/ })).toHaveValue('未保存的取消原因');
  const after = await readOrder(id);
  expect(after.totalAmount).toBe(before.totalAmount);
  expect(after.priceRevision).toBe(before.priceRevision);
  expect(after.status).toBe(before.status);
  expect(after.requests).toBeNull();
  await healthy(page);
});
