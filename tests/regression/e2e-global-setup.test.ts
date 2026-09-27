import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const { createClient, query, connect, end } = vi.hoisted(() => ({
  createClient: vi.fn(), query: vi.fn(), connect: vi.fn(), end: vi.fn(),
}));
vi.mock('pg', () => ({ Client: class {
  constructor(options: unknown) { createClient(options); }
  query = query; connect = connect; end = end;
} }));
vi.mock('bcryptjs', () => ({ default: { hash: vi.fn().mockResolvedValue('fixture-hash') } }));

import globalSetup from '../e2e/global-setup';
import { E2E_PIECEWORK_RULES, E2E_PIECEWORK_SOURCE } from '../../scripts/lib/e2e-piecework';

beforeEach(() => {
  vi.clearAllMocks();
  vi.stubEnv('DATABASE_URL', 'postgresql://fixture:secret@localhost/erp_e2e_test');
  vi.stubEnv('E2E_DATABASE_URL', 'postgresql://fixture:secret@localhost/erp_e2e_test');
  vi.stubEnv('E2E_DATABASE_CONFIRM_DATABASE', 'erp_e2e_test');
  vi.stubEnv('E2E_ORIGINAL_DATABASE_TARGET', 'localhost:5432/ordinary');
  vi.stubEnv('E2E_APPEND_ONLY_DATABASE_ISOLATED', '1');
  vi.stubEnv('E2E_RELEASE_MODE', '1');
  query.mockResolvedValue({ rows: [] });
});
afterEach(() => vi.unstubAllEnvs());

describe('all E2E setup fails closed before any database connection', () => {
  it.each([
    ['E2E_DATABASE_URL', undefined], ['E2E_DATABASE_CONFIRM_DATABASE', 'incorrect'],
    ['E2E_APPEND_ONLY_DATABASE_ISOLATED', '0'],
    ['E2E_ORIGINAL_DATABASE_TARGET', 'localhost:5432/erp_e2e_test'],
  ])('does not initialize a DB client with invalid %s', async (key, value) => {
    vi.stubEnv(key!, value);
    await expect(globalSetup()).rejects.toThrow();
    expect(createClient).not.toHaveBeenCalled();
    expect(connect).not.toHaveBeenCalled();
    expect(query).not.toHaveBeenCalled();
  });

  it('refuses mismatched connected identity before user fixture writes', async () => {
    query.mockResolvedValueOnce({ rows: [{ database: 'wrong' }] });
    await expect(globalSetup()).rejects.toThrow('does not match');
    expect(query).toHaveBeenCalledTimes(1);
    expect(end).toHaveBeenCalledOnce();
  });

  it('fails release setup instead of allowing missing rates to turn report tests into skips', async () => {
    query.mockResolvedValueOnce({ rows: [{ database: 'erp_e2e_test' }] });
    await expect(globalSetup()).rejects.toThrow('all three fixture rates');
    expect(query).toHaveBeenCalledTimes(2);
    expect(query.mock.calls.some(([sql]) => String(sql).includes('INSERT'))).toBe(false);
  });

  it('writes users only after isolated identity and the effective three-rate prerequisite pass', async () => {
    query.mockResolvedValueOnce({ rows: [{ database: 'erp_e2e_test' }] });
    query.mockResolvedValueOnce({ rows: E2E_PIECEWORK_RULES.map((rule) => ({
      ...rule, bookId: 'test-price-book', sourceName: E2E_PIECEWORK_SOURCE, ruleSetSha256: 'a'.repeat(64),
    })) });
    await globalSetup();
    expect(query.mock.calls.filter(([sql]) => String(sql).includes('INSERT INTO "User"'))).toHaveLength(7);
    expect(end).toHaveBeenCalledOnce();
  });
});
