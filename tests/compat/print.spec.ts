import { expect, test } from '@playwright/test';
import { E2E_PASSWORD, E2E_USERS, getUserIdByUsername, login, seedPrintableOrder } from '../e2e/_helpers';

test.setTimeout(120_000);

test('login, self-hosted fonts, A4 preview and authorized standard PDF', async ({ page, request }) => {
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  const { orderId } = await seedPrintableOrder({ submitterId: await getUserIdByUsername(E2E_USERS.owner!.username), designCount: 3 });
  await login(page, { from: `/print/orders/${orderId}`, username: E2E_USERS.owner!.username, password: E2E_PASSWORD });
  await expect(page.locator('html')).toHaveAttribute('data-print-fonts', 'ready');
  await expect(page.locator('html')).toHaveAttribute('data-print-pagination', 'ready');
  await expect(page.locator('.sheet')).toHaveCount(1);
  expect(await page.locator('.sheet').evaluateAll((sheets) => sheets.every((sheet) => sheet.getBoundingClientRect().height <= 1123.1))).toBe(true);
  expect(await page.locator('.work-order-document').evaluate((node) => getComputedStyle(node).fontFamily)).toContain('ERP Print Sans');
  const pdfUrl = `/api/orders/${orderId}/pdf`;
  expect((await request.get(pdfUrl)).status()).toBe(401);
  const pdf = await page.request.get(pdfUrl, { timeout: 90_000 });
  expect(pdf.status()).toBe(200);
  expect(pdf.headers()['content-type']).toBe('application/pdf');
  expect((await pdf.body()).subarray(0, 5).toString()).toBe('%PDF-');
  const inline = await page.request.get(`${pdfUrl}?view=inline`, { timeout: 90_000 });
  expect(inline.status()).toBe(200);
  expect(inline.headers()['content-disposition']).toMatch(/^inline;/);
  await page.context().clearCookies();
  await login(page, { username: E2E_USERS.sales!.username, password: E2E_PASSWORD });
  expect((await page.request.get(pdfUrl)).status()).toBe(404);
  expect(errors).toEqual([]);
});

test('missing font stops browser printing and provides a recovery message', async ({ page }) => {
  const { orderId } = await seedPrintableOrder({ submitterId: await getUserIdByUsername(E2E_USERS.owner!.username), designCount: 1 });
  await page.route('**/fonts/print/*.woff2', (route) => route.abort());
  await page.addInitScript(() => { window.print = () => { document.documentElement.dataset.unexpectedPrint = 'true'; }; });
  await login(page, { from: `/print/orders/${orderId}?autoprint=1`, username: E2E_USERS.owner!.username, password: E2E_PASSWORD });
  await expect(page.locator('html')).toHaveAttribute('data-print-fonts', 'failed');
  await expect(page.getByRole('alert').filter({ hasText: '已停止自动打印' })).toContainText('已停止自动打印');
  await expect(page.locator('html')).not.toHaveAttribute('data-unexpected-print', 'true');
});
