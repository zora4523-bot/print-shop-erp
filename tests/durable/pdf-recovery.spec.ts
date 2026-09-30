import { readFile } from 'node:fs/promises';
import AxeBuilder from '@axe-core/playwright';
import { PDFDocument } from 'pdf-lib';
import { test, expect } from '@playwright/test';
import { E2E_USERS, E2E_PASSWORD, login, getUserIdByUsername, seedPrintableOrder, cleanupPrintableOrderStressFixture } from '../e2e/_helpers';
import { withSupplyChainDb } from '../e2e/_supply-chain-fixtures';
import { assertDurableEnvironment, startHeavyWorker, expectJobSucceeded } from './_helpers';

test('offline recovery, in-place progress, isolated worker rendering and authorized repeated downloads', async ({ page, request }, testInfo) => {
  test.setTimeout(150_000);
  assertDurableEnvironment();
  await cleanupPrintableOrderStressFixture();
  const fixture = await seedPrintableOrder({ submitterId: await getUserIdByUsername(E2E_USERS.sales.username), designCount: 5, variant: 'rich-context' });
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  let worker: Awaited<ReturnType<typeof startHeavyWorker>> | undefined;
  try {
    await login(page, { from: `/orders/${fixture.orderId}`, username: E2E_USERS.owner.username, password: E2E_PASSWORD });
    const path = `/api/orders/${fixture.orderId}/pdf`;
    expect((await page.goto(`${path}?regenerate=1`))?.status()).toBe(503);
    await expect(page.getByText('错误码：PDF_WORKER_UNAVAILABLE')).toBeVisible();
    await expect(page.getByRole('link', { name: '网页打印', exact: true })).toHaveAttribute('href', `/print/orders/${fixture.orderId}`);
    for (const width of [375, 393, 768, 1024, 1280, 1920]) {
      await page.setViewportSize({ width, height: 900 });
      for (const colorScheme of ['light', 'dark'] as const) {
        await page.emulateMedia({ colorScheme });
        expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(width);
        expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);
        const retry = page.getByRole('link', { name: '立即重试', exact: true });
        expect((await retry.boundingBox())!.height).toBeGreaterThanOrEqual(44);
        await retry.focus(); await expect(retry).toBeFocused();
      }
    }
    await page.getByRole('link', { name: '网页打印', exact: true }).tap();
    await expect(page.locator('html')).toHaveAttribute('data-print-ready', 'true');
    await expect(page.locator('.work-order-document')).toBeVisible();
    await page.goto(path);
    const job = await withSupplyChainDb(async (db) => {
      const rows = await db.query<{ id: string }>('SELECT id FROM "BackgroundJob" WHERE type=\'ORDER_PDF\' AND payload->>\'orderId\'=$1 AND status IN (\'PENDING\', \'RUNNING\')', [fixture.orderId]);
      expect(rows.rows).toHaveLength(1);
      await db.query('UPDATE "BackgroundJob" SET "availableAt"=NOW()+INTERVAL \'5 minutes\' WHERE id=$1', [rows.rows[0].id]);
      return rows.rows[0].id;
    });
    worker = await startHeavyWorker(testInfo);
    await page.getByRole('link', { name: '立即重试', exact: true }).tap();
    await expect(page.getByRole('heading', { name: 'PDF 正在排队' })).toBeVisible();
    expect(await page.locator('meta[http-equiv="refresh"]').count()).toBe(0);
    await page.evaluate(() => { document.body.dataset.recoveryMarker = 'same-document'; });
    const retry = page.getByRole('link', { name: '查询生成结果' });
    await retry.focus();
    await page.waitForResponse((response) => response.url().includes('status=1') && response.status() === 202);
    await expect(retry).toBeFocused();
    expect(await page.locator('body').getAttribute('data-recovery-marker')).toBe('same-document');
    await withSupplyChainDb((db) => db.query('UPDATE "BackgroundJob" SET "availableAt"=NOW() WHERE id=$1', [job]));
    const downloaded = await page.waitForEvent('download', { timeout: 45_000 });
    const file = testInfo.outputPath('recovered-work-order.pdf');
    await downloaded.saveAs(file);
    const bytes = await readFile(file);
    expect(bytes.subarray(0, 5).toString()).toBe('%PDF-');
    expect((await PDFDocument.load(bytes)).getPageCount()).toBeGreaterThan(0);
    await testInfo.attach('work-order.pdf', { path: file, contentType: 'application/pdf' });
    await expectJobSucceeded(job);
    const repeated = await page.request.get(`${path}?jobId=${job}`);
    expect(repeated.status()).toBe(200);
    expect(await repeated.body()).toEqual(bytes);
    expect((await request.get(`${path}?status=1&jobId=${job}`)).status()).toBe(401);
    // A second render exercises reuse with colored artwork and a physical annex.
    const annex = await seedPrintableOrder({ submitterId: await getUserIdByUsername(E2E_USERS.sales.username), designCount: 1, variant: 'large-items', itemCount: 1, artworkAnnexBoundary: true });
    const annexPath = `/api/orders/${annex.orderId}/pdf`;
    const accepted = await page.request.get(`${annexPath}?regenerate=1`);
    expect([200, 202]).toContain(accepted.status());
    const annexJob = await withSupplyChainDb((db) => db.query<{ id: string }>('SELECT id FROM "BackgroundJob" WHERE type=\'ORDER_PDF\' AND payload->>\'orderId\'=$1 ORDER BY "createdAt" DESC LIMIT 1', [annex.orderId]));
    await expectJobSucceeded(annexJob.rows[0].id);
    const annexResponse = await page.request.get(`${annexPath}?jobId=${annexJob.rows[0].id}`);
    expect(annexResponse.status()).toBe(200);
    const annexPdf = await annexResponse.body();
    expect((await PDFDocument.load(annexPdf)).getPageCount()).toBeGreaterThan(1);
    await testInfo.attach('colored-annex.pdf', { body: annexPdf, contentType: 'application/pdf' });
    expect(errors).toEqual([]);
  } finally {
    await worker?.stop();
    await cleanupPrintableOrderStressFixture();
  }
});
