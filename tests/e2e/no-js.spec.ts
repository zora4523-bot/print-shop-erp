import { expect, test, type Page } from '@playwright/test';
import { E2E_PASSWORD, E2E_USERS } from './global-setup';
import { isolateE2eLoginClient } from './_login-client';

// 零 JS 降级门禁（DECISIONS.md 2026-08-17）。
//
// 这个 spec 跑在 javaScriptEnabled: false 的 project 下，是仓库里**唯一**
// 验证「未 hydration / JS 不可用时表单仍能提交」的地方。在它之前，这条
// 性质只靠三行代码注释被"相信"着，而实测 92 个 <form> 里有 19 处早已被
// `action={(fd) => startTransition(...)}` 静默破坏，CI 全绿 —— 因为没有
// 任何测试看着它。
//
// 覆盖范围**刻意只有三条路径**，即失败后用户无法自救的那些：
//   1. 登录   —— 进不去系统，且没有任何服务端渲染的备用入口
//   2. 登出   —— 点了不清 session（这正是 2026-04-22 Codex round 10
//                发现的那个真实缺陷，修复 commit e0070f6）
//   3. 改密码 —— 账号安全操作
// 其余后台 CRUD 表单**不在门禁内**：它们的失败模式是"慢网下点了没反应，
// 再点一次就好"，不值得为此付测试维护成本。详见 DECISIONS.md。
//
// 机制备忘：React 只在传给 useActionState 的函数本身是 Server Action 引用
// （带 $$FORM_ACTION，`.bind` 会保留）、且 `<form action={formAction}>` 直
// 接接收该引用时，才会在 SSR 输出里渲染原生 action + 隐藏的 $ACTION_ID。
// 一旦包成箭头函数，该属性当场归零。所以这三个页面的 form 形状是被本文件
// 锁住的契约，不是风格偏好。

const worker = E2E_USERS.workerHandPress!;

// 本地登录助手：不复用 _helpers.ts 的 login()，因为那个模块在导入时就会
// 求值 ADMIN_PASSWORD 并在缺环境变量时抛错，而这里只需要 e2e-* 固定账号。
async function loginWithoutJs(page: Page, username = worker.username): Promise<void> {
  await isolateE2eLoginClient(page);
  await page.goto('/login');
  await page.locator('#username').fill(username);
  await page.locator('#password').fill(E2E_PASSWORD);
  await page.getByRole('button', { name: /登录|登 录/ }).click();
  await page.waitForURL((url) => !url.pathname.startsWith('/login'), {
    timeout: 15_000,
  });
}

test.describe('零 JS 降级', () => {
  test('后台退出登录在 JS 不可用时仍能清除 session', async ({ page }) => {
    await loginWithoutJs(page, E2E_USERS.owner!.username);
    await page.goto('/orders');
    await page.getByRole('button', { name: '退出登录', exact: true }).click();
    await page.waitForURL((url) => url.pathname === '/login');
    await page.goto('/orders');
    expect(new URL(page.url()).pathname).toBe('/login');
  });
  test('登录表单在 JS 不可用时仍能提交并建立 session', async ({ page }) => {
    await loginWithoutJs(page);

    // 落到师傅端工作台即证明 session 已建立（layout 会把未登录请求
    // redirect 回 /login）。
    expect(new URL(page.url()).pathname).not.toMatch(/^\/login/);
    await expect(
      page.getByRole('link', { name: '师傅工作台' }),
    ).toBeVisible();
  });

  test('退出登录在 JS 不可用时仍能清除 session', async ({ page }) => {
    await loginWithoutJs(page);

    // 师傅端外壳里的 <noscript> 原生退出表单（页内那个在 streaming 边界里，零 JS 下出不来）。
    await page.getByRole('button', { name: '退出登录' }).click();
    await page.waitForURL((url) => url.pathname.startsWith('/login'), {
      timeout: 15_000,
    });

    // 真正清掉了 session：再访问受保护路由会被弹回 /login，而不是渲染出来。
    await page.goto('/worker/tasks');
    expect(new URL(page.url()).pathname).toMatch(/^\/login/);
  });

  test('改密码表单在 JS 不可用时仍能往返服务端校验', async ({ page }) => {
    await loginWithoutJs(page);
    await page.goto('/account/password');

    // 故意用错误的当前密码：证明表单确实 POST 到了 Server Action 并把
    // 服务端返回的字段错误渲染了回来，同时不改动任何 fixture 账号状态。
    await page.locator('#currentPassword').fill('definitely-not-the-password');
    await page.locator('#newPassword').fill('zero-js-probe-1234');
    await page.locator('#confirmPassword').fill('zero-js-probe-1234');
    await page.getByRole('button', { name: '更新密码' }).click();

    await expect(page.getByText('当前密码不正确')).toBeVisible({
      timeout: 15_000,
    });
  });
});
