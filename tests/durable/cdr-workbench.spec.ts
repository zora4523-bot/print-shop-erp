import { createServer } from 'node:http';
import { test, expect } from '@playwright/test';
import { E2E_PASSWORD, E2E_USERS, getUserIdByUsername, login, seedCdrOrder, withDb } from '../e2e/_helpers';
import { assertDurableEnvironment, startHeavyWorker } from './_helpers';

// Real ZIP bytes and HTTP storage IO; no real bucket credentials or network.
test('工作台真实 worker 打包下载、旧版本拒绝、更新标记、分享撤销与过期', async ({ page, request }, info) => {
  test.setTimeout(150000);
  assertDurableEnvironment();
  const objects = new Map<string, Buffer>();
  const server = createServer(async (req, res) => {
    const key = new URL(req.url!, 'http://localhost').pathname.replace(/^\/cdr-test\//, '/');
    if (req.method === 'PUT') {
      const chunks: Buffer[] = [];
      for await (const chunk of req) chunks.push(Buffer.from(chunk));
      objects.set(key, Buffer.concat(chunks));
      res.writeHead(200, { etag: 'test-etag', 'x-oss-request-id': 'test-request' }); res.end();
    } else if (key.startsWith('/design/')) {
      res.writeHead(200, { 'content-type': 'application/octet-stream', 'x-oss-request-id': 'test-request' }); res.end('test-cdr-bytes');
    } else if (objects.has(key)) {
      res.writeHead(200, { 'content-type': 'application/zip', 'content-disposition': 'attachment; filename="cdr.zip"', 'x-oss-request-id': 'test-request' }); res.end(objects.get(key));
    } else { res.writeHead(404); res.end(); }
  });
  await new Promise<void>((resolve) => server.listen(3313, '127.0.0.1', resolve));
  let worker: Awaited<ReturnType<typeof startHeavyWorker>> | undefined;
  try {
    await seedCdrOrder({ submitterId: await getUserIdByUsername(E2E_USERS.sales.username), cdrCount: 1 });
    await withDb(async (db) => {
      await db.query(`UPDATE "Order" SET status='CONFIRMED', "submittedAt"=NOW()-INTERVAL '2 days' WHERE id='e2e-cdr-1'`);
      await db.query(`UPDATE "OrderItemDesign" SET "fileUrl"='http://127.0.0.1:3313/design/test.cdr' WHERE "orderItemId"='e2e-cdr-1-item'`);
    });
    await login(page, { from: '/owner?cdrQ=E2E-CDR-1', username: E2E_USERS.owner.username, password: E2E_PASSWORD });
    const section = page.locator('#cdr-download');
    await section.getByRole('button', { name: '一键下载本页', exact: true }).click();
    await expect(section.getByText('正在生成下载包', { exact: true })).toBeVisible();
    // Snapshot changes after enqueue: no worker may silently deliver a different file.
    await withDb((db) => db.query(`UPDATE "OrderItemDesign" SET id=id || '-replacement', "fileName"='changed.cdr' WHERE "orderItemId"='e2e-cdr-1-item'`));
    worker = await startHeavyWorker(info, { requirePdfReady: false });
    await expect(section.getByText('文件打包失败', { exact: true })).toBeVisible({ timeout: 30000 });
    const failed = await withDb((db) => db.query(`SELECT j.attempts, j.status FROM "BackgroundJob" j JOIN "DesignBundle" b ON b."backgroundJobId"=j.id WHERE b."orderIds" @> ARRAY['e2e-cdr-1'] ORDER BY b."createdAt" DESC LIMIT 1`));
    expect(failed.rows[0]).toMatchObject({ attempts: 1, status: 'DEAD' });
    const downloaded = page.waitForEvent('download');
    await section.getByRole('button', { name: '按原工单重新生成', exact: true }).first().click();
    const download = await downloaded;
    const zipPath = info.outputPath('cdr.zip'); await download.saveAs(zipPath);
    expect(await download.failure()).toBeNull();
    expect([...objects.values()].some((bytes) => bytes.includes('changed.cdr'))).toBe(true);
    await expect(section.getByText('下载包已就绪', { exact: true })).toBeVisible();
    await section.locator('summary').filter({ hasText: '工单明细' }).click();
    await expect(section.getByText('已打包当前文件', { exact: true })).toBeVisible();
    await withDb((db) => db.query(`UPDATE "OrderItemDesign" SET "fileName"='latest.cdr' WHERE "orderItemId"='e2e-cdr-1-item'`));
    await page.reload();
    await section.locator('summary').filter({ hasText: '工单明细' }).click();
    await expect(section.getByText('文件已更新', { exact: true })).toBeVisible();
    await section.locator('summary').filter({ hasText: '下载记录' }).click();
    await page.context().grantPermissions(['clipboard-read', 'clipboard-write']);
    await section.getByRole('button', { name: '复制分享链接' }).click();
    await expect(section.getByText(/已复制下载链接/)).toBeVisible();
    const href = await section.getByRole('button', { name: '下载 ZIP', exact: true }).first().getAttribute('href');
    expect(href).toBeTruthy();
    expect((await request.get(href!)).status()).toBe(200);
    await section.getByRole('button', { name: '撤销下载链接' }).click();
    await page.getByRole('button', { name: '确认撤销链接' }).click();
    await expect.poll(async () => (await request.get(href!)).status()).toBe(404);
    await page.reload();
    await section.locator('summary').filter({ hasText: '工单明细' }).click();
    await expect(section.getByText('尚未打包', { exact: true })).toBeVisible();
    const nextDownload = page.waitForEvent('download');
    await section.getByRole('button', { name: '一键下载本页', exact: true }).click();
    await nextDownload;
    const newHref = await section.getByRole('button', { name: '下载 ZIP', exact: true }).first().getAttribute('href');
    await withDb((db) => db.query(`UPDATE "DesignBundle" SET "expiresAt"=(NOW() AT TIME ZONE 'UTC')-INTERVAL '1 second' WHERE "revokedAt" IS NULL AND status='READY'`));
    expect((await request.get(newHref!)).status()).toBe(404);
  } finally {
    await worker?.stop();
    await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
  }
});
