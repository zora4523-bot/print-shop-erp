import { test, expect } from '@playwright/test';
import { Client } from 'pg';
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

async function readSavedOrder(id: string) {
  const db = new Client({ connectionString: process.env.DATABASE_URL });
  await db.connect();
  try {
    const { rows } = await db.query<{
      order: {
        editVersion: number;
        pricingStatus: string;
        promisedDate: string | null;
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
    await expect(page.getByRole('dialog')).toBeVisible();
    expect((await readSavedOrder(orderId)).facts).toEqual(before.facts);
    await page.getByRole('button', { name: '确认保存', exact: true }).click();
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
    const customerRef = `e2e-${suffix}`;
    const customName = `E2E 中秋礼盒 ${suffix}`;

    await page.getByRole('textbox', { name: '工单名称' }).fill(customName);
    await page.locator('input[name="customerRef"]').fill(customerRef);

    // 当前单页表单默认打开第一个款式。建单事实由三条
    // 计价路线 + 纸张 + 规格组成，不再把“报价产品”或人工金额
    // 暴露给建单端。所有选择都 scope 到对应 fieldset，避免同名
    // 工艺按钮造成假阳性。
    await openFirstOrderItemEditor(page);
    await page.getByLabel('包装补充说明（选填）').fill('创建时贴客户标签');
    const form = page.locator('[data-slot="order-form-b"]');
    const routes = form.getByRole('group', { name: '工艺类型' });
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
    await paper.getByRole('button', { name: '珠光艳闪', exact: true }).click();
    await expect(
      paper.getByRole('button', { name: '珠光艳闪', exact: true }),
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

    await form
      .getByRole('textbox', { name: '款式名', exact: true })
      .fill('E2E 测试款式');
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
    await page.waitForLoadState('networkidle');
    await expectNoNextErrorOverlay(page);

    // 详情页显示了我们刚填的 customerRef 和款式名 —— 工单确实落库了。
    // 等到 dd 元素带 customerRef 出现（Row 组件结构 <dt>客户名称/简称</dt><dd>...</dd>）。
    await expect(page.locator('dd', { hasText: customerRef })).toBeVisible({
      timeout: 10_000,
    });
    await expect(page.getByText('E2E 测试款式').first()).toBeVisible();
    await expect(page.getByText(customName).first()).toBeVisible();
    const itemDetails = page
      .locator('details')
      .filter({ hasText: 'E2E 测试款式' })
      .first();
    await itemDetails.locator('summary').click();
    await expect(itemDetails).toHaveAttribute('open', '');
    const itemFact = (label: string) =>
      itemDetails
        .locator('dt')
        .filter({ hasText: new RegExp(`^${label}$`) })
        .locator('..')
        .locator('dd');
    await expect(itemFact('计价路线')).toHaveText('局部烫金（通版现货）');
    await expect(itemFact('规格')).toHaveText('大号封90×165');
    await expect(itemFact('纸张')).toHaveText('160g珠光艳闪');
    await expect(itemFact('纸张克重')).toHaveText('160 g/㎡');
    await expect(page.getByText(/^GD-\d{6}-\d{3}$/).first()).toBeVisible();

    // 标签页标题里是工单号，不是 id 前 8 位。这是唯一能验证
    // generateMetadata 在真实 Next 运行时里真的查到了 orderNo 的地方 ——
    // 单测跑不到 metadata 那条路径。
    await expect(page).toHaveTitle(/^GD-\d{6}-\d{3} · 工单$/);

    const orderId = new URL(page.url()).pathname.split('/')[2];
    const before = await readSavedOrder(orderId);
    expect(before.order.packageRequirement).toBe('创建时贴客户标签');
    expect(before.order.pricingStatus).toBe('AUTO_CONFIRMED');
    await page.goto(`/orders/${orderId}/edit`);
    await expect(page.getByLabel('工单名称', { exact: true })).toHaveValue(
      customName,
    );
    await expect(page.getByLabel('客户名称/简称（选填）')).toHaveValue(
      customerRef,
    );
    await expect(page.getByLabel('收件人', { exact: true })).toHaveValue(
      before.order.receiverName ?? '',
    );
    await expect(page.getByLabel('收货电话', { exact: true })).toHaveValue(
      before.order.receiverPhone ?? '',
    );
    await page.getByText('更多生产信息', { exact: true }).click();
    await expect(page.locator('#edit-items')).toContainText('160g珠光艳闪');
    await expect(page.locator('#edit-items')).toContainText('大号封90×165');
    await expect(page.getByLabel('数量（个）', { exact: true })).toHaveValue(
      '1000',
    );

    // Two tabs share the same starting version. Only the first may save.
    const stalePage = await context.newPage();
    await stalePage.goto(`/orders/${orderId}/edit`);
    await expect(stalePage.getByLabel('工单名称', { exact: true })).toHaveValue(
      customName,
    );
    await page.getByLabel('包装补充说明（选填）').fill('封口后贴客户标签');
    await page.getByLabel('收件人', { exact: true }).fill('修改后的收件人');
    await page.getByLabel('收货电话', { exact: true }).fill('13900139000');
    await page.getByRole('button', { name: '保存修改…', exact: true }).click();
    await expect(page.getByRole('dialog')).toBeVisible();
    expect((await readSavedOrder(orderId)).facts).toEqual(before.facts);
    await page.getByRole('button', { name: '确认保存', exact: true }).click();
    await expect(page).toHaveURL(`/orders/${orderId}`);
    await expect(page.getByText(customName).first()).toBeVisible();
    const after = await readSavedOrder(orderId);
    expect(after.order.receiverName).toBe('修改后的收件人');
    expect(after.order.receiverPhone).toBe('13900139000');
    expect(after.order.packageRequirement).toBe('封口后贴客户标签');
    expect(after.shipments[0]).toMatchObject({
      receiverName: '修改后的收件人',
      receiverPhone: '13900139000',
    });
    expect(after.facts).toEqual(before.facts);
    expect(after.order.editVersion).toBeGreaterThan(before.order.editVersion);
    expect(after.updateLogs).toBe(before.updateLogs + 1);

    await stalePage.getByLabel('收货电话', { exact: true }).fill('13700137000');
    await stalePage
      .getByRole('button', { name: '保存修改…', exact: true })
      .click();
    await expect(
      stalePage.getByRole('alert').filter({ hasText: '工单已被其他人修改' }),
    ).toBeVisible();
    expect(await readSavedOrder(orderId)).toEqual(after);
    await stalePage.close();
    await page.goto(`/orders/${orderId}/edit`);
    await expect(page.getByLabel('收货电话', { exact: true })).toHaveValue(
      '13900139000',
    );
    await expectNoNextErrorOverlay(page);
    await expect(page.locator('#edit-items')).toBeVisible();
    await page.screenshot({
      path: test.info().outputPath('edit-order.png'),
      fullPage: true,
    });

    await page.getByLabel('数量（个）', { exact: true }).fill('1200');
    await page.getByLabel('包装（个/包）', { exact: true }).fill('20');
    await page.getByRole('button', { name: '保存修改…', exact: true }).click();
    await expect(page.getByRole('dialog')).toBeVisible();
    expect((await readSavedOrder(orderId)).facts).toEqual(after.facts);
    await page.getByRole('button', { name: '再改改', exact: true }).click();
    expect((await readSavedOrder(orderId)).facts).toEqual(after.facts);
    await page.getByRole('button', { name: '保存修改…', exact: true }).click();
    await page.getByRole('button', { name: '确认保存', exact: true }).click();
    await expect(page).toHaveURL(`/orders/${orderId}`);
    const modified = await readSavedOrder(orderId);
    const facts = modified.facts as {
      items: Array<{
        quantity: number;
        pack: number;
        pricingSnapshot: {
          version: number;
          schemaVersion: number;
          complete: boolean;
        };
        subtotal: number;
        quotedAmount: number;
      }>;
      packaging: Array<{ actualBagCount: number }>;
      packagingLines: Array<{ unitsPerBag: number }>;
    };
    expect(facts.items[0]).toMatchObject({ quantity: 1200, pack: 20 });
    expect(facts.items[0].pricingSnapshot).toMatchObject({
      version: 1,
      schemaVersion: 2,
      complete: true,
    });
    expect(facts.items[0].quotedAmount).toBe(facts.items[0].subtotal);
    expect(facts.packaging[0].actualBagCount).toBe(60);
    expect(facts.packagingLines[0].unitsPerBag).toBe(20);
    // Date-only save preserves the newly established production/financial snapshots.
    await page.goto(`/orders/${orderId}/edit`);
    await page.getByLabel('承诺交期', { exact: true }).fill('2026-10-20');
    await page.getByRole('button', { name: '保存修改…', exact: true }).click();
    await page.getByRole('button', { name: '确认保存', exact: true }).click();
    await expect(page).toHaveURL(`/orders/${orderId}`);
    await expect
      .poll(async () => (await readSavedOrder(orderId)).order.promisedDate)
      .toContain('2026-10-20');
    expect((await readSavedOrder(orderId)).facts).toEqual(modified.facts);
    await expectNoNextErrorOverlay(page);
  });
});
