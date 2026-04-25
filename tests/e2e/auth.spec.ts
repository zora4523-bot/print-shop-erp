import { test, expect } from '@playwright/test';
import { login, ADMIN_USERNAME, expectNoNextErrorOverlay } from './_helpers';

test.describe('登录闸口', () => {
  test('未登录访问受保护页面 → 重定向到 /login', async ({ page }) => {
    await page.goto('/orders');
    await expect(page).toHaveURL(/\/login(\?|$)/);
  });

  test('admin / admin@2026 能登录并落到首页', async ({ page }) => {
    await login(page);
    await expect(page).toHaveURL('/');
    // 不写死 displayName 文案（seed 里是&ldquo;老板&rdquo;，业主可能改）；
    // 用&ldquo;退出登录&rdquo;按钮的存在作为已登录信号 —— 这个按钮在 layout
    // 头部，每个登录态页面都有。
    await expect(page.getByRole('button', { name: /退出登录/ })).toBeVisible();
    await expectNoNextErrorOverlay(page);
  });

  test('错误密码留在 /login 并显示错误', async ({ page }) => {
    await page.goto('/login');
    await page.locator('#username').fill(ADMIN_USERNAME);
    await page.locator('#password').fill('wrong-password');
    await page.getByRole('button', { name: /登录|登 录/ }).click();
    // 给后端一点时间返回错误，但不能离开 /login。
    await page.waitForTimeout(500);
    await expect(page).toHaveURL(/\/login/);
  });
});
