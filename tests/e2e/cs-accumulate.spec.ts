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
  readE2eOrderPricingSnapshot,
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
  test('客服自动计价提交计入业绩，外部销售两次回款均不改写客服业绩', async ({
    page,
  }) => {
    test.setTimeout(90_000);

    const suffix = uniqueSuffix();
    const submittedCustomerRef = `e2e-cs-submit-${suffix}`;
    const internalFinishedCustomerRef = `e2e-bill-cs-internal-${suffix}`;
    const externalBilledCustomerRef = `e2e-bill-sales-${suffix}`;
    const billingFixtureAmount = '3000.00';
    const halfBillingPayment = '1500.00';
    let submittedCsOrderAmount = '';
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

    await test.step('客服创建并提交自动计价工单，提交事件按工单金额计入业绩', async () => {
      await login(page, {
        from: '/orders/new',
        username: E2E_USERS.customerService.username,
        password: E2E_PASSWORD,
      });
      await openFirstOrderItemEditor(page);
      const form = page.locator('[data-slot="order-form-b"]');
      await form
        .getByRole('textbox', { name: '工单名称', exact: true })
        .fill(`E2E 客服自动计价 ${suffix}`);
      await form
        .getByRole('textbox', { name: '客户名称/简称', exact: true })
        .fill(submittedCustomerRef);

      await form
        .getByRole('group', { name: '工艺类型' })
        .getByRole('button', { name: '局部烫金', exact: true })
        .click();
      await form
        .getByRole('group', { name: '纸张材质' })
        .getByRole('button', { name: '珠光艳闪', exact: true })
        .click();
      await form
        .getByRole('group', { name: '规格' })
        .getByRole('button', { name: '大号封', exact: true })
        .click();
      await form
        .getByRole('group', { name: '克重' })
        .getByRole('button', { name: '160g', exact: true })
        .click();
      await form
        .getByRole('textbox', { name: '款式名', exact: true })
        .fill('E2E 客服业绩款');
      await form
        .getByRole('spinbutton', { name: '数量', exact: true })
        .fill('1000');
      await form
        .getByRole('textbox', { name: '收货地址', exact: true })
        .fill('E2E 收货人 13800138000 广东省佛山市南海区测试路 1 号');
      await form
        .getByRole('checkbox', { name: '顺丰到付（本单不计快递费）' })
        .check();
      await expect(
        form.getByRole('textbox', { name: '成交单价' }),
      ).toHaveCount(0);
      await expect(
        form.getByRole('textbox', { name: '人工改价说明' }),
      ).toHaveCount(0);
      await form
        .getByRole('button', { name: '保存草稿', exact: true })
        .click();
      await page.waitForURL(/\/orders\/(?!new\b)[a-z0-9]+(\/|$)/, {
        timeout: 45_000,
      });
      const orderId = new URL(page.url()).pathname
        .split('/')
        .filter(Boolean)
        .pop()!;
      const pricing = await readE2eOrderPricingSnapshot({
        orderId,
        customerRef: submittedCustomerRef,
      });
      expect(pricing).not.toBeNull();
      expect(pricing!.settlementType).toBe('INTERNAL_SALES');
      expect(pricing!.pricingStatus).toBe('AUTO_CONFIRMED');
      expect(Number(pricing!.totalAmount)).toBeGreaterThan(0);
      submittedCsOrderAmount = pricing!.totalAmount;

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
        .toBe(Number(submittedCsOrderAmount));
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
      totalAmount: billingFixtureAmount,
      finishedAt: midShanghaiMonth(),
    });
    await seedFinishedOrder({
      submitterId: salesUserId,
      submitterRole: 'SALES',
      customerRef: externalBilledCustomerRef,
      totalAmount: billingFixtureAmount,
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
      const publishDialog = page.getByRole('alertdialog', {
        name: /^确认发布 .* 账单？$/,
      });
      await expect(publishDialog).toBeVisible();
      await publishDialog
        .getByRole('button', { name: '确认发单', exact: true })
        .click();
      await expect(page.locator('input[name="amount"]')).toBeVisible({
        timeout: 10_000,
      });
    });

    await test.step('第一笔客户付款只更新应收，客服提交业绩保持不变', async () => {
      await page.locator('input[name="amount"]').fill(halfBillingPayment);
      await page
        .getByRole('button', { name: '核对并录入付款', exact: true })
        .click();
      const paymentDialog = page.getByRole('alertdialog', {
        name: '确认录入这笔收款？',
        exact: true,
      });
      await expect(paymentDialog).toBeVisible();
      await paymentDialog
        .getByRole('button', { name: '确认录入付款', exact: true })
        .click();
      await expect(
        page.locator('[data-slot="badge"]').filter({ hasText: /^部分结清$/ }),
      ).toBeVisible({ timeout: 10_000 });

      const afterFirstPayment = await readActiveCsTotalSales(csUserId);
      expect(afterFirstPayment?.periodId).toBe(periodId);
      expect(Number(afterFirstPayment!.totalSales)).toBe(
        Number(submittedCsOrderAmount),
      );
    });

    await test.step('第二笔客户付款结清账单，客服提交业绩仍不变', async () => {
      await expect(page.locator('input[name="amount"]')).toBeVisible({
        timeout: 5_000,
      });
      await page.locator('input[name="amount"]').fill(halfBillingPayment);
      await page
        .getByRole('button', { name: '核对并录入付款', exact: true })
        .click();
      const paymentDialog = page.getByRole('alertdialog', {
        name: '确认录入这笔收款？',
        exact: true,
      });
      await expect(paymentDialog).toBeVisible();
      await paymentDialog
        .getByRole('button', { name: '确认录入付款', exact: true })
        .click();
      await expect(
        page.locator('[data-slot="badge"]').filter({ hasText: /^已结清$/ }),
      ).toBeVisible({ timeout: 10_000 });

      const afterSecondPayment = await readActiveCsTotalSales(csUserId);
      expect(afterSecondPayment?.periodId).toBe(periodId);
      expect(Number(afterSecondPayment!.totalSales)).toBe(
        Number(submittedCsOrderAmount),
      );
    });
  });
});
