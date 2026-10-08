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
import { ProductionConflictError, ProductionInputError } from '@/lib/production/input-error';
import { FoilWageInputError } from '@/lib/salary/foil-wage';
import { UnauthorizedError } from '@/lib/auth/errors';
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
    mocks.permission.mockRejectedValue(new UnauthorizedError('无权操作'));
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
  it.each([new Error('SELECT secret FROM database'), new Error('connect ECONNREFUSED database.internal:5432'), new TypeError('unexpected'), new SyntaxError('internal snapshot')])('propagates unexpected errors without exposing an action message: %s', async error => {
    mocks.publish.mockRejectedValue(error);
    await expect(publishProductionDispatchAction(null, payload(dispatch))).rejects.toBe(error);
    expect(mocks.refresh).not.toHaveBeenCalled();
  });
  it('retains typed business feedback and malformed payload feedback', async () => {
    mocks.publish.mockRejectedValue(new ProductionInputError('请先核对历史生产记录'));
    expect(await publishProductionDispatchAction(null, payload(dispatch))).toEqual({ ok: false, message: '请先核对历史生产记录' });
    const form = new FormData(); form.set('payload', '{');
    expect(await publishProductionDispatchAction(null, form)).toEqual({ ok: false, message: '填写内容不完整，请核对后重试' });
  });
  it('保留深层烫金计薪输入提示', async () => {
    mocks.complete.mockRejectedValue(new FoilWageInputError('专版须有 1–3 个颜色，请核对款式颜色'));
    expect(await registerProductionCompletionAction(null, completion())).toEqual({ ok: false, message: '专版须有 1–3 个颜色，请核对款式颜色' });
    expect(mocks.refresh).not.toHaveBeenCalled();
  });
  it.each(['P2024', 'P2028'])('数据库繁忙 %s 保留表单并隐藏内部信息', async code => {
    mocks.complete.mockRejectedValue({ code, message: 'internal database address and query' });
    expect(await registerProductionCompletionAction(null, completion())).toEqual({ ok: false, message: '系统繁忙，请稍后重试' });
    expect(mocks.refresh).not.toHaveBeenCalled();
  });
  it('历史冲突记录已提交时刷新工单和生产视图', async () => {
    mocks.complete.mockRejectedValue(new ProductionConflictError('o1', '已有后续生产，不能重复计产'));
    expect(await registerProductionCompletionAction(null, completion('RECOVER'))).toEqual({ ok: false, message: '已有后续生产，不能重复计产' });
    for (const path of ['/orders/o1', '/worker/orders/o1', '/worker/tasks', '/worker/salary', '/owner/salary/piecework']) {
      expect(mocks.refresh).toHaveBeenCalledWith(path);
    }
  });
  it.each(['publish', 'complete', 'allocate', 'correct', 'review'] as const)('only returns expected domain errors from %s', async entry => {
    const invoke = () => {
      if (entry === 'publish') return publishProductionDispatchAction(null, payload(dispatch));
      if (entry === 'complete') return registerProductionCompletionAction(null, completion());
      if (entry === 'allocate') return allocateProductionWagesAction(null, payload({ jobId: 'j1', requestKey: 'manual-001', reason: '核定', allocations: [{ workerId: 'worker', amount: '10.00', expectedRevision: 0 }] }));
      if (entry === 'correct') return correctProductionRegistrationAction({ jobId: 'j1', requestKey: 'correct-001', revision: 0, reason: '误登记', notActuallyProduced: true });
      const form = new FormData();
      Object.entries({ jobId: 'j1', jobRevision: '0', reviewRevision: '0', mode: 'UNPRODUCED', reason: '核实未生产', notActuallyProduced: 'on' }).forEach(([key, value]) => form.set(key, value));
      return reviewProductionFactAction(null, form);
    };
    const unexpected = new Error('internal database address and query');
    mocks[entry].mockRejectedValueOnce(unexpected);
    await expect(invoke()).rejects.toBe(unexpected);
    mocks[entry].mockRejectedValueOnce(new ProductionInputError('请核对生产资料'));
    expect(await invoke()).toEqual({ ok: false, message: '请核对生产资料' });
    expect(mocks[entry]).toHaveBeenCalledTimes(2);
    expect(mocks.refresh).not.toHaveBeenCalled();
  });
});
