import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { NextAuthRequest } from 'next-auth';
import { UnauthorizedError } from '@/lib/auth/errors';
const mocks = vi.hoisted(() => ({ permission: vi.fn(), session: vi.fn(), file: vi.fn() }));
vi.mock('@/lib/auth/permissions', () => ({ requireSessionPermission: mocks.permission }));
vi.mock('@/lib/auth/session', () => ({ getVerifiedSession: mocks.session }));
vi.mock('@/lib/historical-finance/files', () => ({ readHistoricalFinanceFile: mocks.file }));
import { handleHistoricalFinance } from '../handler';
const request = (file: string) => ({ url: `https://example.test/historical-finance/${file}`, auth: null }) as NextAuthRequest;
beforeEach(() => { vi.resetAllMocks(); mocks.permission.mockResolvedValue({ role: 'ADMIN' }); mocks.file.mockResolvedValue({ type: 'text/javascript; charset=utf-8', body: new Uint8Array([49]) }); });
describe('historical finance authorization', () => {
  it.each(['data.js', 'expense-summary.csv'])('checks current account permission before reading %s', async file => {
    mocks.permission.mockRejectedValue(new UnauthorizedError('denied'));
    const response = await handleHistoricalFinance(request(file));
    expect(response.status).toBe(401);
    expect(response.headers.get('cache-control')).toBe('private, no-store');
    expect(mocks.file).not.toHaveBeenCalled();
    expect(mocks.permission).toHaveBeenCalledWith('report:all', null);
  });
  it.each([null, { user: { id: 'disabled-account', role: 'ADMIN' } }])('redirects an unverified HTML visitor to login and preserves the return path', async auth => {
    mocks.permission.mockRejectedValue(new UnauthorizedError('denied'));
    mocks.session.mockResolvedValue(null);
    const input = { ...request('index.html?view=materials&from=https://untrusted.test'), auth } as NextAuthRequest;
    const response = await handleHistoricalFinance(input);
    expect(response.status).toBe(307);
    const target = new URL(response.headers.get('location')!);
    expect(target.origin).toBe('https://example.test');
    expect(target.pathname).toBe('/login');
    expect(target.searchParams.get('from')).toBe('/historical-finance/index.html?view=materials&from=https://untrusted.test');
    expect(response.headers.get('cache-control')).toBe('private, no-store');
    expect(response.headers.get('vary')).toBe('Cookie');
    expect(mocks.session).toHaveBeenCalledWith(auth);
    expect(mocks.file).not.toHaveBeenCalled();
  });
  it('does not send an authenticated account without permission into a login loop', async () => {
    mocks.permission.mockRejectedValue(new UnauthorizedError('denied'));
    mocks.session.mockResolvedValue({ user: { id: 'sales-account', role: 'SALES' } });
    const response = await handleHistoricalFinance(request('index.html'));
    expect(response.status).toBe(403);
    expect(response.headers.get('location')).toBeNull();
    expect(await response.text()).toContain('当前账号无权');
    expect(mocks.file).not.toHaveBeenCalled();
  });
  it('does not turn a failed account lookup into a login redirect', async () => {
    mocks.permission.mockRejectedValue(new UnauthorizedError('denied'));
    mocks.session.mockRejectedValue(new Error('database unavailable'));
    await expect(handleHistoricalFinance(request('index.html'))).rejects.toThrow('database unavailable');
  });
  it('serves bytes with private cache policy', async () => {
    const response = await handleHistoricalFinance(request('data.js?v=123'));
    expect(response.status).toBe(200);
    expect(await response.text()).toBe('1');
    expect(response.headers.get('vary')).toBe('Cookie');
    expect(response.headers.get('cache-control')).toBe('private, no-store');
    expect(mocks.file).toHaveBeenCalledWith('data.js');
  });
  it('does not disguise an unavailable authorization service as permission', async () => {
    mocks.permission.mockRejectedValue(new Error('database unavailable'));
    await expect(handleHistoricalFinance(request('data.js'))).rejects.toThrow('database unavailable');
    expect(mocks.file).not.toHaveBeenCalled();
  });
});
