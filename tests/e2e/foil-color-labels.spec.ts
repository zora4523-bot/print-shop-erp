import { expect, test } from '@playwright/test';
import { E2E_PASSWORD, E2E_USERS, login, openFirstOrderItemEditor } from './_helpers';

for (const role of ['owner', 'sales'] as const) {
  test(`${role} 建单使用新的烫金颜色名称`, async ({ page }) => {
    const errors: string[] = [];
    page.on('pageerror', (error) => errors.push(error.message));
    await login(page, { username: E2E_USERS[role].username, password: E2E_PASSWORD, from: '/orders/new' });
    await openFirstOrderItemEditor(page);
    const form = page.locator('[data-slot="order-form-b"]');
    const red = form.getByRole('button', { name: '红金', exact: true });
    await expect(red).toBeVisible();
    await red.click();
    await expect(form.getByRole('button', { name: /红金，第 \d 色/ })).toHaveAttribute('aria-pressed', 'true');
    for (const old of ['浅色', '红色', '黑色', '银色', '蓝色', '透明色', '绿色']) {
      await expect(form.getByRole('button', { name: new RegExp(`^${old}(，|$)`) })).toHaveCount(0);
    }
    expect(errors).toEqual([]);
  });
}
