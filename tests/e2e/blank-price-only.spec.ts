import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import sharp from 'sharp';
import Decimal from 'decimal.js';
import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Browser, type Page, type Locator } from '@playwright/test';
import { assertActivatedE2eDatabase } from '../../scripts/lib/e2e-environment';
import { login, E2E_PASSWORD, E2E_USERS, openFirstOrderItemEditor } from './_helpers';
import { seedMasterDataAdmin } from './master-data-fixtures';

const exec = promisify(execFile);
/** Test fixtures may only touch the explicitly activated disposable database. */
async function fixture<T>(body: string): Promise<T> {
  assertActivatedE2eDatabase();
  const { stdout } = await exec(process.execPath, ['--conditions=react-server', '--import', 'tsx', '-e', `
    const target=require('./scripts/lib/e2e-environment.ts').assertActivatedE2eDatabase();
    const {db}=require('./lib/db.ts');const admin=require('./lib/price/customer-price-book-admin.ts');
    (async()=>{
      const identity=await db.$queryRawUnsafe('SELECT current_database() AS name');
      if(identity[0]?.name!==target.databaseName)throw Error('Fixture database mismatch');
      ${body}
    })().then(value=>console.log(JSON.stringify(value))).finally(()=>db.$disconnect());
  `], { env: process.env, maxBuffer: 8 * 1024 * 1024 });
  return JSON.parse(stdout) as T;
}
async function createDraft() {
  return fixture<{ id: string }>(`
    const actor=await db.user.findUniqueOrThrow({where:{username:'e2e-owner'}});
    return admin.createCustomerPriceBookDraft({purpose:'PROCESSING',changeReason:'空白封按单价启用验收'},actor);
  `);
}
async function publish(page: Page, id: string) {
  await page.goto(`/owner/rules/price-versions?draft=${id}`);
  const form = page.getByRole('form', { name: '发布价目草稿' });
  await expect(form).toBeVisible();
  const risk = form.getByRole('checkbox', { name: /我已逐条核对高风险变更/ });
  await expect(risk).toBeVisible();
  await risk.check();
  await form.getByRole('button', { name: '确认并立即发布', exact: true }).click();
  await expect.poll(() => fixture<boolean>(`return (await db.customerPriceBook.findUniqueOrThrow({where:{id:${JSON.stringify(id)}}})).isActive;`)).toBe(true);
}
async function createAndSubmitSalesOrder(browser: Browser, paperName: string, orderName: string, errors: string[]) {
  const context = await browser.newContext();
  const page = await context.newPage();
  page.setDefaultTimeout(20_000);
  page.on('pageerror', (error) => errors.push(error.message));
  // The real order creation/submission/quotation writes are exercised. Only
  // object-storage transport uses the established synthetic failed PUT + DB
  // design fixture; this test does not claim to validate OSS uploads.
  await page.route((url) => url.hostname.endsWith('.aliyuncs.com'), async (route) => {
    if (route.request().method() === 'PUT') await route.abort('failed');
    else await route.continue();
  });
  try {
    await login(page, { username: E2E_USERS.sales.username, password: E2E_PASSWORD, from: '/orders/new' });
    await openFirstOrderItemEditor(page);
    const form = page.locator('[data-slot="order-form-b"]');
    await form.getByRole('group', { name: '工单类型' }).getByRole('button', { name: '局部烫金', exact: true }).click();
    // Selecting a paper must work even when the currently selected size is not
    // priced for it; the picker moves to that paper's available size.
    await form.getByRole('group', { name: '纸张材质' }).getByRole('button', { name: paperName, exact: true }).click();
    await form.getByRole('group', { name: '克重', exact: true }).getByRole('button', { name: '160g', exact: true }).click();
    await form.getByRole('group', { name: '规格', exact: true }).getByRole('button', { name: '中号封', exact: true }).click();
    await page.getByRole('textbox', { name: '工单名称', exact: true }).fill(orderName);
    await form.getByRole('spinbutton', { name: '数量', exact: true }).fill('1000');
    await form.getByRole('spinbutton', { name: '每包数量', exact: true }).fill('10');
    await page.getByRole('textbox', { name: '收货地址', exact: true }).fill('测试收货人 13800138000 广东省佛山市南海区测试路1号');
    const png = await sharp({ create: { width: 64, height: 64, channels: 3, background: 'white' } }).png().toBuffer();
    await form.locator('input[type="file"]').first().setInputFiles({ name: 'blank-price-test.png', mimeType: 'image/png', buffer: png });
    await page.getByRole('button', { name: /^(创建并提交|提交并申请管理员终价)$/ }).click();
    await page.getByRole('dialog').getByRole('button', { name: /^(确认提交并申请核价|确认无误，提交)$/ }).click();
    let orderId: string | null = null;
    await expect.poll(async () => {
      orderId = await fixture<string | null>(`return (await db.order.findFirst({where:{customName:${JSON.stringify(orderName)}},select:{id:true}}))?.id ?? null;`);
      return orderId;
    }, { timeout: 20_000 }).not.toBeNull();
    await expect(page.getByRole('dialog').getByRole('button', { name: '继续完成', exact: true })).toBeVisible();
    await fixture(`const order=await db.order.findUniqueOrThrow({where:{id:${JSON.stringify(orderId)}},include:{items:true}});
      await db.orderItemDesign.create({data:{orderItemId:order.items[0].id,fileType:'IMAGE',fileUrl:${JSON.stringify(`data:image/png;base64,${png.toString('base64')}`)},fileName:'fixture.png',fileSize:200n,uploadedBy:order.createdById}});return true;`);
    await page.goto(`/orders/${orderId}`);
    await page.getByRole('button', { name: '提交工单', exact: true }).click();
    const latest = page.getByRole('button', { name: '确认最新报价并提交', exact: true });
    const status = () => fixture<string>(`return (await db.order.findUniqueOrThrow({where:{id:${JSON.stringify(orderId)}}})).status;`);
    await expect.poll(async () => (await latest.isVisible()) ? 'confirm' : await status()).not.toBe('DRAFT');
    if (await latest.isVisible()) await latest.click();
    // Complete automatic pricing and the supplied design satisfy the existing
    // production-readiness check, which advances submission to CONFIRMED.
    await expect.poll(status).toBe('CONFIRMED');
    return orderId!;
  } finally { await context.close(); }
}

