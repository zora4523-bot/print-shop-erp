import { expect, test, type Page } from '@playwright/test';
import { E2E_PASSWORD, login } from './_helpers';
import { archiveHourlyPayroll, salaryLedger, seedSalaryLedgerFixture } from './release-ledger-fixtures';

type Fixture = Awaited<ReturnType<typeof seedSalaryLedgerFixture>>;

async function attendancePanel(page: Page, fixture: Fixture) {
  await page.goto(`/foreman/attendance?month=${fixture.month}&workerId=${fixture.worker.id}`);
  const panel = page.locator('details').filter({ hasText: `${fixture.worker.name} · ${fixture.date}` });
  await panel.locator('summary').click();
  await expect(panel.getByRole('button', { name: '保存', exact: true })).toBeVisible();
  return panel;
}

test('打包考勤录入走真实管理页面，历史时薪月结存档月份的考勤冻结且存档只读', async ({ page }) => {
  test.setTimeout(150_000);
  const fixture = await seedSalaryLedgerFixture();
  test.info().annotations.push({ type: 'data-residue', description: `Archived payroll and attendance retained: ${fixture.worker.id}/${fixture.month}` });
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
    roleSnapshot: 'WORKER', workerTypeSnapshot: 'PACKER', identitySnapshotVerified: true });
  const attendanceId = ledger.attendance[0]!.id;
  panel = await attendancePanel(page, fixture);
  await panel.getByRole('button', { name: '保存', exact: true }).click();
  await expect(panel.getByRole('status')).toContainText(`已保存 ${fixture.date} 的考勤`);
  ledger = await salaryLedger(fixture.worker.id, fixture.month);
  expect(ledger.attendance).toHaveLength(1);
  expect(ledger.attendance[0]!.id).toBe(attendanceId);
  expect(ledger.payroll).toEqual([]);

  await archiveHourlyPayroll(fixture.worker.id, fixture.month);
  const archived = await salaryLedger(fixture.worker.id, fixture.month);
  expect(archived.payroll).toHaveLength(1);

  panel = await attendancePanel(page, fixture);
  await panel.getByLabel('正常工时', { exact: true }).fill('9');
  await panel.getByRole('button', { name: '保存', exact: true }).click();
  await expect(panel.getByRole('alert')).toContainText('考勤已冻结，不能修改');
  expect(await salaryLedger(fixture.worker.id, fixture.month)).toEqual(archived);

  await page.goto(`/owner/salary/hourly?month=${fixture.month}&workerId=${fixture.worker.id}`);
  const row = page.getByRole('row').filter({ hasText: fixture.worker.name });
  await expect(row).toContainText('已归档');
  await expect(page.getByRole('button', { name: /重算|标记已发/ })).toHaveCount(0);
  expect(await salaryLedger(fixture.worker.id, fixture.month)).toEqual(archived);
  expect(errors).toEqual([]);
});
