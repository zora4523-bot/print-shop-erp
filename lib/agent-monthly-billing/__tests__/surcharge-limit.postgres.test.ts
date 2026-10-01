import { randomUUID } from 'node:crypto';
import { Client } from 'pg';
import { beforeAll, describe, expect, it, vi } from 'vitest';
import { Role } from '@/generated/prisma/enums';
import { db } from '@/lib/db';
import { confirmAgentMonthlyBill, createAgentMonthlyBillCredit } from '../commands';
import { agentSurchargeLockKey } from '../locks';

vi.mock('server-only', () => ({}));

// Codex 审查 P2：补收根记录不可改，必须保证一定分摊得出去。同一销售所有尚未进入已确认
// 账单的补收按最坏情况落进同一张草稿校验上限，并发录入按销售串行。写真实数据，只在一次性库上跑。
const url = process.env.DATABASE_URL;
const disposable = Boolean(url && /(?:^|_)(?:e2e|test|ci)(?:_|$)/.test(new URL(url).pathname.slice(1)));
const postgres = disposable ? describe : describe.skip;

const prefix = `bill_limit_${randomUUID().replaceAll('-', '').slice(0, 16)}`;
const adminId = `${prefix}_admin`;
const salesId = `${prefix}_sales`;
const admin = { id: adminId, role: Role.ADMIN };

postgres.sequential('agent bill surcharge storage limit · real schema', () => {
  // 两张来源工单分属 7 月、8 月两张已确认账单：并发录入时各自的账单锁不同，只有按销售的
  // 补收锁能把它们串起来。
  const sources: Array<{ billId: string; itemId: string }> = [];

  beforeAll(async () => {
    await db.user.createMany({ data: [
      { id: adminId, username: adminId, displayName: '上限测试管理员', password: 'not-a-login-hash', role: Role.ADMIN },
      { id: salesId, username: salesId, displayName: '上限测试销售', password: 'not-a-login-hash', role: Role.SALES },
    ] });
    for (const [suffix, period] of [['a', '2001-07'], ['b', '2001-08']] as const) {
      const settledAt = new Date(`${period}-10T04:00:00.000Z`);
      await db.order.create({ data: {
        orderNo: `${prefix}-${suffix}`, customName: '补收上限', submitterId: salesId, createdById: adminId, submitterRole: 'SALES',
        settlementType: 'EXTERNAL_SALES', billingMode: 'CHARGE', status: 'SETTLED',
        priceRevision: 1, pricingStatus: 'ADMIN_CONFIRMED', pricingConfirmedAt: settledAt, pricingConfirmedById: adminId,
        processingAmount: '100.00', totalAmount: '100.00', confirmedFee: '100.00',
        settledFee: '100.00', settledAt, settlementContractVersion: 2, shippedAt: settledAt,
      } });
      const billId = (await db.agentMonthlyBill.create({ data: {
        agentUserId: salesId, period, agentUsernameSnapshot: salesId, agentDisplayNameSnapshot: '上限测试销售',
      }, select: { id: true } })).id;
      await confirmAgentMonthlyBill(billId, admin, randomUUID());
      const itemId = (await db.agentMonthlyBillItem.findFirstOrThrow({ where: { billId }, select: { id: true } })).id;
      sources.push({ billId, itemId });
    }
  });

  const surcharge = (index: number, amount: string) => createAgentMonthlyBillCredit({
    expectedBillId: sources[index]!.billId, sourceItemId: sources[index]!.itemId, direction: 'SURCHARGE',
    amount, reason: '上限测试', idempotencyKey: randomUUID(),
  }, admin);

  it('counts pending surcharges recorded against other source orders of the same agent', async () => {
    await expect(surcharge(0, '6000000000.00')).resolves.toMatchObject({ requestedAmount: '6000000000.00' });
    await expect(surcharge(1, '6000000000.00')).rejects.toThrow('补收金额过大');
    expect(await db.agentMonthlyBillCredit.count({ where: { sourceItem: { bill: { agentUserId: salesId } } } })).toBe(1);
  });

  it('serializes concurrent surcharges for one agent across different source months', async () => {
    // 另一连接先持有该销售的补收锁：两笔请求必须都排在这把锁上（否则会各自读到同一个
    // 旧累计值一起通过）。已待分摊 60 亿，两笔各 30 亿，只能有一笔通过。
    const holder = new Client({ connectionString: url });
    await holder.connect();
    let results: PromiseSettledResult<unknown>[];
    try {
      await holder.query('BEGIN');
      await holder.query('SELECT pg_advisory_xact_lock(hashtext($1))', [agentSurchargeLockKey(salesId)]);
      const pending = Promise.allSettled([surcharge(0, '3000000000.00'), surcharge(1, '3000000000.00')]);
      await vi.waitFor(async () => {
        const waiting = await holder.query<{ count: string }>(
          "SELECT count(*) FROM pg_locks WHERE locktype = 'advisory' AND NOT granted",
        );
        expect(Number(waiting.rows[0]!.count)).toBeGreaterThanOrEqual(2);
      }, { timeout: 15_000, interval: 100 });
      await holder.query('COMMIT');
      results = await pending;
    } finally {
      await holder.query('ROLLBACK').catch(() => undefined);
      await holder.end();
    }
    expect(results.filter((result) => result.status === 'fulfilled')).toHaveLength(1);
    const rejected = results.find((result) => result.status === 'rejected');
    expect(String((rejected as PromiseRejectedResult).reason)).toContain('补收金额过大');
  });
});
