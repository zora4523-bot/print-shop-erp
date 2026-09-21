import { beforeEach, expect, it, vi } from 'vitest';
import { Prisma, Role } from '@/generated/prisma/client';
vi.mock('server-only', () => ({}));
const mocks = vi.hoisted(() => ({
  validate: vi.fn(() => []),
  tx: {
    $executeRaw: vi.fn(), customerPriceBook: { findUnique: vi.fn(), update: vi.fn() },
    customerPriceRule: { findMany: vi.fn(), create: vi.fn(), update: vi.fn() },
    customerChargeCategory: { findMany: vi.fn() }, material: { findMany: vi.fn(), create: vi.fn() },
    product: { findMany: vi.fn(), create: vi.fn(), update: vi.fn() }, businessAuditLog: { create: vi.fn() },
  },
}));
vi.mock('@/lib/db', () => ({ db: { $transaction: (callback: (tx: typeof mocks.tx) => unknown) => callback(mocks.tx) } }));
vi.mock('@/lib/price/customer-price-book-draft-validation', () => ({ validateDraftPriceBookRules: mocks.validate }));
import { addBlankPaperDraft, updateBlankPriceMatrixDraft } from '../customer-price-book-admin';
const actor = { id: 'owner', username: 'owner', displayName: '管理员', role: Role.ADMIN };
const time = '2026-09-13T00:00:00.000Z';
const input = { priceBookId: 'draft', expectedUpdatedAt: time, paper: { mode: 'new' as const, name: '测试纸', weight: 160 }, specifications: [{ key: 'mid' as const, amount: '0.3251' }] };
const book = { id: 'draft', purpose: 'PROCESSING', settlementType: 'EXTERNAL_SALES', isActive: false, updatedAt: new Date(time),
  notes: { workflow: { status: 'DRAFT', basedOn: { id: 'base', code: 'base', version: 1 }, createdBy: 'owner', createdAt: time, changeReason: '测试新增' } } };
const paper = { id: 'paper', name: '160g测试纸', specification: '160g', isActive: true, outOfStock: false };
const existingRule = { category: { code: 'BASE_PROCESSING' }, exclusiveGroup: 'STOCK_BASE', product: null, id: 'rule', productId: null, amount: new Prisma.Decimal('0.135'), isActive: true,
  triggerCondition: { schemaVersion: 1, target: 'ITEM', pricingRoutes: ['STOCK_BLANK'], paperTypes: ['160g测试纸'], specifications: ['中号封'] } };
