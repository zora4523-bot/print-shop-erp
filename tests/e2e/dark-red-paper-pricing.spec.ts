import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { expect, test, type Page } from '@playwright/test';
import sharp from 'sharp';
import { calculateCreateOrderQuote, type CreateOrderPriceSnapshot } from '../../lib/price/create-order';
import { createGoldenOrderInput, createGoldenOrderItem } from '../../lib/price/__tests__/fixtures/create-order-golden-fixtures';
import { E2E_PASSWORD, E2E_USERS, login, selectExternalSalesForAdminOrder, withDb } from './_helpers';

const exec = promisify(execFile);
const nodeArgs = ['--conditions=react-server', '--import', 'tsx'];
const releaseScript = 'scripts/publish-dark-red-paper.ts';

async function release(...args: string[]) {
  return exec(process.execPath, [...nodeArgs, releaseScript, ...args], { env: process.env });
}

async function adminOperation(operation: string) {
  return exec(process.execPath, [...nodeArgs, '-e', `
    const {db}=require('./lib/db.ts');
    const admin=require('./lib/price/customer-price-book-admin.ts');
    (async()=>{const actor=await db.user.findUniqueOrThrow({where:{username:'e2e-owner'}});
      ${operation}
    })().finally(()=>db.$disconnect());
  `], { env: process.env });
}

async function snapshot(): Promise<CreateOrderPriceSnapshot> {
  const result = await exec(process.execPath, [...nodeArgs, '-e', `
    const {db}=require('./lib/db.ts');
    const {readPublishedCreateOrderPriceSnapshot}=require('./lib/order/create-order-published-rule-adapter.ts');
    db.$transaction(tx=>readPublishedCreateOrderPriceSnapshot(tx))
      .then(value=>process.stdout.write(JSON.stringify(value))).finally(()=>db.$disconnect());
  `], { env: process.env });
  return JSON.parse(result.stdout) as CreateOrderPriceSnapshot;
}

test.beforeAll(async () => {
  // 数量档位属于迁移后的价格配置，使用正式发布脚本准备已确认基准。
  await exec(process.execPath, [...nodeArgs, 'scripts/publish-confirmed-custom-tiers.ts',
    '--apply', '--actor=e2e-owner'], { env: process.env });
});

