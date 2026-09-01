import 'dotenv/config';

import { randomBytes } from 'node:crypto';
import { Client } from 'pg';
import { describe, expect, it } from 'vitest';
import {
  hourlyPayrollLockKey,
  salaryIdentityLockKey,
} from '../hourly-lock';

const databaseUrl = process.env.DATABASE_URL;
const postgresDescribe = databaseUrl ? describe : describe.skip;

function quoteIdentifier(value: string): string {
  return `"${value.replaceAll('"', '""')}"`;
}

const waitForBlockedLock = () =>
  new Promise<void>((resolve) => setTimeout(resolve, 25));

postgresDescribe.sequential(
  'attendance/payroll worker-month lock · PostgreSQL concurrency',
  () => {
    it('serializes both commit orders without leaving a paid stale derivative', async () => {
      const schema = `hourly_attendance_lock_${randomBytes(8).toString('hex')}`;
      const quotedSchema = quoteIdentifier(schema);
      const attendanceClient = new Client({ connectionString: databaseUrl });
      const payrollClient = new Client({ connectionString: databaseUrl });
      const lockKey = hourlyPayrollLockKey(
        `worker-${randomBytes(6).toString('hex')}`,
        '2026-05',
      );

      await attendanceClient.connect();
      await payrollClient.connect();
      try {
        await attendanceClient.query(`CREATE SCHEMA ${quotedSchema}`);
        await attendanceClient.query(`SET search_path TO ${quotedSchema}, public`);
        await payrollClient.query(`SET search_path TO ${quotedSchema}, public`);
        await attendanceClient.query(`
          CREATE TABLE "HourlyWorkerPayroll" (
            "id" TEXT PRIMARY KEY,
            "isPaid" BOOLEAN NOT NULL
          )
        `);

        // Attendance wins: it invalidates the unpaid derivative while holding
        // the shared key. A mark-paid request that began from a stale id waits,
        // re-reads after the lock, and finds no row to freeze.
        await attendanceClient.query(
          `INSERT INTO "HourlyWorkerPayroll" ("id", "isPaid") VALUES ('p-1', FALSE)`,
        );
        await attendanceClient.query('BEGIN');
        await payrollClient.query('BEGIN');
        await attendanceClient.query(
          'SELECT pg_advisory_xact_lock(hashtext($1))',
          [lockKey],
        );
        await attendanceClient.query(
          `DELETE FROM "HourlyWorkerPayroll" WHERE "id" = 'p-1' AND "isPaid" = FALSE`,
        );

        let payrollAcquired = false;
        const payrollLock = payrollClient
          .query('SELECT pg_advisory_xact_lock(hashtext($1))', [lockKey])
          .then(() => {
            payrollAcquired = true;
          });
        await waitForBlockedLock();
        expect(payrollAcquired).toBe(false);
        await attendanceClient.query('COMMIT');
        await payrollLock;
        const invalidated = await payrollClient.query(
          `SELECT "id" FROM "HourlyWorkerPayroll" WHERE "id" = 'p-1'`,
        );
        expect(invalidated.rowCount).toBe(0);
        await payrollClient.query('COMMIT');

        // Mark-paid wins: attendance waits, then observes the paid row and
        // must reject instead of deleting its source facts.
        await attendanceClient.query(
          `INSERT INTO "HourlyWorkerPayroll" ("id", "isPaid") VALUES ('p-2', FALSE)`,
        );
        await payrollClient.query('BEGIN');
        await attendanceClient.query('BEGIN');
        await payrollClient.query(
          'SELECT pg_advisory_xact_lock(hashtext($1))',
          [lockKey],
        );
        await payrollClient.query(
          `UPDATE "HourlyWorkerPayroll" SET "isPaid" = TRUE WHERE "id" = 'p-2'`,
        );

        let attendanceAcquired = false;
        const attendanceLock = attendanceClient
          .query('SELECT pg_advisory_xact_lock(hashtext($1))', [lockKey])
          .then(() => {
            attendanceAcquired = true;
          });
        await waitForBlockedLock();
        expect(attendanceAcquired).toBe(false);
        await payrollClient.query('COMMIT');
        await attendanceLock;
        const paid = await attendanceClient.query<{ isPaid: boolean }>(
          `SELECT "isPaid" AS "isPaid" FROM "HourlyWorkerPayroll" WHERE "id" = 'p-2'`,
        );
        expect(paid.rows).toEqual([{ isPaid: true }]);
        await attendanceClient.query('ROLLBACK');
      } finally {
        await attendanceClient.query('ROLLBACK').catch(() => undefined);
        await payrollClient.query('ROLLBACK').catch(() => undefined);
        await attendanceClient.query('RESET search_path').catch(() => undefined);
        await payrollClient.query('RESET search_path').catch(() => undefined);
        await attendanceClient
          .query(`DROP SCHEMA IF EXISTS ${quotedSchema} CASCADE`)
          .catch(() => undefined);
        await attendanceClient.end();
        await payrollClient.end();
      }
    }, 15_000);

    it('serializes account identity changes before attendance snapshots', async () => {
      const schema = `salary_identity_lock_${randomBytes(8).toString('hex')}`;
      const quotedSchema = quoteIdentifier(schema);
      const attendanceClient = new Client({ connectionString: databaseUrl });
      const accountClient = new Client({ connectionString: databaseUrl });
      const workerId = `worker-${randomBytes(6).toString('hex')}`;
      const month = '2026-05';
      const identityKey = salaryIdentityLockKey(workerId);
      const monthKey = hourlyPayrollLockKey(workerId, month);

      await attendanceClient.connect();
      await accountClient.connect();
      try {
        await attendanceClient.query(`CREATE SCHEMA ${quotedSchema}`);
        await attendanceClient.query(`SET search_path TO ${quotedSchema}, public`);
        await accountClient.query(`SET search_path TO ${quotedSchema}, public`);
        await attendanceClient.query(`SET statement_timeout TO '5s'`);
        await accountClient.query(`SET statement_timeout TO '5s'`);
        await attendanceClient.query(`
          CREATE TABLE "User" (
            "id" TEXT PRIMARY KEY,
            "workerType" TEXT NOT NULL,
            "isActive" BOOLEAN NOT NULL
          )
        `);
        await attendanceClient.query(`
          CREATE TABLE "Attendance" (
            "id" TEXT PRIMARY KEY,
            "workerId" TEXT NOT NULL,
            "workerTypeSnapshot" TEXT NOT NULL
          )
        `);
        await attendanceClient.query(
          `INSERT INTO "User" ("id", "workerType", "isActive") VALUES ($1, 'CLEANER', TRUE)`,
          [workerId],
        );

        // Account wins: attendance waits before reading User and therefore
        // snapshots the committed new role, never the pre-lock CLEANER value.
        await accountClient.query('BEGIN');
        await attendanceClient.query('BEGIN');
        await accountClient.query(
          'SELECT pg_advisory_xact_lock(hashtext($1))',
          [identityKey],
        );
        await accountClient.query(
          `UPDATE "User" SET "workerType" = 'COOK' WHERE "id" = $1`,
          [workerId],
        );
        let attendanceAcquired = false;
        const attendanceIdentityLock = attendanceClient
          .query('SELECT pg_advisory_xact_lock(hashtext($1))', [identityKey])
          .then(() => {
            attendanceAcquired = true;
          });
        await waitForBlockedLock();
        expect(attendanceAcquired).toBe(false);
        await accountClient.query('COMMIT');
        await attendanceIdentityLock;
        await attendanceClient.query(
          'SELECT pg_advisory_xact_lock(hashtext($1))',
          [monthKey],
        );
        const afterAccount = await attendanceClient.query<{
          workerType: string;
        }>(`SELECT "workerType" FROM "User" WHERE "id" = $1`, [workerId]);
        await attendanceClient.query(
          `INSERT INTO "Attendance" ("id", "workerId", "workerTypeSnapshot") VALUES ('after-account', $1, $2)`,
          [workerId, afterAccount.rows[0]!.workerType],
        );
        await attendanceClient.query('COMMIT');
        expect(afterAccount.rows).toEqual([{ workerType: 'COOK' }]);

        // Attendance wins: it reads and writes the identity snapshot while
        // holding identity -> month. The account change waits and cannot alter
        // that already-committed historical fact.
        await attendanceClient.query(
          `UPDATE "User" SET "workerType" = 'CLEANER' WHERE "id" = $1`,
          [workerId],
        );
        await attendanceClient.query('BEGIN');
        await accountClient.query('BEGIN');
        await attendanceClient.query(
          'SELECT pg_advisory_xact_lock(hashtext($1))',
          [identityKey],
        );
        await attendanceClient.query(
          'SELECT pg_advisory_xact_lock(hashtext($1))',
          [monthKey],
        );
        const beforeAccount = await attendanceClient.query<{
          workerType: string;
        }>(`SELECT "workerType" FROM "User" WHERE "id" = $1`, [workerId]);
        await attendanceClient.query(
          `INSERT INTO "Attendance" ("id", "workerId", "workerTypeSnapshot") VALUES ('before-account', $1, $2)`,
          [workerId, beforeAccount.rows[0]!.workerType],
        );
        let accountAcquired = false;
        const accountIdentityLock = accountClient
          .query('SELECT pg_advisory_xact_lock(hashtext($1))', [identityKey])
          .then(() => {
            accountAcquired = true;
          });
        await waitForBlockedLock();
        expect(accountAcquired).toBe(false);
        await attendanceClient.query('COMMIT');
        await accountIdentityLock;
        await accountClient.query(
          `UPDATE "User" SET "workerType" = 'COOK' WHERE "id" = $1`,
          [workerId],
        );
        await accountClient.query('COMMIT');
        const historical = await attendanceClient.query<{
          workerTypeSnapshot: string;
        }>(
          `SELECT "workerTypeSnapshot" FROM "Attendance" WHERE "id" = 'before-account'`,
        );
        expect(historical.rows).toEqual([
          { workerTypeSnapshot: 'CLEANER' },
        ]);
      } finally {
        await attendanceClient.query('ROLLBACK').catch(() => undefined);
        await accountClient.query('ROLLBACK').catch(() => undefined);
        await attendanceClient.query('RESET search_path').catch(() => undefined);
        await accountClient.query('RESET search_path').catch(() => undefined);
        await attendanceClient
          .query(`DROP SCHEMA IF EXISTS ${quotedSchema} CASCADE`)
          .catch(() => undefined);
        await attendanceClient.end();
        await accountClient.end();
      }
    }, 15_000);

    it('serializes account payroll invalidation against mark-paid in both commit orders', async () => {
      const schema = `account_payroll_lock_${randomBytes(8).toString('hex')}`;
      const quotedSchema = quoteIdentifier(schema);
      const accountClient = new Client({ connectionString: databaseUrl });
      const payrollClient = new Client({ connectionString: databaseUrl });
      const workerId = `worker-${randomBytes(6).toString('hex')}`;
      const month = '2026-05';
      const identityKey = salaryIdentityLockKey(workerId);
      const monthKey = hourlyPayrollLockKey(workerId, month);

      await accountClient.connect();
      await payrollClient.connect();
      try {
        await accountClient.query(`CREATE SCHEMA ${quotedSchema}`);
        await accountClient.query(`SET search_path TO ${quotedSchema}, public`);
        await payrollClient.query(`SET search_path TO ${quotedSchema}, public`);
        await accountClient.query(`SET statement_timeout TO '5s'`);
        await payrollClient.query(`SET statement_timeout TO '5s'`);
        await accountClient.query(`
          CREATE TABLE "User" (
            "id" TEXT PRIMARY KEY,
            "employmentStartDate" DATE
          )
        `);
        await accountClient.query(`
          CREATE TABLE "HourlyWorkerPayroll" (
            "id" TEXT PRIMARY KEY,
            "workerId" TEXT NOT NULL,
            "month" TEXT NOT NULL,
            "isPaid" BOOLEAN NOT NULL,
            UNIQUE ("workerId", "month")
          )
        `);
        await accountClient.query(
          `INSERT INTO "User" ("id", "employmentStartDate") VALUES ($1, DATE '2026-05-01')`,
          [workerId],
        );

        // Account edit wins. mark-paid has already discovered the locator but
        // waits on the month key, then must re-read and find the row deleted.
        await accountClient.query(
          `INSERT INTO "HourlyWorkerPayroll" ("id", "workerId", "month", "isPaid") VALUES ('p-account-first', $1, $2, FALSE)`,
          [workerId, month],
        );
        await payrollClient.query('BEGIN');
        const staleLocator = await payrollClient.query(
          `SELECT "workerId", "month" FROM "HourlyWorkerPayroll" WHERE "id" = 'p-account-first'`,
        );
        expect(staleLocator.rowCount).toBe(1);
        await accountClient.query('BEGIN');
        await accountClient.query(
          'SELECT pg_advisory_xact_lock(hashtext($1))',
          [identityKey],
        );
        await accountClient.query(
          'SELECT pg_advisory_xact_lock(hashtext($1))',
          [monthKey],
        );
        await accountClient.query(
          `DELETE FROM "HourlyWorkerPayroll" WHERE "workerId" = $1 AND "isPaid" = FALSE`,
          [workerId],
        );
        await accountClient.query(
          `UPDATE "User" SET "employmentStartDate" = DATE '2026-05-15' WHERE "id" = $1`,
          [workerId],
        );
        let payrollAcquired = false;
        const payrollLock = payrollClient
          .query('SELECT pg_advisory_xact_lock(hashtext($1))', [monthKey])
          .then(() => {
            payrollAcquired = true;
          });
        await waitForBlockedLock();
        expect(payrollAcquired).toBe(false);
        await accountClient.query('COMMIT');
        await payrollLock;
        const deleted = await payrollClient.query(
          `SELECT "id" FROM "HourlyWorkerPayroll" WHERE "id" = 'p-account-first'`,
        );
        expect(deleted.rowCount).toBe(0);
        await payrollClient.query('COMMIT');

        // mark-paid wins. The account edit holds identity, waits for the same
        // month, then observes PAID and must roll back even though the new
        // boundary only removes the first half of that same payroll month.
        await accountClient.query(
          `UPDATE "User" SET "employmentStartDate" = DATE '2026-05-01' WHERE "id" = $1`,
          [workerId],
        );
        await accountClient.query(
          `INSERT INTO "HourlyWorkerPayroll" ("id", "workerId", "month", "isPaid") VALUES ('p-paid-first', $1, $2, FALSE)`,
          [workerId, month],
        );
        await payrollClient.query('BEGIN');
        await payrollClient.query(
          `SELECT "workerId", "month" FROM "HourlyWorkerPayroll" WHERE "id" = 'p-paid-first'`,
        );
        await payrollClient.query(
          'SELECT pg_advisory_xact_lock(hashtext($1))',
          [monthKey],
        );
        await payrollClient.query(
          `UPDATE "HourlyWorkerPayroll" SET "isPaid" = TRUE WHERE "id" = 'p-paid-first'`,
        );

        await accountClient.query('BEGIN');
        await accountClient.query(
          'SELECT pg_advisory_xact_lock(hashtext($1))',
          [identityKey],
        );
        const coordinates = await accountClient.query(
          `SELECT "month" FROM "HourlyWorkerPayroll" WHERE "workerId" = $1 ORDER BY "month"`,
          [workerId],
        );
        expect(coordinates.rows).toEqual([{ month }]);
        let accountMonthAcquired = false;
        const accountMonthLock = accountClient
          .query('SELECT pg_advisory_xact_lock(hashtext($1))', [monthKey])
          .then(() => {
            accountMonthAcquired = true;
          });
        await waitForBlockedLock();
        expect(accountMonthAcquired).toBe(false);
        await payrollClient.query('COMMIT');
        await accountMonthLock;
        const paidAfterLock = await accountClient.query<{ isPaid: boolean }>(
          `SELECT "isPaid" AS "isPaid" FROM "HourlyWorkerPayroll" WHERE "id" = 'p-paid-first'`,
        );
        expect(paidAfterLock.rows).toEqual([{ isPaid: true }]);
        // New employment would start on May 15, changing the paid month's
        // exact eligible-date intersection, so the implementation rejects and
        // rolls back instead of changing User.
        await accountClient.query('ROLLBACK');

        const finalFacts = await payrollClient.query<{
          employmentStartDate: string;
          isPaid: boolean;
        }>(
          `SELECT to_char(u."employmentStartDate", 'YYYY-MM-DD') AS "employmentStartDate", p."isPaid" AS "isPaid"
             FROM "User" u
             JOIN "HourlyWorkerPayroll" p ON p."workerId" = u."id"
            WHERE p."id" = 'p-paid-first'`,
        );
        expect(finalFacts.rows).toEqual([
          { employmentStartDate: '2026-05-01', isPaid: true },
        ]);
      } finally {
        await accountClient.query('ROLLBACK').catch(() => undefined);
        await payrollClient.query('ROLLBACK').catch(() => undefined);
        await accountClient.query('RESET search_path').catch(() => undefined);
        await payrollClient.query('RESET search_path').catch(() => undefined);
        await accountClient
          .query(`DROP SCHEMA IF EXISTS ${quotedSchema} CASCADE`)
          .catch(() => undefined);
        await accountClient.end();
        await payrollClient.end();
      }
    }, 15_000);
  },
);
