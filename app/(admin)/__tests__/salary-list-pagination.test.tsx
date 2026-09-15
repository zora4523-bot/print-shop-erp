import { renderToStaticMarkup } from 'react-dom/server';
import { beforeEach, expect, it, vi } from 'vitest';
const { daily, hourly, monthContext, permission } = vi.hoisted(() => ({
  daily: vi.fn(), hourly: vi.fn(), monthContext: vi.fn(), permission: vi.fn(),
}));
vi.mock('@/lib/auth/permissions', () => ({ requirePermission: permission }));
vi.mock('@/lib/salary/daily', () => ({ listDailyWorkerSalaries: daily, listMachineWorkersForSalary: vi.fn().mockResolvedValue([]) }));
vi.mock('@/lib/salary/hourly-aggregate', () => ({ listHourlyPayrolls: hourly, getHourlyPayrollMonthContext: monthContext }));
vi.mock('@/lib/account', () => ({ listUsers: vi.fn().mockResolvedValue([]) }));
vi.mock('@/lib/attendance', () => ({ getAttendanceSummaries: vi.fn().mockResolvedValue(new Map()), parseShanghaiMonth: vi.fn().mockReturnValue({}) }));
vi.mock('@/components/business/salary/RecomputeHourlyForm', () => ({ RecomputeHourlyForm: ({ context }: { context: { existingRecordCount: number } }) => <div>整月记录：{context.existingRecordCount}</div> }));
vi.mock('@/components/business/salary/MarkHourlyPaidForm', () => ({ MarkHourlyPaidForm: () => null }));
import Daily from '../owner/salary/daily/page';
import Hourly from '../owner/salary/hourly/page';
beforeEach(() => {
  vi.clearAllMocks();
  const result = { rows: [], total: 123, page: 2, pageCount: 3, pageSize: 50, totalSalary: '9876.54', unpaidSalary: '1234.56' };
  daily.mockResolvedValue(result);
  hourly.mockResolvedValue(result);
  monthContext.mockResolvedValue({ workerIds: [], context: { existingRecordCount: 300 } });
});
it('daily page forwards pagination and preserves filters and full totals in the markup', async () => {
  const html = renderToStaticMarkup(await Daily({ searchParams: Promise.resolve({ date: '2026-05-01', paid: 'unpaid', workerId: 'w1', page: '2', pageSize: '50' }) }));
  expect(permission).toHaveBeenCalledWith('salary:view:all');
  expect(daily).toHaveBeenCalledWith({ date: '2026-05-01', workerId: 'w1', isPaid: false, page: '2', pageSize: '50' });
  expect(html).toContain('9,876.54');
  expect(html).toContain('123 条');
  expect(html).toContain('date=2026-05-01&amp;paid=unpaid&amp;workerId=w1&amp;pageSize=50&amp;page=3');
});
it('hourly page preserves pagination links and whole-month recompute context independently', async () => {
  const html = renderToStaticMarkup(await Hourly({ searchParams: Promise.resolve({ month: '2026-05', paid: 'paid', workerId: 'w1', page: '2', pageSize: '50' }) }));
  expect(permission).toHaveBeenCalledWith('salary:view:all');
  expect(hourly).toHaveBeenCalledWith({ month: '2026-05', workerId: 'w1', isPaid: true, page: '2', pageSize: '50' });
  expect(monthContext).toHaveBeenCalledWith('2026-05');
  expect(html).toContain('整月记录：300');
  expect(html).toContain('9,876.54');
  expect(html).toContain('month=2026-05&amp;paid=paid&amp;workerId=w1&amp;pageSize=50&amp;page=3');
});
