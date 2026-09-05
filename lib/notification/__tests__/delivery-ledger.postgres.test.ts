import { Client } from 'pg';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const { databaseBridge } = vi.hoisted(() => ({
  databaseBridge: { $executeRaw: vi.fn(), $queryRaw: vi.fn() },
}));

vi.mock('server-only', () => ({}));
vi.mock('@/lib/db', () => ({ db: databaseBridge }));

import {
  finalizeDurableDelivery,
  NotificationDeliveryLedgerError,
  recoverDurableDeliveryFinalization,
} from '../delivery-ledger';

// Opt in through the process environment. Every statement targets a
// transaction-local table/type; no application rows or schemas are modified.
const databaseUrl = process.env.DATABASE_URL;
const postgresDescribe = databaseUrl ? describe : describe.skip;
type ParameterizedSql = { text: string; values: unknown[] };
const input = {
  deliveryKey: 'notification:postgres-finalization-test',
  channelId: 'test-channel',
  attemptId: 'test-attempt',
  jobAttempt: 2,
  status: 'SUCCESS' as const,
  errorMessage: null,
  retryCount: 0,
  sent: true,
};

postgresDescribe.sequential('durable delivery finalization · PostgreSQL', () => {
  let client: Client | undefined;

  beforeEach(async () => {
    client = new Client({ connectionString: databaseUrl });
    await client.connect();
    await client.query('BEGIN');
    await client.query("SET LOCAL statement_timeout TO '10s'");
    await client.query('SET LOCAL search_path TO pg_temp');
    await client.query(`
      CREATE TYPE pg_temp."NotificationStatus" AS ENUM
        ('SENDING', 'SUCCESS', 'FAILED', 'RETRYING', 'UNKNOWN');
      CREATE TEMP TABLE "NotificationLog" (
        "deliveryKey" TEXT NOT NULL,
        "channelId" TEXT NOT NULL,
        "status" "NotificationStatus" NOT NULL,
        "errorMessage" TEXT,
        "retryCount" INTEGER NOT NULL DEFAULT 0,
        "sentAt" TIMESTAMPTZ,
        "deliveryAttemptId" TEXT,
        "deliveryJobAttempt" INTEGER,
        "deliveryStateVersion" INTEGER NOT NULL DEFAULT 0,
        "lastAttemptAt" TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
        "updatedAt" TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
        UNIQUE ("deliveryKey", "channelId")
      ) ON COMMIT DROP
    `);
    await client.query(`
      INSERT INTO "NotificationLog"
        ("deliveryKey", "channelId", "status", "deliveryAttemptId", "deliveryJobAttempt")
      VALUES ($1, $2, 'SENDING', $3, $4)
    `, [input.deliveryKey, input.channelId, input.attemptId, input.jobAttempt]);
    // Execute the production helpers' actual Prisma SQL and bound parameters
    // against PostgreSQL. SQL-text mocks cannot catch CASE parameter inference.
    databaseBridge.$executeRaw.mockReset().mockImplementation(async (sql: ParameterizedSql) => {
      return (await client!.query(sql.text, sql.values)).rowCount;
    });
    databaseBridge.$queryRaw.mockReset().mockImplementation(async (sql: ParameterizedSql) => {
      return (await client!.query(sql.text, sql.values)).rows;
    });
  });

  afterEach(async () => {
    if (!client) return;
    await client.query('ROLLBACK').catch(() => undefined);
    await client.end();
    client = undefined;
  });

  for (const method of ['finalize', 'recover'] as const) {
    it.each(['SUCCESS', 'FAILED', 'RETRYING', 'UNKNOWN'] as const)(
      `${method} persists %s without an untyped CASE expression`,
      async (status) => {
        const finalState = {
          ...input,
          status,
          sent: status === 'SUCCESS',
          errorMessage: status === 'SUCCESS' ? null : 'synthetic provider result',
          retryCount: 1,
        };
        if (method === 'finalize') {
          await expect(finalizeDurableDelivery(finalState)).resolves.toBeUndefined();
        } else {
          await expect(recoverDurableDeliveryFinalization(finalState)).resolves.toEqual({
            status,
            errorMessage: finalState.errorMessage,
          });
        }
        const { rows: [row] } = await client!.query('SELECT * FROM "NotificationLog"');
        expect(row).toMatchObject({
          status,
          errorMessage: finalState.errorMessage,
          retryCount: 1,
          deliveryAttemptId: null,
          deliveryJobAttempt: status === 'RETRYING' ? input.jobAttempt : null,
          deliveryStateVersion: 1,
        });
        expect(row.sentAt !== null).toBe(status === 'SUCCESS');
      },
    );
  }

  it('recovers an already committed success without replacing it with UNKNOWN', async () => {
    await finalizeDurableDelivery(input);
    await expect(recoverDurableDeliveryFinalization({
      ...input,
      status: 'UNKNOWN',
      errorMessage: 'synthetic lost database acknowledgement',
      sent: false,
    })).resolves.toEqual({ status: 'SUCCESS', errorMessage: null });
    const { rows: [row] } = await client!.query('SELECT * FROM "NotificationLog"');
    expect(row.deliveryStateVersion).toBe(1);
    expect(row.sentAt).not.toBeNull();
  });

  it('rejects an obsolete fencing token without changing the current reservation', async () => {
    await expect(finalizeDurableDelivery({ ...input, attemptId: 'obsolete-attempt' }))
      .rejects.toBeInstanceOf(NotificationDeliveryLedgerError);
    const { rows: [row] } = await client!.query('SELECT * FROM "NotificationLog"');
    expect(row).toMatchObject({ status: 'SENDING', deliveryStateVersion: 0 });
  });
});
