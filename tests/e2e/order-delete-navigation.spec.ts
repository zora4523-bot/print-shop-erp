import { test, expect } from '@playwright/test';
import { login, E2E_PASSWORD, E2E_USERS } from './_helpers';

test('建单校验后连续删除款式，报价更新不抢焦点且删除按钮保持原位', async ({ page }) => {
  test.setTimeout(90_000);
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await login(page, { username: E2E_USERS.sales.username, password: E2E_PASSWORD, from: '/orders/new' });
  const form = page.locator('[data-slot="order-form-b"]');
  const styles = form.getByRole('navigation', { name: '款式', exact: true });
  const copy = form.getByRole('button', { name: '⧉ 复制当前', exact: true });
  await expect(copy).toBeEnabled();
  for (let index = 1; index < 15; index++) await copy.click();
  await expect(styles.getByRole('button')).toHaveCount(15);
  // Exercise the real RHF invalid-submit path without persisting an order.
  await form.evaluate((element) => element.closest('form')!.requestSubmit());
  await expect(form.locator('[data-slot="order-form-errors"]')).toBeVisible();
  await expect(form.getByRole('textbox', { name: '工单名称', exact: true })).toBeFocused();
  await styles.getByRole('button').last().click();
  const remove = form.getByRole('button', { name: /^删除第 \d+ 款$/ });
  await remove.scrollIntoViewIfNeeded();
  const origin = await remove.boundingBox();
  expect(origin).not.toBeNull();
  for (let count = 15; count > 1; count--) {
    // A fixed pointer position must continue to delete, without locator auto-scroll.
    await page.mouse.click(origin!.x + origin!.width / 2, origin!.y + origin!.height / 2);
    await expect(styles.getByRole('button')).toHaveCount(count - 1);
    await expect(styles.locator('[aria-pressed="true"]')).toContainText(`${count - 1}.`);
    if (count > 2) {
      await expect(remove).toBeFocused();
      const box = await remove.boundingBox();
      expect(box?.y).toBe(origin!.y);
      expect(box?.x).toBe(origin!.x);
    } else {
      await expect(remove).toHaveCount(0);
      await expect(styles.getByRole('button').first()).toBeFocused();
    }
  }
  // Let the actual quote request complete, then check it didn't steal focus.
  await expect(form.getByRole('button', { name: /^(创建并提交|提交并申请管理员终价)$/ })).toBeEnabled();
  await expect(styles.getByRole('button').first()).toBeFocused();
  await form.evaluate((element) => element.closest('form')!.requestSubmit());
  await expect(form.getByRole('textbox', { name: '工单名称', exact: true })).toBeFocused();
});
