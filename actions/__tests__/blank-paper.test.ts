import { beforeEach, expect, it, vi } from 'vitest';
const mocks = vi.hoisted(() => ({
  require: vi.fn(),
  add: vi.fn(),
  revalidate: vi.fn(),
}));
vi.mock('@/lib/auth/permissions', () => ({ requirePermission: mocks.require }));
vi.mock('next/cache', () => ({ revalidatePath: mocks.revalidate }));
vi.mock('@/lib/price/customer-price-book-admin', () => ({
  addBlankPaperDraft: mocks.add,
  CustomerPriceBookAdminError: class extends Error {},
}));
import { addBlankPaperAction } from '../blank-paper';
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
it('先检查价格、物料和产品权限，再写入并更新业务页面', async () => {
  expect(await addBlankPaperAction(input)).toMatchObject({ status: 'success' });
  expect(mocks.require.mock.calls.map((call) => call[0])).toEqual([
    'dict:price:manage',
    'material:manage',
    'dict:product:manage',
  ]);
  expect(mocks.add).toHaveBeenCalledWith(input, { id: 'owner' });
  expect(mocks.revalidate).toHaveBeenCalledWith('/workbench');
});
it.each([1, 2, 3])('权限检查 %i 失败不会写入', async (position) => {
  for (let index = 1; index < position; index++)
    mocks.require.mockResolvedValueOnce({ id: 'owner' });
  mocks.require.mockRejectedValueOnce(new Error('forbidden'));
  await expect(addBlankPaperAction(input)).rejects.toThrow('forbidden');
  expect(mocks.add).not.toHaveBeenCalled();
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
