import { test, expect } from '@playwright/test';
import { expectNoNextErrorOverlay, login } from './_helpers';

// Setting 表接线的端到端验证（DECISIONS 2026-08-19）。
//
// 这张表此前只有 seed 一个写入方、零个读取方，改了没有任何效果。这里跑通
// 的正是那条被打断的链路：在设置页改厂名 → 打印视图印出新厂名。
//
// 两条用例都用 finally 把值改回去，避免污染共享 dev 库的后续用例（尤其是
// 截图门禁，厂名会印在打印基线上）。

const SETTINGS_PATH = '/owner/settings';

// login() 内部的 waitForURL 只有 10s，用 `from=` 会把目标页首次编译算进去，
// dev server 冷启动必超时。先登录到 `/` 再 goto（默认导航超时更宽）。
async function openSettings(page: import('@playwright/test').Page) {
  await login(page);
  await page.goto(SETTINGS_PATH);
  await expectNoNextErrorOverlay(page);
}

test.describe('系统设置', () => {
  test('厂名改动会落到打印视图上', async ({ page }) => {
    // 依次触达 /owner/settings、/orders、/print/orders/[id] 三条路由，
    // dev server 首次访问都要编译。
    test.setTimeout(90_000);
    await openSettings(page);

    const factoryInput = page.locator('#factory_name');
    await expect(factoryInput).toBeVisible();
    const original = await factoryInput.inputValue();
    expect(original.length).toBeGreaterThan(0);

    const probe = `门禁厂名${Date.now().toString(36)}`;

    try {
      await factoryInput.fill(probe);
      await page.getByRole('button', { name: /保存设置/ }).click();
      await expect(page.getByRole('status')).toContainText('已保存');

      // 重新加载：值确实落库了，而不是只活在这一次的 action 返回里
      await page.reload();
      await expect(page.locator('#factory_name')).toHaveValue(probe);

      // 真正的目标：打印视图现在印的是配置值。挑一张已有工单即可。
      await page.goto('/orders');
      const orderHrefs = await page
        .locator('a[href^="/orders/"]')
        .evaluateAll((links) =>
          links
            .map((a) => a.getAttribute('href') ?? '')
            // /orders/new 和 /orders/<id>/edit 也以 /orders/ 开头
            .filter((h) => /^\/orders\/[^/]+$/.test(h) && h !== '/orders/new'),
        );
      test.skip(orderHrefs.length === 0, '开发库里没有工单，跳过打印视图断言');

      await page.goto(`/print${orderHrefs[0]}`);
      await expect(page.locator('.factory-name').first()).toHaveText(probe);
    } finally {
      // 无论断言是否失败都还原，别把探针厂名留给后面的截图门禁
      await page.goto(SETTINGS_PATH);
      await page.locator('#factory_name').fill(original);
      await page.getByRole('button', { name: /保存设置/ }).click();
      await expect(page.getByRole('status')).toContainText('已保存');
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
