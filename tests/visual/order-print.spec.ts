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
// count-many. The bucket samples below hit ALL six:
//   1 → count-1, 2 → count-2, 3 → count-3-4, 5 → count-5-6,
//   8 → count-7-9, 10 → count-many
//
// Stability tactics:
//   - seedPrintableOrder uses a deterministic orderId per count, so
//     QR pixels (encoded `order:<id>`) hash identically every run.
//   - Designs render an inline 1×1 PNG (data:image/png;base64,...)
//     so no network fetch / no image caching variance.
//   - print-footer (打印时间) is masked — wall-clock varies.
//   - Next.js dev-toolbar BUTTON is masked, NOT the whole
//     <nextjs-portal> host (Codex round 91 / P2): Next renders real
//     build / runtime error overlays inside the same portal; hiding
//     the host would silently swallow a broken page.
//
// Platform: baselines are committed for darwin. Linux / Windows runs
// will see "snapshot doesn't exist" on first invocation —
// `pnpm test:visual:update` on the target platform writes its own
// `*-<platform>.png` siblings (Codex round 91 / P1: don't skip,
// because skipping also blocks the recovery path).

const BUCKETS = [1, 2, 3, 5, 8, 10] as const;

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
        mask: [
          // 打印时间每次跑都不一样 —— 必须 mask。
          page.locator('.print-footer'),
          // 只 mask Next dev-toolbar 那个浮动按钮 (Open Next.js Dev
          // Tools)；不 mask 整个 <nextjs-portal>，否则真有运行时
          // 错误时 dialog 也会被吃掉，截图反而干净 (round 91 / P2)。
          // 生产构建里这个按钮不存在，mask 是 no-op。
          page.getByRole('button', { name: /Open Next\.js Dev Tools/i }),
        ],
      });
    });
  }
});
