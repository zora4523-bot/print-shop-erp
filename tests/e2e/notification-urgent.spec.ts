import { test, expect } from '@playwright/test';
import {
  login,
  uniqueSuffix,
  E2E_PASSWORD,
  E2E_USERS,
  seedNotificationWireFixture,
  readNotificationLogs,
  openFirstOrderItemEditor,
  submitDraftOrderAndWait,
} from './_helpers';

// P1 #2 Slice C — URGENT_ORDER wire smoke。
//
// production-flow.spec.ts 的主链路用的是非急单，所以 ORDER_SUBMITTED
// 单触发；急单这条路（SPEC §8.1：急单 → 排产群+管理员群，**两条事件
// 都触发**）需要单独一个内部工单 fixture：勾"急单"创建并提交 →
// 断言 NotificationLog 同时多 1 行 ORDER_SUBMITTED + 1 行 URGENT_ORDER。
//
// Mock-mode 下两条 log 都 status=SUCCESS errorMessage='MOCK'。
//
// 不重复 production-flow 的整链 —— 排产 / 报工 / 发货已在主 spec 覆盖。
test.describe('notification urgent wire — golden path', () => {
  test('ADMIN 创建急单 → 提交 → ORDER_SUBMITTED + URGENT_ORDER 两条 log', async ({
    page,
  }) => {
    test.setTimeout(90_000);

    const orderRef = `e2e-urgent-${uniqueSuffix()}`;
    const customName = `E2E 急单通知 ${orderRef}`;
    const itemName = `E2E 急单款 ${orderRef}`;

    const { channelId } = await seedNotificationWireFixture();

    await login(page, {
      from: '/orders/new',
      username: E2E_USERS.foreman.username,
      password: E2E_PASSWORD,
    });

    // 新版内部建单按三条计价路线 + 纸张 / 规格选项创建，不再暴露
    // 报价产品或人工金额输入；这里仍只关注急单通知的业务边界。
    await openFirstOrderItemEditor(page);
    const form = page.locator('[data-slot="order-form-b"]');
    await form
      .getByRole('textbox', { name: '工单名称', exact: true })
      .fill(customName);
    await form
      .getByRole('textbox', { name: '客户名称/简称', exact: true })
      .fill(orderRef);
    const urgentCheckbox = form.getByRole('checkbox', {
      name: '急单（提交后会推送至排产群）',
      exact: true,
    });
    await expect(urgentCheckbox).not.toBeChecked();
    await urgentCheckbox.click();
    await expect(urgentCheckbox).toBeChecked();

    const routes = form.getByRole('group', { name: '工艺类型' });
    await routes
      .getByRole('button', { name: '局部烫金', exact: true })
      .click();
    await form
      .getByRole('group', { name: '纸张材质' })
      .getByRole('button', { name: '珠光艳闪', exact: true })
      .click();
    await form
      .getByRole('group', { name: '规格' })
      .getByRole('button', { name: '大号封', exact: true })
      .click();
    await form
      .getByRole('group', { name: '克重' })
      .getByRole('button', { name: '160g', exact: true })
      .click();
    await form
      .getByRole('textbox', { name: '款式名', exact: true })
      .fill(itemName);
    await form
      .getByRole('spinbutton', { name: '数量', exact: true })
      .fill('1000');
    await form
      .getByRole('textbox', { name: '承诺交期' })
      .fill('2026-12-31');
    await form
      .getByRole('textbox', { name: '收货地址', exact: true })
      .fill('E2E 收货人 13800138000 广东省佛山市测试路 1 号');
    await expect(
      form.getByRole('combobox', { name: '报价产品' }),
    ).toHaveCount(0);
    await expect(
      form.getByRole('textbox', { name: '成交单价' }),
    ).toHaveCount(0);
    await form
      .getByRole('button', { name: '保存草稿', exact: true })
      .click();
    await page.waitForURL(/\/orders\/(?!new\b)[a-z0-9]+(\/|$)/, {
      timeout: 45_000,
    });
    const orderId = new URL(page.url()).pathname.split('/').filter(Boolean).pop()!;

    // 提交工单 → notify('ORDER_SUBMITTED') + notify('URGENT_ORDER') 都触发
    await submitDraftOrderAndWait(page);

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
