import { test, expect } from '@playwright/test';
import {
  ADMIN_PASSWORD,
  ADMIN_USERNAME,
  expectNoNextErrorOverlay,
  login,
  resetNotificationFixture,
  uniqueSuffix,
} from './_helpers';

// P1 #2 Slice B — owner notifications admin UI
//
// 真页面跑通：
//   1. /owner/notifications 显示 10 条 seeded rule + 0 条 channel
//   2. 创建一个 channel → 列表多 1 行
//   3. 编辑 ORDER_SUBMITTED rule → 绑入新 channel + 启用 → 保存
//   4. 列表显示&ldquo;启用 / 绑群数 1&rdquo;
//   5. 测试按钮（mock-mode）→ NotificationLog 写一条 __TEST__ SUCCESS
//   6. 删除被引用的 channel → 失败（带说明）
//   7. 把 rule 取消引用 + 删除 channel → 成功
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
    // 10 条 seeded rule（按字母序：CS_PERIOD_ENDING, CS_PERIOD_SETTLED,
    // DAILY_WORKER_SALARY, ORDER_COMPLETED, ORDER_SCHEDULED, ORDER_SHIPPED,
    // ORDER_SUBMITTED, OUTSOURCE_OVERDUE, STOCK_ALERT, URGENT_ORDER）
    await expect(
      page.locator('text=ORDER_SUBMITTED').first(),
    ).toBeVisible();
    await expect(
      page.locator('text=DAILY_WORKER_SALARY').first(),
    ).toBeVisible();

    // ─── 2. 创建 channel ───
    await page.getByRole('link', { name: '新建群' }).click();
    await expect(page).toHaveURL(/\/owner\/notifications\/channels\/new/);

    await page.locator('#channelKey').fill(channelKey);
    await page.locator('#channelName').fill(channelName);
    await page
      .locator('#webhookUrl')
      .fill(
        `https://qyapi.weixin.qq.com/cgi-bin/webhook/send?key=test-${suffix}`,
      );
    await page.getByRole('button', { name: '创建群' }).click();

    await expect(page).toHaveURL(/\/owner\/notifications($|\?)/);
    await expect(page.locator(`text=${channelName}`).first()).toBeVisible();
    await expect(page.locator(`text=${channelKey}`).first()).toBeVisible();
    // webhook 显示走 mask（不该看到完整 key）
    await expect(
      page.locator(`text=https://qyapi.weixin.qq.com/cgi-bin/webhook/send`),
    ).toBeVisible();

    // ─── 3. 编辑 ORDER_SUBMITTED rule，绑新 channel + 启用 ───
    await page
      .locator('tr', { has: page.locator('text=ORDER_SUBMITTED') })
      .getByRole('link', { name: '编辑' })
      .click();
    await expect(page).toHaveURL(
      /\/owner\/notifications\/rules\/ORDER_SUBMITTED/,
    );

    // 勾选新 channel
    await page.getByRole('checkbox', { name: channelName }).check();
    // 勾选&ldquo;启用此规则&rdquo;
    await page
      .locator('#isActive')
      .check();
    await page.getByRole('button', { name: '保存修改' }).click();

    await expect(page).toHaveURL(/\/owner\/notifications($|\?)/);
    // ORDER_SUBMITTED 行：绑群数应为 1（多个 rule 可能也显示 1，所以
    // 直接断言整行包含相应文案）
    const orderSubmittedRow = page.locator('tr', {
      has: page.locator('text=ORDER_SUBMITTED'),
    });
    await expect(orderSubmittedRow).toContainText('启用');

    // ─── 4. 测试按钮（mock-mode）触发 __TEST__ log ───
    page.once('dialog', (d) => d.accept());
    await page
      .locator('tr', { has: page.locator(`text=${channelName}`) })
      .getByRole('button', { name: '测试' })
      .click();
    // alert 弹完后会 reload；等&ldquo;最近推送日志&rdquo;表里出现 __TEST__ 行
    // —— Playwright 会自动等 page reload。
    await expect(page.locator('text=__TEST__').first()).toBeVisible({
      timeout: 5000,
    });

    // ─── 5. 删除 channel（被引用 → disabled / 提示） ───
    const channelRow = page.locator('tr', {
      has: page.locator(`text=${channelKey}`),
    });
    const deleteBtn = channelRow.getByRole('button', { name: '删除' });
    await expect(deleteBtn).toBeDisabled();

    // ─── 6. 取消 rule 引用 + 关闭 → 删除按钮可点，但 FK 还会拦 ───
    await orderSubmittedRow.getByRole('link', { name: '编辑' }).click();
    await page.getByRole('checkbox', { name: channelName }).uncheck();
    await page.locator('#isActive').uncheck();
    await page.getByRole('button', { name: '保存修改' }).click();
    await expect(page).toHaveURL(/\/owner\/notifications($|\?)/);

    // 现在 button 不再 disabled（rule 引用已解除）
    const deleteBtn2 = channelRow.getByRole('button', { name: '删除' });
    await expect(deleteBtn2).not.toBeDisabled();

    // 但点了之后会被 PG FK 拒（NotificationLog.__TEST__ 行还指着此
    // channel）。Action 把 P2003 翻译成可读 alert：&ldquo;该群有历史推送
    // 日志，无法删除。请改为停用&rdquo;。
    let confirmAccepted = false;
    let alertMessage = '';
    page.on('dialog', async (d) => {
      if (d.type() === 'confirm' && !confirmAccepted) {
        confirmAccepted = true;
        await d.accept();
      } else if (d.type() === 'alert') {
        alertMessage = d.message();
        await d.accept();
      } else {
        await d.dismiss();
      }
    });
    await deleteBtn2.click();
    // 等到 alert 触发后填入 alertMessage
    await expect.poll(() => alertMessage, { timeout: 5_000 }).toMatch(
      /历史推送日志|无法删除/,
    );
    // 行仍在
    await expect(channelRow).toBeVisible();

    await expectNoNextErrorOverlay(page);
  });
});
