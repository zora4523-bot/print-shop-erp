import { expect, test } from '@playwright/test';
import { requireReleasePrerequisite } from './release-prerequisite';
import { expectA11yGate, expectViewportGate, attachCandidateScreenshot } from '../visual/ui-gates';
import {
  cleanupE2eProductionOperationFixture,
  E2E_PASSWORD,
  E2E_PRODUCTION_REPORT_INCREMENT,
  E2E_USERS,
  expectNoNextErrorOverlay,
  login,
  withDb,
  productionOperationE2eIsolationFailure,
  seedE2eProductionOperationFixture,
} from './_helpers';

const worker = E2E_USERS.workerHandPress!;

test.describe('ProductionOperation 扫码报工 — 主流程', () => {
  test('固定局部烫金账号看到本人工序 → 上报 → 累计数量更新', async ({
    page,
  }) => {
    test.setTimeout(120_000);

    const isolationFailure = productionOperationE2eIsolationFailure();
    requireReleasePrerequisite(isolationFailure);
    if (isolationFailure) {
      test.skip(true, isolationFailure);
      return;
    }

    const seeded = await seedE2eProductionOperationFixture();
    if (!seeded.ready) {
      requireReleasePrerequisite(seeded.reason);
      test.skip(true, seeded.reason);
      return;
    }

    const { fixture } = seeded;
    const reportedQty = E2E_PRODUCTION_REPORT_INCREMENT;
    const completedQtyBefore = String(Number(fixture.completedQtyBefore));
    const expectedCompletedQty = String(
      Number(fixture.completedQtyBefore) + reportedQty,
    );

    try {
      await login(page, {
        from: '/worker/tasks',
        username: worker.username,
        password: E2E_PASSWORD,
      });
      await expect(page).toHaveURL('/worker/tasks');
      await expect(
        page.getByRole('heading', { name: '生产工序', exact: true }),
      ).toBeVisible();

      await page.getByRole('textbox', { name: '搜索工单或款式' }).fill(fixture.orderNo);
      await page.getByRole('button', { name: '搜索', exact: true }).click();

      const operationLink = page.locator(
        `a[href="/worker/tasks/${fixture.operationId}"]`,
      );
      await expect(operationLink).toBeVisible();
      await expect(operationLink).toContainText(fixture.orderNo);
      await expect(operationLink).toContainText('局部烫金');
      await expect(operationLink).toContainText(
        `已完成 ${completedQtyBefore} / ${fixture.plannedCompletedQty}`,
      );
      await operationLink.click();
      // 报工页缺少 reportBatch 时会重定向到服务端推导的批次号；等重定向落定再操作表单。
      await expect(page).toHaveURL(new RegExp(`/worker/tasks/${fixture.operationId}\\?reportBatch=\\d+$`));

      const reportSection = page.locator('section').filter({
        has: page.getByRole('heading', { name: '扫码报工', exact: true }),
      });
      await expect(reportSection).toContainText(
        `累计合格 ${completedQtyBefore} / ${fixture.plannedCompletedQty}`,
      );
      await expect(reportSection.getByRole('spinbutton', { name: '本次合格完成数', exact: true })).toHaveValue('');
      await expect(reportSection.getByRole('spinbutton', { name: '本次工单件数进度', exact: true })).toHaveValue('');
      await reportSection
        .getByRole('spinbutton', { name: '本次合格完成数', exact: true })
        .fill(String(reportedQty));
      // This durable fixture tests wage-bearing output, independently of
      // order-piece progress; do not submit its entire remaining order count.
      await reportSection
        .getByRole('spinbutton', { name: '本次工单件数进度', exact: true })
        .fill('0');
      await reportSection
        .getByRole('spinbutton', { name: '缺陷数', exact: true })
        .fill('0');
      await reportSection
        .getByRole('spinbutton', { name: '返工数', exact: true })
        .fill('0');
      await reportSection
        .getByRole('button', { name: '提交扫码报工', exact: true })
        .click();

      await expect(reportSection.getByRole('region', { name: '核对本次报工' })).toBeVisible();
      await expect(reportSection).toContainText('工单件数进度：0');
      await reportSection.getByRole('button', { name: '返回修改', exact: true }).click();
      await expect(reportSection.getByRole('spinbutton', { name: '本次合格完成数', exact: true })).toHaveValue(String(reportedQty));
      await reportSection.getByRole('button', { name: '提交扫码报工', exact: true }).click();
      await reportSection.getByRole('button', { name: '确认报工', exact: true }).click();

      await expect(
        reportSection.getByRole('status'),
      ).toContainText('已记录本次报工，计件金额', { timeout: 15_000 });
      await expectNoNextErrorOverlay(page);

      await page.reload();
      const refreshedReportSection = page.locator('section').filter({
        has: page.getByRole('heading', { name: '扫码报工', exact: true }),
      });
      await expect(refreshedReportSection).toContainText(
        `累计合格 ${expectedCompletedQty} / ${fixture.plannedCompletedQty}`,
      );

      const completedMetric = page
        .locator('dt')
        .filter({ hasText: /^合格完成$/ })
        .locator('..')
        .locator('dd');
      await expect(completedMetric).toHaveText(expectedCompletedQty);
      await page.goto('/worker/salary');
      const pending = page.getByRole('region', { name: /未结算报工/ });
      await expect(pending).toContainText(fixture.orderNo);
      // The durable fixture retains earlier reports; changed rates/reporters can
      // require manual review. Verify the UI against the persisted decision.
      const reviewRequired = await withDb(async (db) => {
        const result = await db.query<{ payrollReviewRequired: boolean }>(
          'SELECT "payrollReviewRequired" FROM "ProductionOperation" WHERE id=$1', [fixture.operationId],
        );
        expect(result.rowCount).toBe(1);
        return result.rows[0]!.payrollReviewRequired;
      });
      await expect(pending).toContainText(reviewRequired ? '待核定' : '工序未完成');
      await expect(pending).toContainText(`合格数量：${reportedQty}`);
      // New ledger feedback must close the worker/admin loop without touching wages.
      const before = await withDb(async (db) => (await db.query(
        'SELECT id, amount::text, snapshot FROM "ProductionReport" WHERE "operationId"=$1 ORDER BY "reportedAt" DESC, id DESC LIMIT 1', [fixture.operationId],
      )).rows[0]);
      await page.goto(`/worker/reports/${before.id}`);
      await expect(page.getByRole('heading', { name: '我的报工明细' })).toBeVisible();
      for (const theme of ['light', 'dark']) {
        await page.evaluate((value) => localStorage.setItem('erp-theme', value), theme);
        for (const width of [375, 393, 768, 1024, 1280, 1920]) {
          await page.setViewportSize({ width, height: 852 });
          await page.reload();
          await expect(page.locator('html')).toHaveAttribute('data-theme', theme);
          await expect(page.getByRole('heading', { name: '我的报工明细' })).toBeVisible();
          await expect.poll(() => page.evaluate(() => document.getAnimations().filter((animation) => animation.playState === 'running' || animation.pending).length)).toBe(0);
          await expectViewportGate(page, test.info());
          await expectA11yGate(page);
          await attachCandidateScreenshot(page, test.info(), 'worker', `report-detail-${width}-${theme}`);
        }
      }
      await page.getByLabel('问题说明').fill('请核对本次装版费用和完成数量');
      await page.getByRole('button', { name: '提交问题', exact: true }).click();
      await expect(page.getByText('问题待处理，请等待管理员回复。')).toBeVisible();
      const dispute = await withDb(async (db) => {
        const row = (await db.query(`SELECT id FROM "ProductionReportDispute" WHERE "reportId"=$1 AND status='PENDING'`, [before.id])).rows[0];
        await expect(db.query('INSERT INTO "ProductionReportDispute" (id,"reportId",reason,"updatedAt") VALUES ($1,$2,$3,now())', [`duplicate-${row.id}`, before.id, '重复待处理问题测试'])).rejects.toThrow(/unique/i);
        return row;
      });
      const adminContext = await page.context().browser()!.newContext();
      const adminPage = await adminContext.newPage();
      try {
        await login(adminPage, { from: `/orders/${fixture.orderId}` });
        const records = adminPage.locator('#detail-production-records');
        await expect(records).toBeAttached();
        // Wait for streamed content before inspecting its initial open state.
        if (await records.getAttribute('open') === null) {
          await adminPage.getByText('生产、用料与计件记录', { exact: true }).click();
        }
        const feedback = adminPage.locator(`#report-dispute-${dispute.id}`);
        await expect(feedback).toBeVisible();
        await feedback.getByLabel('处理回复').fill('已核对，本次报工金额正确');
        await feedback.getByRole('button', { name: '确认已解决', exact: true }).click();
        await expect(feedback.getByText('已核对，本次报工金额正确')).toBeVisible();
        await page.reload();
        await expect(page.getByText('已核对，本次报工金额正确')).toBeVisible();
        await withDb(async (db) => {
          expect((await db.query('SELECT id, amount::text, snapshot FROM "ProductionReport" WHERE id=$1', [before.id])).rows[0]).toEqual(before);
          await expect(db.query('DELETE FROM "ProductionReportDispute" WHERE id=$1', [dispute.id])).rejects.toThrow(/cannot be deleted/);
          await expect(db.query('UPDATE "ProductionReportDispute" SET resolution=$2 WHERE id=$1', [dispute.id, '篡改历史回复'])).rejects.toThrow(/immutable/);
        });
        // A different worker cannot read the report or its feedback.
        const other = E2E_USERS.workerWindmill!;
        const otherContext = await page.context().browser()!.newContext();
        try {
          const otherPage = await otherContext.newPage();
          await login(otherPage, { username: other.username, password: E2E_PASSWORD, from: `/worker/reports/${before.id}` });
          await expect(otherPage.getByRole('heading', { name: '找不到这个页面，或你没有访问权限' })).toBeVisible();
          await expect(otherPage.getByRole('heading', { name: '我的报工明细' })).toHaveCount(0);
          await expect(otherPage.getByText('请核对本次装版费用和完成数量')).toHaveCount(0);
        } finally { await otherContext.close(); }
      } finally { await adminContext.close(); }

    } finally {
      const cleanup = await cleanupE2eProductionOperationFixture(fixture);
      if (!cleanup.deleted) {
        test.info().annotations.push({
          type: 'data-residue',
          description:
            `${fixture.orderNo} retained by append-only ProductionReport ` +
            `(${cleanup.immutableReportCount} report rows)`,
        });
      }
    }
  });
});


