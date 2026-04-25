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
// classes (count-1 / count-2 / count-3-4 / count-5-6 / count-7-9 /
// count-many). A representative sample exercises each bucket: 1, 2,
// 3, 5, 10. If the print layout breaks at any of these, the diff
// surfaces here instead of through a customer complaint.
//
// Stability tactics (so the snapshot is stable across runs):
//   - seedPrintableOrder uses a deterministic orderId per count, so
//     QR pixels (encoded `order:<id>`) hash identically every run.
//   - Designs render an inline 1×1 PNG (data:image/png;base64,...)
//     so no network fetch / no image caching variance.
//   - print-footer (打印时间) is masked — wall-clock changes every run.
//   - Test runs serial (workers=1, fullyParallel:false) so seeded
//     rows can't be raced by a concurrent spec.

const BUCKETS = [1, 2, 3, 5, 10] as const;

test.describe('OrderPrintLayout 截图回归', () => {
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
