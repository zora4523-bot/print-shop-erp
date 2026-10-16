import { readFileSync } from 'node:fs';
import { Client } from 'pg';
import { describe, expect, it } from 'vitest';
import { isDisposableE2eDatabaseName, postgresDatabaseIdentity } from '../../scripts/lib/e2e-environment';

const databaseUrl = process.env.DATABASE_URL;
const identity = databaseUrl ? postgresDatabaseIdentity(databaseUrl) : null;
const databaseDescribe = identity && isDisposableE2eDatabaseName(identity.databaseName) ? describe : describe.skip;
const migration = readFileSync('prisma/migrations/20261008190000_search_task_index_readiness/migration.sql', 'utf8');
const oldIndex = 'public."ProductionTask_orderItemId_craftId_key"';
const currentIndex = 'public."ProductionTask_orderItemId_craftId_idx"';

databaseDescribe('search readiness forward migration · PostgreSQL', () => {
  it('repairs the retired index only, preserves other metadata and remains idempotent', async () => {
    const client = new Client({ connectionString: databaseUrl });
    await client.connect();
    try {
      await client.query('BEGIN');
      await client.query("SET LOCAL statement_timeout TO '10s'");
      const current = await client.query('SELECT * FROM app_ops.search_surface_candidate ORDER BY surface_key');
      const original = current.rows.find(row => row.surface_key === 'order-search-v1');
      expect(original).toBeDefined();
      const legacyIndexes = original.required_indexes.map((index: string) => index === currentIndex ? oldIndex : index);
      await client.query('UPDATE app_ops.search_surface_candidate SET required_indexes = $1 WHERE surface_key = $2', [legacyIndexes, 'order-search-v1']);
      const before = await client.query('SELECT missing_required_indexes FROM app_ops.search_index_readiness WHERE surface_key = $1', ['order-search-v1']);
      expect(before.rows[0].missing_required_indexes).toContain(oldIndex);

      expect((await client.query(migration)).rowCount).toBe(1);
      const repaired = await client.query('SELECT * FROM app_ops.search_surface_candidate ORDER BY surface_key');
      expect(repaired.rows).toEqual(current.rows.map(row => row.surface_key === 'order-search-v1' ? {
        ...row,
        required_indexes: legacyIndexes.map((index: string) => index === oldIndex ? currentIndex : index),
        updated_at: expect.any(Date),
      } : row));
      const after = await client.query('SELECT missing_required_indexes FROM app_ops.search_index_readiness WHERE surface_key = $1', ['order-search-v1']);
      expect(after.rows[0].missing_required_indexes).not.toContain(oldIndex);
      expect(after.rows[0].missing_required_indexes).not.toContain(currentIndex);
      expect((await client.query(migration)).rowCount).toBe(0);

      // 回滚恢复索引，验证预检仍能发现真正缺失的必需索引。
      await client.query('DROP INDEX public."ProductionTask_orderItemId_craftId_idx"');
      const missing = await client.query('SELECT missing_required_indexes FROM app_ops.search_index_readiness WHERE surface_key = $1', ['order-search-v1']);
      expect(missing.rows[0].missing_required_indexes).toContain(currentIndex);
    } finally {
      await client.query('ROLLBACK');
      await client.end();
    }
  });
});
