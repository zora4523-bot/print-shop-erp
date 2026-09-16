import { beforeEach, describe, expect, it, vi } from 'vitest';
const mocks = vi.hoisted(() => ({ permission: vi.fn(), create: vi.fn(), save: vi.fn(), publish: vi.fn(), revalidate: vi.fn() }));
vi.mock('@/lib/auth/permissions', () => ({ requirePermission: mocks.permission }));
vi.mock('@/lib/salary/piecework-admin', () => ({ createPieceworkDraft: mocks.create, savePieceworkDraft: mocks.save, publishSavedPieceworkDraft: mocks.publish }));
vi.mock('@/lib/db', () => ({ db: {} }));
vi.mock('next/cache', () => ({ revalidatePath: mocks.revalidate }));
import { mutatePieceworkRulesAction } from '../owner-piecework-rules';
import { PieceworkPriceBookAdminError } from '@/lib/salary/piecework-price-book-admin';
beforeEach(() => { vi.resetAllMocks(); mocks.permission.mockResolvedValue({ id: 'admin' }); });
function form(values: Record<string, string>) { const f = new FormData(); for (const [k, v] of Object.entries(values)) f.set(k, v); return f; }
describe('piecework server action', () => {
  it('checks permission before any mutation', async () => {
    mocks.permission.mockRejectedValue(new Error('Forbidden'));
    await expect(mutatePieceworkRulesAction(null, form({ intent: 'create' }))).rejects.toThrow('Forbidden');
    expect(mocks.create).not.toHaveBeenCalled();
    expect(mocks.permission).toHaveBeenCalledWith('salary:rule:manage');
  });
  it('rejects invalid input before domain writes', async () => {
    expect((await mutatePieceworkRulesAction(null, form({ intent: 'save' }))).status).toBe('error');
    expect(mocks.save).not.toHaveBeenCalled();
  });
  it('publishes by saved revision only, ignoring forged rates', async () => {
    expect((await mutatePieceworkRulesAction(null, form({ intent: 'publish', version: '2', updatedAt: '2026-09-16T00:00:00.000Z', partial: '999' }))).status).toBe('success');
    expect(mocks.publish).toHaveBeenCalledWith({ version: 2, updatedAt: '2026-09-16T00:00:00.000Z' }, { id: 'admin' });
    expect(mocks.revalidate).toHaveBeenCalledWith('/owner/rules/employee-pay');
  });
  it('returns recoverable conflicts without hiding unexpected failures', async () => {
    mocks.create.mockRejectedValueOnce(new PieceworkPriceBookAdminError('工价已被修改，请重新加载后核对'));
    expect((await mutatePieceworkRulesAction(null, form({ intent: 'create' }))).status).toBe('error');
    mocks.create.mockRejectedValueOnce(new Error('unexpected'));
    await expect(mutatePieceworkRulesAction(null, form({ intent: 'create' }))).rejects.toThrow('unexpected');
  });
});
