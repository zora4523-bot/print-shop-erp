import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { Role } from '@/generated/prisma/enums';
import { db } from '@/lib/db';
import { confirmAgentMonthlyBill, createAgentMonthlyBillCredit } from '../commands';

vi.mock('server-only', () => ({}));

// 写入真实数据行并经过触发器（含 20261001120000_agent_bill_surcharge），只在一次性库上运行。
const url = process.env.DATABASE_URL;
const disposable = Boolean(url && /(?:^|_)(?:e2e|test|ci)(?:_|$)/.test(new URL(url).pathname.slice(1)));
const postgres = disposable ? describe : describe.skip;

const prefix = `bill_surcharge_${randomUUID().replaceAll('-', '').slice(0, 16)}`;
const adminId = `${prefix}_admin`;
const salesId = `${prefix}_sales`;
const admin = { id: adminId, role: Role.ADMIN };
const settledAt = new Date('2001-02-10T04:00:00.000Z');

postgres.sequential('agent bill surcharge · real schema and triggers (owner 2026-10-01)', () => {
  let sourceBillId: string;
  let sourceItemId: string;
  let nextBillId: string;

  beforeAll(async () => {
    await db.user.createMany({ data: [
      { id: adminId, username: adminId, displayName: '补收测试管理员', password: 'not-a-login-hash', role: Role.ADMIN },
      { id: salesId, username: salesId, displayName: '补收测试销售', password: 'not-a-login-hash', role: Role.SALES },
    ] });
    await db.order.create({ data: {
      orderNo: `${prefix}-1`, customName: '补收验收', submitterId: salesId, createdById: adminId, submitterRole: 'SALES',
      settlementType: 'EXTERNAL_SALES', billingMode: 'CHARGE', status: 'SETTLED',
      priceRevision: 1, pricingStatus: 'ADMIN_CONFIRMED', pricingConfirmedAt: settledAt, pricingConfirmedById: adminId,
      processingAmount: '100.00', totalAmount: '100.00', confirmedFee: '100.00',
      settledFee: '100.00', settledAt, settlementContractVersion: 2, shippedAt: settledAt,
    } });
    const source = await db.agentMonthlyBill.create({ data: {
      agentUserId: salesId, period: '2001-02', agentUsernameSnapshot: salesId, agentDisplayNameSnapshot: '补收测试销售',
    }, select: { id: true } });
    sourceBillId = source.id;
    await confirmAgentMonthlyBill(sourceBillId, admin, randomUUID());
    sourceItemId = (await db.agentMonthlyBillItem.findFirstOrThrow({ where: { billId: sourceBillId }, select: { id: true } })).id;
    nextBillId = (await db.agentMonthlyBill.create({ data: {
      agentUserId: salesId, period: '2001-03', agentUsernameSnapshot: salesId, agentDisplayNameSnapshot: '补收测试销售',
    }, select: { id: true } })).id;
  });

  afterAll(async () => {
    // 次月草稿可删；已确认的来源账单受触发器保护，按唯一前缀留在一次性库里。
    await db.agentMonthlyBillAdjustment.deleteMany({ where: { billId: nextBillId } }).catch(() => undefined);
    await db.agentMonthlyBill.deleteMany({ where: { id: nextBillId } }).catch(() => undefined);
  });

  const request = (direction: 'CREDIT' | 'SURCHARGE', amount: string) => createAgentMonthlyBillCredit({
    expectedBillId: sourceBillId, sourceItemId, direction, amount, reason: '核对后调整', idempotencyKey: randomUUID(),
  }, admin);
  const nextBill = () => db.agentMonthlyBill.findUniqueOrThrow({ where: { id: nextBillId },
    select: { memberSubtotal: true, adjustmentAmount: true, totalAmount: true, adjustments: { select: { amount: true }, orderBy: { createdAt: 'asc' } } } });

  it('allocates a surcharge on a confirmed source into the next DRAFT bill as a positive adjustment', async () => {
    await expect(request('SURCHARGE', '15.00')).resolves.toMatchObject({ requestedAmount: '15.00', allocatedBillIds: [nextBillId] });
    const bill = await nextBill();
    expect([bill.memberSubtotal, bill.adjustmentAmount, bill.totalAmount].map((value) => value.toFixed(2))).toEqual(['0.00', '15.00', '15.00']);
  });

  it('lets a later credit use the surcharge, but never past a zero net for the source order', async () => {
    await expect(request('CREDIT', '115.00')).resolves.toMatchObject({ requestedAmount: '-115.00' });
    const bill = await nextBill();
    // 本月只有补收的 15 元额度可抵扣，剩余 100 元抵扣留待以后的账单。
    expect(bill.adjustments.map((row) => row.amount.toFixed(2))).toEqual(['15.00', '-15.00']);
    expect(bill.totalAmount.toFixed(2)).toBe('0.00');
    await expect(request('CREDIT', '0.01')).rejects.toThrow('累计抵扣不能超过来源工单的结算金额（含已补收）');
  });

  it('rejects an allocation whose direction differs from its credit at the database', async () => {
    const surcharge = await db.agentMonthlyBillCredit.findFirstOrThrow({ where: { sourceItemId, requestedAmount: { gt: 0 } }, select: { id: true } });
    await expect(db.agentMonthlyBillAdjustment.create({ data: { billId: nextBillId, creditId: surcharge.id, amount: '-1.00' } }))
      .rejects.toThrow(/same direction|Credit allocation/);
  });
});
