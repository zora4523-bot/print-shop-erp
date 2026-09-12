import { randomUUID } from 'node:crypto';
import { expect, test, type Page } from '@playwright/test';
import { Client } from 'pg';
import AxeBuilder from '@axe-core/playwright';
import { E2E_PASSWORD, E2E_USERS, getUserIdByUsername, login } from './_helpers';

test.use({ hasTouch: true });

// Each case owns a fresh, append-only historical fixture. Never mutate a real
// salesperson's order or weaken the database's immediate quote constraints.
async function seed(status = 'SUBMITTED', username = E2E_USERS.sales.username) {
  const id = `e2e-sales-review-${randomUUID()}`;
  const salesId = await getUserIdByUsername(username);
  const db = new Client({ connectionString: process.env.DATABASE_URL });
  await db.connect();
  try {
    await db.query('BEGIN');
    const { rows: books } = await db.query(`SELECT id FROM "CustomerPriceBook" WHERE purpose='LOGISTICS' AND "settlementType"='EXTERNAL_SALES' AND "isActive" ORDER BY "effectiveFrom" DESC LIMIT 1`);
    expect(books).not.toHaveLength(0);
    await db.query(`INSERT INTO "Order" (id,"orderNo","submitterId","submitterRole","createdById","settlementType",status,"customName","receiverName","receiverPhone","receiverAddress","processingAmount","totalAmount","confirmedFee","pricingStatus","pricingConfirmedAt","updatedAt") VALUES ($1,$1,$2,'SALES',$2,'EXTERNAL_SALES',$3::"OrderStatus",$1,'测试收件人','13800138000','广东省佛山市测试路1号',100,130,130,'LEGACY_CONFIRMED',NOW(),NOW())`, [id, salesId, status]);
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
  await page.goto(`/orders/${id}`);
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
  await page.getByRole('button', { name: '撤回申请', exact: true }).click();
  await expect.poll(async () => (await readOrder(id)).requests).toEqual([
    { type: 'MODIFY', status: 'WITHDRAWN' }, { type: 'CANCEL', status: 'WITHDRAWN' },
  ]);
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
      expect(await page.evaluate(() => document.documentElement.scrollWidth), `${path}: ${width} dark=${dark}`).toBeLessThanOrEqual(width);
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
