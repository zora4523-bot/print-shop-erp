import { test, expect } from '@playwright/test';
import {
  login,
  uniqueSuffix,
  E2E_PASSWORD,
  seedFinishedOrder,
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
import { seedUniqueCustomerService } from './_cs-notification-fixtures';

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
  test('客服默认零版费工单提交计入业绩，代理商整单收款不改写客服业绩', async ({
    browser,
    baseURL,
  }) => {
    test.setTimeout(90_000);

    const suffix = uniqueSuffix();
    const submittedCustomerRef = `e2e-cs-submit-${suffix}`;
    const internalFinishedCustomerRef = `e2e-bill-cs-internal-${suffix}`;
    const externalBilledCustomerRef = `e2e-bill-sales-${suffix}`;
    const billingFixtureAmount = '3000.00';
    let submittedCsOrderAmount = '';
    const cs = await seedUniqueCustomerService();
    const csUserId = cs.id;
    const csContext = await browser.newContext({ baseURL });
    const adminContext = await browser.newContext({ baseURL });
    let page = await csContext.newPage();
    try {

      const { periodId } = await seedActiveCsPeriod({
        csUserId,
        monthlyBase: '5000.00',
      });
      const before = await readActiveCsTotalSales(csUserId);
      expect(before?.periodId).toBe(periodId);
      expect(Number(before!.totalSales)).toBe(0);

      await test.step('客服创建并提交默认零版费工单，提交事件按已确认金额计入业绩', async () => {
        await login(page, {
          from: '/orders/new',
          username: cs.username,
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
          .getByRole('group', { name: '工单类型' })
          .getByRole('button', { name: '局部烫金', exact: true })
          .click();
        await form
          .getByRole('group', { name: '纸张材质' })
          .getByRole('button', { name: '艳红珠光纸', exact: true })
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
          .getByRole('textbox', { name: '设计款名称', exact: true })
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
        // 现行决策：独立版费默认 0，不因没有人工版费而制造待核价状态。
        // 历史显式待定版费仍由领域回归验证，不能反向改变新建单契约。
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

      // Independent actors keep this financial boundary test separate from
      // logout/prefetch races, which have their own authentication regression.
      page = await adminContext.newPage();

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
          from: `/owner/agent-bills?period=${billingFixture.period}&agentUserId=${billingFixture.agentUserId}`,
          username: ADMIN_USERNAME,
          password: ADMIN_PASSWORD,
        });
        await page
          .getByRole('button', { name: '生成或更新草稿' })
          .click();
        await expect(
          page.getByText(
            new RegExp(`^已生成或更新 \\d+ 张 ${billingFixture.period} 账单$`, 'u'),
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
    } finally {
      await csContext.close();
      await adminContext.close();
    }
  });
});
