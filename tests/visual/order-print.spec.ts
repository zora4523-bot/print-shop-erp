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
//   - Snapshot is scoped to `.print-container` (the OrderPrintLayout
//     root <div>), NOT the page — Next dev-toolbar / page chrome /
//     error overlays sit outside it.
//   - For `.print-container` taller than viewport (10-design bucket),
//     Playwright scroll-stitches and position:fixed dev toolbar can
//     bleed in. So the mask list ALSO covers the &ldquo;Open Next.js
//     Dev Tools&rdquo; button as a belt-and-suspenders (Codex rounds
//     90→93 chronicle this).
//
// Platform: baselines are committed for darwin. Linux / Windows runs
// will see "snapshot doesn't exist" on first invocation —
// `pnpm test:visual:update` on the target platform writes its own
// `*-<platform>.png` siblings.

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

      // 截 OrderPrintLayout 的根 div；多数 chrome 因此自然不入境。
      // 但 .print-container 比 viewport 高时（如 10-design 桶），
      // Playwright 滚动拼接，position:fixed 的 Next dev toolbar 会
      // bleed 进截图——所以仍然要 mask 那个按钮（Codex round 93 / P2）。
      // 三层防御组合后：
      //   - 短 print-container：toolbar 在截图范围外 → mask no-op
      //   - 高 print-container：toolbar bleed in → mask 罩住
      //   - prod build：button 不存在 → mask no-op
      // 错误 overlay 不被 mask（它是另一个组件，不匹配按钮 selector）。
      await expect(page.locator('.print-container')).toHaveScreenshot(
        `order-print-${count}-designs.png`,
        {
          mask: [
            // 打印时间每次跑都不一样 —— 必须 mask。
            page.locator('.print-footer'),
            // dev toolbar bleed-through 防御，仅在 toolbar 真的在截图
            // 区里时罩住（locator 不匹配 → 该 mask 等同没传）。
            page.getByRole('button', { name: /Open Next\.js Dev Tools/i }),
          ],
        },
      );
    });
  }
});
