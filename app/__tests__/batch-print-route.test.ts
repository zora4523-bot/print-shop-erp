import { beforeEach, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';
import type { NextAuthRequest } from 'next-auth';
const m = vi.hoisted(() => ({ auth: vi.fn(), status: vi.fn(), download: vi.fn() }));
vi.mock('@/lib/auth/permissions', () => ({ requireSessionPermission: m.auth }));
vi.mock('@/lib/order/batch-print', () => ({ batchPrintStatus: m.status, downloadBatchPrint: m.download, BatchPrintAccessError: class extends Error {}, BatchPrintSelectionError: class extends Error {} }));
import { UnauthorizedError } from '@/lib/auth/errors';
import { BatchPrintAccessError } from '@/lib/order/batch-print';
import { handleBatchPrintGet } from '@/app/api/orders/batch-print/[jobId]/handler';
function request(query = '') {
  return handleBatchPrintGet(Object.assign(new NextRequest(`https://example.test/api/orders/batch-print/j${query}`), { auth: null }) as NextAuthRequest, { params: Promise.resolve({ jobId: 'j' }) });
}
beforeEach(() => { vi.resetAllMocks(); m.auth.mockResolvedValue({ id: 'admin' }); m.download.mockResolvedValue(Buffer.from('%PDF-test')); m.status.mockResolvedValue({ status: 'pending' }); });
it('rejects anonymous requests without reading a task', async () => { m.auth.mockRejectedValue(new UnauthorizedError()); expect((await request()).status).toBe(401); expect(m.status).not.toHaveBeenCalled(); });
it('does not reveal other users jobs', async () => { m.status.mockRejectedValue(new BatchPrintAccessError()); expect((await request()).status).toBe(404); });
it.each(['download', 'inline'])('delivers private %s bytes', async (view) => { const r = await request(`?view=${view}`); expect(r.status).toBe(200); expect(r.headers.get('cache-control')).toBe('private, no-store'); expect(r.headers.get('content-type')).toBe('application/pdf'); expect(r.headers.get('content-disposition')).toContain(view === 'inline' ? 'inline' : 'attachment'); });
it('rejects ambiguous view', async () => { expect((await request('?view=inline&view=download')).status).toBe(400); expect(m.download).not.toHaveBeenCalled(); });
it('does not leak artifact errors', async () => { m.download.mockRejectedValue(new Error('/private/secret.pdf')); const r = await request('?view=download'); expect(r.status).toBe(503); expect(await r.text()).not.toContain('secret'); });
