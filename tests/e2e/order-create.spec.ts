import { test, expect } from '@playwright/test';
import { Client } from 'pg';
import AxeBuilder from '@axe-core/playwright';
import { assertActivatedE2eDatabase } from '../../scripts/lib/e2e-environment';
import {
  E2E_PASSWORD,
  E2E_USERS,
  login,
  uniqueSuffix,
  expectNoNextErrorOverlay,
  openFirstOrderItemEditor,
  getUserIdByUsername,
  seedDashboardSnapshot,
} from './_helpers';

const owner = E2E_USERS.owner!;
// Next development cold compilation can exceed the default 5-second assertion
// timeout. Wait for the actual destination and content without fixed sleeps.
const routeTransitionOptions = { timeout: 20_000 };

async function readSavedOrder(id: string) {
  const db = new Client({ connectionString: process.env.DATABASE_URL });
  await db.connect();
  try {
    const { rows } = await db.query<{
      order: {
        editVersion: number;
        status: string;
        pricingStatus: string;
        promisedDate: string | null;
        isUrgent: boolean;
        receiverName: string | null;
        receiverPhone: string | null;
        packageRequirement: string | null;
      };
      facts: unknown;
      shipments: Array<{
        receiverName: string | null;
        receiverPhone: string | null;
      }>;
      updateLogs: number;
    }>(
      `SELECT to_jsonb(o) AS "order",
      jsonb_build_object(
        'amounts', jsonb_build_array(o."processingAmount", o."packagingAmount", o."totalAmount", o."quotedFee", o."confirmedFee", o."settledFee"),
        'items', (SELECT jsonb_agg(to_jsonb(i) ORDER BY i.id) FROM "OrderItem" i WHERE i."orderId" = o.id),
        'packaging', (SELECT jsonb_agg(to_jsonb(p) ORDER BY p.id) FROM "OrderPackagingGroup" p WHERE p."orderId" = o.id),
        'packagingLines', (SELECT jsonb_agg(to_jsonb(p) ORDER BY p.id) FROM "OrderPackagingGroupLine" p WHERE p."orderId" = o.id),
        'shipping', (SELECT jsonb_agg(to_jsonb(s) - ARRAY['receiverName', 'receiverPhone', 'updatedAt'] ORDER BY s.id) FROM "OrderShipment" s WHERE s."orderId" = o.id),
        'allocations', (SELECT jsonb_agg(to_jsonb(l) ORDER BY l.id) FROM "OrderShipmentLine" l JOIN "OrderShipment" s ON s.id = l."shipmentId" WHERE s."orderId" = o.id),
        'charges', (SELECT jsonb_agg(to_jsonb(c) ORDER BY c.id) FROM "OrderCustomerCharge" c WHERE c."orderId" = o.id)
      ) AS facts,
      (SELECT jsonb_agg(to_jsonb(s) ORDER BY s.sequence) FROM "OrderShipment" s WHERE s."orderId" = o.id) AS shipments,
      (SELECT count(*)::int FROM "OrderLog" l WHERE l."orderId" = o.id AND l.action = 'UPDATE') AS "updateLogs"
      FROM "Order" o WHERE o.id = $1`,
      [id],
    );
    expect(rows).toHaveLength(1);
    return rows[0];
  } finally {
    await db.end();
  }
}

