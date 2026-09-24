import { existsSync, readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

// Contract: every row that the migration chain registers in
// app_ops.sensitive_column_policy must point at a column that still exists in
// prisma/schema.prisma, or be removed by a later migration. Otherwise the
// readiness view reports `sensitive_policy_references_missing_columns` and
// /owner/pigsty can never become ready (2026-09-24 客服 / 厨师删表删列遗漏).

const MIGRATIONS_DIR = path.join(process.cwd(), 'prisma/migrations');
const PRUNE_MIGRATION = '20260924150000_prune_removed_sensitive_column_policies';

const REMOVED_POLICIES: ReadonlyArray<readonly [string, string]> = [
  ['HourlyWorkerPayroll', 'spareSalary'],
  ['SalaryPeriod', 'totalSales'],
  ['SalaryPeriod', 'initialSales'],
  ['SalaryPeriod', 'monthlyBase'],
  ['CustomerServiceCommission', 'totalSales'],
  ['CustomerServiceCommission', 'commissionAmount'],
  ['CustomerServiceCommission', 'monthlyBaseTotal'],
  ['CustomerServiceCommission', 'totalIncome'],
  ['CustomerServiceCommission', 'paidBase'],
  ['CustomerServiceCommission', 'paidCommission'],
];

function migrationNames(): string[] {
  return readdirSync(MIGRATIONS_DIR, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .sort();
}

function readMigration(name: string): string {
  return readFileSync(path.join(MIGRATIONS_DIR, name, 'migration.sql'), 'utf8');
}

/** (table, column) pairs inserted into sensitive_column_policy, in order. */
function insertedPolicies(sql: string): Array<[string, string]> {
  const out: Array<[string, string]> = [];
  const insert = /INSERT INTO app_ops\.sensitive_column_policy\s*\([^)]*\)\s*VALUES([\s\S]*?)ON CONFLICT/g;
  for (const match of sql.matchAll(insert)) {
    for (const row of match[1].matchAll(/\(\s*'([^']+)',\s*'([^']+)',/g)) {
      out.push([row[1], row[2]]);
    }
  }
  return out;
}

/** (table, column) pairs removed by a DELETE against sensitive_column_policy. */
function deletedPolicies(sql: string): Array<[string, string]> {
  const out: Array<[string, string]> = [];
  const del = /DELETE FROM app_ops\.sensitive_column_policy[\s\S]*?;/g;
  for (const match of sql.matchAll(del)) {
    for (const row of match[0].matchAll(/\(\s*'public',\s*'([^']+)',\s*'([^']+)'\s*\)/g)) {
      out.push([row[1], row[2]]);
    }
  }
  return out;
}

function schemaColumns(): Map<string, Set<string>> {
  const schema = readFileSync(path.join(process.cwd(), 'prisma/schema.prisma'), 'utf8');
  const models = new Map<string, Set<string>>();
  for (const match of schema.matchAll(/^model (\w+) \{([\s\S]*?)^\}/gm)) {
    const fields = new Set<string>();
    for (const line of match[2].split('\n')) {
      const field = /^\s{2}(\w+)\s+\S/.exec(line);
      if (field) fields.add(field[1]);
    }
    models.set(match[1], fields);
  }
  return models;
}

describe('sensitive column policy migrations', () => {
  it('never leaves a policy row pointing at a column the schema no longer has', () => {
    const live = new Map<string, [string, string]>();
    for (const name of migrationNames()) {
      const sql = readMigration(name);
      for (const pair of insertedPolicies(sql)) live.set(pair.join('.'), pair);
      for (const pair of deletedPolicies(sql)) live.delete(pair.join('.'));
    }
    expect(live.size).toBeGreaterThan(20);

    const models = schemaColumns();
    const dangling = [...live.values()]
      .filter(([table, column]) => !models.get(table)?.has(column))
      .map((pair) => pair.join('.'));
    expect(dangling).toEqual([]);
  });

  it('prunes exactly the policies of the removed 客服 / 厨师 payroll columns in a forward migration', () => {
    const names = migrationNames();
    expect(existsSync(path.join(MIGRATIONS_DIR, PRUNE_MIGRATION, 'migration.sql'))).toBe(true);
    expect(names.indexOf(PRUNE_MIGRATION)).toBeGreaterThan(
      names.indexOf('20260924110000_remove_customer_service_role'),
    );
    const sql = readMigration(PRUNE_MIGRATION);
    expect(new Set(deletedPolicies(sql).map((pair) => pair.join('.')))).toEqual(
      new Set(REMOVED_POLICIES.map((pair) => pair.join('.'))),
    );
    // Idempotent and conservative: only a policy whose column is really gone is
    // removed, and nothing else in the migration writes data or DDL.
    expect(sql).toMatch(/NOT EXISTS[\s\S]*information_schema\.columns/);
    expect(sql).not.toMatch(/\b(INSERT|UPDATE|ALTER|DROP|TRUNCATE)\b/);
  });
});
