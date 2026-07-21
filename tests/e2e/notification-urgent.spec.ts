import { test, expect } from '@playwright/test';
import {
  login,
  uniqueSuffix,
  E2E_PASSWORD,
  E2E_USERS,
  seedNotificationWireFixture,
  readNotificationLogs,
} from './_helpers';

// P1 #2 Slice C — URGENT_ORDER wire smoke。
//
// production-flow.spec.ts 的主链路用的是非急单，所以 ORDER_SUBMITTED
// 单触发；急单这条路（SPEC §8.1：急单 → 排产群+管理员群，**两条事件
// 都触发**）需要单独一个 fixture：勾"急单"复选框创建工单 → 提交 →
// 断言 NotificationLog 同时多 1 行 ORDER_SUBMITTED + 1 行 URGENT_ORDER。
//
// Mock-mode 下两条 log 都 status=SUCCESS errorMessage='MOCK'。
//
// 不重复 production-flow 的整链 —— 排产 / 报工 / 发货已在主 spec 覆盖。
test.describe('notification urgent wire — golden path', () => {
  test('SALES 创建急单 → 提交 → ORDER_SUBMITTED + URGENT_ORDER 两条 log', async ({
    page,
  }) => {
    test.setTimeout(60_000);

    const orderRef = `e2e-urgent-${uniqueSuffix()}`;
    const itemName = `E2E 急单款 ${orderRef}`;

    const { channelId } = await seedNotificationWireFixture();

    await login(page, {
      from: '/orders/new',
      username: E2E_USERS.sales.username,
      password: E2E_PASSWORD,
    });

    // 创建工单 + 勾"急单"复选框
    await page.locator('input[name="customerRef"]').fill(orderRef);
    await page.locator('input[name="items.0.name"]').fill(itemName);
    await page.locator('input[name="items.0.quantity"]').fill('1000');
    await page
      .locator('label')
      .filter({ hasText: '现货加烫' })
      .locator('input[type="checkbox"]')
      .check();
    // 急单复选框 (CreateOrderForm name="isUrgent")
    await page.locator('input[name="isUrgent"]').check();
    await page.getByRole('button', { name: /创建工单/ }).click();
    await page.waitForURL(/\/orders\/(?!new\b)[a-z0-9]+(\/|$)/, {
      timeout: 10_000,
    });
    const orderId = new URL(page.url()).pathname.split('/').filter(Boolean).pop()!;

    // 提交工单 → notify('ORDER_SUBMITTED') + notify('URGENT_ORDER') 都触发
    await page.getByRole('button', { name: /^提交工单$/ }).click();
    await expect(
      page.getByRole('button', { name: /^提交工单$/ }),
    ).toHaveCount(0, { timeout: 10_000 });

    // 等待 notify 真正写入 NotificationLog —— Server Action 完成 +
    // revalidatePath 触发的 fetch 都跑完。expect.poll 比 waitForTimeout
    // 稳：估值容易偶尔不够。
    await expect
      .poll(
        async () => {
          const [submitted, urgent] = await Promise.all([
            readNotificationLogs({
              eventType: 'ORDER_SUBMITTED',
              channelId,
            }),
            readNotificationLogs({
              eventType: 'URGENT_ORDER',
              channelId,
            }),
          ]);
          const mineS = submitted.filter((l) => l.relatedOrderId === orderId);
          const mineU = urgent.filter((l) => l.relatedOrderId === orderId);
          return mineS.length + mineU.length;
        },
        { timeout: 5_000, intervals: [200, 400, 800] },
      )
      .toBeGreaterThanOrEqual(2);

    // 断言：ORDER_SUBMITTED 1 条 + URGENT_ORDER 1 条，都关联本 orderId。
    const submittedLogs = await readNotificationLogs({
      eventType: 'ORDER_SUBMITTED',
      channelId,
    });
    const mineSubmitted = submittedLogs.filter(
      (l) => l.relatedOrderId === orderId,
    );
    expect(mineSubmitted).toHaveLength(1);
    expect(mineSubmitted[0]!.status).toBe('SUCCESS');
    // 急单标记落到 messageContent（template 含 {urgentMark}）
    expect(mineSubmitted[0]!.messageContent).toContain('🚨 急单');

    const urgentLogs = await readNotificationLogs({
      eventType: 'URGENT_ORDER',
      channelId,
    });
    const mineUrgent = urgentLogs.filter((l) => l.relatedOrderId === orderId);
    expect(mineUrgent).toHaveLength(1);
    expect(mineUrgent[0]!.status).toBe('SUCCESS');
    expect(mineUrgent[0]!.messageContent).toContain('急单提醒');
    // 防 placeholder 漏：messageContent 不含 raw `{...}` 字面量。
    expect(mineUrgent[0]!.messageContent).not.toMatch(/\{[a-z]+\}/i);
    expect(mineSubmitted[0]!.messageContent).not.toMatch(/\{[a-z]+\}/i);
  });
});
