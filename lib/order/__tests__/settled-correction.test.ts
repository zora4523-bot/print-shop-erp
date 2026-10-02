import Decimal from 'decimal.js';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { Prisma } from '../../../generated/prisma/client';
import { Role } from '../../../generated/prisma/enums';

const mocks = vi.hoisted(() => {
  const tx = {
    $executeRaw: vi.fn(),
    order: { findUnique: vi.fn(), findUniqueOrThrow: vi.fn(), update: vi.fn() },
    orderCustomerCharge: { findUnique: vi.fn(), create: vi.fn() },
    agentMonthlyBillItem: { findUnique: vi.fn(), update: vi.fn() },
    customerChargeCategory: { findUnique: vi.fn() },
    orderLog: { create: vi.fn() },
  };
  return {
    tx,
    db: {
      $transaction: vi.fn(async (work: (client: typeof tx) => unknown) => work(tx)),
      order: { findUnique: vi.fn() },
    },
    cutoff: vi.fn(),
    period: vi.fn(),
    bill: vi.fn(),
    allocate: vi.fn(),
    revision: vi.fn(),
    clock: vi.fn(),
  };
});
vi.mock('@/lib/db', () => ({ db: mocks.db }));
vi.mock('@/lib/finance/settlement-cutoff-lock', () => ({ lockSettlementCutoffShared: mocks.cutoff }));
vi.mock('@/lib/agent-monthly-billing/locks', () => ({ lockAgentPeriod: mocks.period, lockAgentBill: mocks.bill }));
vi.mock('@/lib/agent-monthly-billing/generation', () => ({ allocateOutstandingCreditsInTx: mocks.allocate }));
vi.mock('@/lib/order/pricing-revision', () => ({ appendOrderPricingRevisionInTx: mocks.revision }));
vi.mock('@/lib/background-jobs/clock', () => ({ databaseClockNow: mocks.clock }));

import {
  correctSettledOrder,
  readSettledOrderCorrectionAvailability,
  SettledOrderCorrectionError,
} from '../settled-correction';

const admin = { id: 'admin-1', role: Role.ADMIN };
const now = new Date('2026-10-01T08:00:00.000Z');
const key = '7c111111-2222-4333-8444-555555555555';

function settledOrder(overrides: Record<string, unknown> = {}) {
  return {
    id: 'order-1', orderNo: 'GD-1', status: 'SETTLED', settlementType: 'EXTERNAL_SALES', billingMode: 'CHARGE',
    submitterId: 'sales-1', revision: 7, priceRevision: 3,
    processingAmount: new Decimal('150.00'), totalAmount: new Decimal('199.80'), confirmedFee: new Decimal('199.80'),
    settledFee: new Decimal('199.80'), settledAt: new Date('2026-09-30T04:00:00.000Z'),
    ...overrides,
  };
}
const draftItem = { id: 'item-1', billId: 'bill-1', bill: { status: 'DRAFT', agentUserId: 'sales-1', period: '2026-09' } };
const input = (overrides: Record<string, unknown> = {}) => ({
  orderId: 'order-1', expectedRevision: 7, amount: '-20.00', reason: '运费多收', idempotencyKey: key, ...overrides,
});

beforeEach(() => {
  vi.clearAllMocks();
  mocks.clock.mockResolvedValue(now);
  mocks.tx.orderCustomerCharge.findUnique.mockResolvedValue(null);
  mocks.tx.order.findUnique.mockResolvedValue(settledOrder());
  mocks.tx.agentMonthlyBillItem.findUnique.mockResolvedValue(null);
  mocks.tx.customerChargeCategory.findUnique.mockResolvedValue({ id: 'category-adjust', isActive: true });
  mocks.tx.order.findUniqueOrThrow.mockResolvedValue({
    settledFee: new Decimal('179.80'), customName: '新年快乐', processingAmount: new Decimal('180.00'),
    customerCharges: [{ description: '快递费', amount: new Decimal('19.80') }, { description: '结算更正', amount: new Decimal('-20.00') }],
    priceRevision: 4, revision: 8,
  });
  mocks.revision.mockResolvedValue({ priceRevision: 4, orderRevision: 8, pricingRevisionId: 'rev-4' });
});

