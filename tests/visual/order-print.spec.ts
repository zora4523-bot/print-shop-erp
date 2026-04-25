import { test, expect } from '@playwright/test';
import {
  login,
  ADMIN_USERNAME,
  ADMIN_PASSWORD,
  getUserIdByUsername,
  seedPrintableOrder,
} from '../e2e/_helpers';

// Wave 5 — Visual regression for OrderPrintLayout.
//
// SPEC §E.2.1 buckets design counts into fixed-size CSS modifier
// classes: count-1 / count-2 / count-3-4 / count-5-6 / count-7-9 /
// count-many. The bucket samples below hit ALL six (Codex round 90 /
// P2 caught the original list missing count-7-9):
//   1 → count-1, 2 → count-2, 3 → count-3-4, 5 → count-5-6,
//   8 → count-7-9, 10 → count-many
// A regression in any of these now surfaces here instead of in
// printed sheets at the customer.
//
// Stability tactics:
//   - seedPrintableOrder uses a deterministic orderId per count, so
//     QR pixels (encoded `order:<id>`) hash identically every run.
//   - Designs render an inline 1×1 PNG (data:image/png;base64,...)
//     so no network fetch / no image caching variance.
//   - print-footer (打印时间) is masked — wall-clock changes every run.
//   - Next.js dev toolbar (`<nextjs-portal>` in bottom-left) is
//     injected-CSS-hidden before each screenshot so a Next upgrade
//     can't fail this whole suite (Codex round 90 / P3).
//
// Platform: baselines are committed for darwin only. Linux/Windows
// renders fonts differently and would diff against the macOS
// baselines. Skipping on other platforms keeps the suite green
// locally; CI on Linux will need its own baselines generated via
// `pnpm test:visual:update` from a Linux container, then committed
// alongside (Playwright auto-suffixes per platform).

const BUCKETS = [1, 2, 3, 5, 8, 10] as const;

test.describe('OrderPrintLayout 截图回归', () => {
  // Codex round 90 / P1: don't fail when baselines for the current
  // platform don't exist. Until Linux baselines are added, skip on
  // anything but macOS — the alternative is a hard error on every
  // non-mac developer + CI.
  test.skip(
    process.platform !== 'darwin',
    'baselines 仅在 macOS 上提交；其他平台需先 `pnpm test:visual:update` 生成本机基线',
  );

  for (const count of BUCKETS) {
    test(`${count} design 网格布局稳定`, async ({ page }) => {
      const adminId = await getUserIdByUsername(ADMIN_USERNAME);
      const { orderId } = await seedPrintableOrder({
        submitterId: adminId,
        designCount: count,
      });

      await login(page, {
        from: `/print/orders/${orderId}`,
        username: ADMIN_USERNAME,
        password: ADMIN_PASSWORD,
      });
      await expect(page).toHaveURL(`/print/orders/${orderId}`);

      // 确保 1×1 data: 图标 + 内联 SVG QR 都已 paint 完。
      // networkidle 不可靠（dev 模式下 Next 自己有 SSE 连接），
      // 用一个&ldquo;关键内容已渲染&rdquo;的 expect 替代。
      await expect(page.locator('text=VR 款式').first()).toBeVisible();

      // Hide the Next.js dev-toolbar before snapping. Without this,
      // a Next upgrade that ships a redesigned indicator pixel-shifts
      // every visual test. The print page itself doesn't render
      // <nextjs-portal>; only the dev shell injects it.
      await page.addStyleTag({
        content: 'nextjs-portal { display: none !important; }',
      });

      await expect(page).toHaveScreenshot(`order-print-${count}-designs.png`, {
        fullPage: true,
        // 打印时间每次跑都不一样 —— 必须 mask，否则永远红。
        mask: [page.locator('.print-footer')],
        // SPEC §E.2.1 说 10+ 张时显示&ldquo;split this order&rdquo;的提示横条；
        // 它有 .no-print 类不影响打印，但截图里仍然出现，正是我们想要
        // 守护的 UI 之一，不 mask。
      });
    });
  }
});
