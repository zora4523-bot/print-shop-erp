import { test, expect } from '@playwright/test';
import {
  login,
  ADMIN_USERNAME,
  ADMIN_PASSWORD,
  E2E_USERS,
  getUserIdByUsername,
  seedDashboardSnapshot,
} from '../e2e/_helpers';

// Visual regression — owner dashboard charts (Slice C).
//
// 3 element-scoped baselines, one per chart. Deterministic fixture
// (seedDashboardSnapshot with chartFixture=true) seeds:
//   - 7 fixed-pattern non-zero days for the 30-day trend
//   - 3 distinct submitters w/ ¥5k / ¥3k / ¥1.5k for the ranking
//   - 3 categories + UNCATEGORIZED for the pie
// `data-slot` IDs are owned by the chart components; never rename
// without updating these baselines too.
//
// Stability tactics (mirrors tests/visual/order-print.spec.ts pattern):
//   - Element-scope, not page-scope: dev toolbar / sidebar / header
//     don't enter the frame.
//   - Mask "Open Next.js Dev Tools" button as belt-and-suspenders
//     (Codex round 93 / wave 5 lessons): tall element + Playwright
//     scroll-stitch can still bleed the toolbar in.
//   - isAnimationActive={false} on every Bar / Line / Pie + Tooltip
//     means the very first paint matches the final SVG.
//   - Wait for the recharts <svg.recharts-surface> to be visible
//     before screenshotting — ResponsiveContainer uses ResizeObserver
//     and the chart paints on the second frame.
//   - Fixed viewport (1440 × 900) so ResponsiveContainer locks at
//     the same width / height every run.
//
// Platform: darwin baselines committed; other platforms generate
// their own `*-<platform>.png` via `pnpm test:visual:update` on first
// run (same convention as wave 5).

const VIEWPORT = { width: 1440, height: 900 } as const;

test.describe('Owner Dashboard charts 截图回归', () => {
  test.beforeEach(async ({ page }) => {
    await page.setViewportSize(VIEWPORT);

    const salesUserId = await getUserIdByUsername(E2E_USERS.sales.username);
    const csUserId = await getUserIdByUsername(
      E2E_USERS.customerService.username,
    );
    const ownerUserId = await getUserIdByUsername(ADMIN_USERNAME);
    await seedDashboardSnapshot({
      salesUserId,
      csUserId,
      ownerUserId,
      chartFixture: true,
    });

    await login(page, {
      from: '/owner',
      username: ADMIN_USERNAME,
      password: ADMIN_PASSWORD,
    });
    await expect(page).toHaveURL(/\/owner($|\?)/);

    // Recharts uses ResponsiveContainer + ResizeObserver. The initial
    // SSR markup contains 0-sized SVG; the real <svg.recharts-surface>
    // only appears after first measure. Wait for at least one to land
    // — implies all three (single React render pass).
    await page.locator('svg.recharts-surface').first().waitFor({
      state: 'visible',
      timeout: 5_000,
    });

    // Park the cursor in the top-left corner. Without this the cursor
    // stays at the login button's last click position, which after
    // redirect to /owner can land *on a recharts <Bar>*. recharts then
    // shows the active-state Tooltip on baseline capture, drifting
    // pixel-by-pixel between runs (the tooltip's anchor depends on
    // the exact cursor coords inside the bar). Moving here = no
    // active datum = no tooltip in baseline.
    await page.mouse.move(0, 0);
  });

  const CHART_SLOTS = [
    { slot: 'dashboard-chart-trend', file: 'owner-dashboard-trend.png' },
    { slot: 'dashboard-chart-ranking', file: 'owner-dashboard-ranking.png' },
    { slot: 'dashboard-chart-category', file: 'owner-dashboard-category.png' },
  ] as const;

  for (const { slot, file } of CHART_SLOTS) {
    test(`${slot} 渲染稳定`, async ({ page }) => {
      const chart = page.locator(`[data-slot="${slot}"]`);
      await expect(chart).toBeVisible();
      await expect(chart).toHaveScreenshot(file, {
        mask: [
          // Defensive: dev toolbar can bleed if scroll-stitching kicks
          // in on tall captures (wave 5 round 93). Charts are ~288-
          // 320px so this should be a no-op, but cheap insurance.
          page.getByRole('button', { name: /Open Next\.js Dev Tools/i }),
        ],
      });
    });
  }
});
