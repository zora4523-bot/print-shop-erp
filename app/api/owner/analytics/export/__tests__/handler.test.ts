import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { NextAuthRequest } from 'next-auth';
import { UnauthorizedError } from '@/lib/auth/errors';
const mocks = vi.hoisted(() => ({ auth: vi.fn(), report: vi.fn() }));
vi.mock('server-only', () => ({}));
vi.mock('@/lib/auth/permissions', () => ({ requireSessionPermission: mocks.auth }));
vi.mock('@/lib/analytics/service', () => ({ readAnalyticsReport: mocks.report }));
vi.mock('@/lib/analytics/queries', () => ({ analyticsRead: (_actor: unknown, read: (tx: object) => unknown) => read({}), readAnalyticsFinance: vi.fn(), readAnalyticsTrend: vi.fn() }));
import { handleAnalyticsExport } from '../handler';
const request = (query = '') => ({ url: `https://test/api/owner/analytics/export?view=orders${query}`, auth: null }) as NextAuthRequest;
beforeEach(() => { vi.resetAllMocks(); mocks.auth.mockResolvedValue({ id: 'a', role: 'ADMIN' }); mocks.report.mockResolvedValue({ metrics: [], tables: [], details: { title: '明细', columns: ['名称'], rows: [[{ value: '=cmd' }]] }, notes: [], page: 1, pages: 1, total: 1 }); });
describe('analytics export authorization', () => {
  it('rejects missing, disabled or wrong-role sessions before reads', async () => {
    mocks.auth.mockRejectedValueOnce(new UnauthorizedError('Forbidden'));
    expect((await handleAnalyticsExport(request())).status).toBe(401); expect(mocks.report).not.toHaveBeenCalled();
    expect(mocks.auth).toHaveBeenCalledWith('report:all', null);
  });
  it.each(['&from=bad', '&page=0', '&sales=a&sales=b'])('rejects invalid/repeated parameters %s', async query => {
    expect((await handleAnalyticsExport(request(query))).status).toBe(400); expect(mocks.report).not.toHaveBeenCalled();
  });
  it('exports every filtered page with no-store and formula-safe text', async () => {
    const response = await handleAnalyticsExport(request('&page=2'));
    expect(response.status).toBe(200); expect(response.headers.get('cache-control')).toBe('private, no-store');
    expect(response.headers.get('content-type')).toContain('text/csv'); expect(await response.text()).toContain("'=cmd");
    expect(mocks.report).toHaveBeenCalledWith({}, expect.objectContaining({ page: 2 }), true);
  });
  it('does not turn unexpected query errors into empty CSV', async () => {
    mocks.report.mockRejectedValueOnce(new Error('query failed')); await expect(handleAnalyticsExport(request())).rejects.toThrow('query failed');
  });
});
