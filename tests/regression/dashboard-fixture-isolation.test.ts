import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const database = vi.hoisted(() => ({
  connect: vi.fn(),
  query: vi.fn(),
  end: vi.fn(),
}));

vi.mock('pg', () => ({
  Client: class {
    connect = database.connect;
    query = database.query;
    end = database.end;
  },
}));

vi.mock('@playwright/test', () => ({ expect: vi.fn() }));

beforeEach(() => {
  vi.clearAllMocks();
  vi.stubEnv('E2E_ADMIN_PASSWORD', 'fixture-test-only');
  database.query.mockResolvedValue({ rowCount: 1, rows: [] });
});

afterEach(() => {
  vi.unstubAllEnvs();
});

describe('dashboard fixture isolation', () => {
  it('appends disjoint fixture populations without deleting or rewriting history', async () => {
    const { seedDashboardSnapshot } = await import('../e2e/_helpers');
    const options = { salesUserId: 'e2e-sales' };
    const first = await seedDashboardSnapshot(options);
    const second = await seedDashboardSnapshot(options);

    expect(second.fixtureRunId).not.toBe(first.fixtureRunId);
    expect(second.salesUserId).not.toBe(first.salesUserId);
    expect(second.outsourceId).not.toBe(first.outsourceId);
    const firstOrders = new Set([
      ...first.submittedOrderIds,
      ...first.completedOrderIds,
      first.shippedOrderId,
    ]);
    expect([
      ...second.submittedOrderIds,
      ...second.completedOrderIds,
      second.shippedOrderId,
    ].some((id) => firstOrders.has(id))).toBe(false);

    const statements = database.query.mock.calls.map(([sql]) => String(sql));
    expect(statements.some((sql) => /\b(?:DELETE|TRUNCATE|UPDATE)\b/i.test(sql))).toBe(false);
    expect(statements.filter((sql) => sql === 'COMMIT')).toHaveLength(2);
    expect(statements).not.toContain('ROLLBACK');
    // Fixture owners cannot sign in and cannot be cloned from a real account.
    const principalInsert = statements.find((sql) => sql.includes('INSERT INTO "User"'));
    expect(principalInsert).toContain('"displayName", FALSE');
    expect(principalInsert).toContain("username LIKE 'e2e-%'");
    expect(principalInsert).toContain('role = $3::"Role"');
  });

  it('rolls back a partial seed if a ledger insert fails', async () => {
    const { seedDashboardSnapshot } = await import('../e2e/_helpers');
    database.query.mockImplementation(async (sql: string) => {
      if (sql.includes('INSERT INTO "OutsourceOrder"')) throw new Error('fixture insert failed');
      return { rowCount: 1, rows: [] };
    });

    await expect(seedDashboardSnapshot({ salesUserId: 'e2e-sales' }))
      .rejects.toThrow('fixture insert failed');
    const statements = database.query.mock.calls.map(([sql]) => String(sql));
    expect(statements.at(-1)).toBe('ROLLBACK');
    expect(statements).not.toContain('COMMIT');
    expect(database.end).toHaveBeenCalledOnce();
  });

  it('refuses a source account outside the guarded E2E role', async () => {
    const { seedDashboardSnapshot } = await import('../e2e/_helpers');
    database.query.mockImplementation(async (sql: string) => ({
      rowCount: sql.includes('INSERT INTO "User"') ? 0 : 1,
      rows: [],
    }));

    await expect(seedDashboardSnapshot({ salesUserId: 'non-fixture-user' }))
      .rejects.toThrow('requires an E2E source user with the expected role');
    const statements = database.query.mock.calls.map(([sql]) => String(sql));
    expect(statements.at(-1)).toBe('ROLLBACK');
    expect(statements.some((sql) => sql.includes('INSERT INTO "Order"'))).toBe(false);
  });
});
