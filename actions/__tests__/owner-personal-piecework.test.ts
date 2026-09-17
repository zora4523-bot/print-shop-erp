import { beforeEach, expect, it, vi } from 'vitest';
const { permission, save, publish, create, revalidate } = vi.hoisted(() => ({ permission: vi.fn(), save: vi.fn(), publish: vi.fn(), create: vi.fn(), revalidate: vi.fn() }));
vi.mock('@/lib/db', () => ({ db: {} }));
vi.mock('@/lib/auth/permissions', () => ({ requirePermission: permission }));
vi.mock('next/cache', () => ({ revalidatePath: revalidate }));
vi.mock('@/lib/salary/personal-piecework-admin', async (original) => ({ ...await original<typeof import('@/lib/salary/personal-piecework-admin')>(), createPersonalPieceworkDraft: create, savePersonalPieceworkDraft: save, publishPersonalPieceworkDraft: publish }));
import { mutatePersonalPieceworkAction } from '../owner-personal-piecework';
const actor = { id: 'admin', role: 'ADMIN', username: 'admin', displayName: '管理员' };
function form() { const data = new FormData(); Object.entries({ intent: 'save', version: '2', updatedAt: '2026-09-17T00:00:00Z', partial: '0.1000', useUnifiedRates: 'false', sourceName: '合同', publishNote: '调价', effectiveFrom: '', workerId: 'injected' }).forEach(([k, v]) => data.set(k, v)); return data; }
beforeEach(() => { vi.clearAllMocks(); permission.mockResolvedValue(actor); });
it('管理员仅对绑定账号保存，身份从会话获取', async () => {
  expect(await mutatePersonalPieceworkAction('worker', null, form())).toMatchObject({ status: 'success' });
  expect(save).toHaveBeenCalledWith(expect.objectContaining({ workerId: 'worker', partial: '0.1000' }), actor);
  expect(permission).toHaveBeenCalledWith('salary:rule:manage');
  expect(revalidate).toHaveBeenCalledWith('/owner/accounts/worker');
});
it('未经授权不写入', async () => {
  permission.mockRejectedValueOnce(new Error('Forbidden'));
  await expect(mutatePersonalPieceworkAction('worker', null, form())).rejects.toThrow('Forbidden'); expect(save).not.toHaveBeenCalled();
});
it.each(['-1', '0.00001', '1e3'])('非法金额 %s 不写入', async (amount) => {
  const data = form(); data.set('partial', amount);
  expect(await mutatePersonalPieceworkAction('worker', null, data)).toMatchObject({ status: 'error' }); expect(save).not.toHaveBeenCalled();
});
it('发布仅传草稿修订，不接受临时金额', async () => {
  const data = form(); data.set('intent', 'publish');
  await mutatePersonalPieceworkAction('worker', null, data);
  expect(publish).toHaveBeenCalledWith({ workerId: 'worker', version: 2, updatedAt: '2026-09-17T00:00:00Z' }, actor);
});
it('不提交调价依据也可保存个人工价', async () => {
  const data = form(); data.delete('sourceName');
  expect(await mutatePersonalPieceworkAction('worker', null, data)).toMatchObject({ status: 'success' });
  expect(save).toHaveBeenCalled();
});