async function openHistoricalPriceEditor(page: Page, orderId: string) {
  await page.goto(`/orders/${orderId}`);
  const summary = page.getByRole('main').locator('summary:visible').filter({ hasText: /^历史材料单价$/ });
  await summary.click();
  return summary.locator('..');
}

async function confirmHistoricalPrice(page: Page, value: string, reason: string) {
  const editor = page.getByRole('main').locator('summary:visible').filter({ hasText: /^历史材料单价$/ }).locator('..');
  await editor.getByRole('textbox').fill(value);
  await editor.getByRole('button', { name: '确认材料单价', exact: true }).click();
  const dialog = page.getByRole('alertdialog', { name: '确认材料单价', exact: true });
  const confirm = dialog.getByRole('button', { name: '确认材料单价', exact: true });
  await expect(confirm).toBeDisabled();
  await dialog.getByRole('textbox', { name: '定价依据' }).fill(reason);
  await confirm.click();
}

type HistoricalPriceState = {
  revision: number;
  priceRevision: number;
  financial: string;
  confirmation: null | { unitPrice: string; reason: string; source: string; previousPriceRevision: number };
  revisions: Array<{ revision: number; source: string; snapshot: { metadata: { confirmation: unknown } } }>;
  logs: Array<{ action: string; remark: string; changedFields: unknown }>;
};

