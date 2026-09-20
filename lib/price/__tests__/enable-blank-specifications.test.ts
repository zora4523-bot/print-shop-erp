import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ProductCategory, Role } from '../../../generated/prisma/enums';
vi.mock('server-only', () => ({}));

const node = { id: 'stock', path: 'product.blank_stock', legacyCategory: ProductCategory.BLANK_STOCK, isActive: true };
const paper = { id: 'paper', name: '160g红卡', specification: '160g', isActive: true, outOfStock: false };
const product = (id: string, changes = {}) => ({
  id, code: id, category: ProductCategory.BLANK_STOCK, categoryNodeId: 'stock', categoryNode: { ...node },
  paperType: '160g红卡', specification: '中号封80×115', weight: 160,
  paperMaterialId: null as string | null, isActive: true, ...changes,
});
type ProductRow = ReturnType<typeof product>;
const mocks = vi.hoisted(() => ({
  state: { products: [] as ProductRow[], papers: [] as (typeof paper)[], audits: [] as unknown[] },
  transaction: vi.fn(),
  tx: {
    $executeRaw: vi.fn(), $queryRaw: vi.fn(),
    material: { findMany: vi.fn(), create: vi.fn() },
    product: { findMany: vi.fn(), findUnique: vi.fn(), create: vi.fn(), update: vi.fn() },
    customerPriceRule: { count: vi.fn(), findMany: vi.fn(), create: vi.fn() },
    customerPriceBook: { findMany: vi.fn(), update: vi.fn(), create: vi.fn() },
    businessAuditLog: { create: vi.fn() },
  },
}));
vi.mock('@/lib/db', () => ({ db: { $transaction: mocks.transaction } }));
import { enableBlankSpecifications } from '../enable-blank-specifications';

const actor = { id: 'owner', username: 'owner', displayName: '管理员', role: Role.ADMIN };
const input = { paperId: 'paper', specifications: ['mid' as const] };

beforeEach(() => {
  vi.resetAllMocks();
  mocks.state.papers = [{ ...paper }];
  mocks.state.products = [product('anchor', { paperType: '160g其他纸' })];
  mocks.state.audits = [];
  // Model commit/rollback and serialized writers without touching any database.
  let queue = Promise.resolve();
  mocks.transaction.mockImplementation((callback: (tx: typeof mocks.tx) => Promise<unknown>) => {
    const task = queue.then(async () => {
      const before = structuredClone(mocks.state);
      try { return await callback(mocks.tx); } catch (error) {
        Object.assign(mocks.state, before);
        throw error;
      }
    });
    queue = task.then(() => undefined, () => undefined);
    return task;
  });
  mocks.tx.$executeRaw.mockResolvedValue(0);
  mocks.tx.$queryRaw.mockResolvedValue([]);
  mocks.tx.material.findMany.mockImplementation(async () => [...mocks.state.papers]);
  mocks.tx.product.findMany.mockImplementation(async () => [...mocks.state.products]);
  mocks.tx.product.findUnique.mockImplementation(async ({ where }) => mocks.state.products.find((row) => row.id === where.id));
  mocks.tx.product.create.mockImplementation(async ({ data }) => {
    const row = product(`created-${mocks.state.products.length}`, data);
    mocks.state.products.push(row);
    return row;
  });
  mocks.tx.product.update.mockImplementation(async ({ where, data }) => {
    const row = mocks.state.products.find((row) => row.id === where.id)!;
    Object.assign(row, data);
    return { ...row };
  });
  mocks.tx.businessAuditLog.create.mockImplementation(async ({ data }) => {
    mocks.state.audits.push(data);
    return { id: 'audit' };
  });
});

