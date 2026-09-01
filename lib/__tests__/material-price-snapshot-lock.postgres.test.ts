import 'dotenv/config';

import { Client } from 'pg';
import { describe, expect, it } from 'vitest';
import { PRICE_RULE_SNAPSHOT_LOCK_KEY } from '../price/rule-snapshot-lock';

const databaseUrl = process.env.DATABASE_URL;
const postgresDescribe = databaseUrl ? describe : describe.skip;

postgresDescribe.sequential('material price-snapshot lock · PostgreSQL', () => {
  it('an exclusive catalog mutation waits for an in-flight shared quote snapshot', async () => {
    if (!databaseUrl) return;
    const reader = new Client({ connectionString: databaseUrl });
    const writer = new Client({ connectionString: databaseUrl });
    await Promise.all([reader.connect(), writer.connect()]);
    try {
      await reader.query('BEGIN');
      await reader.query(
        'SELECT pg_advisory_xact_lock_shared(hashtext($1))',
        [PRICE_RULE_SNAPSHOT_LOCK_KEY],
      );
      await writer.query('BEGIN');
      await writer.query(`SET LOCAL statement_timeout = '5000ms'`);

      let settled = false;
      const pendingWriteLock = writer
        .query('SELECT pg_advisory_xact_lock(hashtext($1))', [
          PRICE_RULE_SNAPSHOT_LOCK_KEY,
        ])
        .finally(() => {
          settled = true;
        });
      await new Promise((resolve) => setTimeout(resolve, 50));
      expect(settled).toBe(false);

      await reader.query('COMMIT');
      await expect(pendingWriteLock).resolves.toBeDefined();
      await writer.query('COMMIT');
    } finally {
      await reader.query('ROLLBACK').catch(() => undefined);
      await writer.query('ROLLBACK').catch(() => undefined);
      await Promise.all([reader.end(), writer.end()]);
    }
  });

  it('提交与停用都按 snapshot -> material row 顺序时不形成反向等待', async () => {
    if (!databaseUrl) return;
    const reader = new Client({ connectionString: databaseUrl });
    const writer = new Client({ connectionString: databaseUrl });
    await Promise.all([reader.connect(), writer.connect()]);
    try {
      const paper = await reader.query<{ id: string }>(
        `SELECT "id" FROM "Material"
         WHERE "category" = 'PAPER'::"MaterialCategory"
         ORDER BY "id" ASC
         LIMIT 1`,
      );
      const paperId = paper.rows[0]?.id;
      if (!paperId) return;

      await reader.query('BEGIN');
      await writer.query('BEGIN');
      await reader.query(`SET LOCAL statement_timeout = '5000ms'`);
      await writer.query(`SET LOCAL statement_timeout = '5000ms'`);
      await reader.query(
        'SELECT pg_advisory_xact_lock_shared(hashtext($1))',
        [PRICE_RULE_SNAPSHOT_LOCK_KEY],
      );

      let writerHasSnapshot = false;
      const writerSnapshot = writer
        .query('SELECT pg_advisory_xact_lock(hashtext($1))', [
          PRICE_RULE_SNAPSHOT_LOCK_KEY,
        ])
        .then(() => {
          writerHasSnapshot = true;
        });
      await new Promise((resolve) => setTimeout(resolve, 50));
      expect(writerHasSnapshot).toBe(false);

      await expect(
        reader.query(
          `SELECT "id" FROM "Material" WHERE "id" = $1 FOR SHARE`,
          [paperId],
        ),
      ).resolves.toMatchObject({ rowCount: 1 });

      await reader.query('COMMIT');
      await expect(writerSnapshot).resolves.toBeUndefined();
      await expect(
        writer.query(
          `UPDATE "Material" SET "isActive" = "isActive" WHERE "id" = $1`,
          [paperId],
        ),
      ).resolves.toMatchObject({ rowCount: 1 });
      await writer.query('ROLLBACK');
    } finally {
      await reader.query('ROLLBACK').catch(() => undefined);
      await writer.query('ROLLBACK').catch(() => undefined);
      await Promise.all([reader.end(), writer.end()]);
    }
  });
});
