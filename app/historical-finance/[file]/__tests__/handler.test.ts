import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { NextAuthRequest } from 'next-auth';
import { UnauthorizedError } from '@/lib/auth/errors';
const mocks = vi.hoisted(() => ({ permission: vi.fn(), file: vi.fn() }));
vi.mock('@/lib/auth/permissions', () => ({ requireSessionPermission: mocks.permission }));
vi.mock('@/lib/historical-finance/files', () => ({ readHistoricalFinanceFile: mocks.file }));
import { handleHistoricalFinance } from '../handler';
const request = (file: string) => ({ url: `https://example.test/historical-finance/${file}`, auth: null }) as NextAuthRequest;
beforeEach(() => { vi.resetAllMocks(); mocks.permission.mockResolvedValue({ role: 'ADMIN' }); mocks.file.mockResolvedValue({ type: 'text/javascript; charset=utf-8', body: new Uint8Array([49]) }); });
describe('historical finance authorization', () => {
  it.each(['index.html', 'data.js', 'expense-summary.csv'])('checks current account permission before reading %s', async file => {
    mocks.permission.mockRejectedValue(new UnauthorizedError('denied'));
    const response = await handleHistoricalFinance(request(file));
    expect(response.status).toBe(401);
    expect(response.headers.get('cache-control')).toBe('private, no-store');
    expect(mocks.file).not.toHaveBeenCalled();
    expect(mocks.permission).toHaveBeenCalledWith('report:all', null);
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
