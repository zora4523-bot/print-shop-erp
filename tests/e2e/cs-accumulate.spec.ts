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
  midPreviousShanghaiMonth,
  ADMIN_USERNAME,
  ADMIN_PASSWORD,
  openFirstOrderItemEditor,
  readE2eOrderPricingSnapshot,
  seedSettledExternalSalesOrder,
  submitDraftOrderAndWait,
} from './_helpers';

// This E2E protects the boundary between two independent financial facts:
//
// - CS performance is credited when a charged order is submitted. Approved
//   order changes and cancellations later append their own delta entries.
// - V2 agent-bill receipts settle the external receivable and must never
//   credit the same amount into the independent CS performance ledger.
//
// Unit tests can mock either side independently; this flow proves the real
// browser actions and PostgreSQL transactions preserve that separation.
test.describe('客服业绩事件账本与外部销售应收分离', () => {
  test('客服待核制版费工单提交计入已知业绩，代理商整单收款不改写客服业绩', async ({
    page,
  }) => {
    test.setTimeout(90_000);

    const suffix = uniqueSuffix();
    const submittedCustomerRef = `e2e-cs-submit-${suffix}`;
    const internalFinishedCustomerRef = `e2e-bill-cs-internal-${suffix}`;
    const externalBilledCustomerRef = `e2e-bill-sales-${suffix}`;
    const billingFixtureAmount = '3000.00';
    let submittedCsOrderAmount = '';
    const csUserId = await getUserIdByUsername(
      E2E_USERS.customerService.username,
    );

    await resetBillsForUser(csUserId);
    await resetCsSalaryStateForUser(csUserId);

    const { periodId } = await seedActiveCsPeriod({
      csUserId,
      monthlyBase: '5000.00',
    });
    const before = await readActiveCsTotalSales(csUserId);
    expect(before?.periodId).toBe(periodId);
    expect(Number(before!.totalSales)).toBe(0);

    await test.step('客服创建并提交待核制版费工单，提交事件按当前已知金额计入业绩', async () => {
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
      const sfCollectCheckbox = form.getByRole('checkbox', {
        name: '顺丰到付（本单不计快递费）',
      });
      await sfCollectCheckbox.click();
      await expect(sfCollectCheckbox).toBeChecked();
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
      // 局部烫金的材料与机烫费已自动计价，但制版费金额待工厂确认。
      // 当前契约必须 fail closed，不能把“已知部分有价”误判为终价已确认。
      expect(pricing!.pricingStatus).toBe('PENDING_ADMIN_CONFIRMATION');
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

    // V2 billing scans only explicitly settled EXTERNAL_SALES orders. Keep a
    // legacy internal-CS FINISHED row in the same month, then add one v2
    // settled external order: only the latter may enter the agent bill.
    const settledAt = midPreviousShanghaiMonth();
    await seedFinishedOrder({
      submitterId: csUserId,
      submitterRole: 'CUSTOMER_SERVICE',
      customerRef: internalFinishedCustomerRef,
      totalAmount: billingFixtureAmount,
      finishedAt: settledAt,
    });
    const billingFixture = await seedSettledExternalSalesOrder({
      customerRef: externalBilledCustomerRef,
      settledFee: billingFixtureAmount,
      settledAt,
    });

    await test.step('管理员生成外部销售应收，内部客服单不进账单', async () => {
      await login(page, {
        from: '/owner/bills',
        username: ADMIN_USERNAME,
        password: ADMIN_PASSWORD,
      });
      await page
        .getByRole('button', { name: '生成 / 同步 DRAFT' })
        .click();
      await expect(
        page.getByText(
          new RegExp(`^已同步 \\d+ 张 ${billingFixture.period} 账单$`, 'u'),
        ),
      ).toBeVisible({ timeout: 15_000 });

      const row = page
        .locator('table tbody tr')
        .filter({ hasText: billingFixture.agentDisplayName })
        .filter({ hasText: /¥ 3,000\.00\b/ })
        .first();
      await expect(row).toBeVisible({ timeout: 10_000 });
      await row.getByRole('link', { name: '详情', exact: true }).click();
      await page.waitForURL(/\/owner\/agent-bills\/[a-z0-9_-]+$/i);
      await expect(page.getByText(externalBilledCustomerRef)).toBeVisible();
      await expect(page.getByText(internalFinishedCustomerRef)).toHaveCount(0);

      await page.getByRole('button', { name: '确认并冻结账单' }).click();
      await expect(
        page.locator('[data-slot="badge"]').filter({ hasText: /^已确认·待收$/ }),
      ).toBeVisible({ timeout: 15_000 });
    });

    await test.step('代理商整单收款不改写客服提交业绩', async () => {
      await page.getByLabel('收款方式').fill('银行转账');
      await page.getByLabel('流水号').fill(`E2E-CS-${suffix}`);
      await page.getByRole('button', { name: '标记已收' }).click();
      await expect(
        page.locator('[data-slot="badge"]').filter({ hasText: /^已收$/ }),
      ).toBeVisible({ timeout: 15_000 });

      const afterPayment = await readActiveCsTotalSales(csUserId);
      expect(afterPayment?.periodId).toBe(periodId);
      expect(Number(afterPayment!.totalSales)).toBe(
        Number(submittedCsOrderAmount),
      );
    });
  });
});
