import { beforeEach, describe, expect, it, vi } from 'vitest';
const mocks = vi.hoisted(() => ({ permission: vi.fn(), repair: vi.fn(), revalidate: vi.fn() }));
vi.mock('@/lib/auth/permissions', () => ({ requirePermission: mocks.permission }));
vi.mock('next/cache', () => ({ revalidatePath: mocks.revalidate }));
vi.mock('@/lib/order/legacy-production-facts', () => ({ repairLegacyProductionFacts: mocks.repair, LegacyProductionFactsError: class extends Error {} }));
import { repairLegacyProductionFactsAction } from '../order-production-facts';
import { LegacyProductionFactsError } from '@/lib/order/legacy-production-facts';
const actor = { id: 'admin-1', role: 'ADMIN' };
function form() {
  const data = new FormData();
  for (const [key, value] of Object.entries({ orderId: 'order-1', expectedOrderRevision: '2', 'items.0.itemId': 'item-1', 'items.0.craft': 'FULL', 'items.0.unitsPerBag': '10', packagingMode: 'SINGLE_STYLE' })) data.set(key, value);
  return data;
}
beforeEach(() => { vi.resetAllMocks(); mocks.permission.mockResolvedValue(actor); mocks.repair.mockResolvedValue({ orderId: 'order-1', ready: true, issues: [], revision: 3 }); });
describe('repairLegacyProductionFactsAction', () => {
  it('权限先行，即使输入非法也先拒绝未授权请求', async () => {
    mocks.permission.mockRejectedValue(new Error('forbidden'));
    await expect(repairLegacyProductionFactsAction(null, new FormData())).rejects.toThrow('forbidden');
    expect(mocks.permission).toHaveBeenCalledWith('order:production-facts:repair'); expect(mocks.repair).not.toHaveBeenCalled();
  });
  it('invalid 保留嵌套字段路径', async () => {
    const data = form(); data.set('items.0.unitsPerBag', '0');
    expect(await repairLegacyProductionFactsAction(null, data)).toMatchObject({ status: 'invalid', fieldErrors: { 'items.0.unitsPerBag': expect.any(Array) } });
    expect(mocks.repair).not.toHaveBeenCalled(); expect(mocks.revalidate).not.toHaveBeenCalled();
  });
  it('成功委托领域并刷新详情和核价编辑页', async () => {
    expect(await repairLegacyProductionFactsAction(null, form())).toMatchObject({ status: 'success', result: { ready: true } });
    expect(mocks.repair).toHaveBeenCalledWith({ orderId: 'order-1', expectedOrderRevision: 2, packagingMode: 'SINGLE_STYLE', items: [{ itemId: 'item-1', craft: 'FULL', unitsPerBag: 10 }] }, actor);
    expect(mocks.revalidate.mock.calls).toEqual([['/orders/order-1'], ['/orders/order-1/edit']]);
  });
  it('领域错误返回提示，未知错误继续抛出', async () => {
    mocks.repair.mockRejectedValueOnce(new LegacyProductionFactsError('工单已变化'));
    expect(await repairLegacyProductionFactsAction(null, form())).toEqual({ status: 'error', message: '工单已变化' });
    mocks.repair.mockRejectedValueOnce(new Error('database unavailable'));
    await expect(repairLegacyProductionFactsAction(null, form())).rejects.toThrow('database unavailable');
  });
});
