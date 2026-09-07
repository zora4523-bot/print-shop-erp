import { test, expect } from '@playwright/test';
import {
  ADMIN_PASSWORD,
  ADMIN_USERNAME,
  expectNoNextErrorOverlay,
  login,
  resetNotificationFixture,
  uniqueSuffix,
} from './_helpers';

// 企业微信通知目标管理：兼容 Webhook 通道的真实页面回归。
//
// 真页面跑通：
//   1. /owner/notifications 显示 10 条 seeded rule + 0 条 channel
//   2. 创建一个 channel → 列表多 1 行
//   3. 系统设置中把新 channel 配给工厂确认人
//   4. ORDER_SUBMITTED rule 只编辑模板/开关，不可改写固定角色路由
//   5. 测试按钮（mock-mode）→ NotificationLog 写一条 __TEST__ SUCCESS
//   6. 删除被引用的 channel → 失败（带说明）
//   7. 从固定角色路由解绑，历史投递仍拒绝物理删除
//
// helper resetNotificationFixture() 先清掉所有 e2e_ channelKey 前缀
// 的 channel + 重置 ORDER_SUBMITTED / URGENT_ORDER 两条 rule 的状态，
// 避免上次 run 残留干扰。

test.describe.configure({ mode: 'serial' });

test.describe('owner notifications — admin UI', () => {
  test('ADMIN 配置 channel + rule + 测试 + 删除前置检查', async ({ page }) => {
    test.setTimeout(60_000);

    await resetNotificationFixture();

    // 用唯一 suffix 防 channelKey 跨 run 冲突（resetNotificationFixture
    // 已删 e2e_，但加 suffix 多一层 belt-and-suspenders）。
    const suffix = uniqueSuffix().replace(/-/g, '_');
    const channelKey = `e2e_${suffix}`;
    const channelName = `E2E 测试群 ${suffix.slice(0, 6)}`;

    await login(page, {
      from: '/owner/notifications',
      username: ADMIN_USERNAME,
      password: ADMIN_PASSWORD,
    });
    await expect(page).toHaveURL(/\/owner\/notifications($|\?)/);

    // ─── 1. 落地页结构 ───
    await expect(page.getByRole('heading', { name: '推送配置' })).toBeVisible();
    // dev mock-mode banner
    await expect(
      page.locator('[data-slot="notifications-mock-banner"]'),
    ).toBeVisible();
    // 列表使用业务名称，不暴露内部事件值。
    await expect(
      page.getByText('工单已提交', { exact: true }).first(),
    ).toBeVisible();
    await expect(
      page.getByText('师傅日薪汇总', { exact: true }).first(),
    ).toBeVisible();

    // ─── 2. 创建 channel ───
    await page
      .getByRole('heading', { name: '企业微信通知目标', exact: true })
      .locator('..')
      .getByRole('link', { name: '新建通知目标', exact: true })
      .click();
    await expect(page).toHaveURL(/\/owner\/notifications\/channels\/new/);

    await page.locator('#channelKey').fill(channelKey);
    await page.locator('#channelName').fill(channelName);
    // 新建默认是未绑定的智能机器人，不得误启用。此用例明确选择
    // Webhook 兼容路径，避免把历史默认值当成当前 UI 契约。
    const transport = page.getByRole('combobox', { name: '传输方式' });
    await expect(transport).toHaveValue('WECOM_SMART_BOT');
    const activeCheckbox = page.getByRole('checkbox', { name: '启用' });
    await expect(activeCheckbox).toBeDisabled();
    await transport.selectOption('WECOM_GROUP_WEBHOOK');
    await expect(activeCheckbox).toBeChecked();
    await page
      .locator('#webhookUrl')
      .fill(
        `https://qyapi.weixin.qq.com/cgi-bin/webhook/send?key=test-${suffix}`,
      );
    await page.getByRole('button', { name: '创建通知目标', exact: true }).click();

    await expect(page).toHaveURL(/\/owner\/notifications($|\?)/);
    await expect(page.locator(`text=${channelName}`).first()).toBeVisible();
    // webhook 显示走 mask（不该看到完整 key）
    await expect(
      page.locator(`text=https://qyapi.weixin.qq.com/cgi-bin/webhook/send`),
    ).toBeVisible();

    // ─── 3. 系统设置配置工厂确认人固定路由 ───
    await page.goto('/owner/settings');
    const factoryRoute = page.getByRole('region', {
      name: '工厂确认人通知路由',
    });
    await factoryRoute.getByLabel('角色开关').selectOption('true');
    await factoryRoute
      .getByRole('checkbox', { name: `工厂确认人：${channelName}` })
      .check();
    await page.getByRole('button', { name: '保存设置' }).click();
    await expect(page.getByRole('status')).toContainText('设置已保存');

    // ─── 4. 托管事件只编辑模板/开关 ───
    await page.goto('/owner/notifications');
    await page
      .locator('tr', { has: page.getByText('工单已提交', { exact: true }) })
      .getByRole('link', { name: '编辑' })
      .click();
    await expect(page).toHaveURL(
      /\/owner\/notifications\/rules\/ORDER_SUBMITTED/,
    );

    await expect(page.getByText('此事件固定路由到')).toBeVisible();
    await expect(page.getByRole('checkbox', { name: channelName })).toHaveCount(0);
    // 勾选&ldquo;启用此规则&rdquo;
    const ruleActiveCheckbox = page.getByRole('checkbox', {
      name: '启用此规则',
    });
    await ruleActiveCheckbox.click();
    await expect(ruleActiveCheckbox).toBeChecked();
    await page.getByRole('button', { name: '保存修改' }).click();

    await expect(page).toHaveURL(/\/owner\/notifications($|\?)/);
    // ORDER_SUBMITTED 行显示固定角色，而不是可编辑绑群数。
    const orderSubmittedRow = page.locator('tr', {
      has: page.getByText('工单已提交', { exact: true }),
    });
    await expect(orderSubmittedRow).toContainText('启用');
    await expect(orderSubmittedRow).toContainText('工厂确认人');

    // ─── 4. 测试按钮（mock-mode）触发 __TEST__ log ───
    await page
      .locator('tr', { has: page.locator(`text=${channelName}`) })
      .getByRole('button', { name: '测试' })
      .click();
    // 操作成功后页面会刷新；等“最近推送日志”表里出现测试记录。
    await expect(page.getByText('测试消息', { exact: true }).first()).toBeVisible({
      timeout: 5000,
    });

    // ─── 5. 删除 channel（被引用 → disabled / 提示） ───
    const channelRow = page
      .getByRole('region', { name: '企业微信通知目标列表' })
      .locator('tr', { hasText: channelName });
    const deleteBtn = channelRow.getByRole('button', { name: '删除' });
    await expect(deleteBtn).toBeDisabled();

    // ─── 6. 从固定角色路由解绑 → 删除按钮可点，但 FK 还会拦 ───
    await page.goto('/owner/settings');
    const factoryRouteAfter = page.getByRole('region', {
      name: '工厂确认人通知路由',
    });
    await factoryRouteAfter
      .getByRole('checkbox', { name: `工厂确认人：${channelName}` })
      .uncheck();
    await factoryRouteAfter.getByLabel('角色开关').selectOption('false');
    await page.getByRole('button', { name: '保存设置' }).click();
    await expect(page.getByRole('status')).toContainText('设置已保存');
    await page.goto('/owner/notifications');

    // 现在 button 不再 disabled（rule 引用已解除）
    const channelRowAfter = page
      .getByRole('region', { name: '企业微信通知目标列表' })
      .locator('tr', { hasText: channelName });
    const deleteBtn2 = channelRowAfter.getByRole('button', { name: '删除' });
    await expect(deleteBtn2).not.toBeDisabled();

    // 确认删除后，NotificationLog.__TEST__ 的外键会拒绝删除；
    // 错误以页面内 ActionNotice 呈现，不是浏览器原生 alert。
    await deleteBtn2.click();

    const deleteDialog = page.getByRole('alertdialog', {
      name: `删除“${channelName}”？`,
      exact: true,
    });
    await expect(deleteDialog).toBeVisible();
    await expect(
      deleteDialog.getByText('存在规则或历史投递记录时无法删除。', {
        exact: true,
      }),
    ).toBeVisible();
    await deleteDialog
      .getByRole('button', { name: '确认删除', exact: true })
      .click();

    const deleteError = channelRowAfter.getByRole('alert', {
      name: '删除失败',
      exact: true,
    });
    await expect(deleteError).toBeVisible();
    await expect(
      deleteError.getByText('该群有历史推送记录，无法删除。请改为停用。', {
        exact: true,
      }),
    ).toBeVisible();
    // 行仍在
    await expect(channelRowAfter).toBeVisible();

    await expectNoNextErrorOverlay(page);
  });
});
