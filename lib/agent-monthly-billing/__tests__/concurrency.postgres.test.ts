import 'dotenv/config';

import { randomBytes } from 'node:crypto';
import { Client } from 'pg';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { SETTLEMENT_CUTOFF_LOCK_KEY } from '@/lib/finance/settlement-cutoff-lock';
import {
  agentBillLockKey,
  agentBillRequestLockKey,
  agentPeriodLockKey,
} from '../locks';

const databaseUrl = process.env.DATABASE_URL;
const postgresDescribe = databaseUrl ? describe : describe.skip;

function quoteIdentifier(value: string): string {
  return `"${value.replaceAll('"', '""')}"`;
}

const letPeerReachLock = () =>
  new Promise<void>((resolve) => setTimeout(resolve, 35));

postgresDescribe.sequential(
  'agent monthly billing v2 lock protocol · PostgreSQL concurrency',
  () => {
    const schema = `agent_bill_race_${randomBytes(8).toString('hex')}`;
    const quotedSchema = quoteIdentifier(schema);
    const first = new Client({ connectionString: databaseUrl });
    const second = new Client({ connectionString: databaseUrl });
    const observer = new Client({ connectionString: databaseUrl });

    const cutoffExclusive = (client: Client) =>
      client.query('SELECT pg_advisory_xact_lock(hashtext($1))', [
        SETTLEMENT_CUTOFF_LOCK_KEY,
      ]);
    const cutoffShared = (client: Client) =>
      client.query('SELECT pg_advisory_xact_lock_shared(hashtext($1))', [
        SETTLEMENT_CUTOFF_LOCK_KEY,
      ]);
    const periodLock = (client: Client, period = '2026-05') =>
      client.query('SELECT pg_advisory_xact_lock(hashtext($1))', [
        agentPeriodLockKey('agent-1', period),
      ]);
    const billLock = (client: Client, billId = 'bill-1') =>
      client.query('SELECT pg_advisory_xact_lock(hashtext($1))', [
        agentBillLockKey(billId),
      ]);
    const requestLock = (
      client: Client,
      kind: 'credit' | 'receipt' | 'confirm',
      key: string,
    ) =>
      client.query('SELECT pg_advisory_xact_lock(hashtext($1))', [
        agentBillRequestLockKey(kind, key),
      ]);

    beforeAll(async () => {
      await Promise.all([first.connect(), second.connect(), observer.connect()]);
      await first.query(`CREATE SCHEMA ${quotedSchema}`);
      for (const client of [first, second, observer]) {
        await client.query(`SET search_path TO ${quotedSchema}, public`);
        await client.query(`SET statement_timeout TO '5s'`);
      }
      await first.query(`
        CREATE TABLE bills (
          id TEXT PRIMARY KEY,
          agent_id TEXT NOT NULL,
          period VARCHAR(7) NOT NULL,
          status TEXT NOT NULL DEFAULT 'DRAFT',
          total NUMERIC(12,2) NOT NULL DEFAULT 0,
          UNIQUE (agent_id, period)
        );
        CREATE TABLE orders (
          id TEXT PRIMARY KEY,
          agent_id TEXT NOT NULL,
          status TEXT NOT NULL,
          settled_fee NUMERIC(12,2),
          settled_at TIMESTAMPTZ
        );
        CREATE TABLE bill_members (
          bill_id TEXT NOT NULL,
          order_id TEXT NOT NULL UNIQUE,
          amount NUMERIC(12,2) NOT NULL,
          UNIQUE (bill_id, order_id)
        );
        CREATE TABLE receipts (
          bill_id TEXT NOT NULL UNIQUE,
          idempotency_key TEXT NOT NULL UNIQUE,
          amount NUMERIC(12,2) NOT NULL
        );
        CREATE TABLE credits (
          id TEXT PRIMARY KEY,
          source_item_id TEXT NOT NULL,
          idempotency_key TEXT NOT NULL UNIQUE,
          amount NUMERIC(12,2) NOT NULL
        );
      `);
    });

    beforeEach(async () => {
      await Promise.all(
        [first, second].map((client) =>
          client.query('ROLLBACK').catch(() => undefined),
        ),
      );
      await observer.query(
        'TRUNCATE credits, receipts, bill_members, orders, bills',
      );
    });

    afterAll(async () => {
      await Promise.all(
        [first, second, observer].map((client) =>
          client.query('ROLLBACK').catch(() => undefined),
        ),
      );
      await observer.query('RESET search_path').catch(() => undefined);
      await observer
        .query(`DROP SCHEMA IF EXISTS ${quotedSchema} CASCADE`)
        .catch(() => undefined);
      await Promise.all([first.end(), second.end(), observer.end()]);
    });

    it('双生成：全局 cutoff 串行化后仍只保留一张 agent-period 账单', async () => {
      await Promise.all([first.query('BEGIN'), second.query('BEGIN')]);
      await cutoffExclusive(first);
      await periodLock(first);
      await first.query(
        `INSERT INTO bills (id, agent_id, period) VALUES ('bill-1', 'agent-1', '2026-05')`,
      );

      let secondAcquired = false;
      const waiting = cutoffExclusive(second).then(() => {
        secondAcquired = true;
      });
      await letPeerReachLock();
      expect(secondAcquired).toBe(false);
      await first.query('COMMIT');
      await waiting;
      await periodLock(second);
      await second.query(
        `INSERT INTO bills (id, agent_id, period)
         VALUES ('bill-2', 'agent-1', '2026-05')
         ON CONFLICT (agent_id, period) DO NOTHING`,
      );
      await second.query('COMMIT');

      const rows = await observer.query<{ id: string }>(
        `SELECT id FROM bills ORDER BY id`,
      );
      expect(rows.rows).toEqual([{ id: 'bill-1' }]);
    });

    it('生成↔确认：确认等待生成提交并冻结最新合计', async () => {
      await observer.query(
        `INSERT INTO bills (id, agent_id, period) VALUES ('bill-1', 'agent-1', '2026-05')`,
      );
      await Promise.all([first.query('BEGIN'), second.query('BEGIN')]);
      await cutoffExclusive(first);
      await periodLock(first);
      await billLock(first);
      await first.query(`UPDATE bills SET total = 125.50 WHERE id = 'bill-1'`);

      let confirmAcquired = false;
      const confirmCutoff = cutoffExclusive(second).then(() => {
        confirmAcquired = true;
      });
      await letPeerReachLock();
      expect(confirmAcquired).toBe(false);
      await first.query('COMMIT');
      await confirmCutoff;
      await periodLock(second);
      await billLock(second);
      await requestLock(second, 'confirm', 'confirm-1');
      const fresh = await second.query<{ total: string }>(
        `SELECT total::text AS total FROM bills WHERE id = 'bill-1'`,
      );
      await second.query(
        `UPDATE bills SET status = 'CONFIRMED' WHERE id = 'bill-1'`,
      );
      await second.query('COMMIT');
      expect(fresh.rows).toEqual([{ total: '125.50' }]);
    });

    it('确认↔结算：共享结算先提交时，独占确认扫描不会漏单', async () => {
      await observer.query(`
        INSERT INTO bills (id, agent_id, period) VALUES ('bill-1', 'agent-1', '2026-05');
        INSERT INTO orders (id, agent_id, status) VALUES ('order-1', 'agent-1', 'SHIPPED');
      `);
      await Promise.all([first.query('BEGIN'), second.query('BEGIN')]);
      await cutoffShared(first);
      await first.query(
        `UPDATE orders
            SET status = 'SETTLED', settled_fee = 88,
                settled_at = '2026-05-31T15:59:59.999Z'
          WHERE id = 'order-1'`,
      );

      let confirmAcquired = false;
      const confirmCutoff = cutoffExclusive(second).then(() => {
        confirmAcquired = true;
      });
      await letPeerReachLock();
      expect(confirmAcquired).toBe(false);
      await first.query('COMMIT');
      await confirmCutoff;
      await periodLock(second);
      await billLock(second);
      await second.query(`
        INSERT INTO bill_members (bill_id, order_id, amount)
        SELECT 'bill-1', id, settled_fee
          FROM orders
         WHERE agent_id = 'agent-1'
           AND status IN ('SETTLED', 'CANCELLED')
           AND settled_at >= '2026-04-30T16:00:00Z'
           AND settled_at <  '2026-05-31T16:00:00Z';
        UPDATE bills
           SET total = (SELECT COALESCE(sum(amount), 0) FROM bill_members WHERE bill_id = 'bill-1'),
               status = 'CONFIRMED'
         WHERE id = 'bill-1';
      `);
      await second.query('COMMIT');
      const bill = await observer.query<{ total: string; members: number }>(`
        SELECT total::text AS total,
               (SELECT count(*)::int FROM bill_members WHERE bill_id = bills.id) AS members
          FROM bills WHERE id = 'bill-1'
      `);
      expect(bill.rows).toEqual([{ total: '88.00', members: 1 }]);
    });

    it('双标记已收：共享 cutoff 下依次锁 bill，仅一张全额回执', async () => {
      await observer.query(
        `INSERT INTO bills (id, agent_id, period, status, total)
         VALUES ('bill-1', 'agent-1', '2026-05', 'CONFIRMED', 100)`,
      );
      await Promise.all([first.query('BEGIN'), second.query('BEGIN')]);
      await Promise.all([cutoffShared(first), cutoffShared(second)]);
      await periodLock(first);
      let secondPeriodAcquired = false;
      const waitingPeriod = periodLock(second).then(() => {
        secondPeriodAcquired = true;
      });
      await letPeerReachLock();
      expect(secondPeriodAcquired).toBe(false);
      await billLock(first);
      await requestLock(first, 'receipt', 'receipt-a');
      await first.query(`
        INSERT INTO receipts (bill_id, idempotency_key, amount)
        SELECT id, 'receipt-a', total FROM bills WHERE id = 'bill-1';
        UPDATE bills SET status = 'PAID' WHERE id = 'bill-1';
      `);
      await first.query('COMMIT');
      await waitingPeriod;
      await billLock(second);
      await requestLock(second, 'receipt', 'receipt-b');
      const state = await second.query<{ status: string }>(
        `SELECT status FROM bills WHERE id = 'bill-1'`,
      );
      if (state.rows[0]?.status !== 'PAID') {
        await second.query(
          `INSERT INTO receipts (bill_id, idempotency_key, amount)
           SELECT id, 'receipt-b', total FROM bills WHERE id = 'bill-1'`,
        );
      }
      await second.query('COMMIT');
      const receipts = await observer.query<{ count: number; amount: string }>(
        `SELECT count(*)::int AS count, max(amount)::text AS amount FROM receipts`,
      );
      expect(receipts.rows).toEqual([{ count: 1, amount: '100.00' }]);
    });

    it('双负项：同一来源串行审批，累计值不得突破成员快照', async () => {
      await observer.query(
        `INSERT INTO bills (id, agent_id, period, status, total)
         VALUES ('bill-1', 'agent-1', '2026-05', 'PAID', 100)`,
      );
      await Promise.all([first.query('BEGIN'), second.query('BEGIN')]);
      await Promise.all([cutoffShared(first), cutoffShared(second)]);
      await periodLock(first);
      const waitingPeriod = periodLock(second);
      await billLock(first);
      await requestLock(first, 'credit', 'credit-a');
      await first.query(
        `INSERT INTO credits (id, source_item_id, idempotency_key, amount)
         VALUES ('credit-1', 'item-1', 'credit-a', -60)`,
      );
      await first.query('COMMIT');
      await waitingPeriod;
      await billLock(second);
      await requestLock(second, 'credit', 'credit-b');
      const requested = await second.query<{ amount: string }>(
        `SELECT COALESCE(sum(amount), 0)::text AS amount
           FROM credits WHERE source_item_id = 'item-1'`,
      );
      if (Number(requested.rows[0]?.amount ?? 0) - 50 >= -100) {
        await second.query(
          `INSERT INTO credits (id, source_item_id, idempotency_key, amount)
           VALUES ('credit-2', 'item-1', 'credit-b', -50)`,
        );
      }
      await second.query('COMMIT');
      const credits = await observer.query<{ count: number; amount: string }>(
        `SELECT count(*)::int AS count, sum(amount)::text AS amount FROM credits`,
      );
      expect(credits.rows).toEqual([{ count: 1, amount: '-60.00' }]);
    });

    it('月界结算↔扫描：扫描先锁时，等待者在过闸后取时并进入新月', async () => {
      await observer.query(
        `INSERT INTO orders (id, agent_id, status) VALUES ('order-1', 'agent-1', 'SHIPPED')`,
      );
      await Promise.all([first.query('BEGIN'), second.query('BEGIN')]);
      await cutoffExclusive(first);
      const mayScan = await first.query<{ count: number }>(`
        SELECT count(*)::int AS count FROM orders
         WHERE settled_at >= '2026-04-30T16:00:00Z'
           AND settled_at <  '2026-05-31T16:00:00Z'
      `);
      expect(mayScan.rows).toEqual([{ count: 0 }]);

      let settlementAcquired = false;
      const waitingSettlement = cutoffShared(second).then(() => {
        settlementAcquired = true;
      });
      await letPeerReachLock();
      expect(settlementAcquired).toBe(false);
      await first.query('COMMIT');
      await waitingSettlement;
      // Represents clock_timestamp() taken only after the shared gate returns:
      // exactly 00:00 on 1 June in Asia/Shanghai belongs to the new period.
      await second.query(`
        UPDATE orders
           SET status = 'SETTLED', settled_fee = 20,
               settled_at = '2026-05-31T16:00:00.000Z'
         WHERE id = 'order-1'
      `);
      await second.query('COMMIT');
      const periods = await observer.query<{ may: number; june: number }>(`
        SELECT
          count(*) FILTER (
            WHERE settled_at >= '2026-04-30T16:00:00Z'
              AND settled_at <  '2026-05-31T16:00:00Z'
          )::int AS may,
          count(*) FILTER (
            WHERE settled_at >= '2026-05-31T16:00:00Z'
              AND settled_at <  '2026-06-30T16:00:00Z'
          )::int AS june
        FROM orders
      `);
      expect(periods.rows).toEqual([{ may: 0, june: 1 }]);
    });
  },
);
