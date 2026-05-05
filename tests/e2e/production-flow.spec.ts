import { test, expect } from '@playwright/test';
import {
  login,
  logout,
  uniqueSuffix,
  E2E_PASSWORD,
  E2E_USERS,
  ADMIN_USERNAME,
  ADMIN_PASSWORD,
  seedNotificationWireFixture,
  readNotificationLogs,
} from './_helpers';

// 这条测试的具体使命：把 SALES 创建 → 提交 → FOREMAN 排产 → WORKER
// 报工 → 工单级联 FINISHED 整条链 cover 一遍。所有 advisory lock 都
// 在这条链上：order submit / schedule / task begin / task report /
// order-cascade。HANDOFF 历史里 round 39 P0 race 就埋在 cascade 锁内
// fresh-read Order.status，没有 E2E 真实跑过那段就只能靠相信单测。
test.describe('生产流程 — golden path', () => {
  test('SALES create → submit, FOREMAN schedule, WORKER report → cascade COMPLETED → SHIP → FINISHED', async ({
    page,
  }) => {
    test.setTimeout(60_000); // 多角色切换 + 多次表单提交，给点余量

    const orderRef = `e2e-prod-${uniqueSuffix()}`;
    // 款式名也带 unique 后缀 —— /worker/tasks 列表里 link 不显示
    // customerRef，按款式名找最干净。
    const itemName = `E2E 款式 ${orderRef}`;
    let orderUrl = '';
    let orderId = '';

    // Slice C wire (P1 #2): 绑定 5 条状态机 rule 到一个 mock channel。
    // 跑完每一步生产链路后就读 NotificationLog，断言 wire 触发。
    // mock-mode（NODE_ENV !== production）下 notify 不真发 HTTP，但
    // 仍写 status=SUCCESS errorMessage='MOCK' 行——这就是 wire 的证据。
    const { channelId: notifyChannelId } = await seedNotificationWireFixture();

    await test.step('SALES 登录并创建工单', async () => {
      await login(page, {
        from: '/orders/new',
        username: E2E_USERS.sales.username,
        password: E2E_PASSWORD,
      });
      await page.locator('input[name="customerRef"]').fill(orderRef);
      await page.locator('input[name="items.0.name"]').fill(itemName);
      await page.locator('input[name="items.0.quantity"]').fill('1000');
      // &ldquo;现货加烫&rdquo; 是 seed 里 defaultMachineType=HAND_PRESS 的工艺，
      // 和我们的 e2e-worker-hand 师傅匹配 → 排产能选到。
      await page
        .locator('label')
        .filter({ hasText: '现货加烫' })
        .locator('input[type="checkbox"]')
        .check();
      await page.getByRole('button', { name: /创建工单/ }).click();
      await page.waitForURL(/\/orders\/(?!new\b)[a-z0-9]+(\/|$)/, {
        timeout: 10_000,
      });
      orderUrl = new URL(page.url()).pathname;
      // /orders/[id] → grab the id; /foreman/scheduling/[id] uses the
      // same id (it's the Order PK).
      orderId = orderUrl.split('/').filter(Boolean).pop() ?? '';
      expect(orderId).toMatch(/^[a-z0-9]+$/);
    });

    await test.step('SALES 提交工单 (DRAFT → PENDING_SCHEDULE)', async () => {
      await page.getByRole('button', { name: /^提交工单$/ }).click();
      // 提交后&ldquo;提交工单&rdquo;按钮消失（订单进入 PENDING_SCHEDULE）。
      await expect(
        page.getByRole('button', { name: /^提交工单$/ }),
      ).toHaveCount(0, { timeout: 10_000 });

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

    await test.step('FOREMAN 登录 → 直接到排产详情页', async () => {
      await logout(page);
      // 直接 deep-link 到这个工单的排产页：order id 我们刚捕获了，
      // /foreman/scheduling/[id] 用同一个 id。比按 customerRef 在
      // 列表里翻稳得多（列表 link text 是&ldquo;排产&rdquo;两字，customerRef
      // 在 td 里）。
      await login(page, {
        from: `/foreman/scheduling/${orderId}`,
        username: E2E_USERS.foreman.username,
        password: E2E_PASSWORD,
      });
      await page.waitForURL(`/foreman/scheduling/${orderId}`);

      // 排产表单第一行的 select（每个 item × craft 一行；这里只有一个）。
      // SchedulingForm 用原生 <select>，option label 形如&ldquo;{displayName}（机型，推荐）&rdquo;
      // —— Playwright 的 selectOption 只接受 label 精确匹配，所以先按
      // displayName 子串找到 option 再用其 value 选中。
      const select = page.locator('select').first();
      const workerOptionValue = await select
        .locator('option')
        .filter({ hasText: E2E_USERS.workerHandPress.displayName })
        .first()
        .getAttribute('value');
      expect(workerOptionValue).toBeTruthy();
      await select.selectOption(workerOptionValue as string);

      await page.getByRole('button', { name: /确认排产/ }).click();
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
      // /worker/tasks 列表里每个 Link 显示 {orderNo}, {item.name},
      // {craft.name} 等 —— 按 itemName 唯一识别我们这条任务。
      await page
        .getByRole('link')
        .filter({ hasText: itemName })
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

    await test.step('OWNER 视角验证工单 cascade 到 COMPLETED', async () => {
      await logout(page);
      await login(page, {
        from: orderUrl,
        username: ADMIN_USERNAME,
        password: ADMIN_PASSWORD,
      });
      // 详情页 status badge 应显示&ldquo;已完工&rdquo;（OrderStatus.FINISHED）。
      // 用工单详情页里 Row 渲染状态那一格 + customerRef 双重确认我们看的
      // 是同一个工单。
      // orderRef 在 customerRef row、item name、OrderLog 各出现一次
      // —— first() 避开 strict mode。
      await expect(page.getByText(orderRef).first()).toBeVisible();

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
    await test.step('OWNER 标记发货 (COMPLETED → SHIPPED)', async () => {
      // 还在 admin (orderUrl) 上；ShipOrderForm 在 COMPLETED 下渲染。
      // 填一个运单号 + 提交，验证 status badge 切到&ldquo;已发货&rdquo;。
      trackingNoForLog = `SF-${Date.now().toString(36)}`;
      await page.locator('input[name="trackingNo"]').fill(trackingNoForLog);
      await page.getByRole('button', { name: /^标记发货$/ }).click();
      await expect(
        page
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

    await test.step('OWNER 确认完工 (SHIPPED → FINISHED 终态)', async () => {
      // 发货后 FinishOrderButton 渲染；按一下走到 FINISHED。
      await page.getByRole('button', { name: /^确认完工$/ }).click();
      // 终态：badge =&ldquo;已完成&rdquo;（不是&ldquo;已完工&rdquo;）。这里精准断言别
      // 与 COMPLETED 混淆。
      await expect(
        page
          .locator('[data-slot="badge"]')
          .filter({ hasText: /^已完成$/ }),
      ).toBeVisible({ timeout: 10_000 });
      // 旧的&ldquo;已完工&rdquo;badge 消失。
      await expect(
        page
          .locator('[data-slot="badge"]')
          .filter({ hasText: /^已完工$/ }),
      ).toHaveCount(0);
    });
  });
});
