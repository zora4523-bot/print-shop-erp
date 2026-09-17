import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import sharp from 'sharp';
import { expect, test, type Page } from '@playwright/test';
import { assertActivatedE2eDatabase } from '../../scripts/lib/e2e-environment';
import {
  login,
  E2E_PASSWORD,
  E2E_USERS,
  openFirstOrderItemEditor,
} from './_helpers';
import { expectA11yGate, expectViewportGate } from '../visual/ui-gates';
const exec = promisify(execFile);
async function query<T>(body: string): Promise<T> {
  const result = await exec(
    process.execPath,
    [
      '--conditions=react-server',
      '--import',
      'tsx',
      '-e',
      `
    const {db}=require('./lib/db.ts');const admin=require('./lib/price/customer-price-book-admin.ts');
    (async()=>{${body}})().then(value=>console.log(JSON.stringify(value))).finally(()=>db.$disconnect());`,
    ],
    { env: process.env },
  );
  return JSON.parse(result.stdout) as T;
}
async function prepareDraft() {
  return query<{
    id: string;
  }>(`const versions=await admin.listCustomerPriceBookVersionsAndDrafts();
    const draft=versions.find(v=>v.purpose==='PROCESSING'&&v.status==='DRAFT');if(draft)return {id:draft.id};
    const actor=await db.user.findUniqueOrThrow({where:{username:'e2e-owner'}});
    return admin.createCustomerPriceBookDraft({purpose:'PROCESSING',changeReason:'测试新增纸张'},actor);`);
}
async function publish(page: Page, id: string) {
  await page.goto(`/owner/rules/price-versions?draft=${id}`);
  const form = page.getByRole('form', { name: '发布价目草稿' });
  await expect(form).toBeVisible();
  const risk = form.getByRole('checkbox', { name: /我已逐条核对高风险变更/ });
  await expect(risk).toBeVisible();
  await risk.check();
  await expect(risk).toBeChecked();
  await form
    .getByRole('button', { name: '确认并立即发布', exact: true })
    .click();
  await expect
    .poll(async () =>
      query<boolean>(
        `return (await db.customerPriceBook.findUniqueOrThrow({where:{id:${JSON.stringify(id)}}})).isActive;`,
      ),
    )
    .toBe(true);
}

