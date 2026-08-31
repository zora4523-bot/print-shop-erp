import { existsSync, readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const migrationsRoot = path.join(process.cwd(), 'prisma', 'migrations');
const retainedMigrationName =
  '20260822112100_create_notification_log_query_index';
const obsoleteMigrationNames = [
  '20260822111000_notification_log_query_indexes',
  '20260822112000_rebuild_notification_log_query_index',
] as const;

const schema = readFileSync(
  path.join(process.cwd(), 'prisma', 'schema.prisma'),
  'utf8',
);
const migration = readFileSync(
  path.join(
    migrationsRoot,
    retainedMigrationName,
    'migration.sql',
  ),
  'utf8',
);
const allMigrationSql = readdirSync(migrationsRoot, {
  withFileTypes: true,
})
  .filter((entry) => entry.isDirectory())
  .map((entry) => ({
    name: entry.name,
    sql: readFileSync(
      path.join(migrationsRoot, entry.name, 'migration.sql'),
      'utf8',
    ),
  }));

describe('NotificationLog recent-list query index', () => {
  it('keeps the Prisma schema aligned with the descending cursor order', () => {
    expect(schema).toContain(
      '@@index([lastAttemptAt(sort: Desc), id(sort: Desc)])',
    );
  });

  it('keeps only the final unapplied migration and builds the index once', () => {
    for (const name of obsoleteMigrationNames) {
      expect(existsSync(path.join(migrationsRoot, name))).toBe(false);
    }

    const builds = allMigrationSql.flatMap(({ name, sql }) =>
      (
        sql.match(
          /CREATE INDEX CONCURRENTLY(?:\s+IF NOT EXISTS)?\s+"NotificationLog_lastAttemptAt_id_idx"\s+ON "NotificationLog"\("lastAttemptAt" DESC, "id" DESC\);/g,
        ) ?? []
      ).map(() => name),
    );

    expect(builds).toEqual([retainedMigrationName]);
  });

  it('removes a failed-build artifact before requiring a fresh valid build', () => {
    const retryDrop =
      'DROP INDEX IF EXISTS "NotificationLog_lastAttemptAt_id_idx";';
    const retryCreate =
      'CREATE INDEX CONCURRENTLY "NotificationLog_lastAttemptAt_id_idx"';

    expect(
      migration.match(
        /DROP INDEX IF EXISTS "NotificationLog_lastAttemptAt_id_idx";/g,
      ),
    ).toHaveLength(1);
    expect(migration).toMatch(
      /CREATE INDEX CONCURRENTLY "NotificationLog_lastAttemptAt_id_idx"\s+ON "NotificationLog"\("lastAttemptAt" DESC, "id" DESC\);/,
    );
    expect(migration.indexOf(retryDrop)).toBeLessThan(
      migration.indexOf(retryCreate),
    );
    expect(migration).not.toMatch(
      /CREATE INDEX CONCURRENTLY IF NOT EXISTS/i,
    );
    expect(migration).not.toMatch(/DROP INDEX CONCURRENTLY/i);
    expect(migration).not.toMatch(
      /^\s*(?:BEGIN|COMMIT|START\s+TRANSACTION)\s*;/im,
    );
    expect(migration.match(/;/g)).toHaveLength(2);
  });
});
