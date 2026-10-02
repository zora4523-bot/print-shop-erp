import { randomUUID } from 'node:crypto';
import Decimal from 'decimal.js';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { Role } from '@/generated/prisma/enums';
import { db } from '@/lib/db';
import { readBillSettlementDetail } from '@/lib/agent-monthly-billing/settlement-detail';
import { correctSettledOrder, SettledOrderCorrectionError } from '../settled-correction';

vi.mock('server-only', () => ({}));

// 写入真实数据行并经过数据库触发器，只在一次性库（库名含 e2e / test / ci 段）上运行。
const url = process.env.DATABASE_URL;
const disposable = Boolean(url && /(?:^|_)(?:e2e|test|ci)(?:_|$)/.test(new URL(url).pathname.slice(1)));
const postgres = disposable ? describe : describe.skip;

const prefix = `settled_fix_${randomUUID().replaceAll('-', '').slice(0, 16)}`;
const adminId = `${prefix}_admin`;
const salesId = `${prefix}_sales`;
const period = '2001-01';
const settledAt = new Date('2001-01-15T04:00:00.000Z');
const admin = { id: adminId, role: Role.ADMIN };

async function settledOrder(suffix: string) {
  const shipping = await db.customerChargeCategory.findUniqueOrThrow({ where: { code: 'SHIPPING_FEE' }, select: { id: true } });
  const order = await db.order.create({
    data: {
      orderNo: `${prefix}-${suffix}`, customName: '结算更正验收', submitterId: salesId, createdById: adminId,
      submitterRole: 'SALES', settlementType: 'EXTERNAL_SALES', billingMode: 'CHARGE', status: 'SETTLED',
      priceRevision: 1, pricingStatus: 'ADMIN_CONFIRMED', pricingConfirmedAt: settledAt, pricingConfirmedById: adminId,
      processingAmount: '150.00', totalAmount: '199.80', confirmedFee: '199.80',
      settledFee: '199.80', settledAt, settlementContractVersion: 2, shippedAt: settledAt,
    },
    select: { id: true, orderNo: true, revision: true, workOrderVersion: true },
  });
  await db.orderCustomerCharge.create({
    data: {
      orderId: order.id, categoryId: shipping.id, businessKey: 'ORDER:SHIPPING_FEE', status: 'FINAL',
      description: '快递费', amount: '49.80', createdById: adminId, finalizedById: adminId, finalizedAt: settledAt,
    },
  });
  return order;
}