async function expectHistoricalPriceViewport(scope: Locator, mobile: boolean) {
  const issues = await scope.evaluate((root, isMobile) => {
    const failures: string[] = [];
    const width = document.documentElement.clientWidth;
    if (document.documentElement.scrollWidth > width + 1) failures.push('页面存在横向溢出');
    for (const element of [root, ...root.querySelectorAll<HTMLElement>('*')]) {
      if (!(element instanceof HTMLElement) || !element.checkVisibility({ visibilityProperty: true })) continue;
      const box = element.getBoundingClientRect();
      if (!box.width || !box.height) continue;
      const name = `${element.tagName}:${element.getAttribute('data-slot') ?? element.textContent?.slice(0, 25)}`;
      const style = getComputedStyle(element);
      if (box.left < -1 || box.right > width + 1) failures.push(`内容超出视口:${name}`);
      if (style.position === 'fixed' && (box.top < -1 || box.bottom > window.innerHeight + 1)) failures.push(`弹窗超出视口:${name}`);
      if (!element.classList.contains('sr-only') && !element.getAttribute('aria-label') && !element.getAttribute('aria-describedby') && (
        (['hidden', 'clip'].includes(style.overflowX) && element.scrollWidth > element.clientWidth + 1) ||
        (['hidden', 'clip'].includes(style.overflowY) && element.scrollHeight > element.clientHeight + 1)
      )) failures.push(`内容被裁切:${name}`);
      if (isMobile && element.matches('button:not(:disabled), input:not(:disabled), textarea:not(:disabled), summary') && (box.width < 44 || box.height < 44)) {
        failures.push(`触控尺寸不足:${name}:${box.width}x${box.height}`);
      }
    }
    return failures;
  }, mobile);
  expect(issues, issues.join('\n')).toEqual([]);
}

async function verifyHistoricalPriceViewports(browser: Browser, owner: Page, orderId: string, errors: string[]) {
  const storageState = await owner.context().storageState();
  for (const [width, height] of [[375, 667], [393, 852], [768, 1024], [1024, 768], [1280, 800], [1920, 1080]]) {
    const context = await browser.newContext({ storageState, viewport: { width, height }, hasTouch: width <= 768 });
    const ui = await context.newPage();
    ui.on('pageerror', (error) => errors.push(error.message));
    try {
      const editor = await openHistoricalPriceEditor(ui, orderId);
      // Stable test-only selector scopes accessibility to the new editor and
      // its real confirmation dialog, without changing layout or semantics.
      await editor.evaluate((element) => element.setAttribute('data-e2e-historical-price', ''));
      for (const theme of ['light', 'dark']) {
        await ui.evaluate((value) => {
          document.documentElement.dataset.theme = value;
          document.documentElement.classList.toggle('dark', value === 'dark');
        }, theme);
        await expect.poll(() => ui.evaluate(() => document.getAnimations().filter(
          (animation) => animation instanceof CSSTransition && animation.playState === 'running',
        ).length)).toBe(0);
        await expectHistoricalPriceViewport(editor, width <= 768);
        const input = editor.getByRole('textbox');
        if (width <= 768) await input.tap();
        else await input.focus();
        await expect(input).toBeFocused();
        await input.press('Tab');
        const trigger = editor.getByRole('button', { name: '确认材料单价', exact: true });
        await expect(trigger).toBeFocused();
        if (width <= 768) await trigger.tap();
        else await trigger.press('Enter');
        const dialog = ui.getByRole('alertdialog', { name: '确认材料单价', exact: true });
        await expect(dialog).toBeVisible();
        // Base UI starts at scale .95: measuring that frame would turn a valid
        // 44px touch target into 41.8px. Check settled geometry, never relax it.
        await expect.poll(() => dialog.evaluate((element) => ({
          scale: getComputedStyle(element).scale === 'none' ? '1' : getComputedStyle(element).scale,
          running: element.getAnimations({ subtree: true }).filter((animation) => animation.playState === 'running').length,
        }))).toMatchObject({ scale: '1', running: 0 });
        await expect(dialog.getByRole('button', { name: '确认材料单价', exact: true })).toBeDisabled();
        await dialog.getByRole('textbox', { name: '定价依据' }).fill('仅检查界面，不保存');
        await expect(dialog.getByRole('button', { name: '确认材料单价', exact: true })).toBeEnabled();
        await expectHistoricalPriceViewport(dialog, width <= 768);
        const dialogA11y = await new AxeBuilder({ page: ui }).include('[role="alertdialog"]')
          .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa']).analyze();
        expect(dialogA11y.violations).toEqual([]);
        await dialog.getByRole('button', { name: '取消', exact: true }).click();
        await expect(dialog).toBeHidden();
        const editorA11y = await new AxeBuilder({ page: ui }).include('[data-e2e-historical-price]')
          .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa']).analyze();
        expect(editorA11y.violations).toEqual([]);
      }
    } finally { await context.close(); }
  }
}

