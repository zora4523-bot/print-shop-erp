import { beforeEach, describe, expect, it, vi } from 'vitest';
const mocks = vi.hoisted(() => ({ permission: vi.fn(), quote: vi.fn() }));
vi.mock('@/lib/auth/permissions', () => ({
  requirePermission: mocks.permission,
}));
vi.mock('@/lib/order/sample-order', () => ({ quoteSampleOrder: mocks.quote }));
vi.mock('@/lib/order/create-order-quote-service', () => ({
  CreateOrderQuoteError: class extends Error {},
}));
import { quoteSampleOrderAction } from '../create-order-quote';

beforeEach(() => {
  vi.clearAllMocks();
});
describe('sample quote action authorization', () => {
  it.each(['SALES', 'CUSTOMER_SERVICE', 'ADMIN'])(
    'allows %s with order:create',
    async (role) => {
      mocks.permission.mockResolvedValue({ id: 'actor', role });
      mocks.quote.mockResolvedValue({ total: null, knownTotal: '0.00' });
      expect(await quoteSampleOrderAction({ purpose: 'PROOF' })).toMatchObject({
        status: 'success',
        quote: { total: null },
      });
      expect(mocks.permission).toHaveBeenCalledWith('order:create');
    },
  );
  it('checks permission before reading published prices', async () => {
    mocks.permission.mockRejectedValue(new Error('forbidden'));
    await expect(quoteSampleOrderAction({})).rejects.toThrow('forbidden');
    expect(mocks.quote).not.toHaveBeenCalled();
  });
  it('returns a recoverable invalid packaging message', async () => {
    mocks.permission.mockResolvedValue({ id: 'sales', role: 'SALES' });
    const error = new Error('所选包装已不可用');
    error.name = 'SampleOrderError';
    mocks.quote.mockRejectedValue(error);
    expect(await quoteSampleOrderAction({})).toEqual({
      status: 'error',
      message: error.message,
    });
  });
});