describe('settled order correction (owner 2026-10-01)', () => {
  it('records a negative correction as an adjustment line and moves total, confirmed and settled amounts together', async () => {
    await expect(correctSettledOrder(input(), admin)).resolves.toEqual({
      chargeId: expect.any(String), settledFee: '179.80', priceRevision: 4, revision: 8,
      draftBillId: null, idempotentReplay: false,
    });
    // 结算截止共享锁必须是事务里第一条语句，与账单生成 / 确认的独占锁互斥。
    expect(mocks.cutoff.mock.invocationCallOrder[0]).toBeLessThan(mocks.tx.$executeRaw.mock.invocationCallOrder[0]);
    const charge = mocks.tx.orderCustomerCharge.create.mock.calls[0][0].data;
    expect(charge).toMatchObject({
      orderId: 'order-1', categoryId: 'category-adjust', businessKey: `SETTLEMENT_CORRECTION:${key}`,
      status: 'FINAL', description: '结算更正', amount: '-20.00', isAdjustment: true,
      overrideReason: '运费多收', approvalReference: '运费多收', finalizedAt: now,
      pricingSnapshot: { source: 'SETTLED_ORDER_CORRECTION', settledFee: { before: '199.80', after: '179.80' } },
    });
    expect(mocks.tx.order.update).toHaveBeenCalledWith({ where: { id: 'order-1' }, select: { id: true },
      data: { totalAmount: '179.80', confirmedFee: '179.80', settledFee: '179.80' } });
    expect(mocks.revision).toHaveBeenCalledWith(mocks.tx, expect.objectContaining({
      status: 'ADMIN_CONFIRMED', source: 'SETTLED_ORDER_CORRECTION', expectedPriceRevision: 3, incrementOrderRevision: true,
    }));
    expect(mocks.tx.orderLog.create.mock.calls[0][0].data).toMatchObject({
      action: 'ORDER_SETTLEMENT_CORRECTED', remark: '结算更正 -20.00 元：运费多收',
      changedFields: { settledFee: { before: '199.80', after: '179.80' } },
    });
    expect(mocks.allocate).not.toHaveBeenCalled();
    expect(mocks.tx.agentMonthlyBillItem.update).not.toHaveBeenCalled();
  });

  it('refreshes only this order in its DRAFT bill, then rebuilds that bill\'s adjustments and totals', async () => {
    mocks.tx.agentMonthlyBillItem.findUnique.mockResolvedValue(draftItem);
    mocks.tx.order.findUniqueOrThrow.mockResolvedValue({
      settledFee: new Decimal('214.80'), customName: '新年快乐', processingAmount: new Decimal('180.00'),
      customerCharges: [{ description: '快递费', amount: new Decimal('19.80') }, { description: '结算更正', amount: new Decimal('15.00') }],
    });
    await expect(correctSettledOrder(input({ amount: '15' }), admin)).resolves.toMatchObject({ settledFee: '214.80', draftBillId: 'bill-1' });
    expect(mocks.period).toHaveBeenCalledWith(mocks.tx, 'sales-1', '2026-09');
    expect(mocks.bill).toHaveBeenCalledWith(mocks.tx, 'bill-1');
    expect(mocks.tx.agentMonthlyBillItem.update).toHaveBeenCalledWith({
      where: { id: 'item-1' }, select: { id: true },
      data: {
        settledFeeSnapshot: '214.80',
        settlementDetailSnapshot: {
          schemaVersion: 1, orderName: '新年快乐', processingAmount: '180.00',
          charges: [{ description: '快递费', amount: '19.80' }, { description: '结算更正', amount: '15.00' }],
        },
      },
    });
    expect(mocks.allocate).toHaveBeenCalledWith(mocks.tx, { billId: 'bill-1', agentUserId: 'sales-1', period: '2026-09' });
    expect(mocks.tx.order.update.mock.calls[0][0].data.settledFee).toBe('214.80');
  });

  it('excludes waived charges when refreshing a corrected draft snapshot', async () => {
    mocks.tx.agentMonthlyBillItem.findUnique.mockResolvedValue(draftItem);
    mocks.tx.order.findUniqueOrThrow.mockResolvedValue({
      settledFee: new Decimal('179.80'), customName: null, processingAmount: new Decimal('180.00'),
      customerCharges: [
        { description: '免收', amount: null, status: 'WAIVED' },
        { description: '调整', amount: new Decimal('-0.20'), status: 'FINAL' },
      ],
    });
    await correctSettledOrder(input(), admin);
    expect(mocks.tx.order.findUniqueOrThrow).toHaveBeenCalledWith(expect.objectContaining({
      select: expect.objectContaining({ customerCharges: expect.objectContaining({ select: { description: true, amount: true, status: true } }) }),
    }));
    expect(mocks.tx.agentMonthlyBillItem.update.mock.calls[0][0].data.settlementDetailSnapshot).toEqual({
      schemaVersion: 1, orderName: null, processingAmount: '180.00', charges: [{ description: '调整', amount: '-0.20' }],
    });
  });

  it('writes database null for unavailable corrected draft evidence', async () => {
    mocks.tx.agentMonthlyBillItem.findUnique.mockResolvedValue(draftItem);
    mocks.tx.order.findUniqueOrThrow.mockResolvedValue({
      settledFee: new Decimal('179.80'), customName: null, processingAmount: null, customerCharges: [],
    });
    await correctSettledOrder(input(), admin);
    expect(mocks.tx.agentMonthlyBillItem.update.mock.calls[0][0].data.settlementDetailSnapshot).toBe(Prisma.DbNull);
  });

  it.each([
    [{ status: 'SHIPPED' }, '只有已结算的工单'],
    [{ status: 'CANCELLED' }, '只有已结算的工单'],
    [{ billingMode: 'NO_CHARGE' }, '免收费工单'],
    [{ settlementType: 'NO_CHARGE' }, '免收费工单'],
    [{ settledFee: null }, '缺少结算金额'],
  ])('refuses orders that are not settled receivables: %j', async (overrides, message) => {
    mocks.tx.order.findUnique.mockResolvedValue(settledOrder(overrides));
    await expect(correctSettledOrder(input(), admin)).rejects.toThrow(message);
    expect(mocks.tx.orderCustomerCharge.create).not.toHaveBeenCalled();
  });

  it.each(['CONFIRMED', 'PAID'])('sends a %s monthly bill to credits instead of rewriting the frozen settlement', async (status) => {
    mocks.tx.agentMonthlyBillItem.findUnique.mockResolvedValue({ ...draftItem, bill: { ...draftItem.bill, status } });
    await expect(correctSettledOrder(input(), admin)).rejects.toThrow('请在账单里录入抵扣或补收');
    expect(mocks.tx.order.update).not.toHaveBeenCalled();
  });

  it('rejects a stale page, a result below zero, a zero amount and non-admins', async () => {
    await expect(correctSettledOrder(input({ expectedRevision: 6 }), admin)).rejects.toThrow('请刷新');
    await expect(correctSettledOrder(input({ amount: '-200.00' }), admin)).rejects.toThrow('不能小于 0');
    // 对客收费合计不能为负（Order_receivable_amounts_valid）：最低到加工费 150.00。
    await expect(correctSettledOrder(input({ amount: '-49.81' }), admin)).rejects.toThrow('最低只能更正到加工费 150.00 元');
    await expect(correctSettledOrder(input({ amount: '0' }), admin)).rejects.toBeInstanceOf(SettledOrderCorrectionError);
    await expect(correctSettledOrder(input(), { id: 'sales-1', role: Role.SALES })).rejects.toThrow('只有管理员');
    expect(mocks.tx.orderCustomerCharge.create).not.toHaveBeenCalled();
  });

  it('allows correcting down to exactly the processing fee, and to zero when there is none', async () => {
    await expect(correctSettledOrder(input({ amount: '-49.80' }), admin)).resolves.toMatchObject({ settledFee: '150.00' });
    mocks.tx.order.findUnique.mockResolvedValue(settledOrder({ processingAmount: new Decimal('0') }));
    await expect(correctSettledOrder(input({ amount: '-199.80' }), admin)).resolves.toMatchObject({ settledFee: '0.00' });
  });

  it('requires the adjustment category to be enabled', async () => {
    mocks.tx.customerChargeCategory.findUnique.mockResolvedValue({ id: 'category-adjust', isActive: false });
    await expect(correctSettledOrder(input(), admin)).rejects.toThrow('尚未启用');
  });

  it('replays the same request without a second line, and refuses a reused key with different content', async () => {
    mocks.tx.orderCustomerCharge.findUnique.mockResolvedValue({ id: 'charge-1', amount: new Decimal('-20.00'), overrideReason: '运费多收' });
    mocks.tx.agentMonthlyBillItem.findUnique.mockResolvedValue({ billId: 'bill-1', bill: { status: 'DRAFT' } });
    await expect(correctSettledOrder(input(), admin)).resolves.toEqual({
      chargeId: 'charge-1', settledFee: '179.80', priceRevision: 4, revision: 8, draftBillId: 'bill-1', idempotentReplay: true,
    });
    expect(mocks.tx.orderCustomerCharge.create).not.toHaveBeenCalled();
    await expect(correctSettledOrder(input({ amount: '-21.00' }), admin)).rejects.toThrow('本次提交已失效');
  });
});

