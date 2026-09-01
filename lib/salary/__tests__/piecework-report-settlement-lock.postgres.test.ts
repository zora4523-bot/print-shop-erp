import 'dotenv/config';

import { randomBytes } from 'node:crypto';
import { Client } from 'pg';
import { describe, expect, it } from 'vitest';
import {
  pieceworkReportingDayGateLockKey,
  pieceworkSettlementLockKey,
} from '../piecework-lock';
import { salaryIdentityLockKey } from '../hourly-lock';

const databaseUrl = process.env.DATABASE_URL;
const postgresDescribe = databaseUrl ? describe : describe.skip;

function quoteIdentifier(value: string): string {
  return `"${value.replaceAll('"', '""')}"`;
}

const letOtherConnectionReachLock = () =>
  new Promise<void>((resolve) => setTimeout(resolve, 25));

postgresDescribe.sequential(
  'piecework report/settlement reporter-day lock · PostgreSQL concurrency',
  () => {
    it('serializes both midnight commit orders without a stranded closed-day report', async () => {
      const schema = `piecework_day_lock_${randomBytes(8).toString('hex')}`;
      const quotedSchema = quoteIdentifier(schema);
      const reportClient = new Client({ connectionString: databaseUrl });
      const settlementClient = new Client({ connectionString: databaseUrl });
      const reporterId = `worker-${randomBytes(6).toString('hex')}`;
      // Represents transaction_timestamp() pinned just before Shanghai
      // midnight while the settlement begins just after midnight.
      const closingWorkDate = '2026-08-28';
      const lockKey = pieceworkSettlementLockKey(reporterId, closingWorkDate);

      await reportClient.connect();
      await settlementClient.connect();
      try {
        await reportClient.query(`CREATE SCHEMA ${quotedSchema}`);
        await reportClient.query(`SET search_path TO ${quotedSchema}, public`);
        await settlementClient.query(
          `SET search_path TO ${quotedSchema}, public`,
        );
        await reportClient.query(`SET statement_timeout TO '5s'`);
        await settlementClient.query(`SET statement_timeout TO '5s'`);
        await reportClient.query(`
          CREATE TABLE "ProductionReport" (
            "id" TEXT PRIMARY KEY,
            "reporterId" TEXT NOT NULL,
            "workDate" DATE NOT NULL
          )
        `);
        await reportClient.query(`
          CREATE TABLE "PieceworkSettlement" (
            "reporterId" TEXT NOT NULL,
            "workDate" DATE NOT NULL,
            "status" TEXT NOT NULL,
            PRIMARY KEY ("reporterId", "workDate")
          )
        `);

        // Settlement wins after midnight. The pre-midnight report waits on
        // the same closing-day key, then observes LOCKED and must roll back.
        await settlementClient.query('BEGIN');
        await reportClient.query('BEGIN');
        await settlementClient.query(
          'SELECT pg_advisory_xact_lock(hashtext($1))',
          [lockKey],
        );
        await settlementClient.query(
          `INSERT INTO "PieceworkSettlement" ("reporterId", "workDate", "status") VALUES ($1, $2, 'LOCKED')`,
          [reporterId, closingWorkDate],
        );
        let reportAcquired = false;
        const reportLock = reportClient
          .query('SELECT pg_advisory_xact_lock(hashtext($1))', [lockKey])
          .then(() => {
            reportAcquired = true;
          });
        await letOtherConnectionReachLock();
        expect(reportAcquired).toBe(false);
        await settlementClient.query('COMMIT');
        await reportLock;
        const frozen = await reportClient.query<{ status: string }>(
          `SELECT "status" FROM "PieceworkSettlement" WHERE "reporterId" = $1 AND "workDate" = $2`,
          [reporterId, closingWorkDate],
        );
        expect(frozen.rows).toEqual([{ status: 'LOCKED' }]);
        await reportClient.query('ROLLBACK');
        const noStrandedReport = await settlementClient.query(
          `SELECT 1 FROM "ProductionReport"`,
        );
        expect(noStrandedReport.rowCount).toBe(0);

        // Report wins before midnight. Settlement waits, then its post-lock
        // scan sees and freezes the committed report instead of missing it.
        await settlementClient.query(
          `DELETE FROM "PieceworkSettlement" WHERE "reporterId" = $1`,
          [reporterId],
        );
        await reportClient.query('BEGIN');
        await settlementClient.query('BEGIN');
        await reportClient.query(
          'SELECT pg_advisory_xact_lock(hashtext($1))',
          [lockKey],
        );
        await reportClient.query(
          `INSERT INTO "ProductionReport" ("id", "reporterId", "workDate") VALUES ('report-before-midnight', $1, $2)`,
          [reporterId, closingWorkDate],
        );
        let settlementAcquired = false;
        const settlementLock = settlementClient
          .query('SELECT pg_advisory_xact_lock(hashtext($1))', [lockKey])
          .then(() => {
            settlementAcquired = true;
          });
        await letOtherConnectionReachLock();
        expect(settlementAcquired).toBe(false);
        await reportClient.query('COMMIT');
        await settlementLock;
        const visibleReports = await settlementClient.query(
          `SELECT "id" FROM "ProductionReport" WHERE "reporterId" = $1 AND "workDate" = $2`,
          [reporterId, closingWorkDate],
        );
        expect(visibleReports.rows).toEqual([
          { id: 'report-before-midnight' },
        ]);
        await settlementClient.query(
          `INSERT INTO "PieceworkSettlement" ("reporterId", "workDate", "status") VALUES ($1, $2, 'LOCKED')`,
          [reporterId, closingWorkDate],
        );
        await settlementClient.query('COMMIT');
      } finally {
        await reportClient.query('ROLLBACK').catch(() => undefined);
        await settlementClient.query('ROLLBACK').catch(() => undefined);
        await reportClient.query('RESET search_path').catch(() => undefined);
        await settlementClient.query('RESET search_path').catch(() => undefined);
        await reportClient
          .query(`DROP SCHEMA IF EXISTS ${quotedSchema} CASCADE`)
          .catch(() => undefined);
        await reportClient.end();
        await settlementClient.end();
      }
    }, 15_000);

    it('closes the batch discovery gap in both reporting-day gate orders', async () => {
      const schema = `piecework_day_gate_${randomBytes(8).toString('hex')}`;
      const quotedSchema = quoteIdentifier(schema);
      const reportClient = new Client({ connectionString: databaseUrl });
      const batchClient = new Client({ connectionString: databaseUrl });
      const reporterId = `worker-${randomBytes(6).toString('hex')}`;
      const closingDate = '2026-08-28';
      const openDate = '2026-08-29';
      const closingGate = pieceworkReportingDayGateLockKey(closingDate);
      const openGate = pieceworkReportingDayGateLockKey(openDate);

      await reportClient.connect();
      await batchClient.connect();
      try {
        await reportClient.query(`CREATE SCHEMA ${quotedSchema}`);
        await reportClient.query(`SET search_path TO ${quotedSchema}, public`);
        await batchClient.query(`SET search_path TO ${quotedSchema}, public`);
        await reportClient.query(`SET statement_timeout TO '5s'`);
        await batchClient.query(`SET statement_timeout TO '5s'`);
        await reportClient.query(`
          CREATE TABLE "ProductionReport" (
            "id" TEXT PRIMARY KEY,
            "reporterId" TEXT NOT NULL,
            "workDate" DATE NOT NULL
          )
        `);

        // Report gate wins before midnight: batch discovery blocks on the day
        // gate, then sees the committed report when it finally scans.
        await reportClient.query('BEGIN');
        await batchClient.query('BEGIN');
        await reportClient.query(
          'SELECT pg_advisory_xact_lock(hashtext($1))',
          [closingGate],
        );
        await reportClient.query(
          `INSERT INTO "ProductionReport" ("id", "reporterId", "workDate") VALUES ('report-gate-first', $1, $2)`,
          [reporterId, closingDate],
        );
        let batchAcquired = false;
        const batchGate = batchClient
          .query('SELECT pg_advisory_xact_lock(hashtext($1))', [closingGate])
          .then(() => {
            batchAcquired = true;
          });
        await letOtherConnectionReachLock();
        expect(batchAcquired).toBe(false);
        await reportClient.query('COMMIT');
        await batchGate;
        const discovered = await batchClient.query(
          `SELECT "id" FROM "ProductionReport" WHERE "workDate" = $1`,
          [closingDate],
        );
        expect(discovered.rows).toEqual([{ id: 'report-gate-first' }]);
        await batchClient.query('COMMIT');

        await reportClient.query(`DELETE FROM "ProductionReport"`);

        // Batch gate wins: a transaction that began before midnight but had
        // not reached the gate sees the post-gate wall date, retains the old
        // gate, then moves forward to the new open-day gate before inserting.
        await reportClient.query('BEGIN');
        await reportClient.query('SELECT transaction_timestamp()');
        await batchClient.query('BEGIN');
        await batchClient.query(
          'SELECT pg_advisory_xact_lock(hashtext($1))',
          [closingGate],
        );
        const emptyScan = await batchClient.query(
          `SELECT "id" FROM "ProductionReport" WHERE "workDate" = $1`,
          [closingDate],
        );
        expect(emptyScan.rowCount).toBe(0);
        await batchClient.query('COMMIT');

        // Candidate was closingDate before the gate; the confirmed
        // clock_timestamp day is now represented by openDate.
        await reportClient.query(
          'SELECT pg_advisory_xact_lock(hashtext($1))',
          [closingGate],
        );
        await reportClient.query(
          'SELECT pg_advisory_xact_lock(hashtext($1))',
          [openGate],
        );
        await reportClient.query(
          'SELECT pg_advisory_xact_lock(hashtext($1))',
          [pieceworkSettlementLockKey(reporterId, openDate)],
        );
        await reportClient.query(
          `INSERT INTO "ProductionReport" ("id", "reporterId", "workDate") VALUES ('batch-gate-first', $1, $2)`,
          [reporterId, openDate],
        );
        await reportClient.query('COMMIT');

        const finalDays = await batchClient.query<{
          workDate: string;
        }>(
          `SELECT to_char("workDate", 'YYYY-MM-DD') AS "workDate" FROM "ProductionReport" ORDER BY "workDate"`,
        );
        expect(finalDays.rows).toEqual([{ workDate: openDate }]);
      } finally {
        await reportClient.query('ROLLBACK').catch(() => undefined);
        await batchClient.query('ROLLBACK').catch(() => undefined);
        await reportClient.query('RESET search_path').catch(() => undefined);
        await batchClient.query('RESET search_path').catch(() => undefined);
        await reportClient
          .query(`DROP SCHEMA IF EXISTS ${quotedSchema} CASCADE`)
          .catch(() => undefined);
        await reportClient.end();
        await batchClient.end();
      }
    }, 15_000);

    it('serializes piecework employment validation with account date edits', async () => {
      const schema = `piecework_identity_${randomBytes(8).toString('hex')}`;
      const quotedSchema = quoteIdentifier(schema);
      const reportClient = new Client({ connectionString: databaseUrl });
      const accountClient = new Client({ connectionString: databaseUrl });
      const reporterId = `worker-${randomBytes(6).toString('hex')}`;
      const identityKey = salaryIdentityLockKey(reporterId);
      const workDate = '2026-08-28';

      await reportClient.connect();
      await accountClient.connect();
      try {
        await reportClient.query(`CREATE SCHEMA ${quotedSchema}`);
        await reportClient.query(`SET search_path TO ${quotedSchema}, public`);
        await accountClient.query(`SET search_path TO ${quotedSchema}, public`);
        await reportClient.query(`SET statement_timeout TO '5s'`);
        await accountClient.query(`SET statement_timeout TO '5s'`);
        await reportClient.query(`
          CREATE TABLE "User" (
            "id" TEXT PRIMARY KEY,
            "employmentStartDate" DATE,
            "employmentEndDate" DATE
          )
        `);
        await reportClient.query(`
          CREATE TABLE "ProductionReport" (
            "id" TEXT PRIMARY KEY,
            "reporterId" TEXT NOT NULL,
            "workDate" DATE NOT NULL
          )
        `);
        await reportClient.query(
          `INSERT INTO "User" ("id", "employmentStartDate") VALUES ($1, DATE '2026-08-01')`,
          [reporterId],
        );

        // Account wins: report waits before reading employment and then sees
        // that the current work date is outside the newly committed interval.
        await accountClient.query('BEGIN');
        await reportClient.query('BEGIN');
        await accountClient.query(
          'SELECT pg_advisory_xact_lock(hashtext($1))',
          [identityKey],
        );
        await accountClient.query(
          `UPDATE "User" SET "employmentStartDate" = DATE '2026-08-29' WHERE "id" = $1`,
          [reporterId],
        );
        let reportAcquired = false;
        const reportIdentity = reportClient
          .query('SELECT pg_advisory_xact_lock(hashtext($1))', [identityKey])
          .then(() => {
            reportAcquired = true;
          });
        await letOtherConnectionReachLock();
        expect(reportAcquired).toBe(false);
        await accountClient.query('COMMIT');
        await reportIdentity;
        const excluded = await reportClient.query<{ covered: boolean }>(
          `SELECT $2::date BETWEEN COALESCE("employmentStartDate", DATE '-infinity') AND COALESCE("employmentEndDate", DATE 'infinity') AS "covered" FROM "User" WHERE "id" = $1`,
          [reporterId, workDate],
        );
        expect(excluded.rows).toEqual([{ covered: false }]);
        await reportClient.query('ROLLBACK');

        // Report wins: it validates and appends under identity; the account
        // edit waits and cannot retroactively change the in-flight decision.
        await accountClient.query(
          `UPDATE "User" SET "employmentStartDate" = DATE '2026-08-01' WHERE "id" = $1`,
          [reporterId],
        );
        await reportClient.query('BEGIN');
        await accountClient.query('BEGIN');
        await reportClient.query(
          'SELECT pg_advisory_xact_lock(hashtext($1))',
          [identityKey],
        );
        const covered = await reportClient.query<{ covered: boolean }>(
          `SELECT $2::date BETWEEN COALESCE("employmentStartDate", DATE '-infinity') AND COALESCE("employmentEndDate", DATE 'infinity') AS "covered" FROM "User" WHERE "id" = $1`,
          [reporterId, workDate],
        );
        expect(covered.rows).toEqual([{ covered: true }]);
        await reportClient.query(
          `INSERT INTO "ProductionReport" ("id", "reporterId", "workDate") VALUES ('valid-before-edit', $1, $2)`,
          [reporterId, workDate],
        );
        let accountAcquired = false;
        const accountIdentity = accountClient
          .query('SELECT pg_advisory_xact_lock(hashtext($1))', [identityKey])
          .then(() => {
            accountAcquired = true;
          });
        await letOtherConnectionReachLock();
        expect(accountAcquired).toBe(false);
        await reportClient.query('COMMIT');
        await accountIdentity;
        await accountClient.query(
          `UPDATE "User" SET "employmentStartDate" = DATE '2026-08-29' WHERE "id" = $1`,
          [reporterId],
        );
        await accountClient.query('COMMIT');

        const committed = await reportClient.query(
          `SELECT "id" FROM "ProductionReport" WHERE "id" = 'valid-before-edit'`,
        );
        expect(committed.rowCount).toBe(1);
      } finally {
        await reportClient.query('ROLLBACK').catch(() => undefined);
        await accountClient.query('ROLLBACK').catch(() => undefined);
        await reportClient.query('RESET search_path').catch(() => undefined);
        await accountClient.query('RESET search_path').catch(() => undefined);
        await reportClient
          .query(`DROP SCHEMA IF EXISTS ${quotedSchema} CASCADE`)
          .catch(() => undefined);
        await reportClient.end();
        await accountClient.end();
      }
    }, 15_000);
  },
);
