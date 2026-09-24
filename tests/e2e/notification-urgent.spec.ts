import { test, expect } from '@playwright/test';
import {
  login,
  uniqueSuffix,
  E2E_PASSWORD,
  E2E_USERS,
  seedNotificationWireFixture,
  readNotificationLogs,
  openFirstOrderItemEditor,
  selectExternalSalesForAdminOrder,
  submitDraftOrderAndWait,
  withDb,
} from './_helpers';

// P1 #2 Slice C — URGENT_ORDER wire smoke。
//
// production-flow.spec.ts 的主链路用的是非急单，所以 ORDER_SUBMITTED
// 单触发；急单这条路（SPEC §8.1：急单 → 排产群+管理员群，**两条事件
// 都触发**）需要单独一个工单 fixture：管理员代外部销售勾"急单"创建并提交 →
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

    const { channelId } = await seedNotificationWireFixture();

    await login(page, {
      from: '/orders/new',
      username: E2E_USERS.foreman.username,
      password: E2E_PASSWORD,
    });

    // 新版内部建单按三条计价路线 + 纸张 / 规格选项创建，不再暴露
    // 报价产品或人工金额输入；这里仍只关注急单通知的业务边界。
    await openFirstOrderItemEditor(page);
    // 业主 2026-09-24：管理员建单必须归属一个外部销售。
    await selectExternalSalesForAdminOrder(page);
    const form = page.locator('[data-slot="order-form-b"]');
    await form
      .getByRole('textbox', { name: '工单名称', exact: true })
      .fill(customName);
    // DECISIONS 2026-09-13：管理员建单页已无「客户名称/简称」输入框。
    await expect(
      form.getByRole('textbox', { name: '客户名称/简称', exact: true }),
    ).toHaveCount(0);
    const urgentCheckbox = form.getByRole('checkbox', {
      name: '急单（提交后会推送至排产群）',
      exact: true,
    });
    await expect(urgentCheckbox).not.toBeChecked();
    await urgentCheckbox.click();
    await expect(urgentCheckbox).toBeChecked();

    const routes = form.getByRole('group', { name: '工单类型' });
    await routes
      .getByRole('button', { name: '局部烫金', exact: true })
      .click();
    await form
      .getByRole('group', { name: '纸张材质' })
      .getByRole('button', { name: '艳红珠光纸', exact: true })
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
    // 外部销售工单提交前必须有设计图；上传链路另有测试，这里直接登记一张。
    await withDb((db) => db.query(
      `INSERT INTO "OrderItemDesign" (id,"orderItemId","fileType","fileUrl","fileName","fileSize","uploadedBy")
       SELECT $1||i.id,i.id,'IMAGE',$2,'fixture.png',68,o."createdById" FROM "OrderItem" i JOIN "Order" o ON o.id=i."orderId" WHERE o.id=$3`,
      [`${orderId}-design-`, 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aMioAAAAASUVORK5CYII=', orderId],
    ));
    await page.reload();

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
    // 托管的新单通知只携带管理工作台所需的安全摘要；急单语义由下面
    // 独立的 URGENT_ORDER 事件承载，避免在固定角色消息里重复扩散字段。
    expect(mineSubmitted[0]!.messageContent).toContain('新工单已提交');
    expect(mineSubmitted[0]!.messageContent).not.toContain('🚨 急单');

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
