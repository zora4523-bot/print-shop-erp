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

// P1 #1 Slices A + B — owner dashboard KPIs + watchlists
//
// 单测覆盖 lib/dashboard/owner-stats 与 owner-watchlist 的算术 + 边界，
// 但 Server Component + permission gate + sidebar wire + 3 个 list
// 的渲染链只能跑真页面才知道：
//   - /owner 实际渲染（OwnerLayout → page.tsx requirePermission(
//     'report:all') → owner-stats / owner-watchlist 走真 DB → 4 张
//     StatCard + 3 个 WatchlistTable 渲染）
//   - 数字按千分位（formatMoney 走 Intl.NumberFormat zh-CN）
//   - sidebar Dashboard 链接指向 /owner（不再是 # 占位 — admin-menu
//     单测同一断言）
//
// 数据由 seedDashboardSnapshot 直接写入：
//   Slice A:  3 提交 (1 急) / 2 完工 / 1 发货 / 1 张当月 5000-2000 账单
//   Slice B:  借用 2 完工 → 待发货 list；1 超期外协（3 天）；1 客服周期
//             （3 天后结束，totalSales=300000 命中最高档）
// helper 会先清掉所有 e2e-* 用户的 Order + Bill + e2e-dash-os-* 外协 +
// CS 用户的 SalaryPeriod / Commission，避免上一次 run / 平行 spec 的
// 数据污染。

test.describe('owner dashboard — KPI + 关注列表', () => {
  test('OWNER /owner 渲染 4 张 KPI + 3 个 watchlist（待发货 / 超期外协 / 即将结算客服）', async ({
    page,
  }) => {
    test.setTimeout(60_000);

    const salesUserId = await getUserIdByUsername(E2E_USERS.sales.username);
    const csUserId = await getUserIdByUsername(
      E2E_USERS.customerService.username,
    );
    const seeded = await seedDashboardSnapshot({ salesUserId, csUserId });

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

    // ─── Slice B: 3 个关注列表 ───
    //
    // 每个 list 走 data-slot 定位（dashboard-watchlist-shipments /
    // -outsource / -cs-periods）。dev DB 共享，"至少 1 行"是稳定信号；
    // 不绑死行数。

    // 待发货：seeded 2 条 COMPLETED 工单（Slice A fixture），可能更多。
    const shipmentsCard = page.locator(
      '[data-slot="dashboard-watchlist-shipments"]',
    );
    await expect(shipmentsCard).toBeVisible();
    await expect(shipmentsCard).toContainText('待发货工单');
    // 行计数：至少 2 行（即 seeded 数据成功上榜）。
    await expect(
      shipmentsCard.locator('[data-slot="table-body"] [data-slot="table-row"]'),
    ).toHaveCount(await shipmentsCard
      .locator('[data-slot="table-body"] [data-slot="table-row"]')
      .count());
    const shipmentRows = shipmentsCard.locator(
      '[data-slot="table-body"] [data-slot="table-row"]',
    );
    expect(await shipmentRows.count()).toBeGreaterThanOrEqual(2);

    // 超期外协：seeded 1 条，daysOverdue=3。
    const outsourceCard = page.locator(
      '[data-slot="dashboard-watchlist-outsource"]',
    );
    await expect(outsourceCard).toBeVisible();
    await expect(outsourceCard).toContainText('超期外协');
    await expect(outsourceCard).toContainText('E2E 阿福外协');
    await expect(outsourceCard).toContainText(`${seeded.outsourceDaysOverdue} 天`);

    // 即将结算客服周期：seeded 1 条 e2e-cs，3 天后到期，totalSales=300000
    // 命中默认 CS_TIERS 最高档。预测提成不为 "—"（getActiveCsTiers 返
    // 真规则）。
    const csPeriodsCard = page.locator(
      '[data-slot="dashboard-watchlist-cs-periods"]',
    );
    await expect(csPeriodsCard).toBeVisible();
    await expect(csPeriodsCard).toContainText('即将结算客服周期');
    await expect(csPeriodsCard).toContainText(E2E_USERS.customerService.displayName);
    await expect(csPeriodsCard).toContainText(`${seeded.csPeriodDaysUntilEnd} 天`);
    // 预测提成应是金额而非 "—"
    const csRow = csPeriodsCard
      .locator('[data-slot="table-body"] [data-slot="table-row"]')
      .filter({ hasText: E2E_USERS.customerService.displayName });
    await expect(csRow).toContainText(/¥ [\d,]+\.\d{2}/);

    // ─── Slice C: 3 个图表 ───
    //
    // **视觉回归 spec 已移除**（2026-04-27 决定）：
    //   - trend chart 的 X 轴标签是真实日期（`MM-DD`），每天滚动一次
    //     → baseline 必然 daily drift
    //   - category 数据按 `current Shanghai month` 聚合，跨月边界 +
    //     dev DB 历史污染让 baseline 也漂浮
    //   - 三个图绑同一个 spec 跑，想救只能整套重做（注入可测试 now /
    //     mask 整片日期带）—— ROI 不值。
    // 取舍：完全删掉 tests/visual/owner-dashboard.spec.ts；图表回归改
    // 由本文件的 presence 断言（card 可见 + svg 出现）+ 修改 chart
    // 组件时人工 review screenshot 承担。如果未来引入&ldquo;可注入 now&rdquo;
    // 基础设施（确定性 E2E、时间旅行），可以重新加视觉回归。
    //
    // 这里做&ldquo;render-without-crash&rdquo;断言：3 个 chart card 可见 + 各自
    // 的 recharts SVG 已经 paint（ResponsiveContainer 没 stuck 在 0 高）。
    const trendCard = page.locator(
      '[data-slot="dashboard-chart-trend-card"]',
    );
    const rankingCard = page.locator(
      '[data-slot="dashboard-chart-ranking-card"]',
    );
    const categoryCard = page.locator(
      '[data-slot="dashboard-chart-category-card"]',
    );
    await expect(trendCard).toBeVisible();
    await expect(rankingCard).toBeVisible();
    await expect(categoryCard).toBeVisible();
    await expect(trendCard).toContainText('近 30 天产量趋势');
    await expect(rankingCard).toContainText('本月销售业绩 Top 10');
    await expect(categoryCard).toContainText('本月产品线分布');
    // 3 个 SVG（每个 chart 一个）—— recharts 渲染失败 / SSR 不出 SVG 时
    // 会少。chart fixture 没在这条 spec 里 seed，所以不能保证数据非空，
    // 但至少 ResponsiveContainer 必出 svg.recharts-surface 占位。
    // 注：本 spec 的 seed 只走 Slice A/B（chartFixture=false），ranking
    // 和 category 在无业绩数据下渲染&ldquo;暂无数据&rdquo;占位（不带 SVG）；trend
    // 走 30 天聚合，即使空也输出 SVG。所以期望 SVG 数量 ≥ 1。
    await expect(page.locator('svg.recharts-surface')).toHaveCount(
      await page.locator('svg.recharts-surface').count(),
    );
    expect(await page.locator('svg.recharts-surface').count()).toBeGreaterThanOrEqual(
      1,
    );

    // sidebar Dashboard 链接现在指 /owner（round 96 改 # → Slice A
    // 改回）。点一下不应跳走（已经在 /owner）。
    const sidebarDashboard = page
      .getByRole('link', { name: 'Dashboard' })
      .first();
    await expect(sidebarDashboard).toHaveAttribute('href', '/owner');

    // 防御：dev overlay 不能弹 Server Action / Build Error 警告。
    await expectNoNextErrorOverlay(page);
  });
});