postgres.sequential('settled order correction · real schema and triggers', () => {
  let unbilled: Awaited<ReturnType<typeof settledOrder>>;
  let billed: Awaited<ReturnType<typeof settledOrder>>;
  let billId: string;

  beforeAll(async () => {
    await db.user.createMany({ data: [
      { id: adminId, username: adminId, displayName: '更正测试管理员', password: 'not-a-login-hash', role: Role.ADMIN },
      { id: salesId, username: salesId, displayName: '更正测试销售', password: 'not-a-login-hash', role: Role.SALES },
    ] });
    unbilled = await settledOrder('A');
    billed = await settledOrder('B');
    const bill = await db.agentMonthlyBill.create({
      data: { agentUserId: salesId, period, agentUsernameSnapshot: salesId, agentDisplayNameSnapshot: '更正测试销售',
        memberSubtotal: '199.80', totalAmount: '199.80' },
      select: { id: true },
    });
    billId = bill.id;
    await db.agentMonthlyBillItem.create({
      data: { billId, orderId: billed.id, orderNoSnapshot: billed.orderNo, workOrderVersionSnapshot: billed.workOrderVersion,
        orderStatusSnapshot: 'SETTLED', settledFeeSnapshot: '199.80', settledAtSnapshot: settledAt,
        settlementDetailSnapshot: { schemaVersion: 1, orderName: '结算更正验收', processingAmount: '150.00', charges: [{ description: '快递费', amount: '49.80' }] } },
    });
  });

  afterAll(async () => {
    // DRAFT 账单可删；工单带不可删的价格修订，按唯一前缀留在一次性库里。
    await db.agentMonthlyBillItem.deleteMany({ where: { billId } }).catch(() => undefined);
    await db.agentMonthlyBill.deleteMany({ where: { id: billId } }).catch(() => undefined);
  });

  it('adds a correction line to an unbilled settled order and keeps every amount consistent', async () => {
    const result = await correctSettledOrder({ orderId: unbilled.id, expectedRevision: unbilled.revision,
      amount: '10.00', reason: '少收包装费', idempotencyKey: randomUUID() }, admin);
    expect(result).toMatchObject({ settledFee: '209.80', draftBillId: null, idempotentReplay: false });
    const order = await db.order.findUniqueOrThrow({ where: { id: unbilled.id }, select: {
      status: true, settledAt: true, settledFee: true, confirmedFee: true, totalAmount: true, processingAmount: true, pricingStatus: true,
      customerCharges: { select: { amount: true, description: true, isAdjustment: true } } } });
    expect(order.status).toBe('SETTLED');
    expect(order.settledAt).toEqual(settledAt);
    expect([order.settledFee, order.confirmedFee, order.totalAmount].map((value) => value!.toFixed(2))).toEqual(['209.80', '209.80', '209.80']);
    const charges = order.customerCharges.reduce((sum, charge) => sum.plus(charge.amount!.toString()), new Decimal(0));
    expect(new Decimal(order.processingAmount.toString()).plus(charges).toFixed(2)).toBe('209.80');
    expect(order.customerCharges).toContainEqual(expect.objectContaining({ description: '结算更正', isAdjustment: true }));
    expect(await db.orderPricingRevision.count({ where: { orderId: unbilled.id, source: 'SETTLED_ORDER_CORRECTION' } })).toBe(1);
    expect(await db.orderLog.count({ where: { orderId: unbilled.id, action: 'ORDER_SETTLEMENT_CORRECTED' } })).toBe(1);
  });

  it('keeps a DRAFT bill member consistent with the corrected order so the bill can still be confirmed', async () => {
    const result = await correctSettledOrder({ orderId: billed.id, expectedRevision: billed.revision,
      amount: '-9.80', reason: '运费多收', idempotencyKey: randomUUID() }, admin);
    expect(result).toMatchObject({ settledFee: '190.00', draftBillId: billId });
    const item = await db.agentMonthlyBillItem.findUniqueOrThrow({ where: { orderId: billed.id },
      select: { settledFeeSnapshot: true, settlementDetailSnapshot: true } });
    expect(item.settledFeeSnapshot.toFixed(2)).toBe('190.00');
    // 账单明细快照的分项合计必须等于结算金额，否则销售端看不到明细。
    expect(readBillSettlementDetail(item.settlementDetailSnapshot, '190.00')).not.toBeNull();
    const bill = await db.agentMonthlyBill.findUniqueOrThrow({ where: { id: billId },
      select: { memberSubtotal: true, adjustmentAmount: true, totalAmount: true } });
    expect([bill.memberSubtotal, bill.adjustmentAmount, bill.totalAmount].map((value) => value.toFixed(2))).toEqual(['190.00', '0.00', '190.00']);
  });

  it('stops at the processing fee instead of hitting the receivable constraint', async () => {
    const current = await db.order.findUniqueOrThrow({ where: { id: billed.id }, select: { revision: true } });
    const attempt = correctSettledOrder({ orderId: billed.id, expectedRevision: current.revision,
      amount: '-40.01', reason: '超过收费部分', idempotencyKey: randomUUID() }, admin);
    await expect(attempt).rejects.toBeInstanceOf(SettledOrderCorrectionError);
    await expect(attempt).rejects.toThrow('最低只能更正到加工费 150.00 元');
    await expect(correctSettledOrder({ orderId: billed.id, expectedRevision: current.revision,
      amount: '-40.00', reason: '收费部分全退', idempotencyKey: randomUUID() }, admin)).resolves.toMatchObject({ settledFee: '150.00' });
  });
});
