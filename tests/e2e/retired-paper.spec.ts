import { expect, test } from '@playwright/test';
import { E2E_PASSWORD, E2E_USERS, login, openFirstOrderItemEditor } from './_helpers';

for (const role of ['owner', 'sales'] as const) {
  test(`${role} 新建工单不再提供 120g 纸张`, async ({ page }) => {
    const errors: string[] = [];
    page.on('pageerror', (error) => errors.push(error.message));
    await login(page, { username: E2E_USERS[role].username, password: E2E_PASSWORD, from: '/orders/new' });
    await openFirstOrderItemEditor(page);
    const form = page.locator('[data-slot="order-form-b"]');
    await expect(form).toBeVisible();
    const paper = form.getByRole('group', { name: '纸张材质' });
    await expect(paper).toBeVisible();
    const choices = await paper.getByRole('button').all();
    expect(choices.length).toBeGreaterThan(0);
    for (const choice of choices) {
      await choice.click();
      await expect(form.getByRole('button', { name: /^120\s*g$/i })).toHaveCount(0);
    }
    expect(errors).toEqual([]);
  });
}
