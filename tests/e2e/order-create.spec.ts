import { test, expect } from '@playwright/test';
import {
  E2E_PASSWORD,
  E2E_USERS,
  login,
  uniqueSuffix,
  expectNoNextErrorOverlay,
  openFirstOrderItemEditor,
} from './_helpers';

const owner = E2E_USERS.owner!;

test.describe('创建工单 — golden path', () => {
  // 这条用例存在的具体理由：手动测试时这里炸了
  // PrismaClientKnownRequestError "Failed to deserialize column of
  // type 'void'" —— $queryRaw + pg_advisory_xact_lock 在 Prisma 7 不
  // 工作。776 个 mock 单测全没抓到。这个 E2E 是地基，确保 nextOrderNumber
  // 真正被 PG 调用过一次。
  test('ADMIN 填最少字段创建工单 → 跳到详情页', async ({ page }) => {
    test.setTimeout(120_000);
    await login(page, {
      from: '/orders/new',
      username: owner.username,
      password: E2E_PASSWORD,
    });
    await expect(page).toHaveURL('/orders/new');

    const suffix = uniqueSuffix();
    const customerRef = `e2e-${suffix}`;
    const customName = `E2E 中秋礼盒 ${suffix}`;

    await page.getByRole('textbox', { name: '工单名称' }).fill(customName);
    await page.locator('input[name="customerRef"]').fill(customerRef);

    // 当前单页表单默认打开第一个款式。建单事实由三条
    // 计价路线 + 纸张 + 规格组成，不再把“报价产品”或人工金额
    // 暴露给建单端。所有选择都 scope 到对应 fieldset，避免同名
    // 工艺按钮造成假阳性。
    await openFirstOrderItemEditor(page);
    const form = page.locator('[data-slot="order-form-b"]');
    const routes = form.getByRole('group', { name: '工艺类型' });
    for (const route of ['局部烫金', '专版烫金', '彩印']) {
      await expect(
        routes.getByRole('button', { name: route, exact: true }),
      ).toBeVisible();
    }
    await routes
      .getByRole('button', { name: '局部烫金', exact: true })
      .click();
    await expect(
      routes.getByRole('button', { name: '局部烫金', exact: true }),
    ).toHaveAttribute('aria-pressed', 'true');

    const paper = form.getByRole('group', { name: '纸张材质' });
    await paper
      .getByRole('button', { name: '珠光艳闪', exact: true })
      .click();
    await expect(
      paper.getByRole('button', { name: '珠光艳闪', exact: true }),
    ).toHaveAttribute('aria-pressed', 'true');

    const specification = form.getByRole('group', { name: '规格' });
    await specification
      .getByRole('button', { name: '大号封', exact: true })
      .click();
    await expect(
      specification.getByRole('button', { name: '大号封', exact: true }),
    ).toHaveAttribute('aria-pressed', 'true');

    const weight = form.getByRole('group', { name: '克重' });
    await weight.getByRole('button', { name: '160g', exact: true }).click();
    await expect(
      weight.getByRole('button', { name: '160g', exact: true }),
    ).toHaveAttribute('aria-pressed', 'true');

    await form.getByRole('textbox', { name: '款式名', exact: true }).fill(
      'E2E 测试款式',
    );
    // B 版数量输入是受控组件，用可访问名称绑定用户行为，
    // 不再依赖旧面板的 input name 实现细节。
    await form
      .getByRole('spinbutton', { name: '数量', exact: true })
      .fill('1000');
    await expect(
      form.getByRole('combobox', { name: '报价产品' }),
    ).toHaveCount(0);
    await expect(
      form.getByRole('textbox', { name: '成交单价' }),
    ).toHaveCount(0);
    await expect(
      form.getByRole('textbox', { name: '人工改价说明' }),
    ).toHaveCount(0);

    // 新版单页直接展示收货区，不再通过旧的“收货与费用”步骤页签进入。
    await form
      .getByRole('textbox', { name: '收货地址', exact: true })
      .fill('E2E 收货人 13800138000 广东省佛山市南海区测试路 1 号');

    // 这条 golden path 故意保留“先存草稿”分支；资料完整时的
    // “创建并提交”是建单页的另一个明确动作。
    await page.getByRole('button', { name: '保存草稿', exact: true }).click();

    // 成功后会跳到 /orders/[id]。/orders/new 也匹配过宽 [a-z0-9]+
    // ——显式 negative lookahead 排除 new，否则即使提交失败留在
    // /orders/new 测试也会假绿（之前被坑过）。
    await page.waitForURL(/\/orders\/(?!new\b)[a-z0-9]+(\/|$)/, {
      timeout: 45_000,
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
    const itemFact = (label: string) =>
      itemDetails
        .locator('dt')
        .filter({ hasText: new RegExp(`^${label}$`) })
        .locator('..')
        .locator('dd');
    await expect(itemFact('计价路线')).toHaveText('局部烫金（通版现货）');
    await expect(itemFact('规格')).toHaveText('大号封90×165');
    await expect(itemFact('纸张')).toHaveText('160g珠光艳闪');
    await expect(itemFact('纸张克重')).toHaveText('160 g/㎡');
    await expect(page.getByText(/^GD-\d{6}-\d{3}$/).first()).toBeVisible();

    // 标签页标题里是工单号，不是 id 前 8 位。这是唯一能验证
    // generateMetadata 在真实 Next 运行时里真的查到了 orderNo 的地方 ——
    // 单测跑不到 metadata 那条路径。
    await expect(page).toHaveTitle(/^GD-\d{6}-\d{3} · 工单$/);
  });
});
