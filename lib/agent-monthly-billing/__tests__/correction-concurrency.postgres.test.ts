import { randomUUID } from 'node:crypto';
import Decimal from 'decimal.js';
import { Client } from 'pg';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { Role } from '@/generated/prisma/enums';
import { db } from '@/lib/db';
import { correctSettledOrder } from '@/lib/order/settled-correction';
import { confirmAgentMonthlyBill, createAgentMonthlyBillCredit } from '../commands';
import { agentBillCreditLockKey } from '../locks';

vi.mock('server-only', () => ({}));

// Codex 审查 P2：同一销售不同月份的草稿被并发重排时，跨月抵扣的分摊必须在持有来源锁
// 之后读取，否则后提交的一方按旧分摊多分、被触发器整笔拒绝。写真实数据，只在一次性库上跑。
const url = process.env.DATABASE_URL;
const disposable = Boolean(url && /(?:^|_)(?:e2e|test|ci)(?:_|$)/.test(new URL(url).pathname.slice(1)));
const postgres = disposable ? describe : describe.skip;

const prefix = `bill_race_${randomUUID().replaceAll('-', '').slice(0, 16)}`;
const adminId = `${prefix}_admin`;
const salesId = `${prefix}_sales`;
const admin = { id: adminId, role: Role.ADMIN };

async function settledOrder(suffix: string, amount: string, settledAt: Date) {
  return db.order.create({ data: {
    orderNo: `${prefix}-${suffix}`, customName: '并发更正', submitterId: salesId, createdById: adminId, submitterRole: 'SALES',
    settlementType: 'EXTERNAL_SALES', billingMode: 'CHARGE', status: 'SETTLED',
    priceRevision: 1, pricingStatus: 'ADMIN_CONFIRMED', pricingConfirmedAt: settledAt, pricingConfirmedById: adminId,
    processingAmount: amount, totalAmount: amount, confirmedFee: amount,
    settledFee: amount, settledAt, settlementContractVersion: 2, shippedAt: settledAt,
  }, select: { id: true, orderNo: true, revision: true, workOrderVersion: true } });
}

async function draftBill(period: string, order: Awaited<ReturnType<typeof settledOrder>>, amount: string, settledAt: Date) {
  const bill = await db.agentMonthlyBill.create({ data: {
    agentUserId: salesId, period, agentUsernameSnapshot: salesId, agentDisplayNameSnapshot: '并发测试销售',
    memberSubtotal: amount, totalAmount: amount,
  }, select: { id: true } });
  await db.agentMonthlyBillItem.create({ data: {
    billId: bill.id, orderId: order.id, orderNoSnapshot: order.orderNo, workOrderVersionSnapshot: order.workOrderVersion,
    orderStatusSnapshot: 'SETTLED', settledFeeSnapshot: amount, settledAtSnapshot: settledAt,
  } });
  return bill.id;
}

