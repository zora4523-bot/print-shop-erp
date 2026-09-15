import { beforeEach, expect, it, vi } from 'vitest';
import { Role } from '@/generated/prisma/enums';
vi.mock('server-only', () => ({}));
const mocks = vi.hoisted(() => ({
  validate: vi.fn(() => []),
  tx: {
    $executeRaw: vi.fn(),
    customerPriceBook: { findUnique: vi.fn(), update: vi.fn() },
    customerPriceRule: { findMany: vi.fn(), create: vi.fn() },
    material: { findMany: vi.fn(), create: vi.fn() },
    product: { findMany: vi.fn(), create: vi.fn(), update: vi.fn() },
    businessAuditLog: { create: vi.fn() },
  },
}));
vi.mock('@/lib/db', () => ({
  db: {
    $transaction: (callback: (tx: typeof mocks.tx) => unknown) =>
      callback(mocks.tx),
  },
}));
vi.mock('@/lib/price/customer-price-book-draft-validation', () => ({
  validateDraftPriceBookRules: mocks.validate,
}));
import { addBlankPaperDraft } from '../customer-price-book-admin';
const actor = {
  id: 'owner',
  username: 'owner',
  displayName: '管理员',
  role: Role.ADMIN,
};
const time = '2026-09-13T00:00:00.000Z';
const input = {
  priceBookId: 'draft',
  expectedUpdatedAt: time,
  paper: { mode: 'new' as const, name: '测试纸', weight: 160 },
  specifications: [{ key: 'mid' as const, amount: '0.3251' }],
};
const book = {
  id: 'draft',
  purpose: 'PROCESSING',
  settlementType: 'EXTERNAL_SALES',
  isActive: false,
  updatedAt: new Date(time),
  notes: {
    workflow: {
      status: 'DRAFT',
      basedOn: { id: 'base', code: 'base', version: 1 },
      createdBy: 'owner',
      createdAt: time,
      changeReason: '测试新增',
    },
  },
};
const anchor = {
  categoryId: 'base-category',
  product: {
    isActive: true,
    category: 'BLANK_STOCK',
    categoryNodeId: 'stock',
    categoryNode: { isActive: true },
  },
  triggerCondition: { paperTypes: ['160g旧纸张'], specifications: ['中号封'] },
};
beforeEach(() => {
  vi.clearAllMocks();
  mocks.tx.customerPriceBook.findUnique.mockResolvedValue(book);
  mocks.tx.customerPriceRule.findMany.mockImplementation((args) =>
    Promise.resolve(args.include ? [anchor] : []),
  );
  mocks.tx.material.findMany.mockResolvedValue([]);
  mocks.tx.product.findMany.mockResolvedValue([]);
  mocks.tx.material.create.mockResolvedValue({
    id: 'paper-new',
    name: '160g测试纸',
    isActive: true,
    outOfStock: false,
  });
  mocks.tx.product.create.mockResolvedValue({
    id: 'product-new',
    paperMaterialId: 'paper-new',
    categoryNode: { isActive: true },
  });
  mocks.tx.customerPriceRule.create.mockResolvedValue({ id: 'rule-new' });
});
it('建立稳定纸张关联，并只向草稿写入精确单价', async () => {
  await addBlankPaperDraft(input, actor);
  expect(mocks.tx.product.create.mock.calls[0]?.[0].data.paperMaterialId).toBe(
    'paper-new',
  );
  const data = mocks.tx.customerPriceRule.create.mock.calls[0]?.[0].data;
  expect(data.priceBookId).toBe('draft');
  expect(data.amount.toString()).toBe('0.3251');
  expect(data.triggerCondition).toMatchObject({
    paperTypes: ['160g测试纸'],
    specifications: ['中号封'],
  });
  expect(mocks.tx.businessAuditLog.create).toHaveBeenCalledTimes(4);
});
it.each([
  { ...book, isActive: true },
  { ...book, purpose: 'LOGISTICS' },
  { ...book, updatedAt: new Date('2026-09-14T00:00:00.000Z') },
])('已发布、错误用途或过期草稿拒绝写入', async (value) => {
  mocks.tx.customerPriceBook.findUnique.mockResolvedValue(value);
  await expect(addBlankPaperDraft(input, actor)).rejects.toThrow();
  expect(mocks.tx.material.create).not.toHaveBeenCalled();
});
it('相同名称与克重复用纸张，缺价保留可建单组合但不生成价格规则', async () => {
  mocks.tx.material.findMany.mockResolvedValue([
    {
      id: 'existing',
      name: '160g测试纸',
      specification: null,
      isActive: true,
      outOfStock: false,
    },
  ]);
  await addBlankPaperDraft(
    { ...input, specifications: [{ key: 'large', amount: null }] },
    actor,
  );
  expect(mocks.tx.material.create).not.toHaveBeenCalled();
  expect(mocks.tx.customerPriceRule.create).not.toHaveBeenCalled();
  expect(mocks.tx.product.create).toHaveBeenCalled();
});
it('重复组合拒绝新增规则', async () => {
  mocks.tx.customerPriceRule.findMany.mockResolvedValue([
    {
      ...anchor,
      triggerCondition: {
        paperTypes: ['160g测试纸'],
        specifications: ['中号封'],
      },
    },
  ]);
  await expect(addBlankPaperDraft(input, actor)).rejects.toThrow(
    '已有价格记录',
  );
  expect(mocks.tx.customerPriceRule.create).not.toHaveBeenCalled();
});
it('拒绝停用或缺货纸张', async () => {
  mocks.tx.material.findMany.mockResolvedValue([
    {
      id: 'existing',
      name: '160g测试纸',
      specification: null,
      isActive: false,
    },
  ]);
  await expect(addBlankPaperDraft(input, actor)).rejects.toThrow('停用或缺货');
});

