import { test, expect } from '@playwright/test';
import {
  login,
  uniqueSuffix,
  E2E_USERS,
  getUserIdByUsername,
  seedFinishedOrder,
  resetBillsForUser,
  midShanghaiMonth,
  ADMIN_USERNAME,
  ADMIN_PASSWORD,
} from './_helpers';

// Wave 3 / 账单全链 — 第二条最复杂的 advisory-lock 链路：
//   generateBillsForPeriod  (advisory lock per (salesUserId, period)
//                            + DB UNIQUE(billId, orderId) 兜底)
//   issueBill               (per-bill lock + 状态机 DRAFT → ISSUED)
//   recordPayment           (per-bill lock + tx + 累加付款 +
//                            status 转换 ISSUED → FULLY_PAID)
//
// 单测都 mock 了 db.$executeRaw / $transaction，永远抓不到&ldquo;Prisma 7
// 反序列化 void&rdquo;这种 prod-only bug —— 这条 E2E 是这条链的唯一真验证。
//
// 不走&ldquo;销售真实创建 + 排产 + 报工 + 完工&rdquo;的整条 production 流程
// 是有意识的：那 6 步是 wave 2 的覆盖范围；wave 3 只想验证账单。所以
// 用 seedFinishedOrder() 直接 insert 一条 status=FINISHED + finishedAt=
// NOW() 的 Order 进 DB，跳过 production 链。

test.describe('账单全链 — golden path', () => {
  test('seed FINISHED order → ADMIN 生成 → 发单 → 录入全款 → FULLY_PAID', async ({
    page,
  }) => {
    test.setTimeout(60_000);

    const customerRef = `e2e-bill-${uniqueSuffix()}`;
    const totalAmount = '5000.00';

    // Setup: SALES 用户的 id（globalSetup 已建好）+ 一条 FINISHED 工单。
    const salesUserId = await getUserIdByUsername(E2E_USERS.sales.username);

    // 清掉这个 sales 用户的旧 E2E 账单 + 订单数据。dev DB 共享，
    // generateBillsForPeriod 又是 per-(salesUser, period) upsert
    // —— 不清的话第二次 run 会复用上次 ISSUED/FULLY_PAID 的账单，
    // 然后 generate 报错 (账单已发不再追加)。
    await resetBillsForUser(salesUserId);

    const { orderNo } = await seedFinishedOrder({
      submitterId: salesUserId,
      submitterRole: 'SALES',
      customerRef,
      totalAmount,
      // 中旬 12:00 UTC = 20:00 Shanghai —— 双月份 bound 都稳。NOW()
      // 在 UTC PG 上靠近 Shanghai 月初会落到上月，bill 永远生不出来
      // (Codex round 79 / P2)。
      finishedAt: midShanghaiMonth(),
    });

    await test.step('ADMIN 登录账单页', async () => {
      await login(page, {
        from: '/owner/bills',
        username: ADMIN_USERNAME,
        password: ADMIN_PASSWORD,
      });
    });

    await test.step('生成本月账单（GenerateBillsForm 默认 period=当月）', async () => {
      await page
        .getByRole('button', { name: /^生成 \/ 追加月账单$/ })
        .click();
      // GenerateBillsForm 在 success 时渲染&ldquo;{period} 已生成 N 条&rdquo;
      // 文案 —— 等到它出现，确认 action 跑完。
      await expect(page.getByText(/已生成 \d+ 条/)).toBeVisible({
        timeout: 10_000,
      });
    });

    await test.step('点进我们刚建的工单对应的账单详情', async () => {
      // 账单列表用 customerRef 没有，工单号有。bill row 显示销售人员名 +
      // 周期 + 总额 + 状态；点&ldquo;详情&rdquo;链接进去。
      // 由于 e2e-sales 在 dev DB 里只有这一条 SALES 角色 + 当月 FINISHED
      // 订单（其他 wave 创建的 Order 都没到 FINISHED），这条 bill 的
      // 销售姓名是&ldquo;E2E 销售&rdquo;。
      // Prisma 的 Decimal.toString() 不带尾随 0；UI 渲染 "¥ 5000" 而非
      // "¥ 5000.00"。匹配 displayName + 不带小数的金额，避免被别的行
      // 的 "¥ 0" 干扰用 \b 边界。
      const row = page
        .locator('table tbody tr')
        .filter({ hasText: E2E_USERS.sales.displayName })
        .filter({ hasText: /¥ 5000\b/ })
        .first();
      // strict-mode 防御：先 expect 这一行存在再点 link。
      await expect(row).toBeVisible({ timeout: 10_000 });
      await row.getByRole('link', { name: /详情/ }).click();
      await page.waitForURL(/\/owner\/bills\/[a-z0-9]+/);
    });

    await test.step('详情页确认是同一张账单 + 工单明细里有我们 seed 的 orderNo', async () => {
      await expect(
        page.locator('table tbody').getByText(orderNo),
      ).toBeVisible({ timeout: 5_000 });
    });

    await test.step('发单 (DRAFT → ISSUED)', async () => {
      await page
        .getByRole('button', { name: /^发单给销售 \/ 客服$/ })
        .click();
      // 发单后&ldquo;录入付款&rdquo;表单出现 (ISSUED 状态分支)。
      await expect(page.locator('input[name="amount"]')).toBeVisible({
        timeout: 10_000,
      });
      // 状态 badge 切换为&ldquo;已发单&rdquo;。
      await expect(
        page.locator('[data-slot="badge"]').filter({ hasText: /^已发单$/ }),
      ).toBeVisible();
    });

    await test.step('录入完整付款 (ISSUED → FULLY_PAID)', async () => {
      await page.locator('input[name="amount"]').fill(totalAmount);
      await page.getByRole('button', { name: /^录入付款$/ }).click();
      // FULLY_PAID 是终态：status badge 切到&ldquo;已结清&rdquo;，&ldquo;录入付款&rdquo;
      // 表单消失（detail 页只在 ISSUED / PARTIAL_PAID 状态渲染）。
      await expect(
        page.locator('[data-slot="badge"]').filter({ hasText: /^已结清$/ }),
      ).toBeVisible({ timeout: 10_000 });
      await expect(page.locator('input[name="amount"]')).toHaveCount(0);
    });
  });
});
