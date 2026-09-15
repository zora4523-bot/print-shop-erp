import { expect, it, vi } from 'vitest';
const mocks = vi.hoisted(() => ({ tx: {}, transaction: vi.fn(), inspect: vi.fn() }));
vi.mock('@/lib/db', () => ({ db: { $transaction: mocks.transaction } }));
vi.mock('../production-readiness', () => ({ inspectOrderProductionReadinessInTx: mocks.inspect }));
import { getOrderProductionReadiness } from '../production-readiness-query';
it('详情页只读重查就绪结果且不序列化完整工单', async () => {
  mocks.transaction.mockImplementation(async (fn) => fn(mocks.tx));
  mocks.inspect.mockResolvedValue({ ready: false, issues: ['工单没有包装组'], order: { secret: 'not for client' } });
  expect(await getOrderProductionReadiness('order-1')).toEqual({ ready: false, issues: ['工单没有包装组'] });
  expect(mocks.inspect).toHaveBeenCalledWith(mocks.tx, 'order-1');
});
