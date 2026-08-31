import { test, expect } from '@playwright/test';
import {
  login,
  uniqueSuffix,
  expectNoNextErrorOverlay,
  openFirstOrderItemEditor,
} from './_helpers';

test.describe('创建工单 — golden path', () => {
  // 这条用例存在的具体理由：手动测试时这里炸了
  // PrismaClientKnownRequestError "Failed to deserialize column of
  // type 'void'" —— $queryRaw + pg_advisory_xact_lock 在 Prisma 7 不
  // 工作。776 个 mock 单测全没抓到。这个 E2E 是地基，确保 nextOrderNumber
  // 真正被 PG 调用过一次。
  test('ADMIN 填最少字段创建工单 → 跳到详情页', async ({ page }) => {
    test.setTimeout(60_000);
    await login(page, { from: '/orders/new' });
    await expect(page).toHaveURL('/orders/new');

    const suffix = uniqueSuffix();
    const customerRef = `e2e-${suffix}`;
    const customName = `E2E 中秋礼盒 ${suffix}`;

    await page.getByLabel('工单自定义名称').fill(customName);
    await page.locator('input[name="customerRef"]').fill(customerRef);

    // 当前单页表单默认打开第一个款式；选择报价产品会带出规格、纸张和
    // 产品结构。只走建单所需的稳定用户动作，避免绑定内部字段布局。
    await openFirstOrderItemEditor(page);
    await page.locator('input[name="items.0.name"]').fill('E2E 测试款式');
    await page.locator('input[name="items.0.quantity"]').fill('1000');
    await page
      .getByRole('combobox', { name: '报价产品' })
      .selectOption({ label: '珠光艳闪 160g · 大号封' });
    await expect(page.getByRole('button', { name: '大号封90×165' }))
      .toHaveAttribute('aria-pressed', 'true');
    await expect(page.getByRole('button', { name: '160g珠光艳闪' }))
      .toHaveAttribute('aria-pressed', 'true');
    await page.getByRole('textbox', { name: '成交单价' }).fill('1.00');
    await page
      .getByRole('textbox', { name: '人工改价说明' })
      .fill('E2E 工单创建链路使用固定测试价');

    // 新版单页直接展示收货区，不再通过旧的“收货与费用”步骤页签进入。
    await page
      .getByRole('textbox', {
        name: '详细地址 / 粘贴完整收货信息',
        exact: true,
      })
      .fill('E2E 收货人 13800138000 广东省佛山市南海区测试路 1 号');

    // 这条 golden path 故意保留“先存草稿”分支；资料完整时的
    // “创建并提交”是建单页的另一个明确动作。
    await page.getByRole('button', { name: '保存草稿', exact: true }).click();

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
    const itemDetails = page
      .locator('details')
      .filter({ hasText: 'E2E 测试款式' })
      .first();
    await itemDetails.locator('summary').click();
    await expect(itemDetails).toHaveAttribute('open', '');
    await expect(
      itemDetails.getByText('珠光艳闪 160g · 大号封', { exact: true }),
    ).toBeVisible();
    await expect(page.getByText(/^GD-\d{6}-\d{3}$/).first()).toBeVisible();

    // 标签页标题里是工单号，不是 id 前 8 位。这是唯一能验证
    // generateMetadata 在真实 Next 运行时里真的查到了 orderNo 的地方 ——
    // 单测跑不到 metadata 那条路径。
    await expect(page).toHaveTitle(/^GD-\d{6}-\d{3} · 工单$/);
  });
});
