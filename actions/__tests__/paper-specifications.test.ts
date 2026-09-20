import { beforeEach, expect, it, vi } from 'vitest';
const mocks = vi.hoisted(() => ({ permission: vi.fn(), enable: vi.fn(), redirect: vi.fn(), revalidate: vi.fn() }));
vi.mock('@/lib/auth/permissions', () => ({ requirePermission: mocks.permission }));
vi.mock('@/lib/price/enable-blank-specifications', () => ({ enableBlankSpecifications: mocks.enable }));
vi.mock('@/lib/price/blank-paper-catalog', () => ({ BlankPaperCatalogError: class extends Error {} }));
vi.mock('@/lib/product', () => ({ ProductInvariantError: class extends Error {} }));
vi.mock('next/navigation', () => ({ redirect: mocks.redirect }));
vi.mock('next/cache', () => ({ revalidatePath: mocks.revalidate }));
import { enablePaperSpecificationsAction } from '../paper-specifications';
import { BlankPaperCatalogError } from '@/lib/price/blank-paper-catalog';
const actor = { id: 'actor' };
const form = () => { const fd = new FormData(); fd.append('specifications', 'mid'); fd.set('reviewed', 'yes'); return fd; };
beforeEach(() => { vi.resetAllMocks(); mocks.permission.mockResolvedValue(actor); });
it.each([1, 2])('第 %s 个权限失败时不执行写入', async (gate) => {
  if (gate === 2) mocks.permission.mockResolvedValueOnce(actor);
  mocks.permission.mockRejectedValueOnce(new Error('forbidden'));
  await expect(enablePaperSpecificationsAction('paper', null, form())).rejects.toThrow('forbidden');
  expect(mocks.enable).not.toHaveBeenCalled();
});
it('双权限、可信 actor、增量输入和回执跳转', async () => {
  await enablePaperSpecificationsAction('paper', null, form());
  expect(mocks.permission.mock.calls).toEqual([['material:manage'], ['dict:product:manage']]);
  expect(mocks.enable).toHaveBeenCalledWith({ paperId: 'paper', specifications: ['mid'] }, actor);
  expect(mocks.redirect).toHaveBeenCalledWith('/owner/rules/papers/paper?updated=1');
});
it('拒绝非法键与未经复核的提交', async () => {
  const fd = form(); fd.set('specifications', 'unknown');
  expect((await enablePaperSpecificationsAction('paper', null, fd)).status).toBe('invalid');
  fd.set('specifications', 'mid'); fd.delete('reviewed');
  expect((await enablePaperSpecificationsAction('paper', null, fd)).status).toBe('error');
  expect(mocks.enable).not.toHaveBeenCalled();
});
it('领域错误可见，未知错误继续抛出', async () => {
  mocks.enable.mockRejectedValueOnce(new BlankPaperCatalogError('重复组合'));
  expect(await enablePaperSpecificationsAction('paper', null, form())).toEqual({ status: 'error', message: '重复组合' });
  mocks.enable.mockRejectedValueOnce(new Error('unexpected'));
  await expect(enablePaperSpecificationsAction('paper', null, form())).rejects.toThrow('unexpected');
});
