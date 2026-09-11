import { test, expect } from '@playwright/test';
import {
  cleanupPrintableOrderStressFixture,
  E2E_PASSWORD,
  E2E_USERS,
  expectNoNextErrorOverlay,
  getUserIdByUsername,
  login,
  seedPrintableOrder,
} from './_helpers';

// Setting 表接线的端到端验证（DECISIONS 2026-08-19）。
//
// 这张表此前只有 seed 一个写入方、零个读取方，改了没有任何效果。这里跑通
// 的正是那条被打断的链路：在设置页改厂名 → 打印视图印出新厂名。
//
// 两条用例都用 finally 恢复设置；打印订单由当前测试准备并清理，
// 不依赖前序用例或日常开发数据。

const SETTINGS_PATH = '/owner/settings';
const owner = E2E_USERS.owner!;

async function openSettings(page: import('@playwright/test').Page) {
  await login(page, { username: owner.username, password: E2E_PASSWORD });
  await page.goto(SETTINGS_PATH);
  await expectNoNextErrorOverlay(page);
}

test.describe('系统设置', () => {
  test('厂名改动会落到打印视图上', async ({ page }) => {
    test.setTimeout(90_000);
    await openSettings(page);

    const factoryInput = page.locator('#factory_name');
    await expect(factoryInput).toBeVisible();
    const original = await factoryInput.inputValue();
    expect(original.length).toBeGreaterThan(0);

    const probe = `门禁厂名${Date.now().toString(36)}`;

    try {
      // The existing stress fixture has an explicit cleanup contract. Its
      // single-item order belongs to this test's E2E owner.
      const { orderId } = await seedPrintableOrder({
        submitterId: await getUserIdByUsername(owner.username),
        designCount: 1,
        variant: 'large-items',
        itemCount: 1,
        stressText: true,
      });
      await factoryInput.fill(probe);
      await page.getByRole('button', { name: /保存设置/ }).click();
      await expect(page.getByRole('status')).toContainText('已保存');

      // 重新加载：值确实落库了，而不是只活在这一次的 action 返回里
      await page.reload();
      await expect(page.locator('#factory_name')).toHaveValue(probe);

      await page.goto(`/print/orders/${orderId}`);
      await expectNoNextErrorOverlay(page);
      await expect(
        page.locator('.work-order-document .factory').first(),
      ).toHaveText(probe);
    } finally {
      try {
        await page.goto(SETTINGS_PATH);
        await page.locator('#factory_name').fill(original);
        await page.getByRole('button', { name: /保存设置/ }).click();
        await expect(page.getByRole('status')).toContainText('已保存');
      } finally {
        await cleanupPrintableOrderStressFixture();
      }
    }
  });

  test('非法输入被挡下：数字项靠原生约束，文本项靠服务端', async ({ page }) => {
    test.setTimeout(60_000);
    await openSettings(page);

    // ① 数字项：min/max 是原生 HTML 约束，浏览器直接拒绝提交。零 JS 下
    //    同样有效，所以这一层不需要（也拿不到）服务端的逐字段错误。
    const days = page.locator('#outsource_overdue_days');
    await days.fill('999');
    expect(
      await days.evaluate((el: HTMLInputElement) => el.validity.rangeOverflow),
    ).toBe(true);
    await days.fill('1');

    // ② 文本项：maxLength 只截断、空值不被原生拦下，只能由服务端挡。
    //    走的正是 aria-invalid + 逐字段错误的渲染路径。
    const factory = page.locator('#factory_name');
    const original = await factory.inputValue();

    try {
      await factory.fill('');
      await page.getByRole('button', { name: /保存设置/ }).click();

      await expect(factory).toHaveAttribute('aria-invalid', 'true');
      await expect(page.locator('#factory_name-error')).toContainText(
        '不能为空',
      );

      // 校验失败不能把任何一项写进去
      await page.reload();
      await expect(page.locator('#factory_name')).toHaveValue(original);
    } finally {
      await page.goto(SETTINGS_PATH);
      await page.locator('#factory_name').fill(original);
      await page.getByRole('button', { name: /保存设置/ }).click();
    }
  });
});
