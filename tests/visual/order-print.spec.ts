import { test, expect } from '@playwright/test';
import {
  login,
  ADMIN_USERNAME,
  E2E_PASSWORD,
  E2E_USERS,
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
//     QR pixels (encoded `{base}/orders/<id>` URL) hash identically every run.
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
        username: E2E_USERS.owner!.username,
        password: E2E_PASSWORD,
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

  test('完整工单上下文与红底关键备注稳定', async ({ page }) => {
    const adminId = await getUserIdByUsername(ADMIN_USERNAME);
    const {
      orderId,
      customName,
      itemRemark,
      foilColors,
    } = await seedPrintableOrder({
      submitterId: adminId,
      designCount: 1,
      variant: 'rich-context',
    });

    await login(page, {
      from: `/print/orders/${orderId}`,
      username: E2E_USERS.owner!.username,
      password: E2E_PASSWORD,
    });
    await expect(page).toHaveURL(`/print/orders/${orderId}`);

    await expect(page.locator('.order-custom-name')).toHaveText(customName!);
    await expect(
      page.locator('.item-info dd').filter({
        hasText: foilColors.join('、'),
      }),
    ).toBeVisible();
    const highlightedRemark = page.locator('.item-remark-text');
    await expect(highlightedRemark).toHaveText(itemRemark!);
    await expect(highlightedRemark).toHaveCSS('color', 'rgb(192, 0, 0)');
    await expect(highlightedRemark).toHaveCSS(
      'background-color',
      'rgb(255, 230, 230)',
    );
    await expect(page.locator('.print-container')).toHaveCSS(
      'print-color-adjust',
      'exact',
    );

    await expect(page.locator('.print-container')).toHaveScreenshot(
      'order-print-rich-context.png',
      {
        mask: [
          page.locator('.print-footer'),
          page.getByRole('button', { name: /Open Next\.js Dev Tools/i }),
        ],
      },
    );
  });

  test('三款完整上下文分页正常且每页重复表头', async ({ page }) => {
    const adminId = await getUserIdByUsername(ADMIN_USERNAME);
    const { orderId, customName, itemRemark, foilColors } =
      await seedPrintableOrder({
        submitterId: adminId,
        designCount: 1,
        variant: 'three-items',
      });

    await login(page, {
      from: `/print/orders/${orderId}`,
      username: E2E_USERS.owner!.username,
      password: E2E_PASSWORD,
    });
    await expect(page).toHaveURL(`/print/orders/${orderId}`);
    await expect(page.locator('.order-item')).toHaveCount(3);
    await expect(page.locator('.order-custom-name')).toHaveText(customName!);
    await expect(page.locator('.item-remark-text')).toHaveCount(3);
    await expect(page.getByText('多地址 ×2', { exact: false }).first()).toBeVisible();
    await expect(page.locator('.item-remark-text').first()).toHaveText(
      itemRemark!,
    );
    await expect(
      page.locator('.item-info dd').filter({
        hasText: foilColors.join('、'),
      }),
    ).toHaveCount(3);

    await expect(page.locator('.print-container')).toHaveScreenshot(
      'order-print-three-items.png',
      {
        mask: [
          page.locator('.print-footer'),
          page.getByRole('button', { name: /Open Next\.js Dev Tools/i }),
        ],
      },
    );

    await page.emulateMedia({ media: 'print' });
    const pdf = await page.pdf({
      format: 'A4',
      printBackground: true,
      margin: {
        top: '10mm',
        right: '10mm',
        bottom: '10mm',
        left: '10mm',
      },
    });
    const pageObjects =
      pdf.toString('latin1').match(/\/Type\s*\/Page\b/g) ?? [];
    // 业主 2026-08-18 决策：放弃「三款必须一页」。硬压一页的 compact-3
    // 只在恰好 3 款时生效，而工单一旦排产仍然放不下——那条断言给的是
    // 假的安全感。现在的契约是「正常分页 + 每页重复表头」，所以这里
    // 只断言页数合理（≥1 且不炸裂），页眉重复由下面的 DOM 断言保证。
    expect(pageObjects.length).toBeGreaterThanOrEqual(1);
    expect(
      pageObjects.length,
      '三款工单不应该分出异常多的页面（分页塌陷的典型症状）',
    ).toBeLessThanOrEqual(4);

    // 每页重复表头的机制是 <thead>：浏览器原生在每个打印页重复它，并
    // 预留空间。断言结构存在，避免有人把它改回 position: fixed。
    await expect(page.locator('.print-sheet > thead .running-header-no')).toHaveText(
      /^E2E-VR-THREE-/,
    );
    await expect(page.locator('.print-sheet > tfoot .print-footer')).toHaveCount(1);
    const footerPosition = await page
      .locator('.print-footer')
      .evaluate((el) => getComputedStyle(el).position);
    expect(footerPosition, '页脚不能再用 fixed —— 它每页重画却不占位，会压住正文').not.toBe(
      'fixed',
    );
  });
});
