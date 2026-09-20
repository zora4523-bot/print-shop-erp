import { describe, expect, it, vi } from 'vitest';
import type { Prisma } from '../../generated/prisma/client';
import { MaterialCategory } from '../../generated/prisma/enums';
import { paperIdentityMutationError } from '../material-paper-identity';

const paper = { id: 'paper', category: MaterialCategory.PAPER, name: '160g红卡', specification: null };
function fixture() {
  const tx = {
    material: { findMany: vi.fn().mockResolvedValue([]) },
    product: { findMany: vi.fn().mockResolvedValue([]) },
    customerPriceRule: { findMany: vi.fn().mockResolvedValue([]) },
  };
  return { tx, client: tx as unknown as Prisma.TransactionClient };
}

describe('PLAN S4 paper identity write guard', () => {
  it.each([
    { name: '红卡', specification: '160g', isActive: true },
    { name: '160g冰白 / 红卡', specification: null, isActive: false },
    { name: '160g冰白', specification: '160g红卡 ／ 珠光', isActive: false },
  ])('new paper rejects all matching identities including inactive/multivalue records: %j', async (other) => {
    const { tx, client } = fixture();
    tx.material.findMany.mockResolvedValue([other]);
    expect(await paperIdentityMutationError(client, paper)).toContain('已存在');
    expect(tx.material.findMany.mock.calls[0]![0].where).toEqual({ category: 'PAPER' });
  });
  it.each([
    { ...paper, category: MaterialCategory.OTHER },
    { ...paper, name: '验收纸张' },
  ])('creation without PAPER identity does not add checks', async (next) => {
    const { tx, client } = fixture();
    expect(await paperIdentityMutationError(client, next)).toBeNull();
    expect(tx.material.findMany).not.toHaveBeenCalled();
  });
  it('canonical-equivalent edits do not trigger identity checks', async () => {
    const { tx, client } = fixture();
    expect(await paperIdentityMutationError(client, { ...paper, name: '红 卡', specification: '160g' }, paper)).toBeNull();
    expect(tx.material.findMany).not.toHaveBeenCalled();
  });
  it('non-PAPER updates and edits between empty identity sets do not read catalog references', async () => {
    const { tx, client } = fixture();
    const other = { ...paper, category: MaterialCategory.OTHER };
    expect(await paperIdentityMutationError(client, { ...other, name: '180g新资料' }, other)).toBeNull();
    expect(await paperIdentityMutationError(client, { ...paper, name: '新验收纸' }, { ...paper, name: '验收纸' })).toBeNull();
    expect(tx.material.findMany).not.toHaveBeenCalled();
  });
  it('duplicate checks use normalized paper names, not strict label equality', async () => {
    const { tx, client } = fixture();
    tx.material.findMany.mockResolvedValue([{ name: '纸×', specification: '160g' }]);
    expect(await paperIdentityMutationError(client, { ...paper, name: '160g 纸 X' })).toContain('已存在');
  });
  it.each([paper, { ...paper, category: MaterialCategory.OTHER }])('rename or entering PAPER cannot introduce duplicate identities', async (previous) => {
    const { tx, client } = fixture();
    tx.material.findMany.mockResolvedValue([{ ...paper, name: '160g珠光' }]);
    expect(await paperIdentityMutationError(client, { ...paper, name: '160g珠光' }, previous)).toContain('已存在');
    expect(tx.material.findMany.mock.calls[0]![0].where).toEqual({ category: 'PAPER', id: { not: paper.id } });
  });
  it('adding an identity checks the entire new set including a retained duplicate', async () => {
    const { tx, client } = fixture();
    tx.material.findMany.mockResolvedValue([paper]);
    expect(await paperIdentityMutationError(client, { ...paper, name: '160g红卡 / 珠光' }, paper)).toContain('已存在');
  });
  it.each([
    { ...paper, name: '160g珠光' },
    { ...paper, category: MaterialCategory.OTHER },
    { ...paper, name: '无克重' },
  ])('removed identity still referenced by even an inactive product is protected', async (next) => {
    const { tx, client } = fixture();
    tx.product.findMany.mockResolvedValue([{ paperType: '冰白 ／ 红卡', weight: 160 }]);
    expect(await paperIdentityMutationError(client, next, paper)).toContain('仍被产品');
    expect(tx.product.findMany.mock.calls[0]![0].where).toEqual({ category: { in: ['BLANK_STOCK', 'COLOR_PRINT'] } });
  });
  it('only removed identities are protected; retaining a referenced identity is allowed', async () => {
    const { tx, client } = fixture();
    tx.product.findMany.mockResolvedValue([{ paperType: '160g红卡', weight: 160 }]);
    expect(await paperIdentityMutationError(client, paper, { ...paper, name: '160g红卡 / 珠光' })).toBeNull();
  });
  it('removing an unused alias does not re-check a pre-existing duplicate that is retained', async () => {
    const { tx, client } = fixture();
    tx.material.findMany.mockResolvedValue([paper]);
    expect(await paperIdentityMutationError(client, paper, { ...paper, name: '160g红卡 / 珠光' })).toBeNull();
  });
  it('removing a duplicate does not block on text references while another PAPER carries it', async () => {
    const { tx, client } = fixture();
    tx.material.findMany.mockResolvedValue([{ ...paper, isActive: false }]);
    expect(await paperIdentityMutationError(client, { ...paper, name: '160g珠光' }, paper)).toBeNull();
    expect(tx.product.findMany).not.toHaveBeenCalled();
    expect(tx.customerPriceRule.findMany).not.toHaveBeenCalled();
  });
  it('the duplicate exception is per removed identity, not per material', async () => {
    const { tx, client } = fixture();
    tx.material.findMany.mockResolvedValue([paper]);
    tx.product.findMany.mockResolvedValue([{ paperType: '180g冰白', weight: 180 }]);
    const previous = { ...paper, name: '红卡 ／ 珠光' , specification: '160g' };
    tx.customerPriceRule.findMany.mockResolvedValue([{ triggerCondition: { paperTypes: ['160g珠光'] } }]);
    expect(await paperIdentityMutationError(client, { ...paper, name: '160g新纸' }, previous)).toContain('仍被产品');
  });
  it.each([
    { paperTypes: ['160g红卡'] },
    { paperTypes: ['160g冰白 / 红卡'], unknownLegacyField: true },
  ])('current/planned rule text protects identity without a productId: %j', async (triggerCondition) => {
    const { tx, client } = fixture();
    tx.customerPriceRule.findMany.mockResolvedValue([{ triggerCondition }]);
    const now = new Date('2026-09-20T00:00:00Z');
    expect(await paperIdentityMutationError(client, { ...paper, name: '160g新纸' }, paper, now)).toContain('计划生效');
    expect(tx.customerPriceRule.findMany).toHaveBeenCalledWith({
      where: { isActive: true, priceBook: { is: { isActive: true,
        OR: [{ effectiveTo: null }, { effectiveTo: { gt: now } }],
      } } }, select: { triggerCondition: true },
    });
  });
  it('unrelated and absent rule text does not prevent a legitimate rename', async () => {
    const { tx, client } = fixture();
    tx.customerPriceRule.findMany.mockResolvedValue([
      { triggerCondition: null }, { triggerCondition: [] }, { triggerCondition: { paperTypes: '160g红卡' } },
      { triggerCondition: { paperTypes: [null, '180g红卡'] } },
    ]);
    expect(await paperIdentityMutationError(client, { ...paper, name: '160g新纸' }, paper)).toBeNull();
  });
});