const matrix = { priceBookId: 'draft', expectedUpdatedAt: time, cells: [{ paperId: 'paper', specificationKey: 'mid' as const, amount: '0.3251' }] };
beforeEach(() => {
  vi.clearAllMocks(); mocks.tx.customerPriceBook.findUnique.mockResolvedValue(book);
  mocks.tx.customerPriceRule.findMany.mockResolvedValue([]);
  mocks.tx.customerChargeCategory.findMany.mockResolvedValue([{ id: 'base-category' }]);
  mocks.tx.material.findMany.mockResolvedValue([paper]); mocks.tx.material.create.mockResolvedValue(paper);
  mocks.tx.customerPriceRule.create.mockImplementation(async ({ data }) => ({ id: 'rule-new', ...data }));
  mocks.tx.customerPriceRule.update.mockImplementation(async ({ data }) => ({ id: 'rule', ...data }));
});
it('仅建立纸张与精确文本价格，不读取或写入 Product', async () => {
  mocks.tx.material.findMany.mockResolvedValue([]);
  await addBlankPaperDraft(input, actor);
  const data = mocks.tx.customerPriceRule.create.mock.calls[0]![0].data;
  expect(data).toMatchObject({ productId: null, categoryId: 'base-category', triggerCondition: { paperTypes: ['160g测试纸'], specifications: ['中号封'] } });
  expect(data.amount.toString()).toBe('0.3251');
  expect(mocks.tx.product.create).not.toHaveBeenCalled(); expect(mocks.tx.product.findMany).not.toHaveBeenCalled();
});
it('没有规格价格时仅保存纸张资料', async () => {
  await addBlankPaperDraft({ ...input, specifications: [{ key: 'large', amount: null }] }, actor);
  expect(mocks.tx.customerPriceRule.create).not.toHaveBeenCalled(); expect(mocks.tx.product.create).not.toHaveBeenCalled();
});
it('重复文本身份拒绝新增规则', async () => {
  mocks.tx.customerPriceRule.findMany.mockResolvedValue([existingRule]);
  await expect(addBlankPaperDraft(input, actor)).rejects.toThrow('已有价格记录');
});
it.each([{ isActive: false, outOfStock: false }, { isActive: true, outOfStock: true }])('停用缺货纸张仍拒绝', async (state) => {
  mocks.tx.material.findMany.mockResolvedValue([{ ...paper, ...state }]);
  await expect(addBlankPaperDraft(input, actor)).rejects.toThrow('停用或缺货');
});
it('收费类目缺失时拒绝，不从产品推断', async () => {
  mocks.tx.customerChargeCategory.findMany.mockResolvedValue([]);
  await expect(addBlankPaperDraft(input, actor)).rejects.toThrow('收费类目');
});
it('草稿时间回退仍推进版本', async () => {
  await addBlankPaperDraft(input, actor, new Date(time));
  expect(mocks.tx.customerPriceBook.update.mock.calls[0]![0].data.updatedAt.getTime()).toBe(new Date(time).getTime() + 1);
});
it('纸张重复不能通过停用消除冲突', async () => {
  mocks.tx.material.findMany.mockResolvedValue([paper, { ...paper, id: 'duplicate', isActive: false }]);
  await expect(addBlankPaperDraft(input, actor)).rejects.toThrow('重复记录');
});
it('无产品的空格可以直接录入正价', async () => {
  await updateBlankPriceMatrixDraft(matrix, actor);
  expect(mocks.tx.customerPriceRule.create.mock.calls[0]![0].data.productId).toBeNull();
  expect(mocks.tx.product.create).not.toHaveBeenCalled();
  expect(mocks.tx.$executeRaw.mock.invocationCallOrder[0]).toBeLessThan(mocks.tx.material.findMany.mock.invocationCallOrder[0]!);
});
it.each([
  { code: 'LEGACY', paperType: '160g另一纸', weight: 160, specification: '中号封80×115' },
  { code: 'LEGACY', paperType: '160g测试纸', weight: 160, specification: '大号封90×165' },
  { code: 'DIFFERENT', paperType: '160g测试纸', weight: 160, specification: '中号封80×115' },
  null,
])('旧草稿产品身份不等价时拒绝矩阵保存且不写价目或审计 %#', async (product) => {
  mocks.tx.customerPriceRule.findMany.mockResolvedValue([{ ...existingRule,
    productId: 'legacy-product', product,
    triggerCondition: { ...existingRule.triggerCondition, productCodes: ['LEGACY'] },
  }]);
  await expect(updateBlankPriceMatrixDraft(matrix, actor)).rejects.toThrow('历史产品与价格文本不一致');
  expect(mocks.tx.customerPriceRule.update).not.toHaveBeenCalled();
  expect(mocks.tx.customerPriceRule.create).not.toHaveBeenCalled();
  expect(mocks.tx.customerPriceBook.update).not.toHaveBeenCalled();
  expect(mocks.tx.businessAuditLog.create).not.toHaveBeenCalled();
});
it('旧草稿产品与文本身份等价时允许矩阵录价并保留原始审计证据', async () => {
  const source = { ...existingRule, productId: 'legacy-product',
    product: { code: 'LEGACY', paperType: '测试纸', weight: 160, specification: '中号封80×115' },
    triggerCondition: { ...existingRule.triggerCondition, productCodes: ['LEGACY'] },
  };
  mocks.tx.customerPriceRule.findMany.mockResolvedValue([source]);
  await updateBlankPriceMatrixDraft(matrix, actor);
  expect(mocks.tx.customerPriceRule.update).toHaveBeenCalledWith({ where: { id: source.id },
    data: expect.objectContaining({ productId: null, triggerCondition: existingRule.triggerCondition }),
  });
  expect(mocks.tx.businessAuditLog.create).toHaveBeenCalledWith(expect.objectContaining({
    data: expect.objectContaining({ before: expect.objectContaining({ productId: 'legacy-product' }) }),
  }));
});
it.each([null, '0'])('已有格子明确清空或填零保存停售金额：%s', async (amount) => {
  mocks.tx.customerPriceRule.findMany.mockResolvedValue([existingRule]);
  await updateBlankPriceMatrixDraft({ ...matrix, cells: [{ ...matrix.cells[0]!, amount }] }, actor);
  expect(mocks.tx.customerPriceRule.update.mock.calls[0]![0].data.amount.toFixed(4)).toBe('0.0000');
});
it('新空格留空不产生规则，不推进草稿版本', async () => {
  await updateBlankPriceMatrixDraft({ ...matrix, cells: [{ ...matrix.cells[0]!, amount: null }] }, actor);
  expect(mocks.tx.customerPriceRule.create).not.toHaveBeenCalled(); expect(mocks.tx.customerPriceBook.update).not.toHaveBeenCalled();
});
it('版本冲突、重复格子、超精度及越权均拒绝', async () => {
  await expect(updateBlankPriceMatrixDraft({ ...matrix, expectedUpdatedAt: '2026-01-01T00:00:00.000Z' }, actor)).rejects.toThrow('草稿已变化');
  await expect(updateBlankPriceMatrixDraft({ ...matrix, cells: [matrix.cells[0]!, matrix.cells[0]!] }, actor)).rejects.toThrow('重复提交');
  await expect(updateBlankPriceMatrixDraft({ ...matrix, cells: [{ ...matrix.cells[0]!, amount: '0.12345' }] }, actor)).rejects.toThrow('四位');
  await expect(updateBlankPriceMatrixDraft(matrix, { ...actor, role: Role.WORKER })).rejects.toThrow('无权');
});