const REPEATED_BATCH_TEXT = '这一批已经记录过，本次没有重复计入';

test('报工刷新重提不重复入账，显式再报一批允许相同数量', async ({ page }) => {
  test.setTimeout(120_000);
  const isolationFailure = productionOperationE2eIsolationFailure();
  requireReleasePrerequisite(isolationFailure);
  test.skip(Boolean(isolationFailure), isolationFailure ?? '');
  const seeded = await seedE2eProductionOperationFixture();
  if (!seeded.ready) {
    requireReleasePrerequisite(seeded.reason);
    test.skip(true, seeded.reason);
    return;
  }
  const { fixture } = seeded;
  // The append-only fixture deliberately survives runs. The page derives each
  // run's batch from the reporter's report count, so a new run gets a new batch
  // while refreshes within this test keep the pinned one.
  const batchUrl = new RegExp(`/worker/tasks/${fixture.operationId}\\?reportBatch=\\d+$`);
  const countReports = () => withDb(async (db) => Number((await db.query(
    'SELECT count(*) AS count FROM "ProductionReport" WHERE "operationId"=$1',
    [fixture.operationId],
  )).rows[0].count));
  const before = await countReports();
  try {
    await login(page, { from: `/worker/tasks/${fixture.operationId}`, username: worker.username, password: E2E_PASSWORD });
    await expect(page).toHaveURL(batchUrl);
    const pinnedUrl = page.url();
    const submit = async (expected = '已记录本次报工') => {
      const section = page.locator('section').filter({ has: page.getByRole('heading', { name: '扫码报工', exact: true }) });
      await section.getByRole('spinbutton', { name: '本次合格完成数', exact: true }).fill(String(E2E_PRODUCTION_REPORT_INCREMENT));
      await section.getByRole('spinbutton', { name: '本次工单件数进度', exact: true }).fill('0');
      await section.getByRole('spinbutton', { name: '缺陷数', exact: true }).fill('0');
      await section.getByRole('spinbutton', { name: '返工数', exact: true }).fill('0');
      await section.getByRole('button', { name: '提交扫码报工', exact: true }).click();
      await section.getByRole('button', { name: '确认报工', exact: true }).click();
      await expect(section.getByRole('status')).toContainText(expected, { timeout: 15_000 });
    };
    await submit();
    await expect.poll(countReports).toBe(before + 1);
    await page.reload();
    await expect(page).toHaveURL(pinnedUrl);
    await submit(REPEATED_BATCH_TEXT);
    await expect.poll(countReports).toBe(before + 1);
    await page.getByRole('link', { name: '再报一批', exact: true }).click();
    // 再报一批回到入口，由本人已有报工条数推导新批次（夹具跨运行保留，条数不固定）。
    await expect(page).toHaveURL(batchUrl);
    await expect(page).not.toHaveURL(pinnedUrl);
    await submit();
    await expect.poll(countReports).toBe(before + 2);
    await expectNoNextErrorOverlay(page);
  } finally {
    await cleanupE2eProductionOperationFixture(fixture);
  }
});

