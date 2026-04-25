import { test, expect } from '@playwright/test';
import {
  login,
  uniqueSuffix,
  E2E_USERS,
  getUserIdByUsername,
  seedFinishedOrder,
  resetBillsForUser,
  resetCsSalaryStateForUser,
  seedActiveCsPeriod,
  readActiveCsTotalSales,
  midShanghaiMonth,
  ADMIN_USERNAME,
  ADMIN_PASSWORD,
} from './_helpers';

// Wave 4 (per user redirect — SHIP/FINISH not yet implemented).
//
// CS 业绩累加 是已实现但完全没 E2E 覆盖的钱相关链路：
// recordPayment 在 bill.salesUser.role === CUSTOMER_SERVICE 时调
// accumulateCsSales(amount, tx)，给 CS 用户当前 IN_PROGRESS
// SalaryPeriod 的 totalSales 加上付款金额。
// 这一行 mock 单测很容易绿，但真实 DB + tx 下：
//   - per-CS-user advisory lock (round 46 P0)
//   - tx 必须贯穿 bill update + period update (round 52 P1)
//   - period 找不到时静默 csAccumulated=false (round 46 之前 race)
// 三件事都是单测抓不到的 prod-only 行为。E2E 在这里价值最高。

test.describe('CS 业绩累加 — golden path', () => {
  test('CS bill payment → SalaryPeriod.totalSales 增加正好等于付款金额', async ({
    page,
  }) => {
    test.setTimeout(60_000);

    const customerRef = `e2e-cs-${uniqueSuffix()}`;
    const totalAmount = '3000.00';

    const csUserId = await getUserIdByUsername(E2E_USERS.customerService.username);

    // Reset 旧 bill / 订单 / 工资周期 — 让本次 run 处于已知初态。
    await resetBillsForUser(csUserId);
    await resetCsSalaryStateForUser(csUserId);

    // Seed 一条 IN_PROGRESS SalaryPeriod (totalSales=0) + 一条
    // 当月 FINISHED 工单 (totalAmount=3000)。
    const { periodId } = await seedActiveCsPeriod({
      csUserId,
      monthlyBase: '5000.00',
    });
    await seedFinishedOrder({
      submitterId: csUserId,
      submitterRole: 'CUSTOMER_SERVICE',
      customerRef,
      totalAmount,
      finishedAt: midShanghaiMonth(),
    });

    // 初态确认：周期 totalSales=0
    const before = await readActiveCsTotalSales(csUserId);
    expect(before?.periodId).toBe(periodId);
    // pg numeric 序列化为带小数的字符串，"0" / "0.00" 都可能 —— 用 Number 比。
    expect(Number(before!.totalSales)).toBe(0);

    await test.step('OWNER 登录账单页', async () => {
      await login(page, {
        from: '/owner/bills',
        username: ADMIN_USERNAME,
        password: ADMIN_PASSWORD,
      });
    });

    await test.step('生成本月账单', async () => {
      await page
        .getByRole('button', { name: /^生成 \/ 追加月账单$/ })
        .click();
      await expect(page.getByText(/已生成 \d+ 条/)).toBeVisible({
        timeout: 10_000,
      });
    });

    await test.step('点进 CS 用户的账单详情', async () => {
      // 行通过 displayName + 总额定位，跟 bill-flow 同样套路。
      const row = page
        .locator('table tbody tr')
        .filter({ hasText: E2E_USERS.customerService.displayName })
        .filter({ hasText: /¥ 3000\b/ })
        .first();
      await expect(row).toBeVisible({ timeout: 10_000 });
      await row.getByRole('link', { name: /详情/ }).click();
      await page.waitForURL(/\/owner\/bills\/[a-z0-9]+/);
    });

    await test.step('发单 + 录入全款', async () => {
      await page
        .getByRole('button', { name: /^发单给销售 \/ 客服$/ })
        .click();
      await expect(page.locator('input[name="amount"]')).toBeVisible({
        timeout: 10_000,
      });
      await page.locator('input[name="amount"]').fill(totalAmount);
      await page.getByRole('button', { name: /^录入付款$/ }).click();
      // FULLY_PAID badge 出现 = bill 写入成功
      await expect(
        page.locator('[data-slot="badge"]').filter({ hasText: /^已结清$/ }),
      ).toBeVisible({ timeout: 10_000 });
    });

    await test.step('CS 业绩累加：SalaryPeriod.totalSales 应等于付款金额', async () => {
      // 核心断言：DB 直读 SalaryPeriod，验证 recordPayment 的 tx
      // 真把 accumulateCsSales 的 increment 一起 commit (round 52 P1)，
      // 金额对得上付款额 (round 46 lock 内 fresh-read 后再 increment
      // 的正确性)。
      //
      // 不在 UI 断言 "客服业绩已累计" —— 那段文案在 RecordPaymentForm
      // 的 success state 里，bill 切到 FULLY_PAID 时父详情页 revalidate
      // 会把 form 整段卸载（状态分支不渲染 ISSUED/PARTIAL_PAID 时的
      // form），UI 文案天生有竞态。DB 是 source of truth。
      const after = await readActiveCsTotalSales(csUserId);
      expect(after?.periodId).toBe(periodId);
      expect(Number(after!.totalSales)).toBe(Number(totalAmount));
    });
  });
});
