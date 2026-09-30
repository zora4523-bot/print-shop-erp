import { readFile } from 'node:fs/promises';
import { PDFDocument } from 'pdf-lib';
import { expect, test } from '@playwright/test';
import { E2E_USERS, E2E_PASSWORD, login, getUserIdByUsername, seedPrintableOrder, cleanupPrintableOrderStressFixture } from '../e2e/_helpers';
import { withSupplyChainDb } from '../e2e/_supply-chain-fixtures';
import { assertDurableEnvironment } from './_helpers';

test('single PDF downloads without workers, reuses bytes and prints through the prepared HTML page', async ({ page, request }, info) => {
  test.skip(process.env.PDF_ORDER_MODE !== 'direct', 'Run with E2E_PDF_ORDER_MODE=direct');
  test.setTimeout(90_000);
  assertDurableEnvironment();
  await cleanupPrintableOrderStressFixture();
  const fixture = await seedPrintableOrder({ submitterId: await getUserIdByUsername(E2E_USERS.sales.username), designCount: 1, variant: 'large-items', itemCount: 1, artworkAnnexBoundary: true });
  const pdfPath = `/api/orders/${fixture.orderId}/pdf`;
  try {
    await login(page, { from: `/orders/${fixture.orderId}`, username: E2E_USERS.owner.username, password: E2E_PASSWORD });
    const print = page.getByRole('link', { name: '打印', exact: true });
    await expect(print).toHaveAttribute('href', `/print/orders/${fixture.orderId}?autoprint=1`);
    await expect(page.getByRole('link', { name: '下载 PDF', exact: true })).toHaveAttribute('href', pdfPath);
    const jobsBefore = await withSupplyChainDb((db) => db.query<{ count: string }>('SELECT COUNT(*)::text AS count FROM "BackgroundJob" WHERE type=\'ORDER_PDF\' AND payload->>\'orderId\'=$1', [fixture.orderId]));
    const started = Date.now();
    const download = page.waitForEvent('download');
    await page.getByRole('link', { name: '下载 PDF', exact: true }).click();
    const file = info.outputPath('direct-work-order.pdf');
    await (await download).saveAs(file);
    const firstMs = Date.now() - started;
    const bytes = await readFile(file);
    expect(bytes.subarray(0, 5).toString()).toBe('%PDF-');
    expect((await PDFDocument.load(bytes)).getPageCount()).toBeGreaterThan(1);
    const repeatedAt = Date.now();
    const repeat = await page.request.get(pdfPath);
    const repeatMs = Date.now() - repeatedAt;
    expect(repeat.status()).toBe(200);
    expect(await repeat.body()).toEqual(bytes);
    expect(repeat.headers()['cache-control']).toBe('private, no-store');
    expect((await request.get(pdfPath)).status()).toBe(401);
    const jobsAfter = await withSupplyChainDb((db) => db.query<{ count: string }>('SELECT COUNT(*)::text AS count FROM "BackgroundJob" WHERE type=\'ORDER_PDF\' AND payload->>\'orderId\'=$1', [fixture.orderId]));
    expect(jobsAfter.rows[0].count).toBe(jobsBefore.rows[0].count);
    const workers = await withSupplyChainDb((db) => db.query<{ count: string }>('SELECT COUNT(*)::text AS count FROM "BackgroundWorkerHeartbeat" WHERE "lastSeenAt">NOW()-INTERVAL \'30 seconds\''));
    expect(workers.rows[0].count).toBe('0');
    await info.attach('direct.pdf', { path: file, contentType: 'application/pdf' });
    await info.attach('timing', { body: JSON.stringify({ firstMs, repeatMs, bytes: bytes.length }), contentType: 'application/json' });
    // Verify the actual print entry; replace only the native dialog in this test.
    await page.addInitScript(() => { window.print = () => { document.documentElement.dataset.printInvoked = 'true'; }; });
    await page.goto(`/print/orders/${fixture.orderId}?autoprint=1`);
    await expect(page.locator('html')).toHaveAttribute('data-print-ready', 'true');
    await expect(page.locator('html')).toHaveAttribute('data-print-invoked', 'true');
    await expect(page.locator('.work-order-document')).toBeVisible();
  } finally { await cleanupPrintableOrderStressFixture(); }
});