test('新增纸张、缺价建单、发布自动报价、补规格与历史价格完整链路', async ({
  page,
  browser,
}, testInfo) => {
  test.setTimeout(300_000);
  assertActivatedE2eDatabase();
  page.setDefaultTimeout(20_000);
  const suffix = Date.now().toString(36);
  const paperName = `验证纸${suffix}`;
  const paperLabel = `160g${paperName}`;
  const draft = await prepareDraft();
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await login(page, {
    username: E2E_USERS.owner.username,
    password: E2E_PASSWORD,
    from: '/owner/rules/customer-pricing?section=blank',
  });
  await page
    .getByRole('link', { name: '新增纸张 / 规格', exact: true })
    .click();
  await page.getByRole('radio', { name: '新建纸张' }).check();
  await page.getByLabel('纸张名称', { exact: true }).fill(paperName);
  await page.getByLabel('克重（g）', { exact: true }).fill('160');
  await page.getByRole('checkbox', { name: '中号封', exact: true }).check();
  await page.getByLabel('中号封单价', { exact: true }).fill('0.3251');
  await page.getByRole('checkbox', { name: '大号封', exact: true }).check();
  await page
    .getByRole('button', { name: '保存纸张与规格价格', exact: true })
    .click();
  await expect(page).toHaveURL(/customer-pricing\?section=blank$/);
  await expect(
    page.getByRole('row', { name: new RegExp(paperName) }),
  ).toContainText('160g');
  const inspect = () =>
    query<{
      paperCount: number;
      productCount: number;
      prices: Array<{ specification: string; unitPrice: string | null }>;
    }>(`
    const papers=await db.material.findMany({where:{name:${JSON.stringify(paperLabel)}}});
    const products=await db.product.findMany({where:{paperMaterialId:{in:papers.map(p=>p.id)}}});
    const projection=await require('./lib/order/create-order-published-rule-adapter.ts').readPublishedCreateOrderPriceSnapshot(db);
    return {paperCount:papers.length,productCount:products.length,prices:projection.partial.blankUnitPrices.filter(p=>p.paperType===${JSON.stringify(paperName)})};`);
  expect(await inspect()).toMatchObject({
    paperCount: 1,
    productCount: 2,
    prices: [],
  });

  // Failed mixed request must roll back any newly created combination as well.
  await query(`const actor=await db.user.findUniqueOrThrow({where:{username:'e2e-owner'}});
    const book=await db.customerPriceBook.findUniqueOrThrow({where:{id:${JSON.stringify(draft.id)}}});
    try{await admin.addBlankPaperDraft({priceBookId:book.id,expectedUpdatedAt:book.updatedAt.toISOString(),paper:{mode:'new',name:${JSON.stringify(paperName)},weight:160},specifications:[{key:'mini',amount:'1'},{key:'mid',amount:'1'}]},actor);throw Error('expected conflict');}
    catch(error){if(!error.message.includes('已有价格记录'))throw error;}return true;`);
  expect((await inspect()).productCount).toBe(2);

  // Verify the real creation transaction. Object-storage upload/final submission
  // is a separate integration: intentionally fail only the synthetic image PUT.
  async function createThroughSales(orderName: string, unpublished: boolean) {
    const salesContext = await browser.newContext();
    const sales = await salesContext.newPage();
    sales.setDefaultTimeout(20_000);
    sales.on('pageerror', (error) => errors.push(error.message));
    await sales.route(
      (url) => url.hostname.endsWith('.aliyuncs.com'),
      async (route) => {
        if (route.request().method() === 'PUT') await route.abort('failed');
        else await route.continue();
      },
    );
    try {
      await login(sales, {
        username: E2E_USERS.sales.username,
        password: E2E_PASSWORD,
        from: '/orders/new',
      });
      await openFirstOrderItemEditor(sales);
      const form = sales.locator('[data-slot="order-form-b"]');
      await form
        .getByRole('group', { name: '工单类型' })
        .getByRole('button', { name: '局部烫金', exact: true })
        .click();
      await form
        .getByRole('group', { name: '规格', exact: true })
        .getByRole('button', { name: '中号封', exact: true })
        .click();
      await form
        .getByRole('group', { name: '纸张材质' })
        .getByRole('button', { name: paperName, exact: true })
        .click();
      await form
        .getByRole('group', { name: '克重', exact: true })
        .getByRole('button', { name: '160g', exact: true })
        .click();
      if (unpublished) await expect(form).toContainText(/待核价|人工/);
      await sales
        .getByRole('textbox', { name: '工单名称', exact: true })
        .fill(orderName);
      await form
        .getByRole('spinbutton', { name: '数量', exact: true })
        .fill('1000');
      await form
        .getByRole('spinbutton', { name: '每包数量', exact: true })
        .fill('10');
      await sales
        .getByRole('textbox', { name: '收货地址', exact: true })
        .fill('测试收货人 13800138000 广东省佛山市南海区测试路1号');
      await form
        .locator('input[type="file"]')
        .first()
        .setInputFiles({
          name: 'paper-test.png',
          mimeType: 'image/png',
          buffer: await sharp({
            create: { width: 64, height: 64, channels: 3, background: 'white' },
          })
            .png()
            .toBuffer(),
        });
      await sales
        .getByRole('button', { name: /^(创建并提交|提交并申请管理员终价)$/ })
        .click();
      await sales
        .getByRole('dialog')
        .getByRole('button', { name: /^(确认提交并申请核价|确认无误，提交)$/ })
        .click();

      let createdId: string | null = null;
      await expect
        .poll(
          async () => {
            createdId = await query<string | null>(
              `return (await db.order.findFirst({where:{customName:${JSON.stringify(orderName)}},select:{id:true}}))?.id ?? null;`,
            );
            return createdId;
          },
          { timeout: 20_000 },
        )
        .not.toBeNull();
      await expect(
        sales
          .getByRole('dialog')
          .getByRole('button', { name: '继续完成', exact: true }),
      ).toBeVisible();
      // Supply the same in-database design fixture used by other order E2Es;
      // then submit through the real sales detail, including quote confirmation.
      const imageUrl = `data:image/png;base64,${(
        await sharp({
          create: { width: 64, height: 64, channels: 3, background: 'white' },
        })
          .png()
          .toBuffer()
      ).toString('base64')}`;
      await query(`const order=await db.order.findUniqueOrThrow({where:{id:${JSON.stringify(createdId)}},include:{items:true}});
        await db.orderItemDesign.create({data:{orderItemId:order.items[0].id,fileType:'IMAGE',fileUrl:${JSON.stringify(imageUrl)},fileName:'fixture.png',fileSize:200n,uploadedBy:order.createdById}});return true;`);
      await sales.goto(`/orders/${createdId}`);
      await sales
        .getByRole('button', { name: '提交工单', exact: true })
        .click();
      const latest = sales.getByRole('button', {
        name: '确认最新报价并提交',
        exact: true,
      });
      const status = () =>
        query<string>(
          `return (await db.order.findUniqueOrThrow({where:{id:${JSON.stringify(createdId)}}})).status;`,
        );
      await expect
        .poll(async () =>
          (await latest.isVisible()) ? 'confirm' : await status(),
        )
        .not.toBe('DRAFT');
      if (await latest.isVisible()) await latest.click();
      await expect.poll(status).not.toBe('DRAFT');
      return createdId!;
    } finally {
      await salesContext.close();
    }
  }
  const pendingId = await createThroughSales(`待核纸张${suffix}`, true);
  const pending = await query<{
    pricingStatus: string;
    charges: string;
  }>(`const order=await db.order.findUniqueOrThrow({where:{id:${JSON.stringify(pendingId)}}});
    return {pricingStatus:order.pricingStatus,charges:JSON.stringify(await db.orderCustomerCharge.findMany({where:{orderId:order.id}}))};`);
  expect(pending.pricingStatus).toBe('PENDING_ADMIN_CONFIRMATION');
  expect(pending.charges).not.toContain('0.3251');
  await publish(page, draft.id);
  expect((await inspect()).prices).toEqual(
    expect.arrayContaining([
      expect.objectContaining({ specification: '中号封', unitPrice: '0.3251' }),
    ]),
  );
  const orderId = await createThroughSales(`纸张验证${suffix}`, false);
  const history = () =>
    query<string>(
      `return JSON.stringify({items:await db.orderItem.findMany({where:{orderId:${JSON.stringify(orderId)}},select:{unitPrice:true,subtotal:true,pricingSnapshot:true,quoteDisposition:true},orderBy:{sequence:'asc'}}),charges:await db.orderCustomerCharge.findMany({where:{orderId:${JSON.stringify(orderId)}},orderBy:{id:'asc'}})});`,
    );
  const before = await history();
  expect(before).toContain('0.3251');
  expect(before).toContain('325.10');
  const next = await prepareDraft();
  await page.goto('/owner/rules/customer-pricing/blank/new');
  await page
    .getByLabel('纸张', { exact: true })
    .selectOption({ label: paperLabel });
  await page.getByRole('checkbox', { name: '迷你封', exact: true }).check();
  await page.getByLabel('迷你封单价', { exact: true }).fill('0');
  await page.getByRole('checkbox', { name: '大号封', exact: true }).check();
  await page.getByLabel('大号封单价', { exact: true }).fill('0.5555');
  await page
    .getByRole('button', { name: '保存纸张与规格价格', exact: true })
    .click();
  await expect(page).toHaveURL(/customer-pricing\?section=blank$/);
  const row = page.getByRole('row', { name: new RegExp(paperName) });
  await row
    .getByRole('spinbutton', { name: new RegExp('中号封单价') })
    .fill('0.4252');
  await page.getByRole('button', { name: '保存调价草稿', exact: true }).click();
  await expect(
    page.getByText('调价草稿已保存。', { exact: true }),
  ).toBeVisible();
  await publish(page, next.id);
  expect(await history()).toBe(before);
  expect((await inspect()).productCount).toBe(3);
  expect((await inspect()).prices).toEqual(
    expect.arrayContaining([
      expect.objectContaining({ specification: '大号封', unitPrice: '0.5555' }),
    ]),
  );
  expect((await inspect()).prices).toEqual(
    expect.arrayContaining([
      expect.objectContaining({ specification: '中号封', unitPrice: '0.4252' }),
      expect.objectContaining({ specification: '迷你封', unitPrice: '0' }),
    ]),
  );
  await prepareDraft();
  const ownerState = await page.context().storageState();
  for (const [width, height] of [
    [375, 667],
    [393, 852],
    [768, 1024],
    [1024, 768],
    [1280, 800],
    [1920, 1080],
  ]) {
    const uiContext = await browser.newContext({
      storageState: ownerState,
      viewport: { width, height },
      hasTouch: width <= 768,
    });
    const ui = await uiContext.newPage();
    ui.on('pageerror', (error) => errors.push(error.message));
    await ui.goto('/owner/rules/customer-pricing/blank/new');
    await expect(ui.locator('[aria-current=page]').filter({ hasText: '新增纸张与规格价格' })).toBeVisible();
    if (width <= 768) {
      await ui.getByRole('radio', { name: '新建纸张', exact: true }).locator('..').tap();
      await ui.getByRole('checkbox', { name: '中号封', exact: true }).locator('..').tap();
      await expect(
        ui.getByRole('checkbox', { name: '中号封', exact: true }),
      ).toBeChecked();
    } else await ui.getByRole('radio', { name: '新建纸张' }).check();
    for (const theme of ['light', 'dark']) {
      await ui.evaluate((value) => {
        document.documentElement.dataset.theme = value;
        document.documentElement.classList.toggle('dark', value === 'dark');
      }, theme);
      await expect
        .poll(() =>
          ui.evaluate(
            () =>
              document
                .getAnimations()
                .filter(
                  (a) =>
                    a instanceof CSSTransition && a.playState === 'running',
                ).length,
          ),
        )
        .toBe(0);
      await ui.evaluate(() => window.scrollTo(0, 0));
      await expectViewportGate(ui, {
        ...testInfo,
        project: {
          ...testInfo.project,
          use: { ...testInfo.project.use, viewport: { width, height } },
        },
      });
      await expectA11yGate(ui);
      if (theme === 'light' && (width === 375 || width === 1280)) {
        await ui.screenshot({
          path: `/tmp/blank-paper-${width}.png`,
          fullPage: true,
        });
      }
    }
    await uiContext.close();
  }
  expect(errors).toEqual([]);
});