async function verifyHistoricalCancellation(browser: Browser, owner: Page, orderId: string, errors: string[]) {
  const salesContext = await browser.newContext();
  try {
    const sales = await salesContext.newPage();
    sales.on('pageerror', (error) => errors.push(error.message));
    await login(sales, { username: E2E_USERS.sales.username, password: E2E_PASSWORD, from: `/orders/${orderId}#change-request` });
    const requests = sales.locator('#change-request');
    await requests.getByLabel('取消原因', { exact: true }).fill('客户取消剩余生产，按核实已产数量结算');
    await requests.getByRole('button', { name: '提交取消申请', exact: true }).click();
    await expect(sales.getByRole('button', { name: '撤回申请', exact: true })).toBeVisible();
  } finally { await salesContext.close(); }
  const readCancellation = () => fixture<{
    status: string; settledFee: string | null; confirmedFee: string; totalAmount: string;
    requests: Array<{ status: string; producedQty: number | null; settleFee: string | null }>;
    logs: Array<{ action: string; changedFields: Record<string, { before: unknown; after: unknown }> }>;
  }>(`
    const order=await db.order.findUniqueOrThrow({where:{id:${JSON.stringify(orderId)}},select:{
      status:true,settledFee:true,confirmedFee:true,totalAmount:true}});
    return {...order,requests:await db.orderChangeRequest.findMany({where:{orderId:${JSON.stringify(orderId)},type:'CANCEL'},select:{status:true,producedQty:true,settleFee:true}}),
      logs:await db.orderLog.findMany({where:{orderId:${JSON.stringify(orderId)},action:'CHANGE_REQUEST_CANCEL_APPROVED'},select:{action:true,changedFields:true}})};
  `);
  const original = await readCancellation();
  expect(original).toMatchObject({ status: 'CONFIRMED', settledFee: null,
    requests: [{ status: 'PENDING', producedQty: null, settleFee: null }], logs: [] });
  await owner.goto(`/orders/${orderId}`);
  const panel = owner.locator('[data-slot="admin-order-decision-panel"]');
  await expect(panel).toHaveCount(1);
  await panel.getByRole('button', { name: '批准取消', exact: true }).click();
  await panel.getByRole('spinbutton', { name: '已产数量', exact: true }).fill('500');
  await panel.getByRole('button', { name: '计算参考价', exact: true }).click();
  const finalFee = panel.getByRole('textbox', { name: '最终结算金额', exact: true });
  await expect(finalFee).toBeEnabled();
  const beforeFee = await finalFee.inputValue();
  // The material alone is 500 × 0.4123; any machine/packaging fee is additional.
  expect(new Decimal(beforeFee).gte('206.15')).toBe(true);
  expect(await readCancellation()).toEqual(original);

  // Seed only another administrator identity. Both material confirmation and
  // cancellation remain real authenticated browser Actions.
  const secondAdmin = await seedMasterDataAdmin();
  const secondContext = await browser.newContext();
  try {
    const second = await secondContext.newPage();
    second.on('pageerror', (error) => errors.push(error.message));
    await login(second, { username: secondAdmin.username, password: E2E_PASSWORD, from: `/orders/${orderId}` });
    await openHistoricalPriceEditor(second, orderId);
    await confirmHistoricalPrice(second, '0.5123', '取消核价前按供应凭据修正材料单价');
    await expect.poll(() => fixture<string>(`const item=await db.orderItem.findFirstOrThrow({where:{orderId:${JSON.stringify(orderId)}}});return item.pricingSnapshot.blankMaterialConfirmation.unitPrice;`)).toBe('0.5123');
  } finally { await secondContext.close(); }

  async function approve() {
    await panel.getByRole('button', { name: '确认取消并结算工单', exact: true }).click();
    await owner.getByRole('alertdialog').getByRole('button', { name: '确认取消并结算工单', exact: true }).click();
  }
  await approve();
  await expect(panel.getByRole('alert')).toHaveText('材料单价或价格版本已变化，请重新计算参考结算价');
  expect(await readCancellation()).toEqual(original);
  await panel.getByRole('button', { name: '计算参考价', exact: true }).click();
  await expect(finalFee).toHaveValue(new Decimal(beforeFee).plus('50.00').toFixed(2));
  const latestFee = await finalFee.inputValue();
  expect(new Decimal(latestFee).minus(beforeFee).toFixed(2)).toBe('50.00');
  await approve();
  await expect.poll(async () => (await readCancellation()).status).toBe('CANCELLED');
  const settled = await readCancellation();
  expect(settled).toMatchObject({ status: 'CANCELLED', settledFee: new Decimal(latestFee).toString(),
    confirmedFee: original.confirmedFee, totalAmount: original.totalAmount,
    requests: [{ status: 'APPROVED', producedQty: 500, settleFee: new Decimal(latestFee).toString() }] });
  expect(settled.logs).toHaveLength(1);
  expect(settled.logs[0].changedFields).toMatchObject({
    referenceSettleFee: { after: latestFee }, settledFee: { after: latestFee },
    settlementDelta: { after: '0.00' }, calculation: { after: 'CURRENT_PUBLISHED_ENGINE_V1' },
    calculationComponents: { after: expect.objectContaining({ shipping: '0.00' }) },
  });
}