test('暗红专版发布保护、真实规则报价及历史保留', async () => {
  test.setTimeout(180_000);
  const before = await snapshot();
  const oldRules = await withDb(async client => (await client.query(
    'SELECT * FROM "CustomerPriceRule" WHERE "priceBookId"=$1 ORDER BY id',
    [before.priceVersion.processing.id],
  )).rows);
  await release();
  await expect(release('--apply', '--actor=e2e-sales')).rejects.toThrow('启用的管理员');
  const wasInstalled = before.full.paperSurcharges.some(row => row.paperType === '珠光闪红');
  if (!wasInstalled) {
    const oldQuote = calculateCreateOrderQuote(createGoldenOrderInput([
      createGoldenOrderItem({ craft: 'FULL', paperType: '珠光闪红', quantity: 1_000 }),
    ]), before);
    expect(oldQuote.items[0]?.manualReasons).toContainEqual(expect.objectContaining({
      code: 'FULL_PAPER_SURCHARGE_NOT_FOUND',
    }));
    await adminOperation(`
      const versions=await admin.listCustomerPriceBookVersionsAndDrafts();
      if(!versions.some(v=>v.purpose==='PROCESSING'&&v.status==='DRAFT')) {
        await admin.createCustomerPriceBookDraft({purpose:'PROCESSING',changeReason:'暗红专版发布回归'},actor);
      }
    `);
    const changed = await withDb(async client => {
      const row = (await client.query(`
        SELECT rule.id,rule.amount::text FROM "CustomerPriceRule" rule
        JOIN "CustomerPriceBook" book ON book.id=rule."priceBookId"
        WHERE NOT book."isActive" AND book.notes->'workflow'->>'status'='DRAFT'
          AND rule.code='CUSTOM_DOUBLE_COLOR'
      `)).rows[0];
      expect(row).toBeTruthy();
      await client.query('UPDATE "CustomerPriceRule" SET amount=amount+1 WHERE id=$1', [row.id]);
      return row;
    });
    try {
      await expect(release('--apply', '--actor=e2e-owner')).rejects.toThrow('草稿含其他调价');
    } finally {
      await withDb(client => client.query('UPDATE "CustomerPriceRule" SET amount=$1 WHERE id=$2',
        [changed.amount, changed.id]));
    }
    for (let attempt = 0; attempt < 2; attempt += 1) {
      await adminOperation(`
        const versions=await admin.listCustomerPriceBookVersionsAndDrafts();
        const draft=versions.find(v=>v.purpose==='PROCESSING'&&v.status==='DRAFT');
        const row=await db.customerPriceBook.findUniqueOrThrow({where:{id:draft.id}});
        await admin.prepareConfirmedDarkRedPaperDraft({priceBookId:row.id,expectedDraftUpdatedAt:row.updatedAt},actor);
      `);
    }
  }
  const published = await release('--apply', '--actor=e2e-owner');
  expect(published.stdout).toContain(wasInstalled ? 'ALREADY_PUBLISHED' : '"PUBLISHED"');
  const current = await snapshot();
  const repeated = await release('--apply', '--actor=e2e-owner');
  expect(repeated.stdout).toContain('ALREADY_PUBLISHED');
  expect((await snapshot()).priceVersion).toEqual(current.priceVersion);
  const afterRules = await withDb(async client => (await client.query(
    'SELECT * FROM "CustomerPriceRule" WHERE "priceBookId"=$1 ORDER BY id',
    [before.priceVersion.processing.id],
  )).rows);
  expect(afterRules).toEqual(oldRules);
  expect(current.partial).toEqual(before.partial);
  expect(current.full.unitPrices).toEqual(before.full.unitPrices);
  expect(current.full.basePapers).toEqual(before.full.basePapers);
  expect(current.full.paperSurcharges.filter(row => row.paperType !== '珠光闪红'))
    .toEqual(before.full.paperSurcharges.filter(row => row.paperType !== '珠光闪红'));
  const quote = (overrides: Parameters<typeof createGoldenOrderItem>[0] = {}) =>
    calculateCreateOrderQuote(createGoldenOrderInput([createGoldenOrderItem({
      craft: 'FULL', paperType: '珠光闪红', paperWeightGsm: 160,
      specification: '大号封', pricingGroup: 'LARGE', quantity: 1_000,
      frontColors: ['亚金'], backColors: [], ...overrides,
    })]), current).items[0]!;
  for (const [specification, pricingGroup, productStructure, amount] of [
    ['中号封', 'MID', 'STANDARD_ENVELOPE', '340.00'],
    ['方形封', 'MID', 'STANDARD_ENVELOPE', '340.00'],
    ['大号封', 'LARGE', 'STANDARD_ENVELOPE', '355.00'],
    ['西封中号', 'MID', 'WESTERN_ENVELOPE', '400.00'],
    ['西封大号', 'LARGE', 'WESTERN_ENVELOPE', '415.00'],
  ] as const) {
    expect(quote({ specification, pricingGroup, productStructure })).toMatchObject({ status: 'QUOTED', amount });
  }
  for (const [quantity, amount] of [[1, '1.03'], [499, '513.97'], [500, '275.00'],
    [999, '549.45'], [1000, '355.00'], [1999, '709.65'], [2000, '630.00'],
    [50000, '10500.00']] as const) {
    expect(quote({ quantity })).toMatchObject({ status: 'QUOTED', amount });
  }
  expect(quote({ frontColors: ['亚金', '红金'] })).toMatchObject({ status: 'QUOTED', amount: '445.00' });
  expect(quote({ specialEffect: 'RELIEF' })).toMatchObject({ status: 'QUOTED', amount: '495.00' });
  expect(quote({ frontColors: ['亚金', '红金', '银金'] }).status).toBe('MANUAL_PRICING_REQUIRED');
  expect(quote({ paperWeightGsm: 180 }).status).toBe('MANUAL_PRICING_REQUIRED');
  expect(quote({ paperType: '米金珠光纸' }).status).toBe('MANUAL_PRICING_REQUIRED');
});

async function choose(page: Page, group: string, label: string) {
  await page.getByRole('group', { name: group, exact: true })
    .getByRole('button', { name: label, exact: true }).click();
}

