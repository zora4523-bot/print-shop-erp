import { test, expect } from '@playwright/test';
import {
  login,
  logout,
  uniqueSuffix,
  E2E_PASSWORD,
  E2E_USERS,
  ADMIN_USERNAME,
  ADMIN_PASSWORD,
} from './_helpers';

// 这条测试的具体使命：把 SALES 创建 → 提交 → FOREMAN 排产 → WORKER
// 报工 → 工单级联 FINISHED 整条链 cover 一遍。所有 advisory lock 都
// 在这条链上：order submit / schedule / task begin / task report /
// order-cascade。HANDOFF 历史里 round 39 P0 race 就埋在 cascade 锁内
// fresh-read Order.status，没有 E2E 真实跑过那段就只能靠相信单测。
test.describe('生产流程 — golden path', () => {
  test('SALES create → submit, FOREMAN schedule, WORKER report → 工单 FINISHED', async ({
    page,
  }) => {
    test.setTimeout(60_000); // 多角色切换 + 多次表单提交，给点余量

    const orderRef = `e2e-prod-${uniqueSuffix()}`;
    // 款式名也带 unique 后缀 —— /worker/tasks 列表里 link 不显示
    // customerRef，按款式名找最干净。
    const itemName = `E2E 款式 ${orderRef}`;
    let orderUrl = '';
    let orderId = '';

    await test.step('SALES 登录并创建工单', async () => {
      await login(page, {
        from: '/orders/new',
        username: E2E_USERS.sales.username,
        password: E2E_PASSWORD,
      });
      await page.locator('input[name="customerRef"]').fill(orderRef);
      await page.locator('input[name="items.0.name"]').fill(itemName);
      await page.locator('input[name="items.0.quantity"]').fill('1000');
      // &ldquo;现货加烫&rdquo; 是 seed 里 defaultMachineType=HAND_PRESS 的工艺，
      // 和我们的 e2e-worker-hand 师傅匹配 → 排产能选到。
      await page
        .locator('label')
        .filter({ hasText: '现货加烫' })
        .locator('input[type="checkbox"]')
        .check();
      await page.getByRole('button', { name: /创建工单/ }).click();
      await page.waitForURL(/\/orders\/(?!new\b)[a-z0-9]+(\/|$)/, {
        timeout: 10_000,
      });
      orderUrl = new URL(page.url()).pathname;
      // /orders/[id] → grab the id; /foreman/scheduling/[id] uses the
      // same id (it's the Order PK).
      orderId = orderUrl.split('/').filter(Boolean).pop() ?? '';
      expect(orderId).toMatch(/^[a-z0-9]+$/);
    });

    await test.step('SALES 提交工单 (DRAFT → PENDING_SCHEDULE)', async () => {
      await page.getByRole('button', { name: /^提交工单$/ }).click();
      // 提交后&ldquo;提交工单&rdquo;按钮消失（订单进入 PENDING_SCHEDULE）。
      await expect(
        page.getByRole('button', { name: /^提交工单$/ }),
      ).toHaveCount(0, { timeout: 10_000 });
    });

    await test.step('FOREMAN 登录 → 直接到排产详情页', async () => {
      await logout(page);
      // 直接 deep-link 到这个工单的排产页：order id 我们刚捕获了，
      // /foreman/scheduling/[id] 用同一个 id。比按 customerRef 在
      // 列表里翻稳得多（列表 link text 是&ldquo;排产&rdquo;两字，customerRef
      // 在 td 里）。
      await login(page, {
        from: `/foreman/scheduling/${orderId}`,
        username: E2E_USERS.foreman.username,
        password: E2E_PASSWORD,
      });
      await page.waitForURL(`/foreman/scheduling/${orderId}`);

      // 排产表单第一行的 select（每个 item × craft 一行；这里只有一个）。
      // SchedulingForm 用原生 <select>，option label 形如&ldquo;{displayName}（机型，推荐）&rdquo;
      // —— Playwright 的 selectOption 只接受 label 精确匹配，所以先按
      // displayName 子串找到 option 再用其 value 选中。
      const select = page.locator('select').first();
      const workerOptionValue = await select
        .locator('option')
        .filter({ hasText: E2E_USERS.workerHandPress.displayName })
        .first()
        .getAttribute('value');
      expect(workerOptionValue).toBeTruthy();
      await select.selectOption(workerOptionValue as string);

      await page.getByRole('button', { name: /确认排产/ }).click();
      // 排产成功有两条 navigation 在赛跑：(a) SchedulingForm 的
      // useEffect router.push('/orders/[id]')；(b) server revalidate
      // 后该 order 不再 PENDING_SCHEDULE，detail 页 redirect 回
      // /foreman/scheduling。哪条赢都说明排产 OK，等&ldquo;离开排产
      // 详情页&rdquo;就够了。
      await page.waitForURL(
        (url) =>
          !url.pathname.startsWith(`/foreman/scheduling/${orderId}`),
        { timeout: 10_000 },
      );
    });

    await test.step('WORKER 登录任务列表 → 进入任务详情', async () => {
      await logout(page);
      await login(page, {
        from: '/worker/tasks',
        username: E2E_USERS.workerHandPress.username,
        password: E2E_PASSWORD,
      });
      // /worker/tasks 列表里每个 Link 显示 {orderNo}, {item.name},
      // {craft.name} 等 —— 按 itemName 唯一识别我们这条任务。
      await page
        .getByRole('link')
        .filter({ hasText: itemName })
        .first()
        .click();
      await page.waitForURL(/\/worker\/tasks\/[a-z0-9]+/);
    });

    await test.step('WORKER 开机 → 报工 (PENDING → IN_PROGRESS → COMPLETED)', async () => {
      await page.getByRole('button', { name: /开始生产/ }).click();
      // IN_PROGRESS 后报工表单出现。
      await expect(page.locator('input[name="completedQty"]')).toBeVisible({
        timeout: 10_000,
      });
      await page.locator('input[name="completedQty"]').fill('1000');
      await page.locator('input[name="defectQty"]').fill('0');
      await page.locator('input[name="reworkQty"]').fill('0');
      await page
        .getByRole('button', { name: /^完工报工$/ })
        .click();
      // 完工后页面 COMPLETED 段渲染 <h2>已完工</h2>。 strict mode 下
      // text=已完工 同时撞到 status badge 和 h2 两个元素，所以 scope
      // 到 heading。
      await expect(
        page.getByRole('heading', { name: '已完工' }),
      ).toBeVisible({ timeout: 10_000 });
    });

    await test.step('OWNER 视角验证工单 cascade 到 FINISHED', async () => {
      await logout(page);
      await login(page, {
        from: orderUrl,
        username: ADMIN_USERNAME,
        password: ADMIN_PASSWORD,
      });
      // 详情页 status badge 应显示&ldquo;已完工&rdquo;（OrderStatus.FINISHED）。
      // 用工单详情页里 Row 渲染状态那一格 + customerRef 双重确认我们看的
      // 是同一个工单。
      // orderRef 在 customerRef row、item name、OrderLog 各出现一次
      // —— first() 避开 strict mode。订单详情页头部的 status badge
      // 渲染&ldquo;已完工&rdquo;。两个一起断言确认我们看的是这个工单且 cascade
      // 真的触发了 (HANDOFF round 39: cascade 锁后 fresh-read race
      // —— 这一断言是这条 E2E 的核心价值)。
      await expect(page.getByText(orderRef).first()).toBeVisible();
      await expect(
        page.locator('span').filter({ hasText: /^已完工$/ }).first(),
      ).toBeVisible();
    });
  });
});