test('单价直接启用：真实建单用料、停售重试、历史材料核价和旧入口跳转', async ({ page, browser }) => {
  test.setTimeout(300_000);
  assertActivatedE2eDatabase();
  page.setDefaultTimeout(20_000);
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  const suffix = Date.now().toString(36);
  const paperName = `单价验收${suffix}`;
  const paperLabel = `160g${paperName}`;
  const draftIds: string[] = [];
  try {
    const draft = await createDraft(); draftIds.push(draft.id);
    await login(page, { username: E2E_USERS.owner.username, password: E2E_PASSWORD, from: '/owner/rules/customer-pricing?section=blank' });
    await page.getByRole('link', { name: '新建纸张 / 规格', exact: true }).click();
    await page.getByRole('radio', { name: '新建纸张' }).check();
    await page.getByLabel('纸张名称', { exact: true }).fill(paperName);
    await page.getByLabel('克重（g）', { exact: true }).fill('160');
    // A blank cell creates paper metadata only, not a product or sale permission.
    await page.getByRole('button', { name: '保存纸张与规格价格', exact: true }).click();
    await expect(page).toHaveURL(/customer-pricing\?section=blank$/);
    const paper = await fixture<{ id: string }>(`return db.material.findFirstOrThrow({where:{name:${JSON.stringify(paperLabel)}},select:{id:true}});`);
    const inspect = () => fixture<{ productCount: number; available: number }>(`
      const products=await db.product.count({where:{OR:[{paperMaterialId:${JSON.stringify(paper.id)}},{paperType:${JSON.stringify(paperLabel)}}]}});
      const options=await require('./lib/order/create-order-options.ts').listExternalCreateOrderOptions();
      return {productCount:products,available:options.products.filter(p=>p.source==='BLANK_PRICE'&&p.paperMaterialId===${JSON.stringify(paper.id)}).length};
    `);
    expect(await inspect()).toEqual({ productCount: 0, available: 0 });
    const row = page.getByRole('row', { name: new RegExp(paperName) });
    await row.getByRole('spinbutton', { name: /中号封单价/ }).fill('0.3251');
    await page.getByRole('button', { name: '保存调价草稿', exact: true }).click();
    await expect(page.getByText('调价草稿已保存。', { exact: true })).toBeVisible();
    expect(await inspect()).toEqual({ productCount: 0, available: 0 });
    await publish(page, draft.id);
    expect(await inspect()).toEqual({ productCount: 0, available: 1 });

    // BOM has an independent production target, selected without a Product.
    await page.goto('/owner/boms/new');
    await page.getByLabel('适用对象', { exact: true }).selectOption('BLANK');
    await page.getByLabel('用料清单名称', { exact: true }).fill(`纸张用料${suffix}`);
    await page.getByLabel('纸张', { exact: true }).selectOption(paper.id);
    await page.getByLabel('规格', { exact: true }).selectOption('mid');
    await page.getByLabel('基准产量', { exact: true }).fill('1000');
    await page.getByRole('combobox', { name: '物料', exact: true }).selectOption(paper.id);
    await page.getByLabel('用量', { exact: true }).fill('500.1250');
    await page.getByRole('button', { name: '创建用料清单', exact: true }).click();
    await expect(page).toHaveURL((url) => /^\/owner\/boms\/(?!new$)[^/]+$/.test(url.pathname));
    await expect(page.getByRole('heading', { name: `纸张用料${suffix}`, exact: true })).toBeVisible();
    const bom = await fixture<{ productId: string | null; blankPaperMaterialId: string; blankSpecificationKey: string }>(`
      return db.billOfMaterial.findFirstOrThrow({where:{blankPaperMaterialId:${JSON.stringify(paper.id)}},select:{productId:true,blankPaperMaterialId:true,blankSpecificationKey:true}});
    `);
    expect(bom).toEqual({ productId: null, blankPaperMaterialId: paper.id, blankSpecificationKey: 'mid' });

    const orderId = await createAndSubmitSalesOrder(browser, paperName, `单价工单${suffix}`, errors);
    const history = () => fixture<string>(`
      return JSON.stringify({items:await db.orderItem.findMany({where:{orderId:${JSON.stringify(orderId)}},orderBy:{sequence:'asc'},
        select:{id:true,productId:true,pricingRoute:true,unitPrice:true,subtotal:true,pricingSnapshot:true,quoteDisposition:true}}),
        charges:await db.orderCustomerCharge.findMany({where:{orderId:${JSON.stringify(orderId)}},orderBy:{id:'asc'}}),
        revisions:await db.orderPricingRevision.findMany({where:{orderId:${JSON.stringify(orderId)}},orderBy:{id:'asc'}})});
    `);
    const before = await history();
    const saved = JSON.parse(before) as { items: Array<{ productId: string | null; pricingRoute: string }> };
    expect(saved.items[0]).toMatchObject({ productId: null, pricingRoute: 'STOCK_BLANK' });
    expect(before).toContain('0.3251');
    expect(before).toContain('325.10');
    const usage = await fixture<{ items: Array<{ source: string; materials: Array<{ quantity: string }> }> }>(`
      const items=await db.orderItem.findMany({where:{orderId:${JSON.stringify(orderId)}}});
      return require('./lib/bom.ts').estimateMaterialUsageForOrderItems(items);
    `);
    expect(usage.items[0]).toMatchObject({ source: 'BLANK', materials: [{ quantity: '500.1250' }] });
    await page.goto(`/orders/${orderId}`);
    await expect(page.getByText('纸张规格物料清单', { exact: true })).toBeVisible();

    const stopped = await createDraft(); draftIds.push(stopped.id);
    await page.goto('/owner/rules/customer-pricing?section=blank');
    await page.getByRole('row', { name: new RegExp(paperName) }).getByRole('spinbutton', { name: /中号封单价/ }).fill('0');
    await page.getByRole('button', { name: '保存调价草稿', exact: true }).click();
    await expect(page.getByText('调价草稿已保存。', { exact: true })).toBeVisible();
    await publish(page, stopped.id);
    expect(await inspect()).toEqual({ productCount: 0, available: 0 });
    const denied = await fixture<{ rejected: boolean; message?: string }>(`
      try {await db.$transaction(tx=>require('./lib/order/blank-price-admission.ts').assertBlankPriceAdmissionInTx(tx,[{
        pricingRoute:'STOCK_BLANK',paperType:${JSON.stringify(paperLabel)},paperWeightGsm:160,specification:'中号封80×115',actualWidthMm:80,actualHeightMm:115}],new Date()));
        return {rejected:false};} catch(error){return {rejected:true,message:error.message};}
    `);
    expect(denied).toMatchObject({ rejected: true, message: expect.stringContaining('未启用') });
    // Retry the real successful submission quotation after the live price was
    // disabled. REUSE must return the existing confirmed revision, not reprice.
    const replay = await fixture<{ reused: boolean }>(`
      const actor=await db.user.findUniqueOrThrow({where:{username:'e2e-sales'}});
      return db.$transaction(tx=>require('./lib/order/submit-external-order.ts').finalizeExternalOrderQuoteInTx(tx,${JSON.stringify(orderId)},actor.id,new Date()));
    `);
    expect(replay.reused).toBe(true);
    expect(await history()).toBe(before);

    // Confirm a material-only historical price through the real admin Action.
    // A second browser page keeps the old revision to exercise optimistic locking.
    const historicalState = () => fixture<HistoricalPriceState>(`
      const order=await db.order.findUniqueOrThrow({where:{id:${JSON.stringify(orderId)}},select:{
        revision:true,priceRevision:true,status:true,pricingStatus:true,processingAmount:true,
        packagingAmount:true,totalAmount:true,quotedFee:true,confirmedFee:true,settledFee:true,
        pricingConfirmedAt:true,pricingConfirmedById:true,items:{orderBy:{sequence:'asc'},select:{
          id:true,productId:true,unitPrice:true,fixedFee:true,subtotal:true,pricingSnapshot:true}},
        customerCharges:{orderBy:{id:'asc'}}}});
      const {revision,priceRevision,items,...financial}=order;
      return {revision,priceRevision,
        financial:JSON.stringify({...financial,items:items.map(({pricingSnapshot,...item})=>item)}),
        confirmation:items[0].pricingSnapshot?.blankMaterialConfirmation??null,
        revisions:await db.orderPricingRevision.findMany({where:{orderId:${JSON.stringify(orderId)},source:'ADMIN_BLANK_MATERIAL_CONFIRMATION'},orderBy:{revision:'asc'},select:{revision:true,source:true,snapshot:true}}),
        logs:await db.orderLog.findMany({where:{orderId:${JSON.stringify(orderId)},action:'BLANK_MATERIAL_PRICE_CONFIRMED'},orderBy:{createdAt:'asc'},select:{action:true,remark:true,changedFields:true}})};
    `);
    const baseline = await historicalState();
    expect(baseline.confirmation).toBeNull();
    expect(baseline.revisions).toEqual([]);
    expect(baseline.logs).toEqual([]);
    const editor = await openHistoricalPriceEditor(page, orderId);
    await expect(editor.getByRole('textbox')).toHaveValue('0.3251');
    const stalePage = await page.context().newPage();
    stalePage.on('pageerror', (error) => errors.push(error.message));
    try {
      const staleEditor = await openHistoricalPriceEditor(stalePage, orderId);
      await confirmHistoricalPrice(page, '0.12345', '验证过长精度应被拒绝');
      await expect(editor.getByRole('status')).toHaveText('材料单价最多四位小数');
      expect(await historicalState()).toEqual(baseline);
      await confirmHistoricalPrice(page, '0', '零元不属于有效历史材料单价');
      await expect(editor.getByRole('status')).toHaveText('请填写大于 0、最多四位小数的材料单价及定价依据');
      expect(await historicalState()).toEqual(baseline);

      const reason = '已核对纸张供应商报价，材料单价调整为每个 0.4123 元';
      await confirmHistoricalPrice(page, '0.4123', reason);
      await expect.poll(async () => (await historicalState()).confirmation?.unitPrice).toBe('0.4123');
      const confirmed = await historicalState();
      expect(confirmed.financial).toBe(baseline.financial);
      expect(confirmed.revision).toBe(baseline.revision);
      expect(confirmed.priceRevision).toBe(baseline.priceRevision + 1);
      expect(confirmed.confirmation).toMatchObject({ source: 'ADMIN_MATERIAL_CONFIRMATION',
        unitPrice: '0.4123', reason, previousPriceRevision: baseline.priceRevision });
      expect(confirmed.revisions).toHaveLength(1);
      expect(confirmed.revisions[0]).toMatchObject({ revision: confirmed.priceRevision,
        source: 'ADMIN_BLANK_MATERIAL_CONFIRMATION', snapshot: { metadata: { confirmation: confirmed.confirmation } } });
      expect(confirmed.logs).toEqual([{ action: 'BLANK_MATERIAL_PRICE_CONFIRMED', remark: reason,
        changedFields: expect.objectContaining({ materialUnitPrice: { before: '0.3251', after: '0.4123' },
          priceRevision: { before: baseline.priceRevision, after: confirmed.priceRevision } }) }]);

      await confirmHistoricalPrice(stalePage, '0.5123', '旧页面不得覆盖最新材料单价');
      await expect(staleEditor.getByRole('status')).toHaveText('工单或价格已变更，请刷新后重新核对');
      expect(await historicalState()).toEqual(confirmed);
      const refreshed = await openHistoricalPriceEditor(page, orderId);
      await expect(refreshed.getByRole('textbox')).toHaveValue('0.4123');
    } finally { await stalePage.close(); }

    const beforeVisual = await historicalState();
    await verifyHistoricalPriceViewports(browser, page, orderId, errors);
    expect(await historicalState()).toEqual(beforeVisual);
    await verifyHistoricalCancellation(browser, page, orderId, errors);

    const legacy = await fixture<{ id: string }>(`return db.product.findFirstOrThrow({where:{category:'BLANK_STOCK'},select:{id:true}});`);
    for (const oldPath of ['/owner/rules/stock-skus', '/owner/rules/stock-skus/new', `/owner/rules/stock-skus/${legacy.id}`]) {
      await page.goto(oldPath);
      await expect(page).toHaveURL(/\/owner\/rules\/customer-pricing\?section=blank$/);
      await expect(page.getByRole('heading', { name: '局部烫金 · 空白封现货单价', exact: true })).toBeVisible();
      await expect(page.getByRole('link', { name: '可建单产品组合', exact: true })).toHaveCount(0);
      await expect(page.getByRole('heading', { name: /可建单产品组合|新增产品组合/ })).toHaveCount(0);
    }
    expect(errors).toEqual([]);
  } finally {
    // Only clean up drafts owned by this test; published history remains intact.
    await fixture(`const actor=await db.user.findUniqueOrThrow({where:{username:'e2e-owner'}});
      const versions=await admin.listCustomerPriceBookVersionsAndDrafts();
      for(const id of ${JSON.stringify(draftIds)}){if(!versions.some(v=>v.id===id&&v.status==='DRAFT'))continue;
        const book=await db.customerPriceBook.findUniqueOrThrow({where:{id}});
        await admin.discardCustomerPriceBookDraft({priceBookId:id,expectedDraftUpdatedAt:book.updatedAt},actor);}
      return true;`);
  }
});
