import { describe, expect, it, vi } from 'vitest';
import type { Client } from 'pg';
import { migrateBlankBomTargets, parseBlankBomMigrationArgs } from '../migrate-blank-bom-targets';
const options = { databaseUrl: 'postgresql://localhost/disposable_test', apply: false, defaultCategoryId: undefined };
function clientFixture(existingSetting: unknown = undefined) {
  const query = vi.fn(async (sql: string) => {
    if (sql.startsWith('SELECT value')) return { rows: existingSetting === undefined ? [] : [{ value: existingSetting }] };
    return { rows: [] };
  });
  return { query, client: { query } as unknown as Pick<Client, 'query'> };
}
describe('blank BOM migration CLI safety', () => {
  it('requires explicit named database and defaults to read-only', () => {
    expect(() => parseBlankBomMigrationArgs([])).toThrow();
    expect(() => parseBlankBomMigrationArgs(['--database-url', 'postgresql://localhost/'])).toThrow();
    expect(() => parseBlankBomMigrationArgs(['--database-url', options.databaseUrl, '--default-category-id'])).toThrow();
    expect(parseBlankBomMigrationArgs(['--database-url', options.databaseUrl])).toMatchObject({ apply: false });
    expect(parseBlankBomMigrationArgs(['--database-url', options.databaseUrl, '--apply', '--default-category-id', 'node'])).toMatchObject({ apply: true, defaultCategoryId: 'node' });
  });
  it('read-only preflight cannot mutate and rolls back its snapshot', async () => {
    const { client, query } = clientFixture();
    expect(await migrateBlankBomTargets(client, options)).toMatchObject({ ready: true, applied: false, copies: [], defaultCategoryId: null });
    const sql = query.mock.calls.map(([statement]) => statement);
    expect(sql[0]).toBe('BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY');
    expect(sql.at(-1)).toBe('ROLLBACK');
    expect(sql.some((statement) => /^(INSERT|UPDATE|DELETE|LOCK)/.test(statement))).toBe(false);
  });
  it('refuses invalid configured default even with explicit apply', async () => {
    const { client, query } = clientFixture('missing');
    expect(await migrateBlankBomTargets(client, { ...options, apply: true })).toMatchObject({ ready: false, applied: false });
    const sql = query.mock.calls.map(([statement]) => statement);
    expect(sql.at(-1)).toBe('ROLLBACK');
    expect(sql.some((statement) => /^(INSERT|UPDATE|DELETE)/.test(statement))).toBe(false);
  });
  it('rolls back source read failures', async () => {
    const { client, query } = clientFixture();
    query.mockRejectedValueOnce(new Error('begin failed'));
    await expect(migrateBlankBomTargets(client, options)).rejects.toThrow('begin failed');
    const working = clientFixture();
    working.query.mockImplementation(async (sql: string) => {
      if (sql.startsWith('SELECT')) throw new Error('source unavailable');
      return { rows: [] };
    });
    await expect(migrateBlankBomTargets(working.client, options)).rejects.toThrow('source unavailable');
    expect(working.query).toHaveBeenLastCalledWith('ROLLBACK');
  });
});
