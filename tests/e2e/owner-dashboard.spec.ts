import { test, expect } from '@playwright/test';
import {
  ADMIN_PASSWORD,
  ADMIN_USERNAME,
  E2E_USERS,
  expectNoNextErrorOverlay,
  getUserIdByUsername,
  login,
  seedDashboardSnapshot,
} from './_helpers';

// P1 #1 Slice A — owner dashboard KPIs
//
// 单测覆盖 lib/dashboard/owner-stats 的算术 + 边界，但 Server Component
// + permission gate + sidebar wire 这条链只能跑真页面才知道：
//   - /owner 实际渲染（OwnerLayout 把 OWNER 放进去 → page.tsx
//     requirePermission('report:all') → owner-stats.ts 走真 DB → 4 张
//     StatCard 渲染）
//   - 数字按千分位（formatMoney 走 Intl.NumberFormat zh-CN）
//   - sidebar Dashboard 链接指向 /owner（不再是 # 占位 — admin-menu
//     单测同一断言）
//
// 数据由 seedDashboardSnapshot 直接写入：3 提交 (1 急) / 2 完工 / 1
// 发货 / 1 张当月 5000.00-2000.00 账单。helper 会先清掉所有 e2e-*
// 用户的 Order + Bill，避免上一次 run / 平行 spec 的数据膨胀计数。

test.describe('owner dashboard — KPI 卡片层', () => {
  test('OWNER /owner 渲染 4 张 KPI 卡片，含 seeded 数字 + 急单 + 千分位', async ({
    page,
  }) => {
    test.setTimeout(60_000);

    const salesUserId = await getUserIdByUsername(E2E_USERS.sales.username);
    const seeded = await seedDashboardSnapshot({ salesUserId });

    await login(page, {
      from: '/owner',
      username: ADMIN_USERNAME,
      password: ADMIN_PASSWORD,
    });

    await expect(page).toHaveURL(/\/owner($|\?)/);
    await expect(
      page.getByRole('heading', { name: 'Dashboard', level: 1 }),
    ).toBeVisible();

    // 4 张 StatCard 都有 data-slot="dashboard-kpi"。
    const kpis = page.locator('[data-slot="dashboard-kpi"]');
    await expect(kpis).toHaveCount(4);

    // 数字断言用 ">= seeded" 而不是精确相等：dev DB 是共享的，开发期手工
    // 创建的 OWNER 工单也会在今日 submitted/completed/shipped 中累计，
    // wipe 仅安全地清掉 e2e-* 用户。结构断言（4 卡 + 各自标签）+ 关键
    // seeded 行为（急单 ≥ 1 / bill 金额至少 5000）才是稳定信号。

    // 今日提交：seeded 3 条（含 1 急），全局可能更多。"X 单" 必出现。
    // 急单卡片 hint 至少是 "其中急单 1"，可能更高。
    const submittedCard = page
      .locator('[data-slot="dashboard-kpi"]')
      .filter({ hasText: '今日提交工单' });
    await expect(submittedCard).toContainText(/(\d+) 单/);
    await expect(submittedCard).toContainText(/其中急单 \d+/);
    const submittedText = (await submittedCard.textContent()) ?? '';
    const urgentCount = Number(/其中急单 (\d+)/.exec(submittedText)?.[1] ?? '0');
    expect(urgentCount).toBeGreaterThanOrEqual(1);

    // 今日完工：seeded 2 条。完工同比 hint 任意方向。
    const completedCard = page
      .locator('[data-slot="dashboard-kpi"]')
      .filter({ hasText: '今日完工' });
    await expect(completedCard).toContainText(/(\d+) 单/);
    await expect(completedCard).toContainText(
      /较昨日 [+-]?\d+|与昨日持平/,
    );

    // 今日发货：seeded 1 条。
    const shippedCard = page
      .locator('[data-slot="dashboard-kpi"]')
      .filter({ hasText: '今日发货' });
    await expect(shippedCard).toContainText(/(\d+) 单/);

    // 本月应收：wipe 清掉所有 e2e-* 账单 + dev DB 一般无本月真实账单
    // (开发期手测 bill 不太常见)。即使有，5,000.00 是 seeded 的下限，
    // 累加只会更多 → 用 toContainText 任意 "¥ X,XXX.XX" 格式 + paid /
    // outstanding 文案确认 formatMoney 千分位生效。
    const billCard = page
      .locator('[data-slot="dashboard-kpi"]')
      .filter({ hasText: '本月应收' });
    // 千分位 + 2 位小数：1+ 个数字组、可选千分位、强制 .XX 结尾。
    await expect(billCard).toContainText(/¥ [\d,]+\.\d{2}/);
    await expect(billCard).toContainText(/已收 ¥ [\d,]+\.\d{2}/);
    await expect(billCard).toContainText(/未收/);
    // seeded 5000 / 2000 → 总额 ≥ 5000，paid ≥ 2000。读 textContent
    // 解析对比，避免精确相等。
    const billText = (await billCard.textContent()) ?? '';
    const totalMatch = /本月应收¥ ([\d,]+)\.(\d{2})/.exec(billText);
    expect(totalMatch).not.toBeNull();
    const totalNumber = Number(
      `${totalMatch![1]!.replace(/,/g, '')}.${totalMatch![2]}`,
    );
    expect(totalNumber).toBeGreaterThanOrEqual(5000);

    // sidebar Dashboard 链接现在指 /owner（round 96 改 # → Slice A
    // 改回）。点一下不应跳走（已经在 /owner）。
    const sidebarDashboard = page
      .getByRole('link', { name: 'Dashboard' })
      .first();
    await expect(sidebarDashboard).toHaveAttribute('href', '/owner');

    // 防御：dev overlay 不能弹 Server Action / Build Error 警告。
    await expectNoNextErrorOverlay(page);

    // Avoid touching seeded.* in trivial ways — assertion happens via
    // the rendered counts above. Keep return value usable for future
    // Slice B/C tests sharing the same fixture.
    expect(seeded.submittedOrderIds).toHaveLength(3);
  });
});
