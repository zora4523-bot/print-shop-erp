import 'dotenv/config';

import { randomBytes } from 'node:crypto';
import { Client } from 'pg';
import { describe, expect, it } from 'vitest';
import { salaryIdentityLockKey } from '../hourly-lock';

const databaseUrl = process.env.DATABASE_URL;
const postgresDescribe = databaseUrl ? describe : describe.skip;

function quoteIdentifier(value: string): string {
  return `"${value.replaceAll('"', '""')}"`;
}

const waitForBlockedLock = () =>
  new Promise<void>((resolve) => setTimeout(resolve, 25));

postgresDescribe.sequential(
  'attendance/account salary identity lock · PostgreSQL concurrency',
  () => {
    it('serializes account identity changes before attendance snapshots', async () => {
      const schema = `salary_identity_lock_${randomBytes(8).toString('hex')}`;
      const quotedSchema = quoteIdentifier(schema);
      const attendanceClient = new Client({ connectionString: databaseUrl });
      const accountClient = new Client({ connectionString: databaseUrl });
      const workerId = `worker-${randomBytes(6).toString('hex')}`;
      const identityKey = salaryIdentityLockKey(workerId);

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
          `INSERT INTO "User" ("id", "workerType", "isActive") VALUES ($1, 'PACKER', TRUE)`,
          [workerId],
        );

        // Account wins: attendance waits before reading User and therefore
        // snapshots the committed new role, never the pre-lock PACKER value.
        await accountClient.query('BEGIN');
        await attendanceClient.query('BEGIN');
        await accountClient.query(
          'SELECT pg_advisory_xact_lock(hashtext($1))',
          [identityKey],
        );
        await accountClient.query(
          `UPDATE "User" SET "workerType" = 'MACHINE' WHERE "id" = $1`,
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
        const afterAccount = await attendanceClient.query<{
          workerType: string;
        }>(`SELECT "workerType" FROM "User" WHERE "id" = $1`, [workerId]);
        await attendanceClient.query(
          `INSERT INTO "Attendance" ("id", "workerId", "workerTypeSnapshot") VALUES ('after-account', $1, $2)`,
          [workerId, afterAccount.rows[0]!.workerType],
        );
        await attendanceClient.query('COMMIT');
        expect(afterAccount.rows).toEqual([{ workerType: 'MACHINE' }]);

        // Attendance wins: it reads and writes the identity snapshot while
        // holding the identity lock. The account change waits and cannot alter
        // that already-committed historical fact.
        await attendanceClient.query(
          `UPDATE "User" SET "workerType" = 'PACKER' WHERE "id" = $1`,
          [workerId],
        );
        await attendanceClient.query('BEGIN');
        await accountClient.query('BEGIN');
        await attendanceClient.query(
          'SELECT pg_advisory_xact_lock(hashtext($1))',
          [identityKey],
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
          `UPDATE "User" SET "workerType" = 'MACHINE' WHERE "id" = $1`,
          [workerId],
        );
        await accountClient.query('COMMIT');
        const historical = await attendanceClient.query<{
          workerTypeSnapshot: string;
        }>(
          `SELECT "workerTypeSnapshot" FROM "Attendance" WHERE "id" = 'before-account'`,
        );
        expect(historical.rows).toEqual([
          { workerTypeSnapshot: 'PACKER' },
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
  },
);
