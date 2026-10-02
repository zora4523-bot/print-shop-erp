import { mkdir, readFile, unlink, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { decryptBundleDownloadUrl } from '../../lib/cdr/access-token';
import { readWorkbookXml } from './_xlsx';
import { expect, test, type Page, type Locator, type TestInfo } from '@playwright/test';
import { E2E_PASSWORD, E2E_USERS, login, midPreviousShanghaiMonth, seedSettledExternalSalesOrder, uniqueSuffix } from '../e2e/_helpers';
import { seedOutsourcePrerequisites, withSupplyChainDb } from '../e2e/_supply-chain-fixtures';
import { assertDurableEnvironment, expectJobSucceeded, readJob, startHeavyWorker } from './_helpers';

test.beforeEach(assertDurableEnvironment);

async function downloadWorkbook(page: Page, button: Locator, href: string, file: string, testInfo: TestInfo) {
  const downloaded = page.waitForEvent('download');
  const response = page.waitForResponse(res => new URL(res.url()).pathname === href && res.request().method() === 'GET');
  await button.click();
  expect((await response).status()).toBe(200);
  const download = await downloaded;
  const filePath = testInfo.outputPath(file);
  await download.saveAs(filePath);
  expect(await download.failure()).toBeNull();
  return readWorkbookXml(await readFile(filePath));
}

async function otherAdminCannotDownload(page: Page, href: string) {
  const other = await page.context().browser()!.newContext({ baseURL: new URL(page.url()).origin });
  try {
    const otherPage = await other.newPage();
    await login(otherPage, { username: E2E_USERS.foreman!.username, password: E2E_PASSWORD });
    const response = await otherPage.request.get(href);
    expect(response.status()).toBe(404);
    expect(response.headers()['content-type']).not.toContain('spreadsheetml');
  } finally { await other.close(); }
}

test('工单导出真实排队、IO失败和worker重试后生成可读XLSX，下载按创建人和有效期授权', async ({ page, request }, testInfo) => {
  test.setTimeout(150_000);
  const fixture = await seedOutsourcePrerequisites();
  await login(page, { from: `/orders?queue=all&orderNo=${fixture.orderNo}`, username: E2E_USERS.owner!.username, password: E2E_PASSWORD });
  await page.getByRole('button', { name: '导出工单', exact: true }).click();
  const panel = page.getByRole('dialog', { name: '导出工单', exact: true });
  const exportFiltered = panel.getByRole('button', { name: '导出筛选结果（1 条）', exact: true });
  await expect(exportFiltered).toBeVisible();
  await exportFiltered.click();
  await expect(panel.getByText('已排队，完成后会出现下载按钮。', { exact: true })).toBeVisible();
  const exported = await withSupplyChainDb((db) => db.query<{ id: string; status: string; backgroundJobId: string; fileName: string }>(
    `SELECT id,status::text,"backgroundJobId","fileName" FROM "OrderExport" WHERE filters::text LIKE $1 ORDER BY "createdAt" DESC LIMIT 1`, [`%${fixture.orderNo}%`],
  ));
  expect(exported.rows).toHaveLength(1);
  const row = exported.rows[0]!;
  const href = `/api/orders/exports/${row.id}`;
  expect(row.status).toBe('PENDING');
  expect((await readJob(row.backgroundJobId)).job).toMatchObject({ type: 'ORDER_EXPORT', queue: 'HEAVY', status: 'PENDING', attempts: 0 });
  const pending = await page.request.get(href);
  expect(pending.status()).toBe(409);
  expect(pending.headers()['retry-after']).toBe('5');
  expect((await request.get(href)).status()).toBe(401);

  const directory = process.env.ORDER_EXPORT_ARTIFACT_DIR;
  const artifactRoot = process.env.E2E_DURABLE_ARTIFACT_ROOT;
  if (!directory || !artifactRoot || path.dirname(directory) !== artifactRoot) throw new Error('Missing dedicated export artifact directory');
  await mkdir(artifactRoot, { recursive: true });
  // A test-owned file blocks mkdir with a real filesystem error. Never alter
  // job payload, attempt count or availableAt to fabricate retry evidence.
  await writeFile(directory, 'E2E transient artifact failure', { flag: 'wx' });
  let failingWorker: Awaited<ReturnType<typeof startHeavyWorker>> | undefined;
  try {
    failingWorker = await startHeavyWorker(testInfo);
    await expect.poll(async () => (await readJob(row.backgroundJobId)).attempts[0]?.status, { timeout: 20_000 }).toBe('FAILED');
    const failed = await readJob(row.backgroundJobId);
    expect(failed.job).toMatchObject({ status: 'PENDING', attempts: 1 });
    expect(failed.attempts[0]?.errorCode).toBeTruthy();
    await testInfo.attach('order-export-first-attempt', { body: JSON.stringify(failed), contentType: 'application/json' });
  } finally {
    await failingWorker?.stop();
    await unlink(directory);
    await mkdir(directory, { mode: 0o700 });
  }
  const worker = await startHeavyWorker(testInfo);
  try {
    const succeeded = await expectJobSucceeded(row.backgroundJobId, 60_000);
    expect(succeeded.job?.attempts).toBe(2);
    expect(succeeded.attempts.map((attempt) => attempt.status)).toEqual(['FAILED', 'SUCCEEDED']);
    await testInfo.attach('order-export-retry-result', { body: JSON.stringify(succeeded), contentType: 'application/json' });
    await page.reload();
    await page.getByRole('button', { name: '导出工单', exact: true }).click();
    const downloadButton = page.getByRole('listitem').filter({ hasText: row.fileName }).getByRole('button', { name: '下载', exact: true });
    await expect(downloadButton).toBeVisible();
    expect(await downloadWorkbook(page, downloadButton, href, 'orders.xlsx', testInfo)).toContain(fixture.orderNo);
    await otherAdminCannotDownload(page, href);
    // Expiry is mutable artifact metadata, not a financial/history mutation.
    await withSupplyChainDb((db) => db.query('UPDATE "OrderExport" SET "expiresAt"=NOW()-INTERVAL \'1 second\' WHERE id=$1', [row.id]));
    expect((await page.request.get(href)).status()).toBe(404);
  } finally { await worker.stop(); }
});

test('月账单导出由真实worker读取请求时数据并生成可下载XLSX', async ({ page }, testInfo) => {
  test.setTimeout(90_000);
  const fixture = await seedSettledExternalSalesOrder({ customerRef: `e2e-durable-bill-${uniqueSuffix()}`, settledFee: '321.09', settledAt: midPreviousShanghaiMonth() });
  await login(page, { from: '/owner/agent-bills', username: E2E_USERS.owner!.username, password: E2E_PASSWORD });
  await page.getByLabel('结算发生月（上海时区）', { exact: true }).fill(fixture.period);
  await page.getByRole('button', { name: '生成或更新草稿', exact: true }).click();
  await expect(page.getByText(new RegExp(`^已生成或更新 \\d+ 张 ${fixture.period} 账单$`))).toBeVisible();
  await page.goto(`/owner/agent-bills?period=${fixture.period}&agentUserId=${fixture.agentUserId}`);
  await page.getByRole('button', { name: '导出当前结果（1 张）', exact: true }).click();
  await expect(page.getByText('正在生成导出文件，完成后会显示下载按钮。', { exact: true })).toBeVisible();
  const exported = await withSupplyChainDb((db) => db.query<{ id: string; status: string; backgroundJobId: string; fileName: string }>('SELECT id,status::text,"backgroundJobId","fileName" FROM "AgentMonthlyBillExport" WHERE filters::text LIKE $1 ORDER BY "createdAt" DESC LIMIT 1', [`%${fixture.agentUserId}%`]));
  expect(exported.rows).toHaveLength(1);
  const row = exported.rows[0]!;
  const href = `/api/owner/agent-bills/exports/${row.id}`;
  expect(row.status).toBe('PENDING');
  expect((await page.request.get(href)).status()).toBe(409);
  expect((await readJob(row.backgroundJobId)).job).toMatchObject({ type: 'AGENT_MONTHLY_BILL_EXPORT', queue: 'HEAVY', status: 'PENDING' });
  const worker = await startHeavyWorker(testInfo);
  try {
    await expectJobSucceeded(row.backgroundJobId);
    await page.reload();
    const downloadButton = page.getByRole('listitem').filter({ hasText: row.fileName }).getByRole('button', { name: '下载', exact: true });
    await expect(downloadButton).toBeVisible();
    const contents = await downloadWorkbook(page, downloadButton, href, 'agent-bills.xlsx', testInfo);
    expect(contents).toContain(fixture.orderNo);
    expect(contents).toContain('321.09');
    await otherAdminCannotDownload(page, href);
    await withSupplyChainDb((db) => db.query('UPDATE "AgentMonthlyBillExport" SET "expiresAt"=NOW()-INTERVAL \'1 second\' WHERE id=$1', [row.id]));
    expect((await page.request.get(href)).status()).toBe(404);
  } finally { await worker.stop(); }
});

test('CDR排队到mock完成的下载状态、过期后重新生成与真实PDF任务', async ({ page, request }, testInfo) => {
  test.setTimeout(120_000);
  const fixture = await seedOutsourcePrerequisites();
  await withSupplyChainDb(async (db) => {
    await db.query(
      `INSERT INTO "OrderItemDesign" (id,"orderItemId","fileType","fileUrl","fileName","fileSize","uploadedBy","uploadedAt")
       SELECT $1,$2,'CDR','mock://e2e-durable/design.cdr','durable-test.cdr',1024,"createdById",NOW() FROM "Order" WHERE id=$3`,
      [`${fixture.orderId}-design`, fixture.itemIds[0], fixture.orderId],
    );
  });
  await login(page, { from: '/foreman/cdr', username: E2E_USERS.owner!.username, password: E2E_PASSWORD });
  const selectAll = page.getByRole('checkbox', { name: '全选 / 全不选', exact: true });
  await selectAll.uncheck();
  await page.getByRole('checkbox', { name: `选择工单 ${fixture.orderNo}`, exact: true }).check();
  await page.getByRole('button', { name: '生成下载包', exact: true }).click();
  await expect(page.getByText('已受理：正在生成 1 个 CDR 文件', { exact: true })).toBeVisible();
  await expect(page.locator('#cdr-bundle-form')).toHaveAttribute('aria-busy', 'false');
  const bundle = await withSupplyChainDb((db) => db.query<{ id: string; status: string; backgroundJobId: string; downloadUrlCiphertext: string }>('SELECT id,status::text,"backgroundJobId","downloadUrlCiphertext" FROM "DesignBundle" WHERE "orderIds"=ARRAY[$1]::text[] ORDER BY "createdAt" DESC LIMIT 1', [fixture.orderId]));
  expect(bundle.rows).toHaveLength(1);
  const row = bundle.rows[0]!;
  // APP_PUBLIC_URL is pinned to http://localhost:3000 for QR snapshots; the
  // durable server listens elsewhere, so request the link's path via baseURL.
  const href = new URL(decryptBundleDownloadUrl(row.downloadUrlCiphertext)!).pathname;
  const pending = await request.get(href);
  expect(pending.status()).toBe(409);
  expect(await pending.json()).toEqual({ error: '下载包正在生成' });
  expect(pending.headers()['retry-after']).toBe('5');
  const worker = await startHeavyWorker(testInfo);
  try {
    await expectJobSucceeded(row.backgroundJobId);
    await page.reload();
    await expect(page.getByText('暂不可下载', { exact: true }).first()).toBeVisible();
    const unavailable = await request.get(href);
    expect(unavailable.status()).toBe(503);
    expect(await unavailable.json()).toEqual({ error: 'CDR 下载暂不可用，请联系管理员' });
    await withSupplyChainDb((db) => db.query('UPDATE "DesignBundle" SET "expiresAt"=NOW()-INTERVAL \'1 second\' WHERE id=$1', [row.id]));
    expect((await request.get(href)).status()).toBe(404);
    await page.reload();
    await page.getByRole('button', { name: '按同条件重新生成', exact: true }).first().click();
    await expect.poll(async () => (await withSupplyChainDb((db) => db.query('SELECT id FROM "DesignBundle" WHERE "orderIds"=ARRAY[$1]::text[]', [fixture.orderId]))).rowCount).toBe(2);
    const bundles = await withSupplyChainDb((db) => db.query<{ id: string; backgroundJobId: string }>('SELECT id,"backgroundJobId" FROM "DesignBundle" WHERE "orderIds"=ARRAY[$1]::text[] AND id<>$2', [fixture.orderId, row.id]));
    await expectJobSucceeded(bundles.rows[0]!.backgroundJobId);
    expect((await request.get(href)).status()).toBe(404);

    const pdfPath = `/api/orders/${fixture.orderId}/pdf`;
    const pdfRequests: string[] = [];
    page.on('request', (request) => {
      if (new URL(request.url()).pathname === pdfPath) pdfRequests.push(request.method());
    });
    await page.goto(`/orders/${fixture.orderId}`);
    const pdfLink = page.locator(`a[href="${pdfPath}"]`).first();
    await expect(pdfLink).toBeVisible();
    await page.locator('button[aria-label^="用户菜单"]').click();
    await expect(page.getByRole('menu')).toBeVisible();
    await page.keyboard.press('Escape');
    expect(pdfRequests, '页面渲染和水合不能预取有副作用的 PDF 下载').toHaveLength(0);
    expect((await withSupplyChainDb((db) => db.query(`SELECT id FROM "BackgroundJob" WHERE type='ORDER_PDF' AND payload->>'orderId'=$1`, [fixture.orderId]))).rowCount).toBe(0);
    const downloaded = page.waitForEvent('download');
    await pdfLink.click();
    const download = await downloaded;
    const file = testInfo.outputPath('order.pdf');
    await download.saveAs(file);
    expect((await readFile(file)).subarray(0, 5).toString()).toBe('%PDF-');
    const pdfJobs = await withSupplyChainDb((db) => db.query<{ id: string }>(`SELECT id FROM "BackgroundJob" WHERE type='ORDER_PDF' AND payload->>'orderId'=$1 ORDER BY "createdAt"`, [fixture.orderId]));
    expect(pdfJobs.rows).toHaveLength(1);
    expect(pdfRequests).toEqual(['GET']);
    const repeated = await page.request.get(`${pdfPath}?jobId=${pdfJobs.rows[0]!.id}`);
    expect(repeated.status()).toBe(200);
    expect(await repeated.body()).toEqual(await readFile(file));
    expect((await expectJobSucceeded(pdfJobs.rows[0]!.id)).job).toMatchObject({ type: 'ORDER_PDF', queue: 'HEAVY', attempts: 1 });
    expect((await request.get(`/api/orders/${fixture.orderId}/pdf`)).status()).toBe(401);
  } finally { await worker.stop(); }
});
