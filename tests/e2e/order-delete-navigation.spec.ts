import { test, expect } from '@playwright/test';
import { login, E2E_PASSWORD, E2E_USERS } from './_helpers';

for (const role of ['owner', 'sales'] as const) {
  test(`${role}: 设计款操作区整款删除，移除规格不跳到其他款`, async ({ page }) => {
    await login(page, { username: E2E_USERS[role].username, password: E2E_PASSWORD, from: '/orders/new' });
    const designName = page.getByRole('textbox', { name: '设计款名称', exact: true });
    await designName.fill('保留同款 A');
    await page.getByRole('button', { name: '＋ 添加设计款', exact: true }).click();
    await designName.fill('独立款 B');
    await page.getByRole('tab', { name: '设计款 1', exact: true }).click();
    await page.getByRole('button', { name: '＋ 添加规格', exact: true }).click();
    const specifications = page.getByRole('tablist', { name: '规格明细', exact: true });
    await specifications.getByRole('tab').first().click();
    await page.getByRole('button', { name: '移除当前规格', exact: true }).click();
    await expect(designName).toHaveValue('保留同款 A');
    await expect(specifications.getByRole('tab')).toHaveCount(1);
    await expect(specifications.getByRole('tab')).toBeFocused();
    await page.getByRole('button', { name: '＋ 添加规格', exact: true }).click();
    const remove = page.getByRole('group', { name: '设计款操作', exact: true })
      .getByRole('button', { name: '删除设计款', exact: true });
    await remove.focus();
    await remove.press('Enter');
    await expect(designName).toHaveValue('独立款 B');
    await expect(page.getByRole('tablist', { name: '设计款', exact: true }).getByRole('tab')).toHaveCount(1);
    await expect(page.getByRole('tab', { name: '设计款 1', exact: true })).toBeFocused();
    await expect(remove).toHaveCount(0);
    await expect(page.getByRole('button', { name: '移除当前规格', exact: true })).toHaveCount(0);
  });
}

test('建单校验后连续删除设计款，报价更新不抢焦点', async ({ page }) => {
  test.setTimeout(90_000);
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await login(page, { username: E2E_USERS.sales.username, password: E2E_PASSWORD, from: '/orders/new' });
  const form = page.locator('[data-slot="order-form-b"]');
  const styles = form.getByRole('tablist', { name: '设计款', exact: true });
  const copy = form.getByRole('button', { name: '＋ 添加设计款', exact: true });
  await expect(copy).toBeEnabled();
  for (let index = 1; index < 15; index++) await copy.click();
  await expect(styles.getByRole('tab')).toHaveCount(15);
  // Exercise the real RHF invalid-submit path without persisting an order.
  await form.evaluate((element) => element.closest('form')!.requestSubmit());
  await expect(form.locator('[data-slot="order-form-errors"]')).toBeVisible();
  await expect(form.getByRole('textbox', { name: '工单名称', exact: true })).toBeFocused();
  await styles.getByRole('tab').last().click();
  const remove = form.getByRole('button', { name: '删除设计款', exact: true });
  await remove.scrollIntoViewIfNeeded();
  for (let count = 15; count > 1; count--) {
    await remove.click();
    await expect(styles.getByRole('tab')).toHaveCount(count - 1);
    await expect(styles.locator('[aria-selected="true"]')).toContainText(`设计款 ${count - 1}`);
    if (count > 2) {
      await expect(remove).toBeFocused();
    } else {
      await expect(remove).toHaveCount(0);
      await expect(styles.getByRole('tab').first()).toBeFocused();
    }
  }
  // Let the actual quote request complete, then check it didn't steal focus.
  await expect(form.getByRole('button', { name: /^(创建并提交|提交并申请管理员终价)$/ })).toBeEnabled();
  await expect(styles.getByRole('tab').first()).toBeFocused();
  await form.evaluate((element) => element.closest('form')!.requestSubmit());
  await expect(form.getByRole('textbox', { name: '工单名称', exact: true })).toBeFocused();
});
