import { test, expect } from '@playwright/test';
import {
  login,
  logout,
  uniqueSuffix,
  E2E_PASSWORD,
  E2E_USERS,
  seedNotificationWireFixture,
  readNotificationLogs,
  fillExternalSalesOrderDraft,
  openFirstOrderItemEditor,
  seedE2eOrderDesign,
  submitDraftOrderAndWait,
} from './_helpers';

// 这条测试的具体使命：把 SALES 创建 → 提交 → ADMIN 排产 → WORKER
// 报工 → 工单级联 FINISHED 整条链 cover 一遍。所有 advisory lock 都
// 在这条链上：order submit / schedule / task begin / task report /
// order-cascade。HANDOFF 历史里 round 39 P0 race 就埋在 cascade 锁内
// fresh-read Order.status，没有 E2E 真实跑过那段就只能靠相信单测。
test.describe('生产流程 — golden path', () => {
  test('SALES create → submit, ADMIN schedule, WORKER report → cascade COMPLETED → SHIP → FINISHED', async ({
    page,
  }) => {
    test.setTimeout(60_000); // 多角色切换 + 多次表单提交，给点余量

    const customName = `E2E 生产全链路 ${uniqueSuffix()}`;
    let orderUrl = '';
    let orderId = '';
    let orderNo = '';
    let itemName = '';

    // Slice C wire (P1 #2): 绑定 5 条状态机 rule 到一个 mock channel。
    // 跑完每一步生产链路后就读 NotificationLog，断言 wire 触发。
    // mock-mode（NODE_ENV !== production）下 notify 不真发 HTTP，但
    // 仍写 status=SUCCESS errorMessage='MOCK' 行——这就是 wire 的证据。
    const { channelId: notifyChannelId } = await seedNotificationWireFixture();

    await test.step('SALES 通过可见提交入口创建工单草稿', async () => {
      await login(page, {
        from: '/orders/new',
        username: E2E_USERS.sales.username,
        password: E2E_PASSWORD,
      });
      await openFirstOrderItemEditor(page);
      await fillExternalSalesOrderDraft(page, {
        customName,
        quantity: 1000,
      });

      // 浏览器必须走 B 版真实可见的“创建并提交 → 提交前复核”入口。
      // CI 不访问真实 OSS：拦截预签后的 PUT，使表单停在可恢复的服务端
      // 草稿状态；随后用受控 DB fixture 登记同一张设计图，再从详情页
      // 完成提交。这样既覆盖 UI 主入口和上传尝试，也不会产生云端孤儿。
      await page.route('**/*', async (route) => {
        if (route.request().method() === 'PUT') {
          await route.fulfill({ status: 503, body: 'E2E upload blocked' });
          return;
        }
        await route.continue();
      });
      await page.getByLabel('第 1 款设计图', { exact: true }).setInputFiles({
        name: 'e2e-production-design.png',
        mimeType: 'image/png',
        buffer: Buffer.from(
          'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=',
          'base64',
        ),
      });
      await page
        .getByRole('button', {
          name: /^(创建并提交|提交并申请管理员终价)$/,
        })
        .click();
      await expect(
        page.getByRole('heading', { name: '提交前复核' }),
      ).toBeVisible();
      await page.getByRole('button', { name: '确认无误，提交' }).click();

      await expect(
        page
          .getByRole('dialog')
          .getByText(/草稿已创建，但有 1 个设计文件未上传/),
      ).toBeVisible({ timeout: 20_000 });
      const seeded = await seedE2eOrderDesign({
        expectedCustomName: customName,
      });
      orderId = seeded.orderId;
      orderNo = seeded.orderNo;
      itemName = seeded.itemName;
      orderUrl = `/orders/${orderId}`;
      expect(orderId).toMatch(/^[a-z0-9]+$/);
      await page.unroute('**/*');
    });

    await test.step('SALES 提交工单 (DRAFT → PENDING_SCHEDULE)', async () => {
      await page.goto(orderUrl);
      // Wait for the server-rendered status, not merely the pending button
      // label, so the assertion proves DRAFT → SUBMITTED committed.
      await submitDraftOrderAndWait(page);

      // Slice C 断言：ORDER_SUBMITTED 触发 → 1 条 NotificationLog。
      // 非急单 → URGENT_ORDER 不触发。relatedOrderId 锁定本测试的工单。
      // expect.poll 等 notify 真正写到 DB（button 消失到 log 落库间
      // 偶有 100-200ms gap，估值不稳，poll 才稳）。
      await expect
        .poll(
          async () => {
            const logs = await readNotificationLogs({
              eventType: 'ORDER_SUBMITTED',
              channelId: notifyChannelId,
            });
            return logs.filter((l) => l.relatedOrderId === orderId).length;
          },
          { timeout: 5_000, intervals: [200, 400, 800] },
        )
        .toBeGreaterThanOrEqual(1);
      const submittedLogs = await readNotificationLogs({
        eventType: 'ORDER_SUBMITTED',
        channelId: notifyChannelId,
      });
      const mine = submittedLogs.filter((l) => l.relatedOrderId === orderId);
      expect(mine).toHaveLength(1);
      expect(mine[0]!.status).toBe('SUCCESS');
      expect(mine[0]!.errorMessage).toBe('MOCK');
      expect(mine[0]!.messageContent).toContain('新工单提交');
      const urgentLogs = await readNotificationLogs({
        eventType: 'URGENT_ORDER',
        channelId: notifyChannelId,
      });
      expect(
        urgentLogs.filter((l) => l.relatedOrderId === orderId),
      ).toHaveLength(0);
    });

    await test.step('ADMIN 登录 → 直接到排产详情页', async () => {
      await logout(page);
      // 直接 deep-link 到这个工单的排产页：order id 我们刚捕获了，
      // /foreman/scheduling/[id] 使用同一个 order id；deep-link 不依赖
      // 列表排序或自动生成的款式名称。
      await login(page, {
        from: `/foreman/scheduling/${orderId}`,
        username: E2E_USERS.foreman.username,
        password: E2E_PASSWORD,
      });
      await page.waitForURL(`/foreman/scheduling/${orderId}`);

      // 通版现货在服务端统一归到“局部烫金”工艺，默认机型为手压机。
      // Select the compatible worker in that row before scheduling.
      const assignmentRow = page
        .getByRole('row')
        .filter({ hasText: itemName })
        .filter({ hasText: '局部烫金' });
      const handPressRadio = assignmentRow
        .getByRole('radio')
        .filter({ hasText: E2E_USERS.workerHandPress.displayName });
      await expect(handPressRadio).toHaveCount(1);
      await handPressRadio.click();
      await expect(handPressRadio).toHaveAttribute('aria-checked', 'true');

      const confirmScheduling = page.getByRole('button', { name: /确认排产/ });
      await expect(confirmScheduling).toBeEnabled();
      await confirmScheduling.click();
      // 排产成功有两条 navigation 在赛跑：(a) SchedulingForm 的
      // useEffect router.push('/orders/[id]')；(b) server revalidate
      // 后该 order 不再 PENDING_SCHEDULE，detail 页 redirect 回
      // /foreman/scheduling。哪条赢都说明排产 OK，等&ldquo;离开排产
      // 详情页&rdquo;就够了。
      await page.waitForURL(
        (url) =>
          !url.pathname.startsWith(`/foreman/scheduling/${orderId}`),
        { timeout: 10_000 },
      );

      // Slice C 断言：ORDER_SCHEDULED 触发。同前 poll 等真正落库。
      await expect
        .poll(
          async () => {
            const logs = await readNotificationLogs({
              eventType: 'ORDER_SCHEDULED',
              channelId: notifyChannelId,
            });
            return logs.filter((l) => l.relatedOrderId === orderId).length;
          },
          { timeout: 5_000, intervals: [200, 400, 800] },
        )
        .toBeGreaterThanOrEqual(1);
      const scheduledLogs = await readNotificationLogs({
        eventType: 'ORDER_SCHEDULED',
        channelId: notifyChannelId,
      });
      const mine = scheduledLogs.filter((l) => l.relatedOrderId === orderId);
      expect(mine).toHaveLength(1);
      expect(mine[0]!.status).toBe('SUCCESS');
      expect(mine[0]!.messageContent).toContain('工单已排产');
    });

    await test.step('WORKER 登录任务列表 → 进入任务详情', async () => {
      await logout(page);
      await login(page, {
        from: '/worker/tasks',
        username: E2E_USERS.workerHandPress.username,
        password: E2E_PASSWORD,
      });
      // /worker/tasks 列表显示工单号；它比自动生成的款式名更适合唯一定位。
      await page
        .getByRole('link')
        .filter({ hasText: orderNo })
        .first()
        .click();
      await page.waitForURL(/\/worker\/tasks\/[a-z0-9]+/);
    });

    await test.step('WORKER 开机 → 报工 (PENDING → IN_PROGRESS → COMPLETED)', async () => {
      await page.getByRole('button', { name: /开始生产/ }).click();
      // IN_PROGRESS 后报工表单出现。
      await expect(page.locator('input[name="completedQty"]')).toBeVisible({
        timeout: 10_000,
      });
      await page.locator('input[name="completedQty"]').fill('1000');
      await page.locator('input[name="defectQty"]').fill('0');
      await page.locator('input[name="reworkQty"]').fill('0');
      await page
        .getByRole('button', { name: /^完工报工$/ })
        .click();
      // 完工后页面 COMPLETED 段渲染 <h2>已完工</h2>。 strict mode 下
      // text=已完工 同时撞到 status badge 和 h2 两个元素，所以 scope
      // 到 heading。
      await expect(
        page.getByRole('heading', { name: '已完工' }),
      ).toBeVisible({ timeout: 10_000 });

      // Slice C 断言：reportTask cascade 把 Order → COMPLETED 后触发
      // ORDER_COMPLETED。
      await expect
        .poll(
          async () => {
            const logs = await readNotificationLogs({
              eventType: 'ORDER_COMPLETED',
              channelId: notifyChannelId,
            });
            return logs.filter((l) => l.relatedOrderId === orderId).length;
          },
          { timeout: 5_000, intervals: [200, 400, 800] },
        )
        .toBeGreaterThanOrEqual(1);
      const completedLogs = await readNotificationLogs({
        eventType: 'ORDER_COMPLETED',
        channelId: notifyChannelId,
      });
      const mine = completedLogs.filter((l) => l.relatedOrderId === orderId);
      expect(mine).toHaveLength(1);
      expect(mine[0]!.status).toBe('SUCCESS');
      expect(mine[0]!.messageContent).toContain('工单完工');
    });

    await test.step('ADMIN 视角验证工单 cascade 到 COMPLETED', async () => {
      await logout(page);
      await login(page, {
        from: orderUrl,
        // Keep the flow hermetic: globalSetup owns this ADMIN account and
        // refreshes its password every run. The operator's real admin account
        // may intentionally use different credentials.
        username: E2E_USERS.foreman.username,
        password: E2E_PASSWORD,
      });
      // 详情页 status badge 应显示&ldquo;已完工&rdquo;（OrderStatus.FINISHED）。
      // 用自定义工单名称与头部状态共同确认当前工单。
      await expect(page.getByText(customName).first()).toBeVisible();

      // 状态校验：cascade 应把 Order 从 IN_PRODUCTION 推到
      // OrderStatus.COMPLETED（&ldquo;已完工&rdquo;），HANDOFF round 39 fresh-
      // read race 就在这条路径上。
      //
      // 注意：FINISHED 才是 OrderStatus 的终态（&ldquo;已完成&rdquo;），由
      // SHIPPED → FINISHED 的发货流程到达，不在这条 E2E 范围内。
      // 不要写&ldquo;已完成&rdquo;断言或宽匹配 /^已完工$/，因为
      //   1) 这两个文本是不同状态（COMPLETED vs FINISHED），
      //   2) &ldquo;已完工&rdquo;同时出现在 OrderLog 的&ldquo;状态变更&rdquo;行里——
      //      cascade 没真触发也可能因 log 文本通过。
      // 用 OrderStatusBadge 渲染的 [data-slot=&ldquo;badge&rdquo;] + 文本完全
      // 等于&ldquo;已完工&rdquo;来精确锁定头部那个 status badge。
      const statusBadge = page
        .locator('[data-slot="badge"]')
        .filter({ hasText: /^已完工$/ });
      await expect(statusBadge).toHaveCount(1);
      await expect(statusBadge).toBeVisible();
    });

    let trackingNoForLog = '';
    await test.step('ADMIN 标记发货 (COMPLETED → SHIPPED)', async () => {
      // 还在 admin (orderUrl) 上；ShipOrderForm 在 COMPLETED 下渲染。
      // 填一个运单号 + 提交，验证 status badge 切到&ldquo;已发货&rdquo;。
      trackingNoForLog = `SF-${Date.now().toString(36)}`;
      await page
        .locator('input[name="shipmentTrackingNo"]')
        .fill(trackingNoForLog);
      // 顺丰到付没有可编辑计费重量；隐藏字段固定提交空值。
      await expect(
        page.locator('input[name="shipmentWeightKg"][type="hidden"]'),
      ).toHaveValue('');
      await page
        .getByRole('button', { name: /^确认 1 个地址已发货$/ })
        .click();
      const shipDialog = page.getByRole('alertdialog', {
        name: '确认 1 个地址已发货？',
      });
      await expect(shipDialog).toContainText('转为最终收费');
      await expect(shipDialog).toContainText('重算应收总额');
      await expect(shipDialog).toContainText('发货后仍需“确认完工”');
      await expect(shipDialog).toContainText('本次发货不会扣减库存');
      await shipDialog
        .getByRole('button', { name: '确认发货并重算应收', exact: true })
        .click();
      await expect(
        page
          .getByRole('heading', { level: 1 })
          .locator('[data-slot="badge"]')
          .filter({ hasText: /^已发货$/ }),
      ).toBeVisible({ timeout: 10_000 });

      // Slice C 断言：ORDER_SHIPPED 触发，messageContent 含真实
      // trackingNo（不是 raw `{trackingNo}`，回归 round 102 P1 wire 端）。
      await expect
        .poll(
          async () => {
            const logs = await readNotificationLogs({
              eventType: 'ORDER_SHIPPED',
              channelId: notifyChannelId,
            });
            return logs.filter((l) => l.relatedOrderId === orderId).length;
          },
          { timeout: 5_000, intervals: [200, 400, 800] },
        )
        .toBeGreaterThanOrEqual(1);
      const shippedLogs = await readNotificationLogs({
        eventType: 'ORDER_SHIPPED',
        channelId: notifyChannelId,
      });
      const mine = shippedLogs.filter((l) => l.relatedOrderId === orderId);
      expect(mine).toHaveLength(1);
      expect(mine[0]!.status).toBe('SUCCESS');
      expect(mine[0]!.messageContent).toContain(trackingNoForLog);
      // 防 future-edit 漏 null mapping：messageContent 永不能含 raw
      // `{trackingNo}` placeholder（render.ts 缺 key 留原样的设计）。
      expect(mine[0]!.messageContent).not.toContain('{trackingNo}');
    });

    await test.step('ADMIN 确认完工', async () => {
      // 发货后 FinishOrderButton 渲染；完成操作必须先经过 L2 影响确认。
      await page.getByRole('button', { name: /^确认完工$/ }).click();
      const finishDialog = page.getByRole('alertdialog');
      await expect(finishDialog).toContainText('确认后工单完成且不能恢复');
      await expect(finishDialog).toContainText('不再接受生产或发货操作');
      await expect(finishDialog).toContainText('历史金额、状态和操作记录仍会保留');
      await finishDialog
        .getByRole('button', { name: /^确认关闭并完成$/ })
        .click();
      // 终态：badge =&ldquo;已完成&rdquo;（不是&ldquo;已完工&rdquo;）。这里精准断言别
      // 与 COMPLETED 混淆。
      await expect(
        page
          .getByRole('heading', { level: 1 })
          .locator('[data-slot="badge"]')
          .filter({ hasText: /^已完成$/ }),
      ).toBeVisible({ timeout: 10_000 });
      // 旧的&ldquo;已完工&rdquo;badge 消失。
      await expect(
        page
          .getByRole('heading', { level: 1 })
          .locator('[data-slot="badge"]')
          .filter({ hasText: /^已完工$/ }),
      ).toHaveCount(0);
    });
  });
});
