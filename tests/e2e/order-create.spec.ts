import { test, expect } from '@playwright/test';
import { login, uniqueSuffix, expectNoNextErrorOverlay } from './_helpers';

test.describe('创建工单 — golden path', () => {
  // 这条用例存在的具体理由：手动测试时这里炸了
  // PrismaClientKnownRequestError "Failed to deserialize column of
  // type 'void'" —— $queryRaw + pg_advisory_xact_lock 在 Prisma 7 不
  // 工作。776 个 mock 单测全没抓到。这个 E2E 是地基，确保 nextOrderNumber
  // 真正被 PG 调用过一次。
  test('ADMIN 填最少字段创建工单 → 跳到详情页', async ({ page }) => {
    await login(page, { from: '/orders/new' });
    await expect(page).toHaveURL('/orders/new');

    const suffix = uniqueSuffix();
    const customerRef = `e2e-${suffix}`;
    const customName = `E2E 中秋礼盒 ${suffix}`;

    await page.getByLabel('工单自定义名称').fill(customName);
    await page.locator('input[name="customerRef"]').fill(customerRef);

    // 第一个款式：必填 name + quantity + 至少一项工艺（schema §449）。
    await page.locator('input[name="items.0.name"]').fill('E2E 测试款式');
    await page.locator('input[name="items.0.quantity"]').fill('1000');
    await page
      .getByRole('button', { name: '万元封', exact: true })
      .click();
    await page
      .getByRole('button', { name: '其他纸张（自定义）', exact: true })
      .click();
    await page.getByLabel('自定义纸张').fill('E2E 特种纤维纸');
    const noColor = page.getByRole('button', {
      name: '无颜色（纯彩印）',
      exact: true,
    });
    await noColor.click();
    await expect(noColor).toHaveAttribute('aria-pressed', 'true');
    await page.getByRole('button', { name: '哑金', exact: true }).click();
    await expect(noColor).toHaveAttribute('aria-pressed', 'false');
    await page.getByRole('button', { name: '红金', exact: true }).click();
    await page.getByRole('button', { name: '添加其他色', exact: true }).click();
    await page.getByLabel('自定义烫金色 / 色号').fill('古铜金');
    await page.getByRole('button', { name: '添加颜色', exact: true }).click();
    await expect(page.getByText('已选 3 色：哑金、红金、古铜金')).toBeVisible();
    await page.getByLabel('款式备注').fill('烫金方向不要旋转，生产前先核对');
    // 工艺使用可多选的 aria-pressed 卡片；现货加烫位于低频分组。
    await page.getByRole('button', { name: '现货加烫' }).click();

    // 浏览器剪贴板文件常没有文件名；先验证粘贴会被规范化并进入预览。
    // 为避免 golden-path 依赖外部 OSS，再移除图片后提交。OSS 三步上传
    // 契约由 design-upload-client 单测覆盖。
    const pasteArea = page.getByTestId('pending-design-paste-0');
    await pasteArea.evaluate((element) => {
      const png = Uint8Array.from([
        137, 80, 78, 71, 13, 10, 26, 10, 0, 0, 0, 13, 73, 72, 68, 82,
        0, 0, 0, 1, 0, 0, 0, 1, 8, 6, 0, 0, 0, 31, 21, 196, 137,
      ]);
      const file = new File([png], '', { type: 'image/png' });
      const transfer = new DataTransfer();
      transfer.items.add(file);
      element.dispatchEvent(
        new ClipboardEvent('paste', {
          bubbles: true,
          cancelable: true,
          clipboardData: transfer,
        }),
      );
    });
    await expect(page.getByAltText(/待上传设计图/)).toBeVisible();
    await page.getByRole('button', { name: '移除', exact: true }).click();
    await expect(page.getByAltText(/待上传设计图/)).toHaveCount(0);

    // 提交
    await page.getByRole('button', { name: /创建工单/ }).click();

    // 成功后会跳到 /orders/[id]。/orders/new 也匹配过宽 [a-z0-9]+
    // ——显式 negative lookahead 排除 new，否则即使提交失败留在
    // /orders/new 测试也会假绿（之前被坑过）。
    await page.waitForURL(/\/orders\/(?!new\b)[a-z0-9]+(\/|$)/, {
      timeout: 10_000,
    });
    await page.waitForLoadState('networkidle');
    await expectNoNextErrorOverlay(page);

    // 详情页显示了我们刚填的 customerRef 和款式名 —— 工单确实落库了。
    // 等到 dd 元素带 customerRef 出现（Row 组件结构 <dt>客户名称/简称</dt><dd>...</dd>）。
    await expect(
      page.locator('dd', { hasText: customerRef }),
    ).toBeVisible({ timeout: 10_000 });
    await expect(page.getByText('E2E 测试款式').first()).toBeVisible();
    await expect(page.getByText(customName).first()).toBeVisible();
    await expect(page.getByText('万元封', { exact: true }).first()).toBeVisible();
    await expect(page.getByText('E2E 特种纤维纸', { exact: true }).first()).toBeVisible();
    await expect(
      page.getByText('哑金、红金、古铜金', { exact: true }).first(),
    ).toBeVisible();
    const highlightedRemark = page
      .locator('mark')
      .filter({ hasText: '烫金方向不要旋转，生产前先核对' });
    await expect(highlightedRemark).toBeVisible();
    await expect(highlightedRemark).toHaveClass(/bg-destructive/);
    await expect(page.getByText(/^GD-\d{6}-\d{3}$/).first()).toBeVisible();

    // 标签页标题里是工单号，不是 id 前 8 位。这是唯一能验证
    // generateMetadata 在真实 Next 运行时里真的查到了 orderNo 的地方 ——
    // 单测跑不到 metadata 那条路径。
    await expect(page).toHaveTitle(/^GD-\d{6}-\d{3} · 工单$/);
  });
});