it('已有组合绑定纸张身份，拒绝停用分类', async () => {
  const product = {
    id: 'existing-product',
    isActive: true,
    paperType: '160g测试纸',
    weight: 160,
    specification: '中号封',
    paperMaterialId: null,
    categoryNode: { isActive: false },
  };
  mocks.tx.product.findMany.mockResolvedValue([product]);
  await expect(addBlankPaperDraft(input, actor)).rejects.toThrow(
    '产品组合已停用',
  );
  expect(mocks.tx.customerPriceRule.create).not.toHaveBeenCalled();
  mocks.tx.product.findMany.mockResolvedValue([
    { ...product, categoryNode: { isActive: true } },
  ]);
  mocks.tx.product.update.mockResolvedValue({
    ...product,
    paperMaterialId: 'paper-new',
  });
  await addBlankPaperDraft(input, actor);
  expect(mocks.tx.product.update).toHaveBeenCalledWith(
    expect.objectContaining({ data: { paperMaterialId: 'paper-new' } }),
  );
});
it('相同毫秒或时钟回退仍推进草稿版本', async () => {
  await addBlankPaperDraft(input, actor, new Date(time));
  expect(
    mocks.tx.customerPriceBook.update.mock.calls[0]?.[0].data.updatedAt.getTime(),
  ).toBe(new Date(time).getTime() + 1);
});

it('纸张关联与产品计价身份不一致时拒绝复用', async () => {
  mocks.tx.product.findMany.mockResolvedValue([
    {
      id: 'bad-product',
      paperMaterialId: 'paper-new',
      paperType: '160g另一种纸',
      weight: 160,
      specification: '中号封80×115',
      isActive: true,
      categoryNode: { isActive: true },
    },
  ]);
  await expect(addBlankPaperDraft(input, actor)).rejects.toThrow(
    '纸张关联不一致',
  );
  expect(mocks.tx.customerPriceRule.create).not.toHaveBeenCalled();
});