postgres.sequential('settled correction vs. cross-month credit allocation · PostgreSQL concurrency', () => {
  const draftIds: string[] = [];
  let may: Awaited<ReturnType<typeof settledOrder>>;
  let june: Awaited<ReturnType<typeof settledOrder>>;
  let creditId: string;

  beforeAll(async () => {
    await db.user.createMany({ data: [
      { id: adminId, username: adminId, displayName: '并发测试管理员', password: 'not-a-login-hash', role: Role.ADMIN },
      { id: salesId, username: salesId, displayName: '并发测试销售', password: 'not-a-login-hash', role: Role.SALES },
    ] });
    const aprilAt = new Date('2001-04-10T04:00:00.000Z');
    await settledOrder('apr', '300.00', aprilAt);
    const april = await db.agentMonthlyBill.create({ data: {
      agentUserId: salesId, period: '2001-04', agentUsernameSnapshot: salesId, agentDisplayNameSnapshot: '并发测试销售',
    }, select: { id: true } });
    await confirmAgentMonthlyBill(april.id, admin, randomUUID());
    const sourceItem = await db.agentMonthlyBillItem.findFirstOrThrow({ where: { billId: april.id }, select: { id: true } });

    const mayAt = new Date('2001-05-10T04:00:00.000Z');
    const juneAt = new Date('2001-06-10T04:00:00.000Z');
    may = await settledOrder('may', '100.00', mayAt);
    june = await settledOrder('jun', '50.00', juneAt);
    draftIds.push(await draftBill('2001-05', may, '100.00', mayAt), await draftBill('2001-06', june, '50.00', juneAt));

    // 抵扣 200：5 月可抵 100，6 月可抵 50，余 50 待后续账单。
    creditId = (await createAgentMonthlyBillCredit({ expectedBillId: april.id, sourceItemId: sourceItem.id, direction: 'CREDIT',
      amount: '200.00', reason: '并发测试抵扣', idempotencyKey: randomUUID() }, admin)).creditId;
  });

  afterAll(async () => {
    await db.agentMonthlyBillAdjustment.deleteMany({ where: { billId: { in: draftIds } } }).catch(() => undefined);
    await db.agentMonthlyBillItem.deleteMany({ where: { billId: { in: draftIds } } }).catch(() => undefined);
    await db.agentMonthlyBill.deleteMany({ where: { id: { in: draftIds } } }).catch(() => undefined);
  });

  it('lets two months be corrected at once without over-allocating the shared credit', async () => {
    const before = await db.agentMonthlyBillAdjustment.findMany({ where: { billId: { in: draftIds } }, select: { amount: true } });
    expect(before.reduce((sum, row) => sum.plus(row.amount.toString()), new Decimal(0)).toFixed(2)).toBe('-150.00');

    // 另一个连接先持有抵扣来源锁，让两笔更正都走到分摊这一步再一起放行：若分摊在取锁
    // 前读取，两边读到的都是更正前的分摊，后提交的一方会多分并被触发器拒绝。
    const holder = new Client({ connectionString: url });
    await holder.connect();
    try {
      await holder.query('BEGIN');
      await holder.query('SELECT pg_advisory_xact_lock(hashtext($1))', [agentBillCreditLockKey(creditId)]);
      const pending = Promise.allSettled([
        correctSettledOrder({ orderId: may.id, expectedRevision: may.revision, amount: '30.00', reason: '5 月少收', idempotencyKey: randomUUID() }, admin),
        correctSettledOrder({ orderId: june.id, expectedRevision: june.revision, amount: '30.00', reason: '6 月少收', idempotencyKey: randomUUID() }, admin),
      ]);
      const waiting = async () => (await holder.query<{ count: string }>(
        "SELECT count(*) FROM pg_locks WHERE locktype = 'advisory' AND NOT granted",
      )).rows[0]!.count;
      await vi.waitFor(async () => expect(Number(await waiting())).toBeGreaterThanOrEqual(2), { timeout: 15_000, interval: 100 });
      await holder.query('COMMIT');
      const results = await pending;
      expect(results.map((result) => result.status === 'rejected' ? String(result.reason) : result.status)).toEqual(['fulfilled', 'fulfilled']);
    } finally {
      await holder.query('ROLLBACK').catch(() => undefined);
      await holder.end();
    }

    const bills = await db.agentMonthlyBill.findMany({ where: { id: { in: draftIds } }, orderBy: { period: 'asc' },
      select: { memberSubtotal: true, adjustmentAmount: true, totalAmount: true } });
    // 结算更正后两个月可抵额度为 130 和 80，抵扣 200 全部分完，账单合计都不为负。
    const allocated = bills.reduce((sum, bill) => sum.plus(bill.adjustmentAmount.toString()), new Decimal(0));
    expect(allocated.toFixed(2)).toBe('-200.00');
    for (const bill of bills) {
      expect(new Decimal(bill.totalAmount.toString()).isNegative()).toBe(false);
      expect(new Decimal(bill.memberSubtotal.toString()).plus(bill.adjustmentAmount.toString()).toFixed(2)).toBe(bill.totalAmount.toFixed(2));
    }
  });
});