test.describe('创建工单 — golden path', () => {
  test('历史工单缺少计价明细时，纯交期申请审批保留全部原价', async ({
    page,
  }) => {
    test.setTimeout(90_000);
    test.skip(
      process.env.E2E_APPEND_ONLY_DATABASE_ISOLATED !== '1',
      '历史工单回归仅使用独立测试数据库',
    );
    const salesUserId = await getUserIdByUsername(E2E_USERS.sales.username);
    const { urgentOrderId: orderId } = await seedDashboardSnapshot({
      salesUserId,
    });
    // Only this invocation's fresh legacy fixture is changed. Its recorded
    // historical price intentionally cannot be rebuilt from missing line items.
    const db = new Client({ connectionString: process.env.DATABASE_URL });
    await db.connect();
    try {
      await db.query(
        `UPDATE "Order" SET "processingAmount" = 2800, "totalAmount" = 3000,
          "confirmedFee" = 3000 WHERE id = $1`,
        [orderId],
      );
    } finally {
      await db.end();
    }
    const before = await readSavedOrder(orderId);
    await login(page, {
      from: `/orders/${orderId}/edit`,
      username: owner.username,
      password: E2E_PASSWORD,
    });
    await page.getByLabel('承诺交期', { exact: true }).fill('2026-10-20');
    await page.getByRole('button', { name: '保存修改…', exact: true }).click();
    await expect(page.getByRole('alertdialog')).toBeVisible();
    expect((await readSavedOrder(orderId)).facts).toEqual(before.facts);
    await page.getByRole('button', { name: '保存修改', exact: true }).click();
    await expect
      .poll(async () => (await readSavedOrder(orderId)).order.promisedDate)
      .toContain('2026-10-20');
    const after = await readSavedOrder(orderId);
    expect(after.facts).toEqual(before.facts);
    expect(after.order.pricingStatus).toBe(before.order.pricingStatus);
    await expectNoNextErrorOverlay(page);
  });

  // 这条用例存在的具体理由：手动测试时这里炸了
  // PrismaClientKnownRequestError "Failed to deserialize column of
  // type 'void'" —— $queryRaw + pg_advisory_xact_lock 在 Prisma 7 不
  // 工作。776 个 mock 单测全没抓到。这个 E2E 是地基，确保 nextOrderNumber
  // 真正被 PG 调用过一次。
  test('ADMIN 创建 → 编辑 → 保存，保留款式、分货、包装及计价事实', async ({
    page,
    context,
  }) => {
    test.setTimeout(180_000);
    await login(page, {
      from: '/orders/new',
      username: owner.username,
      password: E2E_PASSWORD,
    });
    await expect(page).toHaveURL('/orders/new');

    const suffix = uniqueSuffix();
    const customName = `E2E 中秋礼盒 ${suffix}`;

    await page.getByRole('textbox', { name: '工单名称' }).fill(customName);
    // 业主 2026-09-24：管理员建单必须选择一个外部销售。
    const recipient = page.getByLabel('关联外部销售（必填）');
    await expect(recipient).toHaveValue('');
    await recipient.selectOption({ label: 'E2E 销售 · e2e-sales' });
    await expect(page.locator('input[name="customerRef"]')).toHaveCount(0);

    // 当前单页表单默认打开第一个款式。建单事实由三条
    // 计价路线 + 纸张 + 规格组成，不再把“报价产品”或人工金额
    // 暴露给建单端。所有选择都 scope 到对应 fieldset，避免同名
    // 工艺按钮造成假阳性。
    await openFirstOrderItemEditor(page);
    await page.getByLabel('包装补充说明（选填）').fill('创建时贴客户标签');
    const form = page.locator('[data-slot="order-form-b"]');
    const routes = form.getByRole('group', { name: '工单类型' });
    for (const route of ['局部烫金', '专版烫金', '彩印']) {
      await expect(
        routes.getByRole('button', { name: route, exact: true }),
      ).toBeVisible();
    }
    await routes.getByRole('button', { name: '局部烫金', exact: true }).click();
    await expect(
      routes.getByRole('button', { name: '局部烫金', exact: true }),
    ).toHaveAttribute('aria-pressed', 'true');

    const paper = form.getByRole('group', { name: '纸张材质' });
    await paper.getByRole('button', { name: '艳红珠光纸', exact: true }).click();
    await expect(
      paper.getByRole('button', { name: '艳红珠光纸', exact: true }),
    ).toHaveAttribute('aria-pressed', 'true');

    const specification = form.getByRole('group', { name: '规格' });
    await specification
      .getByRole('button', { name: '大号封', exact: true })
      .click();
    await expect(
      specification.getByRole('button', { name: '大号封', exact: true }),
    ).toHaveAttribute('aria-pressed', 'true');

    const weight = form.getByRole('group', { name: '克重' });
    await weight.getByRole('button', { name: '160g', exact: true }).click();
    await expect(
      weight.getByRole('button', { name: '160g', exact: true }),
    ).toHaveAttribute('aria-pressed', 'true');

    // 业主 2026-09-26：设计款名称由建单人填写，单款默认跟随工单名称，
    // 改克重等计价事实不再覆盖。
    await expect(
      form.getByRole('textbox', { name: '设计款名称', exact: true }),
    ).toHaveValue(customName);
    // B 版数量输入是受控组件，用可访问名称绑定用户行为，
    // 不再依赖旧面板的 input name 实现细节。
    await form
      .getByRole('spinbutton', { name: '数量', exact: true })
      .fill('1000');
    await form
      .getByRole('spinbutton', { name: '每包数量', exact: true })
      .fill('10');
    await expect(form.getByRole('combobox', { name: '报价产品' })).toHaveCount(
      0,
    );
    await expect(form.getByRole('textbox', { name: '成交单价' })).toHaveCount(
      0,
    );
    await expect(
      form.getByRole('textbox', { name: '人工改价说明' }),
    ).toHaveCount(0);

    // 新版单页直接展示收货区，不再通过旧的“收货与费用”步骤页签进入。
    await form
      .getByRole('textbox', { name: '收货地址', exact: true })
      .fill('E2E 收货人 13800138000 广东省佛山市南海区测试路 1 号');

    // 这条 golden path 故意保留“先存草稿”分支；资料完整时的
    // “创建并提交”是建单页的另一个明确动作。
    await page.getByRole('button', { name: '保存草稿', exact: true }).click();

    // 成功后会跳到 /orders/[id]。/orders/new 也匹配过宽 [a-z0-9]+
    // ——显式 negative lookahead 排除 new，否则即使提交失败留在
    // /orders/new 测试也会假绿（之前被坑过）。
    await page.waitForURL(/\/orders\/(?!new\b)[a-z0-9]+(\/|$)/, {
      timeout: 45_000,
    });
    // 单款设计款名称默认跟随工单名称（DECISIONS 2026-09-26），款式卡标题同名，只认页面主标题。
    await expect(page.getByRole('heading', { level: 1, name: customName, exact: true })).toBeVisible(routeTransitionOptions);
    await expectNoNextErrorOverlay(page);

    // 按当前详情页核对建单结果；款式信息直接展示，工单号按需展开。
    // The compact mobile header intentionally hides its duplicate metadata.
    const customerFact = page.locator('dt').filter({ hasText: /^客户名称\/简称$/ }).locator('..').locator('dd');
    await expect(customerFact).toHaveText('—');
    const itemDetails = page
      .locator('article[id^="order-detail-item-"]')
      .filter({ hasText: customName });
    await expect(itemDetails).toHaveCount(1);
    const itemFact = (label: string) =>
      itemDetails
        .locator('dt')
        .filter({ hasText: new RegExp(`^${label}$`) })
        .locator('..')
        .locator('dd');
    await expect(itemFact('工艺')).toContainText('局部烫金');
    await expect(itemFact('规格')).toHaveText('大号封90×165');
    await expect(itemFact('纸张')).toHaveText('160g艳红珠光纸');
    await page.getByText('工单信息', { exact: true }).click();
    await expect(page.getByText(/^GD-\d{6}-\d{3}$/).first()).toBeVisible();

    // 标签页标题里是工单号，不是 id 前 8 位。这是唯一能验证
    // generateMetadata 在真实 Next 运行时里真的查到了 orderNo 的地方 ——
    // 单测跑不到 metadata 那条路径。
    await expect(page).toHaveTitle(/^GD-\d{6}-\d{3} · 工单 · 长昆纸品有限公司$/);

    const orderId = new URL(page.url()).pathname.split('/')[2];
    // Give only this freshly created fixture existing optional facts. Editing
    // unrelated fields must never interpret omitted values as a request to clear them.
    const originalPromisedDate = '2026-10-15';
    const fixtureDb = new Client({ connectionString: process.env.DATABASE_URL });
    await fixtureDb.connect();
    try {
      await fixtureDb.query(
        `UPDATE "Order" SET "promisedDate" = $2::date, "isUrgent" = true WHERE id = $1`,
        [orderId, originalPromisedDate],
      );
    } finally {
      await fixtureDb.end();
    }
    const before = await readSavedOrder(orderId);
    expect(before.order.packageRequirement).toBe('创建时贴客户标签');
    // 代外部销售建的草稿与销售本人建单一样，报价在提交时由管理员确认。
    expect(before.order.pricingStatus).toBe('PENDING_ADMIN_CONFIRMATION');
    expect(before.order.promisedDate).toContain(originalPromisedDate);
    expect(before.order.isUrgent).toBe(true);
    await page.goto(`/orders/${orderId}/edit`);
    await expect(page.getByRole('textbox', { name: '工单名称', exact: true })).toHaveValue(
      customName,
    );
    await expect(page.getByLabel('客户名称/简称（选填）')).toHaveValue('');
    await expect(page.getByRole('textbox', { name: '收件人', exact: true })).toHaveValue(
      before.order.receiverName ?? '',
    );
    await expect(page.getByRole('textbox', { name: '收货电话', exact: true })).toHaveValue(
      before.order.receiverPhone ?? '',
    );
    await page.getByRole('button', { name: '更多生产信息', exact: true }).click();
    const productionDetails = page.getByRole('dialog', {
      name: '第 1 款生产信息',
      exact: true,
    });
    await expect(productionDetails).toBeVisible();
    await expect(productionDetails).toContainText('160g艳红珠光纸');
    await expect(productionDetails).toContainText('大号封90×165');
    await productionDetails
      .getByRole('button', { name: '关闭', exact: true })
      .click();
    await expect(productionDetails).not.toBeVisible();
    await expect(page.getByLabel('数量（个）', { exact: true })).toHaveValue(
      '1000',
    );

    // Two tabs share the same starting version. Only the first may save.
    const stalePage = await context.newPage();
    await stalePage.goto(`/orders/${orderId}/edit`);
    await expect(stalePage.getByRole('textbox', { name: '工单名称', exact: true })).toHaveValue(
      customName,
    );
    await page.getByLabel('包装补充说明（选填）').fill('封口后贴客户标签');
    await page.getByRole('textbox', { name: '收件人', exact: true }).fill('修改后的收件人');
    await page.getByRole('textbox', { name: '收货电话', exact: true }).fill('13900139000');
    await page.getByRole('button', { name: '保存修改…', exact: true }).click();
    await expect(page.getByRole('alertdialog')).toBeVisible();
    expect((await readSavedOrder(orderId)).facts).toEqual(before.facts);
    await page.getByRole('button', { name: '保存修改', exact: true }).click();
    await expect(page).toHaveURL(`/orders/${orderId}`, routeTransitionOptions);
    await expect(page.getByText(customName).first()).toBeVisible();
    const after = await readSavedOrder(orderId);
    expect(after.order.receiverName).toBe('修改后的收件人');
    expect(after.order.receiverPhone).toBe('13900139000');
    expect(after.order.packageRequirement).toBe('封口后贴客户标签');
    expect(after.order.promisedDate).toBe(before.order.promisedDate);
    expect(after.order.isUrgent).toBe(true);
    expect(after.shipments[0]).toMatchObject({
      receiverName: '修改后的收件人',
      receiverPhone: '13900139000',
    });
    expect(after.facts).toEqual(before.facts);
    expect(after.order.editVersion).toBeGreaterThan(before.order.editVersion);
    expect(after.updateLogs).toBe(before.updateLogs + 1);

    await stalePage.getByRole('textbox', { name: '收货电话', exact: true }).fill('13700137000');
    await stalePage
      .getByRole('button', { name: '保存修改…', exact: true })
      .click();
    await expect(
      stalePage.getByRole('alert').filter({ hasText: '工单已被其他人修改' }),
    ).toBeVisible();
    expect(await readSavedOrder(orderId)).toEqual(after);
    await stalePage.close();
    await page.goto(`/orders/${orderId}/edit`);
    await expect(page.getByRole('textbox', { name: '收货电话', exact: true })).toHaveValue(
      '13900139000',
    );
    await expectNoNextErrorOverlay(page);
    await expect(page.locator('#edit-items:visible')).toBeVisible();
    await page.screenshot({
      path: test.info().outputPath('edit-order.png'),
      fullPage: true,
    });

    // 代外部销售建的草稿改数量 / 规格：草稿尚无快递、耗材收费明细（提交时才权威
    // 生成），保存修改只重算加工费，不能因缺物流行被拒。
    await page.getByLabel('数量（个）', { exact: true }).fill('1200');
    await page.getByLabel('包装（个/包）', { exact: true }).fill('20');
    await page.getByRole('button', { name: '保存修改…', exact: true }).click();
    await expect(page.getByRole('alertdialog')).toBeVisible();
    expect((await readSavedOrder(orderId)).facts).toEqual(after.facts);
    await page.getByRole('button', { name: '再改改', exact: true }).click();
    expect((await readSavedOrder(orderId)).facts).toEqual(after.facts);
    await page.getByRole('button', { name: '保存修改…', exact: true }).click();
    await page.getByRole('button', { name: '保存修改', exact: true }).click();
    await expect(page).toHaveURL(`/orders/${orderId}`, routeTransitionOptions);
    const modified = await readSavedOrder(orderId);
    expect(modified.order.promisedDate).toBe(before.order.promisedDate);
    expect(modified.order.isUrgent).toBe(true);
    type DraftFacts = {
      items: Array<{ id: string; productId: string | null; sequence: number; specification: string;
        actualWidthMm: number; actualHeightMm: number; quantity: number; pack: number;
        pricingSnapshot: { complete: boolean } | null; subtotal: number; quotedAmount: number }>;
      packaging: Array<{ actualBagCount: number }>;
      packagingLines: Array<{ unitsPerBag: number }>;
      charges: Array<{ businessKey: string }> | null;
    };
    const modifiedFacts = modified.facts as DraftFacts;
    expect(modifiedFacts.items[0]).toMatchObject({ quantity: 1200, pack: 20 });
    expect(modifiedFacts.items[0].pricingSnapshot).toMatchObject({ complete: true });
    expect(modifiedFacts.items[0].quotedAmount).toBe(modifiedFacts.items[0].subtotal);
    expect(modifiedFacts.packaging[0].actualBagCount).toBe(60);
    expect(modifiedFacts.packagingLines[0].unitsPerBag).toBe(20);
    expect(modifiedFacts.charges ?? []).toEqual([]);

    // 规格 UPDATE 同样穿过真实预览 / 保存 / 数据库边界（空白封按文本计价，无产品 ID）。
    const large = modifiedFacts.items[0];
    expect(large.productId).toBeNull();
    await page.goto(`/orders/${orderId}/edit`);
    await page.getByLabel('规格', { exact: true }).selectOption({ label: '中号封80×115' });
    await page.getByRole('button', { name: '保存修改…', exact: true }).click();
    await expect(page.getByRole('alertdialog')).toContainText('中号封80×115');
    await page.getByRole('button', { name: '保存修改', exact: true }).click();
    await expect(page).toHaveURL(`/orders/${orderId}`, routeTransitionOptions);
    const respecified = await readSavedOrder(orderId);
    const mid = (respecified.facts as DraftFacts).items[0];
    expect(mid).toMatchObject({ productId: null, specification: '中号封80×115', actualWidthMm: 80, actualHeightMm: 115, quantity: 1200 });
    expect(Number(mid.quotedAmount)).toBeLessThan(Number(large.quotedAmount));
    expect((respecified.facts as DraftFacts).charges ?? []).toEqual([]);
    expect(respecified.order.status).toBe('DRAFT');

    // Date-only save preserves the saved production/financial snapshots.
    await page.goto(`/orders/${orderId}/edit`);
    await page.getByLabel('承诺交期', { exact: true }).fill('2026-10-20');
    await page.getByRole('button', { name: '保存修改…', exact: true }).click();
    await page.getByRole('button', { name: '保存修改', exact: true }).click();
    await expect(page).toHaveURL(`/orders/${orderId}`, routeTransitionOptions);
    await expect
      .poll(async () => (await readSavedOrder(orderId)).order.promisedDate)
      .toContain('2026-10-20');
    expect((await readSavedOrder(orderId)).facts).toEqual(respecified.facts);
    expect((await readSavedOrder(orderId)).order.isUrgent).toBe(true);
    await expectNoNextErrorOverlay(page);

    // 提交时才按最新价目簿权威生成快递 / 耗材两行并重算整单。隔离环境没有 OSS，
    // 用设计图夹具满足提交资料完整性（缺图拒绝由领域测试覆盖）。
    const designDb = new Client({ connectionString: process.env.DATABASE_URL });
    await designDb.connect();
    try {
      await designDb.query(`INSERT INTO "OrderItemDesign" (id,"orderItemId","fileType","fileUrl","fileName","fileSize","uploadedBy") SELECT $1,i.id,'IMAGE',$2,'fixture.png',68,o."createdById" FROM "OrderItem" i JOIN "Order" o ON o.id=i."orderId" WHERE o.id=$3`,
        [crypto.randomUUID(), 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aMioAAAAASUVORK5CYII=', orderId]);
    } finally { await designDb.end(); }
    await page.reload();
    await page.getByRole('button', { name: '提交工单', exact: true }).click();
    await page.getByRole('button', { name: '确认最新报价并提交', exact: true }).click();
    await expect
      .poll(async () => (await readSavedOrder(orderId)).order.status)
      .not.toBe('DRAFT');
    const submitted = await readSavedOrder(orderId);
    const submittedCharges = ((submitted.facts as DraftFacts).charges ?? []).map((charge) => charge.businessKey).sort();
    expect(submittedCharges).toEqual(expect.arrayContaining(['SHIPMENT:1:PACKING_MATERIAL', 'SHIPMENT:1:SHIPPING_FEE']));
    expect((submitted.facts as DraftFacts).items[0]).toMatchObject({ specification: '中号封80×115', quantity: 1200 });
    await expectNoNextErrorOverlay(page);
  });
});

test('纸张身份冲突只标记未估算，工单详情仍可读取', async ({ page, browser }) => {
  test.setTimeout(120_000);
  assertActivatedE2eDatabase();
  const salesUserId = await getUserIdByUsername(E2E_USERS.sales.username);
  const { urgentOrderId: orderId } = await seedDashboardSnapshot({ salesUserId });
  const db = new Client({ connectionString: process.env.DATABASE_URL });
  const duplicateId = `e2e-bom-conflict-${uniqueSuffix()}`;
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await db.connect();
  try {
    await db.query(`INSERT INTO "OrderItem" (id,"orderId",sequence,name,"pricingRoute",craft,"productStructure",
      specification,"actualWidthMm","actualHeightMm","paperType","paperWeightGsm",quantity,crafts,
      "foilColors","frontFoilColors","backFoilColors","foilTechnique","hasLocalFoil","updatedAt")
      VALUES ($1,$2,1,'用料冲突款','STOCK_BLANK','PARTIAL','STANDARD_ENVELOPE','中号封80×115',80,115,'160g珠光艳闪',160,1000,
      ARRAY[(SELECT id FROM "Craft" WHERE code='FLAT_FOIL_PARTIAL')],ARRAY['哑金'],ARRAY['哑金'],ARRAY[]::text[],'FLAT',true,NOW())`,
      [`${orderId}-bom-item`, orderId]);
    await db.query(`INSERT INTO "Material" (id,code,name,category,specification,unit,"isActive","updatedAt")
      VALUES ($1::text,$1::text,'160g珠光艳闪','PAPER','160g','张',false,NOW())`, [duplicateId]);
    await login(page, { from: `/orders/${orderId}`, username: owner.username, password: E2E_PASSWORD });
    const storageState = await page.context().storageState();
    for (const [width, height] of [[375, 667], [393, 852], [768, 1024], [1024, 768], [1280, 800], [1920, 1080]]) {
      const context = await browser.newContext({ storageState, viewport: { width, height }, hasTouch: width <= 768 });
      const ui = await context.newPage();
      ui.on('pageerror', (error) => errors.push(error.message));
      try {
        const response = await ui.goto(`/orders/${orderId}`);
        expect(response?.status()).toBe(200);
        const disclosure = ui.locator('summary:visible').filter({ hasText: /^生产、用料与计件记录$/ });
        const details = disclosure.locator('..');
        await expect(details).toHaveAttribute('open', '');
        if (width <= 768) {
          const box = await disclosure.boundingBox();
          expect(box?.width).toBeGreaterThanOrEqual(44);
          expect(box?.height).toBeGreaterThanOrEqual(44);
          await disclosure.tap();
          await expect(details).not.toHaveAttribute('open');
          await disclosure.tap();
        } else {
          await disclosure.focus();
          await disclosure.press('Enter');
          await expect(details).not.toHaveAttribute('open');
          await disclosure.press('Enter');
        }
        await expect(details).toHaveAttribute('open', '');
        const estimate = ui.locator('section:visible').filter({ has: ui.getByRole('heading', { name: '物料用量估算', exact: true }) }).last();
        await expect(estimate.getByText('空白封用料纸张身份重复，请先检查纸张资料', { exact: true }).first()).toBeVisible();
        await expect(estimate.getByText('未估算', { exact: true }).first()).toBeVisible();
        await expect(estimate.getByText('0 张', { exact: true })).toHaveCount(0);
        await estimate.evaluate((element) => element.setAttribute('data-e2e-bom-diagnostic', ''));
        for (const theme of ['light', 'dark']) {
          await ui.evaluate((value) => {
            document.documentElement.dataset.theme = value;
            document.documentElement.classList.toggle('dark', value === 'dark');
          }, theme);
          expect(await ui.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth + 1)).toBe(true);
          expect((await new AxeBuilder({ page: ui }).include('[data-e2e-bom-diagnostic]').analyze()).violations).toEqual([]);
          await estimate.screenshot({ path: test.info().outputPath(`bom-diagnostic-${width}-${theme}.png`) });
        }
      } finally { await context.close(); }
    }
    expect(errors).toEqual([]);
  } finally {
    await db.query('DELETE FROM "Material" WHERE id = $1', [duplicateId]);
    await db.end();
  }
});

test('管理员新增空白封正确提交目标规格，缺分袋资料仍拒绝写入', async ({ page }) => {
  test.setTimeout(60_000);
  assertActivatedE2eDatabase();
  const salesUserId = await getUserIdByUsername(E2E_USERS.sales.username);
  const orderId = `e2e-blank-add-${uniqueSuffix()}`;
  const db = new Client({ connectionString: process.env.DATABASE_URL });
  await db.connect();
  try {
    // The ADD flow intentionally accepts drafts without packaging groups only.
    // Seed that existing supported state; keep the original packaging golden path intact.
    await db.query(`INSERT INTO "Order" (id,"orderNo","submitterId","submitterRole","settlementType","createdById",status,"updatedAt")
      VALUES ($1,$1,$2,'SALES','EXTERNAL_SALES',$2,'DRAFT',NOW())`, [orderId, salesUserId]);
    await db.query(`INSERT INTO "OrderItem" (id,"orderId",sequence,name,"pricingRoute",craft,"productStructure",
      specification,"actualWidthMm","actualHeightMm","paperType","paperWeightGsm",quantity,pack,crafts,
      "foilColors","frontFoilColors","backFoilColors","foilTechnique","hasLocalFoil","updatedAt")
      VALUES ($1,$2,1,'原中号款','STOCK_BLANK','PARTIAL','STANDARD_ENVELOPE','中号封80×115',80,115,'180g红卡',180,1000,10,
      ARRAY[(SELECT id FROM "Craft" WHERE code='FLAT_FOIL_PARTIAL')],ARRAY['哑金'],ARRAY['哑金'],ARRAY[]::text[],'FLAT',true,NOW())`,
      [`${orderId}-item`, orderId]);
    await db.query(`INSERT INTO "OrderShipment" (id,"orderId",sequence,"receiverName","receiverPhone","receiverAddress","destinationProvince","weightKg","updatedAt")
      VALUES ($1,$2,1,'测试收货人','13800138000','广东省佛山市测试路1号','广东',1,NOW())`, [`${orderId}-shipment`, orderId]);
    await db.query(`INSERT INTO "OrderShipmentLine" (id,"shipmentId","orderItemId",quantity) VALUES ($1,$2,$3,1000)`,
      [`${orderId}-line`, `${orderId}-shipment`, `${orderId}-item`]);
    await login(page, { from: `/orders/${orderId}/edit`, username: owner.username, password: E2E_PASSWORD });
    await page.getByRole('button', { name: '新增款式（沿用第 1 款工艺和纸张）', exact: true }).click();
    await page.getByLabel('第 2 款名称', { exact: true }).fill('新增大号款');
    await page.getByLabel('规格', { exact: true }).nth(1).selectOption({ label: '大号封90×165' });
    const requests: string[] = [];
    page.on('request', (request) => {
      if (request.headers()['next-action']) requests.push(request.postData() ?? '');
    });
    await page.getByRole('button', { name: '保存修改…', exact: true }).click();
    await expect(page.getByRole('alert', { name: '未完成保存' })).toContainText('入袋每包组成未完整');
    expect(requests.some((body) => body.includes('targetBlankIdentity') && body.includes('大号封90×165'))).toBe(true);
    // Existing financial guard is intentional: no synthetic free packaging,
    // no silent template-size insertion, and no saved ADD without a complete quote.
    const items = (await db.query(`SELECT specification,quantity,"quotedAmount"::text
      FROM "OrderItem" WHERE "orderId"=$1 ORDER BY sequence`, [orderId])).rows;
    expect(items).toEqual([{ specification: '中号封80×115', quantity: 1000, quotedAmount: null }]);
    await expectNoNextErrorOverlay(page);
  } finally { await db.end(); }
});
