import 'dotenv/config';

import { randomBytes } from 'node:crypto';
import { Client } from 'pg';
import { describe, expect, it } from 'vitest';
import { purchaseReceiptRequestLockKey } from '../purchase-locks';

const databaseUrl = process.env.DATABASE_URL;
const postgresDescribe = databaseUrl ? describe : describe.skip;

function quoteIdentifier(value: string): string {
  return `"${value.replaceAll('"', '""')}"`;
}

const waitForBlockedLock = () =>
  new Promise<void>((resolve) => setTimeout(resolve, 25));

postgresDescribe.sequential(
  'purchase receipt request idempotency · PostgreSQL concurrency',
  () => {
    it('serializes the same request key so a conflicting payload observes the committed original', async () => {
      const schema = `purchase_receipt_idem_${randomBytes(8).toString('hex')}`;
      const quotedSchema = quoteIdentifier(schema);
      const first = new Client({ connectionString: databaseUrl });
      const second = new Client({ connectionString: databaseUrl });
      const idempotencyKey = '00000000-0000-4000-8000-000000000099';
      const lockKey = purchaseReceiptRequestLockKey(idempotencyKey);
      const originalFingerprint = 'a'.repeat(64);
      const conflictingFingerprint = 'b'.repeat(64);

      await first.connect();
      await second.connect();
      try {
        await first.query(`CREATE SCHEMA ${quotedSchema}`);
        await first.query(`SET search_path TO ${quotedSchema}, public`);
        await second.query(`SET search_path TO ${quotedSchema}, public`);
        await first.query(`SET statement_timeout TO '5s'`);
        await second.query(`SET statement_timeout TO '5s'`);
        await first.query(`
          CREATE TABLE "PurchaseReceipt" (
            "id" TEXT PRIMARY KEY,
            "idempotencyKey" TEXT NOT NULL UNIQUE,
            "requestFingerprint" VARCHAR(64) NOT NULL
          )
        `);

        await first.query('BEGIN');
        await second.query('BEGIN');
        await first.query(
          'SELECT pg_advisory_xact_lock(hashtext($1))',
          [lockKey],
        );
        await first.query(
          `INSERT INTO "PurchaseReceipt" ("id", "idempotencyKey", "requestFingerprint")
           VALUES ('receipt-a', $1, $2)`,
          [idempotencyKey, originalFingerprint],
        );

        let secondAcquired = false;
        const secondLock = second
          .query('SELECT pg_advisory_xact_lock(hashtext($1))', [lockKey])
          .then(() => {
            secondAcquired = true;
          });
        await waitForBlockedLock();
        expect(secondAcquired).toBe(false);

        await first.query('COMMIT');
        await secondLock;
        const replay = await second.query<{ requestFingerprint: string }>(
          `SELECT "requestFingerprint"
             FROM "PurchaseReceipt"
            WHERE "idempotencyKey" = $1`,
          [idempotencyKey],
        );
        expect(replay.rows).toEqual([
          { requestFingerprint: originalFingerprint },
        ]);
        expect(replay.rows[0]?.requestFingerprint).not.toBe(
          conflictingFingerprint,
        );
        await second.query('ROLLBACK');

        const persistedCount = await first.query<{ count: string }>(
          `SELECT COUNT(*)::text AS count FROM "PurchaseReceipt"`,
        );
        expect(persistedCount.rows).toEqual([{ count: '1' }]);
      } finally {
        await first.query('ROLLBACK').catch(() => undefined);
        await second.query('ROLLBACK').catch(() => undefined);
        await first.query('RESET search_path').catch(() => undefined);
        await second.query('RESET search_path').catch(() => undefined);
        await first
          .query(`DROP SCHEMA IF EXISTS ${quotedSchema} CASCADE`)
          .catch(() => undefined);
        await first.end();
        await second.end();
      }
    }, 10_000);
  },
);
