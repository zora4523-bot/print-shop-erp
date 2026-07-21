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

    const customerRef = `e2e-${uniqueSuffix()}`;

    // 注意：OrderForm 用了 RHF + 自定义 TextField，但 <Label> 没接
    // htmlFor 到 <Input id>，所以 page.getByLabel(...) 抓不到。RHF
    // 的 register(name) 把 name 透传到 input，按 name 选稳。
    // 这是个真 a11y 缺口（屏幕阅读器读不到 label），先用 selector 绕，
    // 留 TODO 给业主侧反馈后再修。
    await page.locator('input[name="customerRef"]').fill(customerRef);

    // 第一个款式：必填 name + quantity + 至少一项工艺（schema §449）。
    await page.locator('input[name="items.0.name"]').fill('E2E 测试款式');
    await page.locator('input[name="items.0.quantity"]').fill('1000');
    // 工艺是 RHF Controller 渲染的 checkbox 数组，没有 name 属性。
    // 用包裹 <label> 的文本匹配（seed 里&ldquo;现货加烫&rdquo;一定存在）。
    await page
      .locator('label')
      .filter({ hasText: '现货加烫' })
      .locator('input[type="checkbox"]')
      .check();

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
    // 等到 dd 元素带 customerRef 出现（Row 组件结构 <dt>客户代号</dt><dd>...</dd>）。
    await expect(
      page.locator('dd', { hasText: customerRef }),
    ).toBeVisible({ timeout: 10_000 });
    await expect(page.getByText('E2E 测试款式').first()).toBeVisible();
    await expect(page.getByText(/^GD-\d{6}-\d{3}$/).first()).toBeVisible();
  });
});
