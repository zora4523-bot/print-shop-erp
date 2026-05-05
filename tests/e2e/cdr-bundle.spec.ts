import { test, expect } from '@playwright/test';
import {
  E2E_PASSWORD,
  E2E_USERS,
  getUserIdByUsername,
  login,
  seedCdrOrder,
} from './_helpers';

// P0 #7 CDR 汇总下载 — golden path E2E。
//
// 走完整 foreman flow：登录 → /foreman/cdr → 看到当天 1 条 CDR 工单
// → 全选 → 生成下载包 → 看到成功提示 + downloadUrl + mock 警告（OSS
// 未配置时）。然后访问 downloadUrl，断言 503（mock-mode 下系统拒绝
// 真下载）。
//
// CRON_SECRET 用了同一份 .env；CDR 路由不需要 secret（24h cuid token
// + middleware 排除 api/cdr）。

test.describe('CDR 汇总下载 — golden path', () => {
  test('foreman 选 1 条 CDR 工单 → 生成 mock 下载包 → /api/cdr/bundles/[id] 返 503', async ({
    page,
    request,
  }) => {
    test.setTimeout(60_000);

    const salesUserId = await getUserIdByUsername(E2E_USERS.sales.username);
    const { orderId, orderNo } = await seedCdrOrder({
      submitterId: salesUserId,
      cdrCount: 2,
    });

    await login(page, {
      from: '/foreman/cdr',
      username: E2E_USERS.foreman.username,
      password: E2E_PASSWORD,
    });
    await expect(page).toHaveURL(/\/foreman\/cdr/);

    // 候选工单表里看到 seeded 工单（按 orderNo 锁定）
    await expect(page.getByText(orderNo)).toBeVisible({ timeout: 10_000 });

    // 全选已是默认（CreateBundleForm 初始 selected = all）
    // 提交"生成下载包"
    await page.getByRole('button', { name: /^生成下载包$/ }).click();

    // 成功提示 + downloadUrl 出现
    await expect(page.getByText(/已生成 \d+ 个 CDR 文件的下载包/)).toBeVisible({
      timeout: 10_000,
    });
    // OSS 未配置时显示 mock-mode 提示（页头 banner + 成功 banner 各一处，
    // 任一可见即可）
    await expect(page.getByText(/mock-mode|OSS 未配置/).first()).toBeVisible();

    // 抓 downloadUrl 文本（在 success banner 里）
    const downloadLink = page
      .locator('a[href^="/api/cdr/bundles/"]')
      .first();
    await expect(downloadLink).toBeVisible();
    const downloadUrl = await downloadLink.getAttribute('href');
    expect(downloadUrl).toMatch(/^\/api\/cdr\/bundles\/[a-z0-9]+$/);

    // 真去访问 downloadUrl —— mock-mode zipFileUrl 形如 mock://...，
    // 路由识别后返 503（不是 404，不是 redirect 到 mock://）。
    const res = await request.get(`http://localhost:3000${downloadUrl}`);
    expect(res.status()).toBe(503);
    const body = await res.json();
    expect(body.error).toMatch(/OSS 未配置/);

    // 不存在的 bundle id → 404
    const fake = await request.get(
      'http://localhost:3000/api/cdr/bundles/cknotrealid000000000000000',
    );
    expect(fake.status()).toBe(404);

    // session 未认证也能访问下载路由（middleware 已排除 api/cdr）
    // —— 这是 SPEC §3.5 设计意图：外协方拿链接直下，无登录态。
    void orderId;
  });
});
