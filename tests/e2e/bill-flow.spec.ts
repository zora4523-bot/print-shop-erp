import { test, expect } from '@playwright/test';
import {
  login,
  uniqueSuffix,
  E2E_PASSWORD,
  E2E_USERS,
  seedSettledExternalSalesOrder,
  midPreviousShanghaiMonth,
} from './_helpers';

// V2 golden path: authoritative settlement facts -> one agent/month DRAFT ->
// frozen CONFIRMED bill -> immutable full receipt -> PAID. The fixture uses a
// fresh E2E-only agent because production triggers deliberately forbid deleting
// or recycling confirmed financial facts.
test.describe('代理商月度账单 v2 全链 — golden path', () => {
  test('settled order → DRAFT → CONFIRMED → PAID，legacy 只读归档', async ({
    page,
  }) => {
    test.setTimeout(90_000);

    const totalAmount = '5000.00';
    const fixture = await seedSettledExternalSalesOrder({
      customerRef: `e2e-agent-bill-${uniqueSuffix()}`,
      settledFee: totalAmount,
      settledAt: midPreviousShanghaiMonth(),
    });

    await test.step('旧入口切换到 v2 月账单', async () => {
      await login(page, {
        from: '/owner/bills',
        username: E2E_USERS.owner.username,
        password: E2E_PASSWORD,
      });
      await page.waitForURL(/\/owner\/agent-bills(?:\?.*)?$/);
      await expect(
        page.getByRole('heading', { name: '代理商月度账单', exact: true }),
      ).toBeVisible();
    });

    await test.step('上海时区已结束月份生成 DRAFT', async () => {
      await expect(
        page.getByRole('textbox', {
          name: '结算发生月（上海时区）',
          exact: true,
        }),
      ).toHaveValue(fixture.period);
      await page.getByRole('button', { name: '生成 / 同步 DRAFT' }).click();
      await expect(
        page.getByText(
          new RegExp(`^已同步 \\d+ 张 ${fixture.period} 账单$`, 'u'),
        ),
      ).toBeVisible({ timeout: 15_000 });
    });

    await test.step('当前筛选提供异步导出入口', async () => {
      await expect(
        page.getByRole('heading', { name: '异步导出', exact: true }),
      ).toBeVisible();
      await expect(
        page.getByRole('button', { name: /导出当前结果/u }),
      ).toBeVisible();
    });

    await test.step('账单详情显示结算成员快照', async () => {
      const row = page
        .locator('table tbody tr')
        .filter({ hasText: fixture.agentDisplayName })
        .filter({ hasText: '5,000.00' })
        .first();
      await expect(row).toBeVisible({ timeout: 15_000 });
      await expect(row).toContainText('草稿');
      await row.getByRole('link', { name: '详情', exact: true }).click();
      await page.waitForURL(/\/owner\/agent-bills\/[a-z0-9_-]+$/i);
      await expect(
        page.locator('table tbody').getByText(fixture.orderNo, { exact: true }),
      ).toBeVisible();
      await expect(page.getByText('结算成员快照', { exact: true })).toBeVisible();
    });

    await test.step('确认时重新同步并永久冻结成员与金额', async () => {
      await page.getByRole('button', { name: '确认并冻结账单' }).click();
      await expect(
        page.locator('[data-slot="badge"]').filter({ hasText: /^已确认·待收$/ }),
      ).toBeVisible({ timeout: 15_000 });
      await expect(page.getByRole('button', { name: '标记已收' })).toBeVisible();
    });

    await test.step('收款金额只取服务端锁定总额，整单进入 PAID', async () => {
      await page.getByLabel('收款方式').fill('银行转账');
      await page.getByLabel('流水号').fill(`E2E-${uniqueSuffix()}`);
      await page.getByRole('button', { name: '标记已收' }).click();
      await expect(
        page.locator('[data-slot="badge"]').filter({ hasText: /^已收$/ }),
      ).toBeVisible({ timeout: 15_000 });
      await expect(
        page.getByRole('heading', { name: '不可变收款回执', exact: true }),
      ).toBeVisible();
      await expect(page.getByText('¥ 5,000.00', { exact: true })).toBeVisible();
      await expect(page.getByRole('button', { name: '标记已收' })).toHaveCount(0);
    });

    await test.step('legacy Bill 仅保留只读归档', async () => {
      await page.goto('/owner/bills/archive');
      await expect(
        page.getByRole('heading', { name: 'Legacy 账单只读归档', exact: true }),
      ).toBeVisible();
      await expect(
        page.getByRole('button', { name: /生成月账单|发单|录入付款/u }),
      ).toHaveCount(0);
      await expect(page.locator('input[name="amount"]')).toHaveCount(0);
    });
  });
});
