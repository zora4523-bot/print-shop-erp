import { beforeEach, expect, it, vi } from 'vitest';
const mocks = vi.hoisted(() => ({
  require: vi.fn(),
  add: vi.fn(),
  matrix: vi.fn(),
  revalidate: vi.fn(),
}));
vi.mock('@/lib/auth/permissions', () => ({ requirePermission: mocks.require }));
vi.mock('next/cache', () => ({ revalidatePath: mocks.revalidate }));
vi.mock('@/lib/price/customer-price-book-admin', () => ({
  addBlankPaperDraft: mocks.add,
  updateBlankPriceMatrixDraft: mocks.matrix,
  CustomerPriceBookAdminError: class extends Error {},
}));
import { addBlankPaperAction, updateBlankPriceMatrixFormAction } from '../blank-paper';
const input = {
  priceBookId: 'draft',
  expectedUpdatedAt: '2026-09-13T00:00:00.000Z',
  paper: { mode: 'existing' as const, id: 'paper' },
  specifications: [{ key: 'mid' as const, amount: '0.3251' }],
};
beforeEach(() => {
  vi.clearAllMocks();
  mocks.require.mockResolvedValue({ id: 'owner' });
  mocks.add.mockResolvedValue({ paperId: 'paper', priceBookId: 'draft' });
});
it('已有纸张只需要价格权限，不再需要产品权限', async () => {
  expect(await addBlankPaperAction(input)).toMatchObject({ status: 'success' });
  expect(mocks.require.mock.calls.map((call) => call[0])).toEqual([
    'dict:price:manage',
  ]);
  expect(mocks.add).toHaveBeenCalledWith(input, { id: 'owner' });
  expect(mocks.revalidate).toHaveBeenCalledWith('/workbench');
});
it('新增纸张仍额外要求物料权限，失败不写入', async () => {
  mocks.require.mockResolvedValueOnce({ id: 'owner' }).mockRejectedValueOnce(new Error('forbidden'));
  await expect(addBlankPaperAction({ ...input, paper: { mode: 'new', name: '红卡', weight: 180 } })).rejects.toThrow('forbidden');
  expect(mocks.add).not.toHaveBeenCalled();
  expect(mocks.require.mock.calls.map((call) => call[0])).toEqual(['dict:price:manage', 'material:manage']);
});
it('非法输入不写入', async () => {
  expect(
    await addBlankPaperAction({ ...input, specifications: [] }),
  ).toMatchObject({ status: 'error' });
  expect(mocks.add).not.toHaveBeenCalled();
});

it('异常输入类型返回业务文案', async () => {
  const result = await addBlankPaperAction({
    ...input,
    expectedUpdatedAt: 'invalid',
  });
  expect(result).toEqual({
    status: 'error',
    message: '填写内容有误，请检查后重试',
  });
  expect(mocks.add).not.toHaveBeenCalled();
});

it('矩阵区分未提交字段与明确清空', async () => {
  mocks.matrix.mockResolvedValue({ priceBookId: 'draft', ruleIds: ['rule'] });
  const form = new FormData(); form.set('mid', '');
  const result = await updateBlankPriceMatrixFormAction({ priceBookId: 'draft', expectedUpdatedAt: input.expectedUpdatedAt,
    cells: [{ inputName: 'mid', paperId: 'paper', specificationKey: 'mid' }, { inputName: 'large', paperId: 'paper', specificationKey: 'large' }] }, null, form);
  expect(result.status).toBe('success');
  expect(mocks.matrix).toHaveBeenCalledWith({ priceBookId: 'draft', expectedUpdatedAt: input.expectedUpdatedAt,
    cells: [{ paperId: 'paper', specificationKey: 'mid', amount: null }] }, { id: 'owner' });
});
