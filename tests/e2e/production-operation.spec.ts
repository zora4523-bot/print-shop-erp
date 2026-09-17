import { expect, test } from '@playwright/test';
import { requireReleasePrerequisite } from './release-prerequisite';
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
      await expect(page).toHaveURL(`/worker/tasks/${fixture.operationId}`);

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
