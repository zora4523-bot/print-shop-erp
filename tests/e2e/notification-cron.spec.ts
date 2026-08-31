import { test, expect } from '@playwright/test';
import {
  E2E_USERS,
  getUserIdByUsername,
  seedNotificationWireFixture,
  seedOverdueOutsourceForCron,
  seedOrderOverdueForCron,
  seedEndingPeriodForCron,
  readNotificationLogs,
} from './_helpers';

// P1 #2 Slice D — cron 推送 E2E。两个**新**端点（OUTSOURCE_OVERDUE +
// CS_PERIOD_ENDING）走 fixture → POST → 断言 NotificationLog。既有的
// DAILY_WORKER_SALARY / CS_PERIOD_SETTLED 已由 unit test 全覆盖
// (app/api/cron/__tests__/notification-wire.test.ts)，需要真薪资数据
// 才能 E2E 触发，不重复投入。
//
// 401 / 503 路径单测覆盖；这里只跑 happy path Bearer 认证。
//
// CRON_SECRET 必须在 dev server 启动时已加载（.env）。Playwright
// reuse dev server 时如果 server 启动早于 .env 加 CRON_SECRET，需重启
// pnpm dev。

const CRON_SECRET = process.env.CRON_SECRET;

test.describe('cron notify wire', () => {
  test.skip(
    !CRON_SECRET,
    'CRON_SECRET 未在 .env 设置 → cron 路由会返 503，跳过 E2E',
  );

  test('/api/cron/outsource-overdue → OUTSOURCE_OVERDUE NotificationLog', async ({
    request,
  }) => {
    const { channelId } = await seedNotificationWireFixture();
    const { outsourceId } = await seedOverdueOutsourceForCron();

    const res = await request.post(
      '/api/cron/outsource-overdue',
      {
        headers: { authorization: `Bearer ${CRON_SECRET}` },
      },
    );
    expect(res.status()).toBe(200);
    const body = await res.json();
    expect(body.status).toBe('ok');
    expect(body.overdueCount).toBeGreaterThanOrEqual(1);

    // dispatchNotification 走 Next 16 after()——response 已发但 callback
    // 还在 runtime scope 里跑。用 expect.poll 等 NotificationLog 落库。
    await expect
      .poll(
        async () => {
          const logs = await readNotificationLogs({
            eventType: 'OUTSOURCE_OVERDUE',
            channelId,
          });
          // outsourceId 不会进 relatedOrderId（schema 没建）；用
          // messageContent 含 supplierName 来锁定本测试的行。
          return logs.filter((l) =>
            l.messageContent.includes('E2E cron 阿福外协'),
          ).length;
        },
        { timeout: 5_000, intervals: [200, 400, 800] },
      )
      .toBeGreaterThanOrEqual(1);

    const logs = await readNotificationLogs({
      eventType: 'OUTSOURCE_OVERDUE',
      channelId,
    });
    const mine = logs.filter((l) =>
      l.messageContent.includes('E2E cron 阿福外协'),
    );
    expect(mine).toHaveLength(1);
    expect(mine[0]!.status).toBe('SUCCESS');
    expect(mine[0]!.errorMessage).toBe('MOCK');
    expect(mine[0]!.messageContent).toContain('外协超期');
    // 防 raw {placeholder} 漏（round 102 同款）
    expect(mine[0]!.messageContent).not.toMatch(/\{[a-z]+\}/i);
    void outsourceId;
  });

  test('/api/cron/cs-period-ending → CS_PERIOD_ENDING NotificationLog', async ({
    request,
  }) => {
    const { channelId } = await seedNotificationWireFixture();
    const csUserId = await getUserIdByUsername(
      E2E_USERS.customerService.username,
    );
    const { periodId } = await seedEndingPeriodForCron({ csUserId });

    const res = await request.post(
      '/api/cron/cs-period-ending',
      {
        headers: { authorization: `Bearer ${CRON_SECRET}` },
      },
    );
    expect(res.status()).toBe(200);
    const body = await res.json();
    expect(body.status).toBe('ok');
    expect(body.endingCount).toBeGreaterThanOrEqual(1);

    // E2E_USERS.customerService.displayName 在 globalSetup 里固定是
    // 'E2E 客服'，可作为 log 行的 unique 锁定关键字。
    await expect
      .poll(
        async () => {
          const logs = await readNotificationLogs({
            eventType: 'CS_PERIOD_ENDING',
            channelId,
          });
          return logs.filter((l) =>
            l.messageContent.includes(E2E_USERS.customerService.displayName),
          ).length;
        },
        { timeout: 5_000, intervals: [200, 400, 800] },
      )
      .toBeGreaterThanOrEqual(1);

    const logs = await readNotificationLogs({
      eventType: 'CS_PERIOD_ENDING',
      channelId,
    });
    const mine = logs.filter((l) =>
      l.messageContent.includes(E2E_USERS.customerService.displayName),
    );
    expect(mine).toHaveLength(1);
    expect(mine[0]!.status).toBe('SUCCESS');
    expect(mine[0]!.messageContent).toContain('客服周期即将结束');
    // totalSales 100000 → 千分位 100,000.00（formatMoneyPlain）
    expect(mine[0]!.messageContent).toContain('100,000.00');
    expect(mine[0]!.messageContent).not.toMatch(/\{[a-z]+\}/i);
    void periodId;
  });

  test('/api/cron/order-overdue → ORDER_OVERDUE NotificationLog', async ({
    request,
  }) => {
    const { channelId } = await seedNotificationWireFixture();
    const { orderNo } = await seedOrderOverdueForCron();

    const res = await request.post(
      '/api/cron/order-overdue',
      {
        headers: { authorization: `Bearer ${CRON_SECRET}` },
      },
    );
    expect(res.status()).toBe(200);
    const body = await res.json();
    expect(body.status).toBe('ok');
    expect(body.overdueCount).toBeGreaterThanOrEqual(1);

    await expect
      .poll(
        async () => {
          const logs = await readNotificationLogs({
            eventType: 'ORDER_OVERDUE',
            channelId,
          });
          return logs.filter((l) => l.messageContent.includes(orderNo)).length;
        },
        { timeout: 5_000, intervals: [200, 400, 800] },
      )
      .toBeGreaterThanOrEqual(1);

    const logs = await readNotificationLogs({
      eventType: 'ORDER_OVERDUE',
      channelId,
    });
    const mine = logs.filter((l) => l.messageContent.includes(orderNo));
    expect(mine).toHaveLength(1);
    expect(mine[0]!.status).toBe('SUCCESS');
    expect(mine[0]!.messageContent).toContain('交期逾期');
    expect(mine[0]!.messageContent).toContain('已逾期：5 天');
    expect(mine[0]!.messageContent).toContain('生产中'); // 中文状态非裸枚举
    expect(mine[0]!.messageContent).not.toMatch(/\{[a-z]+\}/i);
  });
});
