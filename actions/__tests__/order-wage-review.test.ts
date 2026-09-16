import { beforeEach, expect, it, vi } from 'vitest';
const { permission, review, revalidate } = vi.hoisted(() => ({ permission: vi.fn(), review: vi.fn(), revalidate: vi.fn() }));
vi.mock('@/lib/db', () => ({ db: {} }));
vi.mock('@/lib/auth/permissions', () => ({ requirePermission: permission }));
vi.mock('next/cache', () => ({ revalidatePath: revalidate }));
vi.mock('@/lib/salary/order-wage-review', async (original) => ({ ...await original<typeof import('@/lib/salary/order-wage-review')>(), reviewOrderWages: review }));
import { reviewOrderWagesAction } from '../order-wage-review';
import { WageReviewError } from '@/lib/salary/order-wage-review';
const actor = { id: 'admin' };
function form() { const f = new FormData(); Object.entries({ operationId: 'op', revision: 'a'.repeat(64), reason: '两人平分', anchorId: 'r1', amount: '19' }).forEach(([key, value]) => f.set(key, value)); return f; }
beforeEach(() => { vi.resetAllMocks(); permission.mockResolvedValue(actor); review.mockResolvedValue({ orderId: 'order' }); });
it('读取服务端身份，核定后刷新工资页面', async () => { expect(await reviewOrderWagesAction(null, form())).toMatchObject({ status: 'success' }); expect(permission).toHaveBeenCalledWith('salary:rule:manage'); expect(review).toHaveBeenCalledWith(expect.objectContaining({ targets: [{ anchorId: 'r1', amount: '19' }] }), actor); expect(revalidate).toHaveBeenCalledWith('/orders/order'); });
it('权限拒绝不调用领域', async () => { permission.mockRejectedValue(new Error('Forbidden')); await expect(reviewOrderWagesAction(null, form())).rejects.toThrow('Forbidden'); expect(review).not.toHaveBeenCalled(); });
it.each(['-1', '1e2', '1.001', ''])('拒绝非法金额 %s', async (amount) => { const f = form(); f.set('amount', amount); expect(await reviewOrderWagesAction(null, f)).toMatchObject({ status: 'error' }); expect(review).not.toHaveBeenCalled(); });
it('领域错误显示，未知错误继续抛出', async () => { review.mockRejectedValueOnce(new WageReviewError('已结算')); expect(await reviewOrderWagesAction(null, form())).toEqual({ status: 'error', message: '已结算' }); review.mockRejectedValue(new Error('database')); await expect(reviewOrderWagesAction(null, form())).rejects.toThrow('database'); });
