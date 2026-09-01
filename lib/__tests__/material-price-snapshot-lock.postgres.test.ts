import 'dotenv/config';

import { Client } from 'pg';
import { describe, expect, it, vi } from 'vitest';
import { TxDirection } from '../../generated/prisma/enums';
import { db } from '../db';
import { applyMaterialStockMovement } from '../material';
import { PRICE_RULE_SNAPSHOT_LOCK_KEY } from '../price/rule-snapshot-lock';

vi.mock('server-only', () => ({}));

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

  it('共享快照锁保护无行锁纸张读，目录写入在读事务后继续', async () => {
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
          `SELECT "id" FROM "Material" WHERE "id" = $1`,
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

  it('报价持有共享快照锁时，真实库存移动不等待 Material 行锁', async () => {
    if (!databaseUrl) return;
    const [paper, location, operator] = await Promise.all([
      db.material.findFirst({
        where: { category: 'PAPER', isActive: true },
        select: { id: true },
        orderBy: { id: 'asc' },
      }),
      db.warehouseLocation.findFirst({
        where: { isActive: true, warehouse: { isActive: true } },
        select: { id: true },
        orderBy: { id: 'asc' },
      }),
      db.user.findFirst({
        where: { isActive: true },
        select: { id: true },
        orderBy: { id: 'asc' },
      }),
    ]);
    if (!paper || !location || !operator) {
      throw new Error('并发回归测试需要 seed 后的在用纸张、库位和账号');
    }

    const reader = new Client({ connectionString: databaseUrl });
    await reader.connect();
    try {
      await reader.query('BEGIN');
      await reader.query(
        'SELECT pg_advisory_xact_lock_shared(hashtext($1))',
        [PRICE_RULE_SNAPSHOT_LOCK_KEY],
      );
      await reader.query('SELECT "id" FROM "Material" WHERE "id" = $1', [
        paper.id,
      ]);

      class RollbackMovement extends Error {}
      const movement = db
        .$transaction(
          async (tx) => {
            await tx.$executeRaw`SET LOCAL lock_timeout = '3s'`;
            await applyMaterialStockMovement(tx, {
              materialId: paper.id,
              locationId: location.id,
              direction: TxDirection.IN,
              quantity: '1',
              reasonType: 'QUOTE_LOCK_REGRESSION',
              unitCost: null,
              remark: '测试事务必须回滚',
              operatorId: operator.id,
            });
            throw new RollbackMovement();
          },
          { maxWait: 5_000, timeout: 5_000 },
        )
        .catch((error: unknown) => {
          if (!(error instanceof RollbackMovement)) throw error;
        });

      const observed = await Promise.race([
        movement.then(() => 'completed' as const),
        new Promise<'timeout'>((resolve) =>
          setTimeout(() => resolve('timeout'), 1_000),
        ),
      ]);
      await reader.query('ROLLBACK');
      await movement;
      expect(observed).toBe('completed');
    } finally {
      await reader.query('ROLLBACK').catch(() => undefined);
      await reader.end();
    }
  }, 10_000);
});