// This independent path needs no protected wage book. Its append-only facts
// stay in the explicitly disposable E2E database until that database is dropped.
test('不计薪报工刷新去重与再报一批经过真实页面和数据库', async ({ page }) => {
  test.setTimeout(120_000);
  const isolationFailure = productionOperationE2eIsolationFailure();
  expect(isolationFailure, 'requires a disposable E2E database').toBeNull();
  const id = `e2e-refresh-progress-${Date.now()}`;
  const stepId = `${id}-step`;
  await withDb(async db => {
    await db.query("SET TIME ZONE 'UTC'");
    const owner = (await db.query('SELECT id FROM "User" WHERE username=$1', [E2E_USERS.owner!.username])).rows[0].id;
    await db.query(`INSERT INTO "Order" (id,"orderNo","submitterId","submitterRole","createdById","settlementType",status,"workOrderVersion","customName","scheduledAt","createdAt","updatedAt") VALUES ($1,$1,$2,'SALES',$2,'EXTERNAL_SALES','RELEASED',1,'刷新报工测试',NOW(),NOW(),NOW())`, [id, owner]);
    await db.query(`INSERT INTO "OrderItem" (id,"orderId",sequence,name,"pricingRoute","productStructure",quantity,"foilTechnique",crafts,"createdAt","updatedAt") VALUES ($1,$2,1,'刷新报工款','CUSTOM_SINGLE_FLAT_FOIL','STANDARD_ENVELOPE',1000,'FLAT',ARRAY[]::text[],NOW(),NOW())`, [`${id}-item`, id]);
    await db.query(`INSERT INTO "Craft" (id,name,code,"defaultWorkerType","defaultMachineType","inHouseMachineTypes","isActive","isOutsource","createdAt","updatedAt") VALUES ($1,$1,$1,'MACHINE','HAND_PRESS',ARRAY[]::"MachineType"[],true,false,NOW(),NOW())`, [`${id}-craft`]);
    await db.query(`INSERT INTO "ProductionProgressStep" (id,"orderId","workOrderVersion","orderItemId","craftId","craftCode","craftName",status,"plannedQty","createdAt","updatedAt") VALUES ($1,$2,1,$3,$4,'REFRESH_TEST','覆膜','PENDING',1000,NOW(),NOW())`, [stepId, id, `${id}-item`, `${id}-craft`]);
  });
  const count = () => withDb(async db => Number((await db.query('SELECT count(*) AS count FROM "ProductionProgressReport" WHERE "progressStepId"=$1', [stepId])).rows[0].count));
  // Same resource must be hidden from a different machine lane, including direct URLs.
  const otherContext = await page.context().browser()!.newContext();
  try {
    const otherPage = await otherContext.newPage();
    await login(otherPage, { from: `/worker/tasks/${stepId}`, username: E2E_USERS.workerWindmill!.username, password: E2E_PASSWORD });
    await expect(otherPage.getByRole('heading', { name: '找不到这个页面，或你没有访问权限' })).toBeVisible();
    await otherPage.goto('/worker/tasks');
    await expect(otherPage.locator(`a[href="/worker/tasks/${stepId}"]`)).toHaveCount(0);
  } finally { await otherContext.close(); }
  await login(page, { from: `/worker/tasks/${stepId}`, username: worker.username, password: E2E_PASSWORD });
  const submit = async (expected = '已记录本次生产进度') => {
    const section = page.locator('section').filter({ has: page.getByRole('heading', { name: '扫码报进度', exact: true }) });
    await section.getByRole('spinbutton', { name: '本次合格完成数', exact: true }).fill('10');
    await section.getByRole('spinbutton', { name: '缺陷数', exact: true }).fill('0');
    await section.getByRole('spinbutton', { name: '返工数', exact: true }).fill('0');
    await section.getByRole('button', { name: '提交扫码报工', exact: true }).click();
    await section.getByRole('button', { name: '确认报工', exact: true }).click();
    await expect(section.getByRole('status')).toContainText(expected);
  };
  await expect(page).toHaveURL(`/worker/tasks/${stepId}?reportBatch=0`);
  await submit();
  await expect.poll(count).toBe(1);
  await page.reload();
  await submit(REPEATED_BATCH_TEXT);
  await expect.poll(count).toBe(1);
  // 重新扫码 / 从列表进入（不带批次号）是新的一批：同样数量照常入账。
  await page.goto(`/worker/tasks/${stepId}`);
  await expect(page).toHaveURL(`/worker/tasks/${stepId}?reportBatch=1`);
  await submit();
  await expect.poll(count).toBe(2);
  await page.getByRole('link', { name: '再报一批', exact: true }).click();
  await expect(page).toHaveURL(`/worker/tasks/${stepId}?reportBatch=2`);
  await submit();
  await expect.poll(count).toBe(3);
  await expectNoNextErrorOverlay(page);
});
