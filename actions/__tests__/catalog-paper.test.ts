import { beforeEach, expect, it, vi } from 'vitest';
const mocks = vi.hoisted(() => ({ permission: vi.fn(), create: vi.fn(), redirect: vi.fn() }));
vi.mock('@/lib/auth/permissions', () => ({ requirePermission: mocks.permission }));
vi.mock('@/lib/material', () => ({ createMaterial: mocks.create, MaterialInvariantError: class extends Error {} }));
vi.mock('next/navigation', () => ({ redirect: mocks.redirect }));
vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }));
import { createCatalogPaperAction } from '../catalog-paper';
const form = (name = '红卡', weight = '160') => { const fd = new FormData(); fd.set('name', name); fd.set('weight', weight); fd.set('reviewed', 'yes'); return fd; };
beforeEach(() => { vi.resetAllMocks(); mocks.create.mockResolvedValue({ id: 'paper' }); });
it('新纸张按统一名称、克重和张单位创建，带回执', async () => {
  await createCatalogPaperAction(null, form());
  expect(mocks.permission).toHaveBeenCalledWith('material:manage');
  expect(mocks.create).toHaveBeenCalledWith(expect.objectContaining({ name: '160g红卡', specification: '160g', unit: '张', category: 'PAPER' }));
  expect(mocks.redirect).toHaveBeenCalledWith('/owner/rules/papers/paper?created=1');
});
it.each([['红卡/珠光', '160'], ['180g红卡', '160'], ['红卡', '2001'], ['红卡', '120']])('拒绝异常或退役纸 %s %s', async (name, weight) => {
  expect((await createCatalogPaperAction(null, form(name, weight))).status).not.toBe('success');
  expect(mocks.create).not.toHaveBeenCalled();
});
it('先授权再处理表单', async () => {
  mocks.permission.mockRejectedValue(new Error('forbidden'));
  await expect(createCatalogPaperAction(null, form())).rejects.toThrow('forbidden');
  expect(mocks.create).not.toHaveBeenCalled();
});
