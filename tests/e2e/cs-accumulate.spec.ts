import { test, expect } from '@playwright/test';
import {
  login,
  logout,
  uniqueSuffix,
  E2E_PASSWORD,
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
  openFirstOrderItemEditor,
  submitDraftOrderAndWait,
} from './_helpers';

// This E2E protects the boundary between two independent financial facts:
//
// - CS performance is credited when a charged order is submitted. Approved
//   order changes and cancellations later append their own delta entries.
// - Customer receipts append BillPayment rows and must never credit the same
//   sales amount again.
//
// Unit tests can mock either side independently; this flow proves the real
// browser actions and PostgreSQL transactions preserve that separation.
test.describe('客服业绩事件账本与外部销售应收分离', () => {
  test('客服提交计入业绩，外部销售两次回款均不改写客服业绩', async ({ page }) => {
    test.setTimeout(90_000);

    const suffix = uniqueSuffix();
    const submittedCustomerRef = `e2e-cs-submit-${suffix}`;
    const internalFinishedCustomerRef = `e2e-bill-cs-internal-${suffix}`;
    const externalBilledCustomerRef = `e2e-bill-sales-${suffix}`;
    const totalAmount = '3000.00';
    const halfAmount = '1500.00';
    const csUserId = await getUserIdByUsername(
      E2E_USERS.customerService.username,
    );
    const salesUserId = await getUserIdByUsername(
      E2E_USERS.billingSales.username,
    );

    await resetBillsForUser(csUserId);
    await resetBillsForUser(salesUserId);
    await resetCsSalaryStateForUser(csUserId);

    const { periodId } = await seedActiveCsPeriod({
      csUserId,
      monthlyBase: '5000.00',
    });
    const before = await readActiveCsTotalSales(csUserId);
    expect(before?.periodId).toBe(periodId);
    expect(Number(before!.totalSales)).toBe(0);

    await test.step('客服创建并提交 3000 元工单，提交事件立即计入业绩', async () => {
      await login(page, {
        from: '/orders/new',
        username: E2E_USERS.customerService.username,
        password: E2E_PASSWORD,
      });
      await page
        .locator('input[name="customerRef"]')
        .fill(submittedCustomerRef);
      await openFirstOrderItemEditor(page);
      await page.locator('input[name="items.0.name"]').fill('E2E 客服业绩款');
      await page.locator('input[name="items.0.quantity"]').fill('1000');
      await page.locator('input[name="items.0.unitPrice"]').fill('3.00');
      await page
        .locator('textarea[name="items.0.priceOverrideReason"]')
        .fill('E2E 客服业绩固定测试价');
      await page.getByRole('button', { name: '现货加烫' }).click();
      await page.getByRole('tab', { name: /收货与费用/ }).click();
      await page
        .getByLabel('收货信息', { exact: true })
        .fill('E2E 收货人 13800138000 广东省佛山市南海区测试路 1 号');
      await page
        .getByRole('button', { name: '保存草稿', exact: true })
        .click();
      await page.waitForURL(/\/orders\/(?!new\b)[a-z0-9]+(\/|$)/, {
        timeout: 10_000,
      });

      await submitDraftOrderAndWait(page);

      await expect
        .poll(
          async () => {
            const current = await readActiveCsTotalSales(csUserId);
            expect(current?.periodId).toBe(periodId);
            return Number(current!.totalSales);
          },
          { timeout: 10_000 },
        )
        .toBe(Number(totalAmount));
    });

    await logout(page);

    // Billing now intentionally scans EXTERNAL_SALES only. Seed one FINISHED
    // internal-CS order and one external-sales order in the same month: the
    // bill must contain only the external order, while the CS event ledger
    // remains the 3000 recorded at submit time.
    await seedFinishedOrder({
      submitterId: csUserId,
      submitterRole: 'CUSTOMER_SERVICE',
      customerRef: internalFinishedCustomerRef,
      totalAmount,
      finishedAt: midShanghaiMonth(),
    });
    await seedFinishedOrder({
      submitterId: salesUserId,
      submitterRole: 'SALES',
      customerRef: externalBilledCustomerRef,
      totalAmount,
      finishedAt: midShanghaiMonth(),
    });

    await test.step('管理员生成外部销售应收，内部客服单不进账单', async () => {
      await login(page, {
        from: '/owner/bills',
        username: ADMIN_USERNAME,
        password: ADMIN_PASSWORD,
      });
      await page
        .getByRole('button', { name: /^生成 \/ 追加月账单$/ })
        .click();
      await expect(page.getByText(/已生成 \d+ 条/)).toBeVisible({
        timeout: 10_000,
      });

      const row = page
        .locator('table tbody tr')
        .filter({ hasText: E2E_USERS.billingSales.displayName })
        .filter({ hasText: /¥ 3,000\.00\b/ })
        .first();
      await expect(row).toBeVisible({ timeout: 10_000 });
      await row.getByRole('link', { name: /详情/ }).click();
      await page.waitForURL(/\/owner\/bills\/[a-z0-9]+/);
      await expect(page.getByText(externalBilledCustomerRef)).toBeVisible();
      await expect(page.getByText(internalFinishedCustomerRef)).toHaveCount(0);

      await page
        .getByRole('button', { name: /^发单给销售 \/ 客服$/ })
        .click();
      await expect(page.locator('input[name="amount"]')).toBeVisible({
        timeout: 10_000,
      });
    });

    await test.step('第一笔客户付款只更新应收，业绩仍为 3000', async () => {
      await page.locator('input[name="amount"]').fill(halfAmount);
      await page.getByRole('button', { name: /^录入付款流水$/ }).click();
      await expect(
        page.locator('[data-slot="badge"]').filter({ hasText: /^部分结清$/ }),
      ).toBeVisible({ timeout: 10_000 });

      const afterFirstPayment = await readActiveCsTotalSales(csUserId);
      expect(afterFirstPayment?.periodId).toBe(periodId);
      expect(Number(afterFirstPayment!.totalSales)).toBe(Number(totalAmount));
    });

    await test.step('第二笔客户付款结清账单，业绩仍不变', async () => {
      await expect(page.locator('input[name="amount"]')).toBeVisible({
        timeout: 5_000,
      });
      await page.locator('input[name="amount"]').fill(halfAmount);
      await page.getByRole('button', { name: /^录入付款流水$/ }).click();
      await expect(
        page.locator('[data-slot="badge"]').filter({ hasText: /^已结清$/ }),
      ).toBeVisible({ timeout: 10_000 });

      const afterSecondPayment = await readActiveCsTotalSales(csUserId);
      expect(afterSecondPayment?.periodId).toBe(periodId);
      expect(Number(afterSecondPayment!.totalSales)).toBe(Number(totalAmount));
    });
  });
});
