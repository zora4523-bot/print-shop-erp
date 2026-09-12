import Decimal from 'decimal.js';
import { expect, test, type Page } from '@playwright/test';
import { E2E_PASSWORD, login } from './_helpers';
import { salaryLedger, seedSalaryLedgerFixture } from './release-ledger-fixtures';

type Fixture = Awaited<ReturnType<typeof seedSalaryLedgerFixture>>;

async function attendancePanel(page: Page, fixture: Fixture) {
  await page.goto(`/foreman/attendance?month=${fixture.month}&workerId=${fixture.worker.id}`);
  const panel = page.locator('details').filter({ hasText: `${fixture.worker.name} · ${fixture.date}` });
  await panel.locator('summary').click();
  await expect(panel.getByRole('button', { name: '保存', exact: true })).toBeVisible();
  return panel;
}

async function recompute(page: Page, fixture: Fixture) {
  await page.goto(`/owner/salary/hourly?month=${fixture.month}&workerId=${fixture.worker.id}`);
  await page.getByRole('button', { name: `核对并重算 ${fixture.month} 全员月结`, exact: true }).click();
  const dialog = page.getByRole('alertdialog');
  await expect(dialog).toContainText('已发记录保持不变');
  await dialog.getByRole('button', { name: `确认重算 ${fixture.month}`, exact: true }).click();
  await expect(page.getByText(`${fixture.month} 时薪月结重算结果`, { exact: true })).toBeVisible();
}

test('清废考勤录入、月结、发放与已付历史锁定走真实管理页面', async ({ page }) => {
  test.setTimeout(150_000);
  const fixture = await seedSalaryLedgerFixture();
  test.info().annotations.push({ type: 'data-residue', description: `Paid salary and attendance retained: ${fixture.worker.id}/${fixture.month}` });
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await login(page, { username: fixture.admin.username, password: E2E_PASSWORD,
    from: `/foreman/attendance?month=${fixture.month}&workerId=${fixture.worker.id}` });

  let panel = await attendancePanel(page, fixture);
  await panel.getByLabel('正常工时', { exact: true }).fill('8');
  await panel.getByLabel('加班工时', { exact: true }).fill('2');
  await panel.getByRole('button', { name: '保存', exact: true }).click();
  await expect(panel.getByRole('status')).toContainText(`已保存 ${fixture.date} 的考勤`);
  let ledger = await salaryLedger(fixture.worker.id, fixture.month);
  expect(ledger.attendance).toHaveLength(1);
  expect(ledger.attendance[0]).toMatchObject({ normalHours: '8.00', otHours: '2.00',
    roleSnapshot: 'WORKER', workerTypeSnapshot: 'CLEANER', identitySnapshotVerified: true });
  const attendanceId = ledger.attendance[0]!.id;
  panel = await attendancePanel(page, fixture);
  await panel.getByRole('button', { name: '保存', exact: true }).click();
  await expect(panel.getByRole('status')).toContainText(`已保存 ${fixture.date} 的考勤`);
  ledger = await salaryLedger(fixture.worker.id, fixture.month);
  expect(ledger.attendance).toHaveLength(1);
  expect(ledger.attendance[0]!.id).toBe(attendanceId);

  await recompute(page, fixture);
  ledger = await salaryLedger(fixture.worker.id, fixture.month);
  expect(ledger.payroll).toHaveLength(1);
  const base = new Decimal(fixture.rate).times(8).toDecimalPlaces(2, Decimal.ROUND_HALF_UP);
  const overtime = new Decimal(fixture.rate).times(fixture.multiplier).times(2).toDecimalPlaces(2, Decimal.ROUND_HALF_UP);
  expect(ledger.payroll[0]).toMatchObject({ totalWorkHours: '8.00', totalOtHours: '2.00',
    baseSalary: base.toFixed(2), otSalary: overtime.toFixed(2), totalSalary: base.plus(overtime).toFixed(2),
    isPaid: false, paidAt: null,
    salaryRuleSnapshot: { workerType: 'CLEANER', totals: { normalHours: '8.00', otHours: '2.00', spareHours: '0.00' } },
  });

  await page.reload();
  const row = page.getByRole('row').filter({ hasText: fixture.worker.name });
  await row.getByRole('button', { name: '标记已发', exact: true }).click();
  const paidDialog = page.getByRole('alertdialog');
  await expect(paidDialog).toContainText(fixture.worker.name);
  expect((await salaryLedger(fixture.worker.id, fixture.month)).payroll[0]!.isPaid).toBe(false);
  const paymentRequestPromise = page.waitForRequest((request) =>
    request.method() === 'POST' && new URL(request.url()).pathname === '/owner/salary/hourly',
  );
  await paidDialog.getByRole('button', { name: '确认标记已发', exact: true }).click();
  const paymentRequest = await paymentRequestPromise;
  await expect(page.getByText('已标记发放', { exact: true })).toBeVisible();
  const paid = await salaryLedger(fixture.worker.id, fixture.month);
  expect(paid.payroll[0]!.isPaid).toBe(true);
  expect(paid.payroll[0]!.paidAt).not.toBeNull();

  await test.step('重放同一发放请求，首次发放时间和完整月结快照保持不变', async () => {
    const replay = await page.request.fetch(paymentRequest);
    expect(replay.status()).toBe(200);
    await replay.dispose();
    expect(await salaryLedger(fixture.worker.id, fixture.month)).toEqual(paid);
  });

  panel = await attendancePanel(page, fixture);
  await panel.getByLabel('正常工时', { exact: true }).fill('9');
  await panel.getByRole('button', { name: '保存', exact: true }).click();
  await expect(panel.getByRole('alert')).toContainText('工资已发放；请先撤销发放再修改考勤');
  expect(await salaryLedger(fixture.worker.id, fixture.month)).toEqual(paid);

  await recompute(page, fixture);
  await expect(page.getByText(/该月工资已标记发放/).filter({ hasText: fixture.worker.name })).toBeVisible();
  expect(await salaryLedger(fixture.worker.id, fixture.month)).toEqual(paid);
  expect(errors).toEqual([]);
});
