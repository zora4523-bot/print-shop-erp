import { test, expect } from '@playwright/test';
import {
  login,
  logout,
  uniqueSuffix,
  E2E_PASSWORD,
  E2E_USERS,
} from './_helpers';

test.describe('非机台生产任务', () => {
  test('排产只显示匹配岗位，打包师傅可完工且不生成计件', async ({ page }) => {
    test.setTimeout(60_000);
    const suffix = uniqueSuffix();
    const orderRef = `e2e-pack-${suffix}`;
    const itemName = `E2E 打包款 ${suffix}`;
    let orderId = '';
    let orderUrl = '';

    await login(page, {
      from: '/orders/new',
      username: E2E_USERS.sales.username,
      password: E2E_PASSWORD,
    });
    await page.locator('input[name="customerRef"]').fill(orderRef);
    await page.locator('input[name="items.0.name"]').fill(itemName);
    await page.locator('input[name="items.0.quantity"]').fill('100');
    await page
      .locator('label')
      .filter({ hasText: '打包/入袋' })
      .locator('input[type="checkbox"]')
      .check();
    await page.getByRole('button', { name: /创建工单/ }).click();
    await page.waitForURL(/\/orders\/(?!new\b)[a-z0-9]+(\/|$)/);
    orderUrl = new URL(page.url()).pathname;
    orderId = orderUrl.split('/').filter(Boolean).pop() ?? '';
    await page.getByRole('button', { name: /^提交工单$/ }).click();
    await expect(page.getByRole('button', { name: /^提交工单$/ })).toHaveCount(0);

    await logout(page);
    await login(page, {
      from: `/foreman/scheduling/${orderId}`,
      username: E2E_USERS.foreman.username,
      password: E2E_PASSWORD,
    });
    const workerSelect = page.locator('select').first();
    await expect(
      workerSelect.locator('option').filter({ hasText: E2E_USERS.workerPacker.displayName }),
    ).toHaveCount(1);
    await expect(
      workerSelect.locator('option').filter({ hasText: E2E_USERS.workerHandPress.displayName }),
    ).toHaveCount(0);
    const packerValue = await workerSelect
      .locator('option')
      .filter({ hasText: E2E_USERS.workerPacker.displayName })
      .getAttribute('value');
    await workerSelect.selectOption(packerValue as string);
    await page.getByRole('button', { name: /确认排产/ }).click();
    await page.waitForURL(
      (url) => !url.pathname.startsWith(`/foreman/scheduling/${orderId}`),
    );

    // The administrator can correct a pending assignment from the order.
    await page.goto(orderUrl);
    await expect(
      page.getByRole('heading', { name: '未开工任务改派' }),
    ).toBeVisible();
    await expect(page.getByText(`当前：${E2E_USERS.workerPacker.displayName}`)).toBeVisible();

    await logout(page);
    await login(page, {
      from: '/worker/tasks',
      username: E2E_USERS.workerPacker.username,
      password: E2E_PASSWORD,
    });
    await page.getByRole('link').filter({ hasText: itemName }).first().click();
    await page.getByRole('button', { name: /开始生产/ }).click();
    await expect(page.getByText(/工资按考勤时薪结算/)).toBeVisible();
    await page.locator('input[name="completedQty"]').fill('100');
    await page.locator('input[name="defectQty"]').fill('0');
    await page.locator('input[name="reworkQty"]').fill('0');
    await page.getByRole('button', { name: /^完工报工$/ }).click();
    await expect(page.getByRole('heading', { name: '已完工' })).toBeVisible();
    await expect(page.getByText('按考勤时薪结算')).toBeVisible();
    await expect(page.getByText('计件金额')).toHaveCount(0);
  });
});
