import { randomUUID } from 'node:crypto';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
const { permission, cancel, review, revalidate } = vi.hoisted(() => ({ permission: vi.fn(), cancel: vi.fn(), review: vi.fn(), revalidate: vi.fn() }));
vi.mock('@/lib/db', () => ({ db: {} }));
vi.mock('@/lib/auth/permissions', () => ({ requirePermission: permission }));
vi.mock('next/cache', () => ({ revalidatePath: revalidate }));
vi.mock('@/lib/salary/piecework-cancellation', async (original) => ({ ...await original<typeof import('@/lib/salary/piecework-cancellation')>(), cancelPieceworkSchedule: cancel, reviewPieceworkCancellation: review }));
import { cancelPieceworkPlanAction, reviewPieceworkCancellationAction } from '../owner-piecework-cancellation';
import { assertFuturePieceworkCancellation } from '@/lib/salary/piecework-cancellation';
import { PieceworkPriceBookAdminError } from '@/lib/salary/piecework-price-book-admin';
const actor = { id: 'admin', role: 'ADMIN', username: 'admin', displayName: '管理员' };
const evidence = { workerId: 'worker', target: { id: 'book', version: 2, effectiveFrom: '2030-01-01T00:00:00.000Z', effectiveTo: null, updatedAt: '2026-09-27T00:00:00.000Z' }, predecessor: null, successor: null };
function form() { const f = new FormData(); f.set('review', JSON.stringify(evidence)); f.set('reason', '取消误填计划'); f.set('clientRequestId', randomUUID()); f.set('actorId', 'forged'); return f; }
beforeEach(() => { vi.resetAllMocks(); vi.stubEnv('PIECEWORK_SCHEDULE_CANCEL_ENABLED', 'true'); permission.mockResolvedValue(actor); review.mockResolvedValue(evidence); cancel.mockResolvedValue({ replayed: false }); });
afterEach(() => vi.unstubAllEnvs());
it('authorizes both preview and execution and passes only the authenticated actor', async () => {
  expect(await reviewPieceworkCancellationAction('worker', 'book')).toEqual({ status: 'success', review: evidence });
  expect(await cancelPieceworkPlanAction(null, form())).toMatchObject({ status: 'success', message: '调价计划已取消' });
  expect(permission).toHaveBeenNthCalledWith(1, 'salary:rule:manage'); expect(permission).toHaveBeenNthCalledWith(2, 'salary:rule:manage');
  expect(cancel).toHaveBeenCalledWith(expect.objectContaining({ review: evidence, reason: '取消误填计划' }), actor);
  expect(cancel.mock.calls[0][0]).not.toHaveProperty('actorId');
  expect(revalidate).toHaveBeenCalledWith('/owner/accounts/[id]', 'page'); expect(revalidate).toHaveBeenCalledWith('/worker/tasks', 'layout');
});
it('rejects unauthorized preview and execution before domain access', async () => {
  permission.mockRejectedValue(new Error('Forbidden'));
  await expect(reviewPieceworkCancellationAction('worker', 'book')).rejects.toThrow('Forbidden');
  await expect(cancelPieceworkPlanAction(null, form())).rejects.toThrow('Forbidden'); expect(review).not.toHaveBeenCalled(); expect(cancel).not.toHaveBeenCalled();
});
it('feature off rejects both paths even when caller knows the action', async () => {
  vi.stubEnv('PIECEWORK_SCHEDULE_CANCEL_ENABLED', 'false');
  expect(await reviewPieceworkCancellationAction('worker', 'book')).toMatchObject({ status: 'error', message: expect.stringContaining('尚未开放') });
  expect(await cancelPieceworkPlanAction(null, form())).toMatchObject({ status: 'error' }); expect(cancel).not.toHaveBeenCalled(); expect(review).not.toHaveBeenCalled();
});
it.each([['review', '{'], ['review', 'x'.repeat(10001)], ['reason', ' '], ['reason', '超'.repeat(501)], ['clientRequestId', 'wrong']])('rejects invalid %s before domain access', async (field, value) => {
  const f = form(); f.set(field, value); expect(await cancelPieceworkPlanAction(null, f)).toMatchObject({ status: 'error' }); expect(cancel).not.toHaveBeenCalled();
});
it('surfaces business conflicts and returns a replay receipt', async () => {
  cancel.mockRejectedValueOnce(new PieceworkPriceBookAdminError('相邻调价计划已变化，请重新核对后取消'));
  expect(await cancelPieceworkPlanAction(null, form())).toMatchObject({ status: 'error', message: expect.stringContaining('已变化') });
  expect(revalidate).not.toHaveBeenCalled(); cancel.mockResolvedValueOnce({ replayed: true });
  expect(await cancelPieceworkPlanAction(null, form())).toMatchObject({ status: 'success', message: '该调价计划此前已取消' });
});
it('strict time boundary rejects equality and past, permits one millisecond in the future', () => {
  const now = new Date('2030-01-01T00:00:00.000Z');
  expect(() => assertFuturePieceworkCancellation(now, now)).toThrow('已经生效');
  expect(() => assertFuturePieceworkCancellation(new Date(now.getTime() - 1), now)).toThrow('已经生效');
  expect(() => assertFuturePieceworkCancellation(new Date(now.getTime() + 1), now)).not.toThrow();
});