for (const actor of ['owner', 'sales'] as const) {
  test(`${actor}：暗红专版实时报价与正式提交一致`, async ({ page }) => {
    test.setTimeout(120_000);
    await release('--apply', '--actor=e2e-owner');
    const errors: string[] = [];
    page.on('pageerror', error => errors.push(error.message));
    await login(page, { from: '/orders/new', username: E2E_USERS[actor].username, password: E2E_PASSWORD });
    if (actor === 'owner') await selectExternalSalesForAdminOrder(page);
    const name = `暗红专版报价 ${actor} ${Date.now()}`;
    await page.getByRole('textbox', { name: '工单名称', exact: true }).fill(name);
    await page.getByRole('textbox', { name: '收货地址', exact: true })
      .fill('测试收货人 13800138000 广东省佛山市南海区测试路1号');
    await page.getByRole('checkbox', { name: /顺丰到付/ }).check();
    await choose(page, '工单类型', '专版烫金');
    await choose(page, '纸张材质', '暗红珠光纸');
    await choose(page, '规格', '大号封');
    await page.getByRole('spinbutton', { name: '数量', exact: true }).fill('1000');
    const rail = page.locator('[data-slot="order-form-rail"]');
    const fee = (label: string) => rail.locator('dt').filter({ hasText: new RegExp(`^${label}$`) })
      .locator('..').locator('dd');
    await expect(fee('专版烫金阶梯价')).toContainText('¥ 325.00');
    await expect(fee('专版纸张加价')).toContainText('¥ 30.00');
    if (actor === 'owner') await page.getByLabel('承诺交期', { exact: true }).fill('2099-01-01');
    const png = await sharp({ create: { width: 64, height: 64, channels: 3, background: 'white' } })
      .png().toBuffer();
    // 使用已保存草稿的设计图夹具，报价及正式提交均执行真实服务。
    await page.route(url => url.hostname.endsWith('.aliyuncs.com'), route =>
      route.request().method() === 'PUT' ? route.abort('failed') : route.continue());
    await page.locator('input[type="file"]').first().setInputFiles({
      name: 'dark-red.png', mimeType: 'image/png', buffer: png,
    });
    await page.getByRole('button', { name: '创建并提交', exact: true }).click();
    const dialog = page.getByRole('dialog');
    await expect(dialog.getByRole('region', { name: '费用复核' })).toContainText('¥ 355.00');
    await dialog.getByRole('button', { name: '确认无误，提交', exact: true }).click();
    await withDb(async client => {
      let id = '';
      await expect.poll(async () => {
        id = (await client.query('SELECT id FROM "Order" WHERE "customName"=$1', [name])).rows[0]?.id ?? '';
        return id;
      }).not.toBe('');
      await expect(dialog.getByRole('button', { name: '继续完成', exact: true })).toBeVisible();
      await client.query(`
        INSERT INTO "OrderItemDesign"
          (id,"orderItemId","fileType","fileUrl","fileName","fileSize","uploadedBy")
        SELECT $1,i.id,'IMAGE',$2,'dark-red.png',200,o."createdById" FROM "OrderItem" i
        JOIN "Order" o ON o.id=i."orderId" WHERE o.id=$3
      `, [crypto.randomUUID(), `data:image/png;base64,${png.toString('base64')}`, id]);
      await page.goto(`/orders/${id}`);
      await page.getByRole('button', { name: '提交工单', exact: true }).click();
      const latest = page.getByRole('button', { name: '确认最新报价并提交', exact: true });
      const status = async () => (await client.query('SELECT status FROM "Order" WHERE id=$1', [id])).rows[0].status;
      await expect.poll(async () => await latest.isVisible() ? 'confirm' : status()).not.toBe('DRAFT');
      if (await latest.isVisible()) await latest.click();
      await expect.poll(status).not.toBe('DRAFT');
      const saved = (await client.query(`
        SELECT "paperType","paperWeightGsm",quantity,"unitPrice"::text,subtotal::text
        FROM "OrderItem" WHERE "orderId"=$1
      `, [id])).rows;
      expect(saved).toEqual([expect.objectContaining({
        paperType: '160g珠光闪红', paperWeightGsm: 160, quantity: 1000,
        unitPrice: '0.3550', subtotal: '355.00',
      })]);
      const locked = (await client.query(`
        SELECT lock."priceBookId" FROM "OrderPriceVersionLock" lock
        JOIN "OrderPricingRevision" revision ON revision.id=lock."pricingRevisionId"
        WHERE revision."orderId"=$1 AND lock.purpose='PROCESSING'
      `, [id])).rows;
      expect(locked).toEqual([{ priceBookId: (await snapshot()).priceVersion.processing.id }]);
    });
    await expect(page.getByRole('button', { name: '提交工单', exact: true })).toHaveCount(0);
    expect(errors).toEqual([]);
  });
}
