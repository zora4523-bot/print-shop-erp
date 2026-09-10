import { beforeEach, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';
import type { NextAuthRequest } from 'next-auth';
import { Role } from '@/generated/prisma/enums';
const mocks = vi.hoisted(() => ({ user: vi.fn(), load: vi.fn(), workbook: vi.fn() }));
vi.mock('@/lib/auth/config', () => ({ auth: (handler: unknown) => handler }));
vi.mock('@/lib/db', () => ({ db: { user: { findUnique: mocks.user } } }));
vi.mock('@/lib/salary/piecework-settlement-xlsx', () => ({
  loadPieceworkSettlementExportData: mocks.load,
  buildPieceworkSettlementWorkbook: mocks.workbook,
  PieceworkSettlementExportError: class extends Error {},
}));
import { GET } from '../route';
import { handlePieceworkSettlementExportGet } from '../handler';
import { PieceworkSettlementExportError } from '@/lib/salary/piecework-settlement-xlsx';
function request(authenticated = true) {
  return Object.assign(new NextRequest('https://erp.example/api/salary/piecework-settlements/export?from=2026-09-01&to=2026-09-08&workerId=worker-2'), {
    auth: authenticated ? { user: { id: 'user-1', role: Role.ADMIN }, expires: '2099-01-01' } : null,
  }) as NextAuthRequest;
}
beforeEach(() => {
  vi.resetAllMocks();
  mocks.user.mockResolvedValue({ id: 'user-1', role: Role.ADMIN, isActive: true });
  mocks.load.mockResolvedValue([{ id: 'settlement-1' }]);
  mocks.workbook.mockResolvedValue(Buffer.from('xlsx'));
});
it('requires a session before reading account or salary data', async () => {
  const response = await handlePieceworkSettlementExportGet(request(false));
  expect(response.status).toBe(401);
  expect(mocks.user).not.toHaveBeenCalled();
  expect(mocks.load).not.toHaveBeenCalled();
  expect(mocks.workbook).not.toHaveBeenCalled();
});
it.each([Role.WORKER, Role.SALES, Role.CUSTOMER_SERVICE])('rejects current database role %s despite an old ADMIN token', async (role) => {
  mocks.user.mockResolvedValue({ id: 'user-1', role, isActive: true });
  const response = await handlePieceworkSettlementExportGet(request());
  expect(response.status).toBe(401);
  expect(mocks.load).not.toHaveBeenCalled();
  expect(mocks.workbook).not.toHaveBeenCalled();
  expect(await response.text()).not.toContain('salary:view:all');
});
it.each([null, { id: 'user-1', role: Role.ADMIN, isActive: false }])('rejects deleted or disabled accounts', async (user) => {
  mocks.user.mockResolvedValue(user);
  expect((await handlePieceworkSettlementExportGet(request())).status).toBe(401);
  expect(mocks.load).not.toHaveBeenCalled();
});
it('exports only after database authorization and preserves filters and private caching', async () => {
  expect(GET).toBe(handlePieceworkSettlementExportGet);
  const response = await handlePieceworkSettlementExportGet(request());
  expect(response.status).toBe(200);
  expect(mocks.load).toHaveBeenCalledWith({ from: '2026-09-01', to: '2026-09-08', workerId: 'worker-2' });
  expect(mocks.user.mock.invocationCallOrder[0]).toBeLessThan(mocks.load.mock.invocationCallOrder[0]);
  expect(response.headers.get('cache-control')).toBe('private, no-store');
  expect(response.headers.get('content-type')).toContain('spreadsheetml');
  expect(await response.text()).toBe('xlsx');
});
it('preserves input validation failures', async () => {
  mocks.load.mockRejectedValue(new PieceworkSettlementExportError('日期范围无效'));
  expect((await handlePieceworkSettlementExportGet(request())).status).toBe(400);
  expect(mocks.workbook).not.toHaveBeenCalled();
});
