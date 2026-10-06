import { beforeEach, describe, expect, it, vi } from 'vitest';
const mocks = vi.hoisted(() => ({ permission: vi.fn(), publish: vi.fn(), complete: vi.fn(), allocate: vi.fn(), correct: vi.fn(), review: vi.fn(), refresh: vi.fn() }));
vi.mock('server-only', () => ({}));
vi.mock('next/cache', () => ({ revalidatePath: mocks.refresh }));
vi.mock('@/lib/auth/permissions', () => ({ requirePermission: mocks.permission }));
vi.mock('@/lib/production/dispatch', async importOriginal => ({ ...await importOriginal<object>(), publishProductionDispatch: mocks.publish }));
vi.mock('@/lib/production/completion-registration', async importOriginal => ({ ...await importOriginal<object>(), registerProductionCompletion: mocks.complete }));
vi.mock('@/lib/salary/production-wages', async importOriginal => ({ ...await importOriginal<object>(), allocateProductionWages: mocks.allocate }));
vi.mock('@/lib/production/correct-registration', async importOriginal => ({ ...await importOriginal<object>(), correctProductionRegistration: mocks.correct }));
vi.mock('@/lib/production/fact-review', async importOriginal => ({ ...await importOriginal<object>(), reviewProductionFact: mocks.review }));
import { DispatchPlanValidationError } from '@/lib/production/dispatch-plan-error';
import { reviewProductionFactAction, allocateProductionWagesAction, correctProductionRegistrationAction, publishProductionDispatchAction, registerProductionCompletionAction } from '../production-dispatch';
const actor = { id: 'session-actor', role: 'ADMIN' };
const payload = (value: unknown) => { const form = new FormData(); form.set('payload', JSON.stringify(value)); return form; };
const dispatch = { requestKey: 'request-001', orders: [{ id: 'o1', revision: 1, version: 1, assignments: { partial: 'worker' } }] };
function completion(mode = 'COMPLETE') {
  const form = new FormData();
  Object.entries({ mode, jobId: 'j1', revision: '0', quantity: '1000', reason: '依据', workerId: 'injected' }).forEach(([key, value]) => form.set(key, value));
  return form;
}
beforeEach(() => { vi.resetAllMocks(); mocks.permission.mockResolvedValue(actor); mocks.publish.mockResolvedValue(['o1']); mocks.complete.mockResolvedValue({ orderId: 'o1', status: 'COMPLETED' }); mocks.allocate.mockResolvedValue('o1'); mocks.correct.mockResolvedValue('o1'); });
describe('production actions', () => {
  it('authorizes publication before decoding and invalidates both portals', async () => {
    expect(await publishProductionDispatchAction(null, payload(dispatch))).toMatchObject({ ok: true });
    expect(mocks.permission).toHaveBeenCalledWith('production:manage');
    expect(mocks.publish).toHaveBeenCalledWith(dispatch, actor);
    for (const path of ['/orders', '/orders/o1', '/worker/orders/o1', '/worker/tasks', '/worker/salary', '/owner/salary/piecework']) expect(mocks.refresh).toHaveBeenCalledWith(path);
  });
  it('does not publish malformed or oversized batches', async () => {
    expect(await publishProductionDispatchAction(null, payload({ ...dispatch, orders: Array(21).fill(dispatch.orders[0]) }))).toMatchObject({ ok: false });
    expect(mocks.publish).not.toHaveBeenCalled();
  });
  it('uses the session actor and ignores forged worker fields', async () => {
    await registerProductionCompletionAction(null, completion());
    expect(mocks.permission).toHaveBeenCalledWith('task:report');
    expect(mocks.complete.mock.calls[0][1]).toEqual(actor);
    expect(mocks.complete.mock.calls[0][0]).not.toHaveProperty('workerId');
  });
  it.each(['BACKFILL', 'APPROVE', 'REJECT'])('requires administrator for %s', async mode => {
    await registerProductionCompletionAction(null, completion(mode));
    expect(mocks.permission).toHaveBeenCalledWith('production:manage');
  });
  it('rejects unauthorized commands before calling any domain writer', async () => {
    mocks.permission.mockRejectedValue(new Error('无权操作'));
    await publishProductionDispatchAction(null, payload(dispatch)); await registerProductionCompletionAction(null, completion('APPROVE'));
    await allocateProductionWagesAction(null, payload({})); await correctProductionRegistrationAction({});
    for (const writer of [mocks.publish, mocks.complete, mocks.allocate, mocks.correct]) expect(writer).not.toHaveBeenCalled();
    expect(mocks.refresh).not.toHaveBeenCalled();
  });
  it('validates money and error-correction acknowledgement server-side', async () => {
    expect(await allocateProductionWagesAction(null, payload({ jobId: 'j1', requestKey: 'manual-001', reason: '核定', allocations: [{ workerId: 'worker', amount: '0.001', expectedRevision: 0 }] }))).toMatchObject({ ok: false });
    expect(await correctProductionRegistrationAction({ jobId: 'j1', requestKey: 'correct-001', revision: 0, reason: '误登记' })).toMatchObject({ ok: false });
    expect(mocks.allocate).not.toHaveBeenCalled(); expect(mocks.correct).not.toHaveBeenCalled();
  });
  it.each(['publish', 'recover', 'review'])('shows safe planning reasons for %s without reporting success', async entry => {
    const error = new DispatchPlanValidationError(
      { id: 'o1', customName: '待核对工单', orderNo: 'GD-1', revision: 1, workOrderVersion: 1 },
      [{ code: 'INACTIVE_CRAFT', message: '款式 #2 引用 canonical PRIVATE_CRAFT_CODE 已停用' }],
    );
    let result;
    if (entry === 'publish') {
      mocks.publish.mockRejectedValue(error);
      result = await publishProductionDispatchAction(null, payload(dispatch));
    } else if (entry === 'recover') {
      mocks.complete.mockRejectedValue(error);
      result = await registerProductionCompletionAction(null, completion('RECOVER'));
    } else {
      mocks.review.mockRejectedValue(error);
      const form = new FormData();
      Object.entries({ jobId: 'j1', jobRevision: '0', reviewRevision: '0', mode: 'UNPRODUCED', reason: '核实未生产', notActuallyProduced: 'on' }).forEach(([key, value]) => form.set(key, value));
      result = await reviewProductionFactAction(null, form);
    }
    expect(result).toEqual({ ok: false, message: '待核对工单：款式 #2：所选工艺已停用，请核对并选择可用工艺。' });
    expect(result?.message).not.toMatch(/canonical|PRIVATE_CRAFT_CODE/);
    expect(mocks.refresh).not.toHaveBeenCalled();
  });
  it('does not disclose SQL or internal errors', async () => {
    mocks.publish.mockRejectedValue(new Error('SELECT secret FROM database'));
    expect(await publishProductionDispatchAction(null, payload(dispatch))).toEqual({ ok: false, message: '本次未保存，请刷新核对后重试' });
  });
});
