import { test, expect } from '@playwright/test';
import { login, ADMIN_USERNAME, ADMIN_PASSWORD, expectNoNextErrorOverlay } from './_helpers';

test.describe('登录闸口', () => {
  test('未登录访问受保护页面 → 重定向到 /login', async ({ page }) => {
    await page.goto('/orders');
    await expect(page).toHaveURL(/\/login(\?|$)/);
  });

  test('seeded admin 能登录并落到首页', async ({ page }) => {
    await login(page);
    // Phase C（2026-05-06）/ 是按角色路由分发器，admin (ADMIN) 落到
    // /owner 而不是 /。允许任何 admin shell 路径（owner / orders /
    // foreman），登录成功后 URL 必须不是 /login。
    await expect(page).toHaveURL(/\/(owner|orders|foreman|sales)/);
    // 不写死 displayName 文案（seed 里是&ldquo;管理员&rdquo;，业主可能改）；
    // 用 AdminHeader 的 UserMenu trigger（aria-label 以&ldquo;用户菜单&rdquo;开头）
    // 作为已登录信号——每个 admin 页面都有。
    await expect(
      page.locator('button[aria-label^="用户菜单"]'),
    ).toBeVisible();
    await expectNoNextErrorOverlay(page);
  });

  test('错误密码保留用户名，修改密码后可直接重试登录', async ({ page }) => {
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
    await expect(page.locator('#username')).toHaveValue(ADMIN_USERNAME);
    await page.locator('#password').fill(ADMIN_PASSWORD);
    await page.locator('#password').press('Enter');
    await expect(page).toHaveURL(/\/(owner|orders|foreman|sales)/);
    await expectNoNextErrorOverlay(page);
  });

  test('主题按钮在脚本未就绪时禁用，就绪后首次点击可切换', async ({ page }) => {
    await login(page, { from: '/owner/agent-bills' });
    await page.setViewportSize({ width: 320, height: 900 });
    let releaseScripts!: () => void;
    const scriptsReady = new Promise<void>((resolve) => { releaseScripts = resolve; });
    await page.route('**/*', async (route) => {
      if (route.request().resourceType() === 'script') await scriptsReady;
      await route.continue();
    });
    try {
      // Real full navigation: HTML paints while JavaScript is still in flight.
      await page.goto('/owner/agent-bills', { waitUntil: 'commit' });
      const trigger = page.getByRole('button', { name: '切换界面主题', exact: true });
      await expect(trigger).toBeVisible();
      await expect(trigger).toBeDisabled();
      releaseScripts();
      await expect(trigger).toBeEnabled();
      await trigger.click();
      await page.getByRole('menuitemradio', { name: '暗色', exact: true }).click();
      await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
      await trigger.click();
      await page.keyboard.press('Escape');
      await expect(page.getByRole('menu')).toHaveCount(0);
      await expect(trigger).toBeFocused();
      await expectNoNextErrorOverlay(page);
    } finally {
      releaseScripts();
      await page.unrouteAll({ behavior: 'wait' });
    }
  });
});


test('水合前输入的用户名在失败提交后仍保留，修正密码可登录', async ({ page }) => {
  let releaseScripts!: () => void;
  const scriptsReady = new Promise<void>((resolve) => { releaseScripts = resolve; });
  await page.route('**/*', async (route) => {
    if (route.request().resourceType() === 'script') await scriptsReady;
    await route.continue();
  });
  try {
    await page.goto('/login', { waitUntil: 'commit' });
    await page.locator('#username').fill(ADMIN_USERNAME);
    await page.locator('#password').fill('wrong-password');
    releaseScripts();
    await page.waitForLoadState('networkidle');
    await page.getByRole('button', { name: '登录', exact: true }).click();
    await expect(page.getByRole('alert')).toBeVisible();
    await expect(page.locator('#username')).toHaveValue(ADMIN_USERNAME);
    await page.locator('#password').fill(ADMIN_PASSWORD);
    await page.locator('#password').press('Enter');
    await expect(page).toHaveURL(/\/(owner|orders|foreman|sales)/);
    await expectNoNextErrorOverlay(page);
  } finally {
    releaseScripts();
    await page.unrouteAll({ behavior: 'wait' });
  }
});
