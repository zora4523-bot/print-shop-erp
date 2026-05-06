import { test, expect } from '@playwright/test';
import { login, ADMIN_USERNAME, expectNoNextErrorOverlay } from './_helpers';

test.describe('登录闸口', () => {
  test('未登录访问受保护页面 → 重定向到 /login', async ({ page }) => {
    await page.goto('/orders');
    await expect(page).toHaveURL(/\/login(\?|$)/);
  });

  test('seeded admin 能登录并落到首页', async ({ page }) => {
    await login(page);
    // Phase C（2026-05-06）/ 是按角色路由分发器，admin (OWNER) 落到
    // /owner 而不是 /。允许任何 admin shell 路径（owner / orders /
    // foreman），登录成功后 URL 必须不是 /login。
    await expect(page).toHaveURL(/\/(owner|orders|foreman|sales)/);
    // 不写死 displayName 文案（seed 里是&ldquo;老板&rdquo;，业主可能改）；
    // 用 AdminHeader 的 UserMenu trigger（aria-label 以&ldquo;用户菜单&rdquo;开头）
    // 作为已登录信号——每个 admin 页面都有。
    await expect(
      page.locator('button[aria-label^="用户菜单"]'),
    ).toBeVisible();
    await expectNoNextErrorOverlay(page);
  });

  test('错误密码留在 /login 并显示错误', async ({ page }) => {
    await page.goto('/login');
    await page.locator('#username').fill(ADMIN_USERNAME);
    await page.locator('#password').fill('wrong-password');
    await page.getByRole('button', { name: /登录|登 录/ }).click();
    // 断言「实际有错误返回」 —— LoginForm 在 generalError 时渲染
    // <p role="alert">. 之前只断 URL 还在 /login，但 URL 在 submit
    // 之前就是 /login，按钮坏掉 / 校验拦截 / action 抛错都会假绿
    // (Codex round 73 / P2)。
    await expect(page.getByRole('alert')).toBeVisible({ timeout: 5_000 });
    await expect(page).toHaveURL(/\/login/);
  });
});
