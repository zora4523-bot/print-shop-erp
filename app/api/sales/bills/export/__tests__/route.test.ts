import { beforeEach, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';
import type { NextAuthRequest } from 'next-auth';
import { UnauthorizedError } from '@/lib/auth/errors';
const { authorize, list, detail, InputError, NotFoundError } = vi.hoisted(() => ({ authorize: vi.fn(), list: vi.fn(), detail: vi.fn(), InputError: class extends Error {}, NotFoundError: class extends Error {} }));
vi.mock('@/lib/auth/permissions', () => ({ requireSessionPermission: authorize }));
vi.mock('@/lib/agent-monthly-billing/sales-export', () => ({ exportSalesBillList: list, exportSalesBillItems: detail, SalesBillExportInputError: InputError, SalesBillExportNotFoundError: NotFoundError }));
import { handleSalesBillExport } from '../handler';
const actor = { id: 'sales-a', role: 'SALES' };
const request = () => Object.assign(new NextRequest('http://localhost/api/sales/bills/export?agentUserId=foreign'), { auth: null }) as NextAuthRequest;
beforeEach(() => { vi.clearAllMocks(); authorize.mockResolvedValue(actor); list.mockResolvedValue({ csv: '\uFEFF"账期"\r\n', fileName: 'my-bills-all.csv' }); detail.mockResolvedValue({ csv: '\uFEFF"工单"\r\n', fileName: 'my-bill-2026-08.csv' }); });
it('requires a database-backed sales permission before export input', async () => {
  authorize.mockRejectedValue(new UnauthorizedError('private permission details'));
  const response = await handleSalesBillExport(request());
  expect(response.status).toBe(401); expect(authorize).toHaveBeenCalledWith('bill:view:self', null);
  expect(list).not.toHaveBeenCalled(); expect(await response.text()).not.toContain('private');
});
it('returns private CSV and passes the authenticated identity to the list query', async () => {
  const response = await handleSalesBillExport(request());
  expect(response.headers.get('Content-Type')).toBe('text/csv; charset=utf-8');
  expect(response.headers.get('Cache-Control')).toBe('private, no-store');
  expect(response.headers.get('X-Content-Type-Options')).toBe('nosniff');
  expect(response.headers.get('Content-Disposition')).toContain('my-bills-all.csv');
  expect(list.mock.calls[0][0]).toBe(actor); expect(response.status).toBe(200);
});
it('routes the selected bill through the owned member export', async () => {
  await handleSalesBillExport(request(), 'bill-a');
  expect(detail).toHaveBeenCalledWith(actor, 'bill-a', expect.any(URLSearchParams)); expect(list).not.toHaveBeenCalled();
});
it.each([[new InputError('筛选条件不合法'), 400], [new NotFoundError('private bill'), 404], [new Error('database secret'), 503]])('maps a safe failure response', async (error, status) => {
  const log = vi.spyOn(console, 'error').mockImplementation(() => undefined);
  list.mockRejectedValue(error);
  const response = await handleSalesBillExport(request());
  expect(response.status).toBe(status); expect(await response.text()).not.toMatch(/private|secret/); log.mockRestore();
});
