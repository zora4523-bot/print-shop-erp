import { test, expect } from '@playwright/test';
import {
  login,
  logout,
  uniqueSuffix,
  E2E_PASSWORD,
  E2E_USERS,
  openFirstOrderItemEditor,
  submitDraftOrderAndWait,
} from './_helpers';

test.describe('非机台生产任务', () => {
  test('排产只显示匹配岗位，打包师傅可完工且不生成计件', async ({ page }) => {
    test.setTimeout(60_000);
    const suffix = uniqueSuffix();
    const orderRef = `e2e-pack-${suffix}`;
    const customName = `E2E 打包工单 ${suffix}`;
    const itemName = `E2E 打包款 ${suffix}`;
    let orderId = '';
    let orderUrl = '';

    await login(page, {
      from: '/orders/new',
      username: E2E_USERS.foreman.username,
      password: E2E_PASSWORD,
    });
    await page.getByRole('textbox', { name: '工单名称' }).fill(customName);
    await page.locator('input[name="customerRef"]').fill(orderRef);
    await openFirstOrderItemEditor(page);
    await page.locator('input[name="items.0.name"]').fill(itemName);
    await page.locator('input[name="items.0.quantity"]').fill('100');
    await page
      .getByRole('combobox', { name: '报价产品' })
      .selectOption({ label: '珠光艳闪 160g · 大号封' });
    const packingCraft = page.getByRole('button', {
      name: '打包/入袋',
      exact: true,
    });
    await packingCraft.click();
    await expect(packingCraft).toHaveAttribute('aria-pressed', 'true');
    await page.locator('input[name="items.0.unitPrice"]').fill('1.00');
    await page
      .locator('textarea[name="items.0.priceOverrideReason"]')
      .fill('E2E 非机台任务人工报价');
    await page
      .getByRole('textbox', { name: '收货地址', exact: true })
      .fill('E2E 收货人 13800138000 广东省佛山市测试路 1 号');
    await page
      .getByRole('button', { name: '保存草稿', exact: true })
      .click();
    await page.waitForURL(/\/orders\/(?!new\b)[a-z0-9]+(\/|$)/);
    orderUrl = new URL(page.url()).pathname;
    orderId = orderUrl.split('/').filter(Boolean).pop() ?? '';
    await submitDraftOrderAndWait(page);

    await logout(page);
    await login(page, {
      from: `/foreman/scheduling/${orderId}`,
      username: E2E_USERS.foreman.username,
      password: E2E_PASSWORD,
    });
    const assignmentRow = page
      .getByRole('row')
      .filter({ hasText: itemName })
      .filter({ hasText: '打包/入袋' });
    const foilAssignmentRow = page
      .getByRole('row')
      .filter({ hasText: itemName })
      .filter({ hasText: '局部烫金' });
    const handPressRadio = foilAssignmentRow
      .getByRole('radio')
      .filter({ hasText: E2E_USERS.workerHandPress.displayName });
    const packerRadio = assignmentRow
      .getByRole('radio')
      .filter({ hasText: E2E_USERS.workerPacker.displayName });
    await expect(handPressRadio).toHaveCount(1);
    await expect(packerRadio).toHaveCount(1);
    await expect(
      assignmentRow
        .getByRole('radio')
        .filter({ hasText: E2E_USERS.workerHandPress.displayName }),
    ).toHaveCount(0);
    await handPressRadio.click();
    await packerRadio.click();
    await expect(handPressRadio).toHaveAttribute('aria-checked', 'true');
    await expect(packerRadio).toHaveAttribute('aria-checked', 'true');
    const confirmScheduling = page.getByRole('button', { name: /确认排产/ });
    await expect(confirmScheduling).toBeEnabled();
    await confirmScheduling.click();
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
    await expect(page.getByText('计件金额', { exact: true })).toHaveCount(0);
  });
});