describe('blank specification enablement under the shared price lock', () => {
  it('creates exact catalog facts and FK, but neither paper nor default prices', async () => {
    const result = await enableBlankSpecifications(input, actor);
    expect(result.productIds).toHaveLength(1);
    expect(mocks.tx.product.create.mock.calls[0]![0].data).toMatchObject({
      categoryNodeId: 'stock', paperMaterialId: 'paper', paperType: '160g红卡', weight: 160, specification: '中号封80×115',
    });
    expect(mocks.tx.material.create).not.toHaveBeenCalled();
    for (const fn of [...Object.values(mocks.tx.customerPriceBook), ...Object.values(mocks.tx.customerPriceRule)]) {
      expect(fn).not.toHaveBeenCalled();
    }
    expect(mocks.tx.$executeRaw).toHaveBeenCalledOnce();
    expect(mocks.tx.$executeRaw.mock.invocationCallOrder[0]).toBeLessThan(mocks.tx.material.findMany.mock.invocationCallOrder[0]);
  });
  it('repeated enablement is a no-op and never fills an old product FK', async () => {
    mocks.state.products.push(product('existing'));
    await enableBlankSpecifications(input, actor);
    await enableBlankSpecifications(input, actor);
    expect(mocks.tx.product.create).not.toHaveBeenCalled();
    expect(mocks.tx.product.update).not.toHaveBeenCalled();
    expect(mocks.state.audits).toEqual([]);
    expect(mocks.state.products.at(-1)?.paperMaterialId).toBeNull();
  });
  it('reactivates in the same transaction with activation/reference audit, without filling FK', async () => {
    mocks.state.products.push(product('inactive', { isActive: false }));
    await enableBlankSpecifications(input, actor);
    expect(mocks.transaction).toHaveBeenCalledOnce();
    expect(mocks.tx.$executeRaw).toHaveBeenCalledOnce();
    expect(mocks.tx.product.update.mock.calls[0]![0].data).toEqual({ isActive: true });
    expect(mocks.state.products.at(-1)?.paperMaterialId).toBeNull();
    expect(mocks.state.audits).toContainEqual(expect.objectContaining({
      action: 'PRODUCT_ACTIVATE', requestMetadata: expect.objectContaining({ referenceImpact: expect.any(Object) }),
    }));
    expect(mocks.tx.customerPriceRule.create).not.toHaveBeenCalled();
    expect(mocks.tx.customerPriceBook.update).not.toHaveBeenCalled();
  });
  it.each([
    { specification: '中号封80x115' },
    { specification: '中号封80×115 / 大号封90×165' },
    { paperType: '160g红卡 / 珠光' },
    { paperMaterialId: 'other-paper', isActive: false },
    { weight: 180, isActive: false },
  ])('blocks active aliases, multivalues and even inactive conflicts: %j', async (changes) => {
    mocks.state.products.push(product('bad', changes));
    await expect(enableBlankSpecifications(input, actor)).rejects.toThrow(/产品组合|事实冲突/);
    expect(mocks.tx.product.create).not.toHaveBeenCalled();
  });
  it.each(['中号封', '中号封80x115', '中号封80×115 / 大号封90×165'])(
    'ignores inactive non-exact %s and leaves it untouched', async (specification) => {
      const row = product('old', { isActive: false, specification });
      mocks.state.products.push(row);
      await enableBlankSpecifications(input, actor);
      expect(mocks.tx.product.create).toHaveBeenCalledOnce();
      expect(mocks.tx.product.update).not.toHaveBeenCalled();
      expect(mocks.state.products.find((p) => p.id === 'old')).toEqual(row);
    },
  );
  it.each([true, false])('refuses duplicate legal candidates (active=%s)', async (isActive) => {
    mocks.state.products.push(product('one', { isActive }), product('two', { isActive }));
    await expect(enableBlankSpecifications(input, actor)).rejects.toThrow('重复');
  });
  it('one active legal row wins over several inactive candidates', async () => {
    mocks.state.products.push(product('on'), product('off1', { isActive: false }), product('off2', { isActive: false }));
    expect((await enableBlankSpecifications(input, actor)).productIds).toEqual(['on']);
    expect(mocks.tx.product.update).not.toHaveBeenCalled();
  });
  it.each([
    { isActive: false }, { outOfStock: true }, { name: '无克重', specification: null },
    { name: '2001g红卡', specification: '2001g' }, { name: '160g红卡 / 珠光' },
    { name: '120g红卡', specification: '120g' },
  ])('rejects invalid/unavailable/retired paper before writing: %j', async (changes) => {
    Object.assign(mocks.state.papers[0]!, changes);
    await expect(enableBlankSpecifications(input, actor)).rejects.toThrow();
    expect(mocks.tx.product.create).not.toHaveBeenCalled();
  });
  it('includes inactive material duplicates in uniqueness checks', async () => {
    mocks.state.papers.push({ ...paper, id: 'off', isActive: false });
    await expect(enableBlankSpecifications(input, actor)).rejects.toThrow('重复记录');
  });
  it.each(['empty', 'multiple', 'inactive', 'retired'])(
    'refuses %s category assignment rather than choosing a node', async (kind) => {
      if (kind === 'empty') mocks.state.products = [];
      if (kind === 'multiple') mocks.state.products.push(product('other-node', { categoryNodeId: 'second' }));
      if (kind === 'inactive') mocks.state.products[0]!.categoryNode.isActive = false;
      if (kind === 'retired') mocks.state.products[0]!.categoryNode.path = 'product.generic_stock';
      await expect(enableBlankSpecifications(input, actor)).rejects.toThrow('确定新产品的分类归属');
      expect(mocks.tx.product.create).not.toHaveBeenCalled();
    },
  );
  it('rejects a retired product even if its FK points to the selected paper', async () => {
    mocks.state.products.push(product('retired', { weight: 120, paperMaterialId: paper.id }));
    await expect(enableBlankSpecifications(input, actor)).rejects.toThrow('事实冲突');
  });
  it('turns P2002 into a business error that directs inspection, not retry', async () => {
    mocks.tx.product.create.mockRejectedValue({ code: 'P2002' });
    await expect(enableBlankSpecifications(input, actor)).rejects.toThrow('产品编码与已有组合冲突');
    expect(mocks.state.audits).toEqual([]);
  });
  it('a later failure rolls back all earlier cells and audits', async () => {
    mocks.tx.product.create.mockImplementationOnce(async ({ data }) => {
      const row = product('first', data);
      mocks.state.products.push(row);
      return row;
    }).mockRejectedValueOnce(new Error('write failed'));
    await expect(enableBlankSpecifications({ ...input, specifications: ['mid', 'large'] }, actor)).rejects.toThrow('write failed');
    expect(mocks.state.products.map((row) => row.id)).toEqual(['anchor']);
    expect(mocks.state.audits).toEqual([]);
  });
  it('serialized concurrent writers re-read catalog and create only once', async () => {
    const results = await Promise.all([enableBlankSpecifications(input, actor), enableBlankSpecifications(input, actor)]);
    expect(results[0]).toEqual(results[1]);
    expect(mocks.tx.product.create).toHaveBeenCalledOnce();
    expect(mocks.tx.$executeRaw).toHaveBeenCalledTimes(2);
  });
  it.each([{ specifications: [] }, { specifications: ['mid', 'mid'] }, { specifications: ['unknown'] }])(
    'rejects invalid incremental keys %j before a transaction', async ({ specifications }) => {
    await expect(enableBlankSpecifications({ ...input, specifications } as unknown as typeof input, actor)).rejects.toThrow();
    expect(mocks.transaction).not.toHaveBeenCalled();
  });
});
