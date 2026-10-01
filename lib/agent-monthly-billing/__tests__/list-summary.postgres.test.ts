import { randomUUID } from 'node:crypto';
import Decimal from 'decimal.js';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { Role } from '@/generated/prisma/enums';
import { db } from '@/lib/db';
import { listAgentMonthlyBills } from '../query';
import { listSalesMonthlyBills } from '../sales-query';

vi.mock('server-only', () => ({}));

// Writes real rows, so only run against a throwaway database (name segment e2e / test / ci).
const url = process.env.DATABASE_URL;
const disposable = Boolean(url && /(?:^|_)(?:e2e|test|ci)(?:_|$)/.test(new URL(url).pathname.slice(1)));
const postgres = disposable ? describe : describe.skip;

const prefix = `bill_summary_${randomUUID().replaceAll('-', '')}`;
const agentId = `${prefix}_sales`;
const BILL_COUNT = 35;
// DRAFT is the only status a bill may be inserted with (DB trigger), and DRAFT rows stay deletable.
const amounts = Array.from({ length: BILL_COUNT }, (_, index) => new Decimal(index + 1).times('10.01').toFixed(2));
const expectedTotal = amounts.reduce((sum, value) => sum.plus(value), new Decimal(0)).toFixed(2);

postgres.sequential('agent bill list summary · whole filtered population on PostgreSQL', () => {
  beforeAll(async () => {
    await db.user.create({ data: { id: agentId, username: agentId, displayName: '汇总测试销售', password: 'not-a-login-hash', role: Role.SALES } });
    await db.agentMonthlyBill.createMany({ data: amounts.map((amount, index) => ({
      id: `${prefix}_${index}`, agentUserId: agentId,
      period: `${2000 + Math.floor(index / 12)}-${String((index % 12) + 1).padStart(2, '0')}`,
      agentUsernameSnapshot: agentId, agentDisplayNameSnapshot: '汇总测试销售',
      memberSubtotal: amount, totalAmount: amount,
    })) });
  });

  afterAll(async () => {
    await db.agentMonthlyBill.deleteMany({ where: { agentUserId: agentId } });
    await db.user.delete({ where: { id: agentId } });
  });

  it('owner summary equals the sum across every page, not just the visible one', async () => {
    const first = await listAgentMonthlyBills({ agentUserId: agentId, page: 1 });
    expect(first.total).toBe(BILL_COUNT);
    expect(first.pageCount).toBe(2);
    const second = await listAgentMonthlyBills({ agentUserId: agentId, page: 2 });
    const pageSum = [...first.rows, ...second.rows].reduce((sum, row) => sum.plus(row.totalAmount.toString()), new Decimal(0)).toFixed(2);
    expect(pageSum).toBe(expectedTotal);
    expect(first.summary.DRAFT).toEqual({ amount: expectedTotal, count: BILL_COUNT });
    expect(second.summary).toEqual(first.summary);
  });

  it('sales summary is the same whole-population total for the signed-in account', async () => {
    const actor = { id: agentId, role: Role.SALES };
    const first = await listSalesMonthlyBills(actor, { page: '1' });
    const second = await listSalesMonthlyBills(actor, { page: '2' });
    expect(first.rows.length + second.rows.length).toBe(BILL_COUNT);
    expect(first.summary.DRAFT).toEqual({ amount: expectedTotal, count: BILL_COUNT });
    expect(second.summary).toEqual(first.summary);
  });
});
