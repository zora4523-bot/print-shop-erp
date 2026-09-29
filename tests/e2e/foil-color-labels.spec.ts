import { expect, test } from '@playwright/test';
import { randomUUID } from 'node:crypto';
import { E2E_PASSWORD, E2E_USERS, login, openFirstOrderItemEditor, withDb } from './_helpers';

const legacyFoilId = `e2e-foil-alias-${randomUUID()}`;

test.beforeAll(async () => {
  await withDb((db) => db.query(
    `INSERT INTO "Material" (id, code, name, category, unit, "sortOrder", "updatedAt")
     VALUES ($1, $2, '哑金', 'FOIL', '卷', -100, NOW())`, [legacyFoilId, legacyFoilId],
  ));
});

test.afterAll(async () => {
  await withDb((db) => db.query('UPDATE "Material" SET "isActive" = false WHERE id = $1', [legacyFoilId]));
});

for (const role of ['owner', 'sales'] as const) {
  test(`${role} 建单使用新的烫金颜色名称`, async ({ page }) => {
    const errors: string[] = [];
    page.on('pageerror', (error) => errors.push(error.message));
    await login(page, { username: E2E_USERS[role].username, password: E2E_PASSWORD, from: '/orders/new' });
    await openFirstOrderItemEditor(page);
    const form = page.locator('[data-slot="order-form-b"]');
    await expect(form.getByRole('button', { name: /^哑金(，|$)/ })).toHaveCount(0);
    const gold = form.getByRole('button', { name: /^亚金(，|$)/ });
    await expect(gold).toHaveCount(1);
    await expect(gold).toHaveAttribute('aria-pressed', 'true');
    await expect(gold.locator('img')).toHaveAttribute('src', /matte-gold/);
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