describe('correction availability for the detail page', () => {
  it('offers the form only for a settled receivable outside a confirmed bill', async () => {
    const row = (overrides: Record<string, unknown> = {}) => ({ ...settledOrder(), agentMonthlyBillItem: null, ...overrides });
    mocks.db.order.findUnique.mockResolvedValueOnce(row());
    await expect(readSettledOrderCorrectionAvailability('order-1')).resolves.toEqual({ allowed: true, settledFee: '199.80', minimumSettledFee: '150.00', inDraftBill: false });
    mocks.db.order.findUnique.mockResolvedValueOnce(row({ agentMonthlyBillItem: { bill: { status: 'DRAFT' } } }));
    await expect(readSettledOrderCorrectionAvailability('order-1')).resolves.toEqual({ allowed: true, settledFee: '199.80', minimumSettledFee: '150.00', inDraftBill: true });
    mocks.db.order.findUnique.mockResolvedValueOnce(row({ agentMonthlyBillItem: { bill: { status: 'CONFIRMED' } } }));
    await expect(readSettledOrderCorrectionAvailability('order-1')).resolves.toMatchObject({ allowed: false });
    mocks.db.order.findUnique.mockResolvedValueOnce(null);
    await expect(readSettledOrderCorrectionAvailability('missing')).resolves.toEqual({ allowed: false, reason: '工单不存在' });
  });
});
