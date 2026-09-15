import Decimal from 'decimal.js';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { OrderCraft, OrderPackagingMode, OrderStatus, Role } from '@/generated/prisma/enums';
const { append, tx } = vi.hoisted(() => ({ append: vi.fn(), tx: {
  $executeRaw: vi.fn(), $transaction: vi.fn(),
  order: { findUnique: vi.fn(), findUniqueOrThrow: vi.fn(), update: vi.fn() },
  orderItem: { update: vi.fn() }, orderPackagingGroup: { create: vi.fn() },
  orderLog: { create: vi.fn() }, craft: { findMany: vi.fn() },
} }));
vi.mock('../pricing-revision', () => ({ appendOrderPricingRevisionInTx: append }));
vi.mock('@/lib/db', () => ({ db: tx }));
import { buildTrustedAdminItemPricingSnapshot, isTrustedAdminItemPricingSnapshot } from '../admin-pricing-snapshot';
import { repairLegacyProductionFacts } from '../legacy-production-facts';
import { getLegacyProductionFactsRepair, legacyPackagingMode } from '../legacy-production-facts-presentation';

function fixture() {
  return {
    id: 'order-1', revision: 2, priceRevision: 3, status: OrderStatus.SUBMITTED as OrderStatus,
    packageRequirement: '单款装', packagingAmount: new Decimal('0'), processingAmount: new Decimal('10'), totalAmount: new Decimal('10'),
    pricingStatus: 'ADMIN_CONFIRMED', settlementType: 'INTERNAL_SALES', confirmedFee: new Decimal('10'),
    settledAt: null, settledFee: null, receiverAddress: '广东省测试地址', receiverPhone: null,
    _count: { changeRequests: 0 }, customerCharges: [], shipments: [],
    items: [{ orderId: 'order-1', productId: null, pricingRoute: 'MANUAL_QUOTE', productStructure: 'STANDARD_ENVELOPE', plateGroupId: null, pricingGroup: null, specification: null, actualWidthMm: null, actualHeightMm: null, paperType: null, paperWeightGsm: null, foilColors: ['哑金'], foilTechnique: 'FLAT', lamination: 'NONE', printColors: [], printColorsKnown: true, isDoubleSided: false, isDoubleColor: false, unitPrice: new Decimal('0'), fixedFee: new Decimal('10'), priceOverrideReason: null, id: 'item-1', sequence: 1, name: '红包', craft: null as OrderCraft | null, pack: 10 as number | null, quantity: 101,
      frontFoilColors: ['哑金'], backFoilColors: [], hasLocalFoil: true, crafts: [], subtotal: new Decimal('10'), pricingSnapshot: {} as Record<string, unknown>, quoteDisposition: 'PRICED', manualQuoteReason: null }],
    packagingGroups: [] as Array<{ id: string; sequence: number; mode: OrderPackagingMode; actualBagCount: number; subtotal: Decimal; lines: Array<{ orderItemId: string; unitsPerBag: number }> }>,
  };
}
let order: ReturnType<typeof fixture>;
const actor = { id: 'admin-1', role: Role.ADMIN };
const input = () => ({ orderId: 'order-1', expectedOrderRevision: 2, items: [{ itemId: 'item-1', craft: OrderCraft.FULL }] });
beforeEach(() => {
  vi.resetAllMocks(); order = fixture();
  tx.$transaction.mockImplementation(async (fn) => fn(tx));
  tx.order.findUnique.mockImplementation(async () => order);
  tx.order.findUniqueOrThrow.mockImplementation(async () => order);
  tx.craft.findMany.mockResolvedValue([]);
  tx.orderItem.update.mockImplementation(async ({ where, data }) => Object.assign(order.items.find((item) => item.id === where.id)!, data));
  tx.orderPackagingGroup.create.mockImplementation(async ({ data }) => {
    order.packagingGroups.push({ ...data, id: `group-${data.sequence}`, subtotal: new Decimal(data.subtotal), lines: data.lines.create });
  });
});
function expectNoWrites() {
  expect(tx.order.update).not.toHaveBeenCalled(); expect(tx.orderItem.update).not.toHaveBeenCalled();
  expect(tx.orderPackagingGroup.create).not.toHaveBeenCalled(); expect(tx.orderLog.create).not.toHaveBeenCalled();
}
describe('repairLegacyProductionFacts', () => {
  it.each([OrderStatus.RELEASED, OrderStatus.IN_PRODUCTION, OrderStatus.SHIPPED, OrderStatus.SETTLED, OrderStatus.CANCELLED])('状态 %s 拒绝', async (status) => {
    order.status = status; await expect(repairLegacyProductionFacts(input(), actor)).rejects.toThrow('当前状态不允许补录'); expectNoWrites();
  });
  it('覆盖已有 craft 被拒', async () => {
    order.items[0].craft = OrderCraft.PRINT;
    await expect(repairLegacyProductionFacts(input(), actor)).rejects.toThrow('已有工艺'); expectNoWrites();
  });
  it('已有包装组时拒建', async () => {
    order.packagingGroups.push({ id: 'existing', sequence: 1, mode: OrderPackagingMode.SINGLE_STYLE, actualBagCount: 11, subtotal: new Decimal(0), lines: [] });
    await expect(repairLegacyProductionFacts({ ...input(), packagingMode: OrderPackagingMode.SINGLE_STYLE }, actor)).rejects.toThrow('已有包装组'); expectNoWrites();
  });
  it('已有包装组允许仅补缺失 craft，不重复创建包装', async () => {
    order.packagingGroups.push({ id: 'existing', sequence: 1, mode: OrderPackagingMode.SINGLE_STYLE, actualBagCount: 11, subtotal: new Decimal(0), lines: [{ orderItemId: 'item-1', unitsPerBag: 10 }] });
    await expect(repairLegacyProductionFacts(input(), actor)).resolves.toMatchObject({ ready: true });
    expect(tx.orderPackagingGroup.create).not.toHaveBeenCalled();
  });
  it.each([OrderStatus.DRAFT, OrderStatus.PENDING_FACTORY, OrderStatus.CONFIRMED])('允许 %s 补录但不改变状态', async (status) => {
    order.status = status;
    await repairLegacyProductionFacts(input(), actor);
    expect(order.status).toBe(status);
    expect(tx.order.update).toHaveBeenCalledWith(expect.objectContaining({ data: { revision: { increment: 1 } } }));
  });
  it('pack 缺失且未给 unitsPerBag 被拒', async () => {
    order.items[0].pack = null;
    await expect(repairLegacyProductionFacts(input(), actor)).rejects.toThrow('请填写每包数量'); expectNoWrites();
  });
  it('正常补录后真实 readiness 通过，保留金额并记录审计与版本', async () => {
    await expect(repairLegacyProductionFacts(input(), actor)).resolves.toMatchObject({ ready: true, issues: [], revision: 3 });
    expect(tx.$executeRaw.mock.invocationCallOrder[0]).toBeLessThan(tx.order.findUnique.mock.invocationCallOrder[0]);
    expect(tx.order.update).toHaveBeenCalledWith({ where: { id: 'order-1', revision: 2 }, data: { revision: { increment: 1 } } });
    expect(tx.orderPackagingGroup.create).toHaveBeenCalledWith({ data: expect.objectContaining({ actualBagCount: 11, unitPrice: '0', subtotal: '0.00', pricingSnapshot: expect.objectContaining({ source: 'LEGACY_PRODUCTION_FACTS_REPAIR', repairedBy: actor.id, note: '包装费已含在历史款式价内' }) }) });
    expect(tx.orderLog.create).toHaveBeenCalledWith({ data: expect.objectContaining({ action: 'LEGACY_PRODUCTION_FACTS_REPAIRED', changedFields: expect.objectContaining({ crafts: [{ itemId: 'item-1', before: null, after: 'FULL' }] }) }) });
  });
  it('优先原 pack，缺失才采用管理员输入', async () => {
    await repairLegacyProductionFacts({ ...input(), items: [{ itemId: 'item-1', craft: OrderCraft.FULL, unitsPerBag: 3 }] }, actor);
    expect(order.packagingGroups[0].lines[0].unitsPerBag).toBe(10);
  });
  it('补录缺失的 pack 输入与明确包装方式', async () => {
    order.packageRequirement = '客户特殊包装说明'; order.items[0].pack = null;
    await expect(repairLegacyProductionFacts({ ...input(), packagingMode: OrderPackagingMode.SINGLE_STYLE, items: [{ itemId: 'item-1', craft: OrderCraft.FULL, unitsPerBag: 10 }] }, actor)).resolves.toMatchObject({ ready: true });
  });
  it('未知旧包装说明要求显式选择', async () => {
    order.packageRequirement = '特殊包装';
    await expect(repairLegacyProductionFacts(input(), actor)).rejects.toThrow('请选择包装方式'); expectNoWrites();
  });
  it.each(['0.01', '10.00'])('packagingAmount %s 按数量分配，尾组取余且合计不变', async (amount) => {
    order.items.push({ ...order.items[0], id: 'item-2', sequence: 2, craft: OrderCraft.FULL, quantity: 202 });
    order.packagingAmount = new Decimal(amount); order.processingAmount = new Decimal(20).plus(amount); order.totalAmount = order.processingAmount; order.confirmedFee = order.totalAmount;
    await expect(repairLegacyProductionFacts(input(), actor)).resolves.toMatchObject({ ready: true });
    const totals = order.packagingGroups.map((group) => group.subtotal);
    expect(totals[0].toFixed(2)).toBe(amount === '0.01' ? '0.00' : '3.33');
    expect(totals[1].toFixed(2)).toBe(amount === '0.01' ? '0.01' : '6.67');
    expect(totals[0].plus(totals[1]).toFixed(2)).toBe(amount);
  });
  it('单组直接保留非零包装费', async () => {
    order.packagingAmount = new Decimal('10'); order.processingAmount = new Decimal('20'); order.totalAmount = order.processingAmount; order.confirmedFee = order.totalAmount;
    await repairLegacyProductionFacts(input(), actor); expect(order.packagingGroups[0].subtotal.toFixed(2)).toBe('10.00');
  });
  it('版本过期、跨单款式、重复款式及非管理员均拒绝', async () => {
    await expect(repairLegacyProductionFacts({ ...input(), expectedOrderRevision: 1 }, actor)).rejects.toThrow('工单已变化');
    await expect(repairLegacyProductionFacts({ ...input(), items: [{ itemId: 'foreign' }] }, actor)).rejects.toThrow('不属于');
    await expect(repairLegacyProductionFacts({ ...input(), items: [...input().items, ...input().items] }, actor)).rejects.toThrow('不能重复');
    await expect(repairLegacyProductionFacts(input(), { id: 'sales', role: Role.SALES })).rejects.toThrow('无权'); expectNoWrites();
  });
  it('不包装保留归属并使用零袋数', async () => {
    await expect(repairLegacyProductionFacts({ ...input(), packagingMode: OrderPackagingMode.UNPACKED }, actor)).resolves.toMatchObject({ ready: true });
    expect(order.packagingGroups[0].actualBagCount).toBe(0);
  });
  it('不包装 + 历史包装费非零在写入前被拒（数据库约束要求不包装组金额为 0）', async () => {
    order.packagingAmount = new Decimal('0.01'); order.processingAmount = new Decimal('20.01'); order.totalAmount = order.processingAmount; order.confirmedFee = order.totalAmount;
    await expect(repairLegacyProductionFacts({ ...input(), packagingMode: OrderPackagingMode.UNPACKED }, actor)).rejects.toThrow('不能补录为不包装'); expectNoWrites();
  });
  it('装盒按地址分别进位且通过真实 readiness', async () => {
    Object.assign(order, { shipments: [{ lines: [{ orderItemId: 'item-1', quantity: 1 }] }, { lines: [{ orderItemId: 'item-1', quantity: 100 }] }] });
    await expect(repairLegacyProductionFacts({ ...input(), packagingMode: OrderPackagingMode.BOX_RED_CARD }, actor)).resolves.toMatchObject({ ready: true });
    expect(order.packagingGroups[0].actualBagCount).toBe(11);
  });
  it('混装保留所选 mode，每款一行且整组保存历史费用', async () => {
    order.items.push({ ...order.items[0], id: 'item-2', sequence: 2, craft: OrderCraft.FULL });
    order.packagingAmount = new Decimal('0.01'); order.processingAmount = new Decimal('20.01'); order.totalAmount = order.processingAmount; order.confirmedFee = order.totalAmount;
    await expect(repairLegacyProductionFacts({ ...input(), packagingMode: OrderPackagingMode.MIXED_STYLE }, actor)).resolves.toMatchObject({ ready: true });
    expect(order.packagingGroups).toHaveLength(1); expect(order.packagingGroups[0]).toMatchObject({ mode: 'MIXED_STYLE', actualBagCount: 11 });
    expect(order.packagingGroups[0].lines).toHaveLength(2); expect(order.packagingGroups[0].subtotal.toFixed(2)).toBe('0.01');
  });
  it('混装袋数不一致时拒绝，不写入部分补录', async () => {
    order.items.push({ ...order.items[0], id: 'item-2', sequence: 2, craft: OrderCraft.FULL, quantity: 202 });
    await expect(repairLegacyProductionFacts({ ...input(), packagingMode: OrderPackagingMode.MIXED_STYLE }, actor)).rejects.toThrow('无法得到同一袋数'); expectNoWrites();
  });
  it('先保存终价再补工艺：新确认依据保持可信，旧依据与新价格版本留痕', async () => {
    const item = order.items[0];
    item.pricingSnapshot = buildTrustedAdminItemPricingSnapshot({ previous: {}, now: new Date('2026-09-14T00:00:00Z'), actorId: actor.id, previousPriceRevision: 2, item });
    const before = item.pricingSnapshot;
    await expect(repairLegacyProductionFacts(input(), actor)).resolves.toMatchObject({ ready: true });
    expect(isTrustedAdminItemPricingSnapshot(item.pricingSnapshot, item)).toBe(true);
    expect(append).toHaveBeenCalledWith(tx, expect.objectContaining({ source: 'LEGACY_PRODUCTION_FACTS_REPAIR', expectedPriceRevision: 3, incrementOrderRevision: false, metadata: { reboundSnapshots: [{ itemId: item.id, before, after: item.pricingSnapshot }] } }));
    expect(item.subtotal.toFixed(2)).toBe('10.00');
  });
  it('不把失配的旧终价依据重新认定为可信', async () => {
    const item = order.items[0];
    item.pricingSnapshot = buildTrustedAdminItemPricingSnapshot({ previous: {}, now: new Date('2026-09-14T00:00:00Z'), actorId: actor.id, previousPriceRevision: 2, item: { ...item, quantity: 999 } });
    const before = item.pricingSnapshot;
    await expect(repairLegacyProductionFacts(input(), actor)).resolves.toMatchObject({ ready: false });
    expect(item.pricingSnapshot).toBe(before); expect(append).not.toHaveBeenCalled();
  });
  it('只识别明确旧包装方式，完整或已下发工单不展示补录', () => {
    expect(legacyPackagingMode('不包装')).toBe('UNPACKED'); expect(legacyPackagingMode('常规入袋')).toBe('SINGLE_STYLE'); expect(legacyPackagingMode('请按客户要求')).toBeUndefined();
    expect(getLegacyProductionFactsRepair(order)?.needsPackaging).toBe(true);
    order.status = OrderStatus.RELEASED; expect(getLegacyProductionFactsRepair(order)).toBeNull();
  });
});
