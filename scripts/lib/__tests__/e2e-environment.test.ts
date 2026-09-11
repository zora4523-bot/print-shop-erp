import { describe, expect, it } from 'vitest';
import { activateE2eDatabase, assertActivatedE2eDatabase, assertE2eDatabaseEnvironment,
  controlledE2eBaseUrl, postgresDatabaseIdentity } from '../e2e-environment';

function environment(): NodeJS.ProcessEnv {
  return { NODE_ENV: 'test', DATABASE_URL: 'postgresql://fixture:private@localhost:5432/ordinary',
    E2E_DATABASE_URL: 'postgresql://fixture:private@localhost:5432/erp_e2e_test',
    E2E_DATABASE_CONFIRM_DATABASE: 'erp_e2e_test' };
}

describe('E2E database isolation before all writes', () => {
  it.each(['localhost', '127.0.0.1', '[::1]', '%6cocalhost', '%31%32%37.0.0.1', 'LOCALHOST.'])('normalizes %s without credentials', (host) => {
    expect(postgresDatabaseIdentity(`postgresql://fixture:private@${host}/erp_e2e_test`))
      .toEqual({ databaseName: 'erp_e2e_test', target: 'localhost:5432/erp_e2e_test' });
  });

  it.each([
    { E2E_DATABASE_URL: undefined }, { E2E_DATABASE_URL: 'invalid-private-secret' },
    { E2E_DATABASE_URL: 'https://localhost/erp_e2e_test' },
    { E2E_DATABASE_CONFIRM_DATABASE: undefined }, { E2E_DATABASE_CONFIRM_DATABASE: 'different' },
    { E2E_DATABASE_URL: 'postgresql://localhost/production', E2E_DATABASE_CONFIRM_DATABASE: 'production' },
    { E2E_DATABASE_URL: 'postgresql://localhost/prod_e2e_test', E2E_DATABASE_CONFIRM_DATABASE: 'prod_e2e_test' },
    { E2E_DATABASE_URL: 'postgresql://localhost/erp_e2e_test?host=remote' },
    { E2E_DATABASE_URL: 'postgresql://localhost/erp_e2e_test?database=ordinary' },
    { E2E_DATABASE_URL: 'postgresql://localhost/erp_e2e_test%2Fordinary' },
    { DATABASE_URL: undefined }, { DATABASE_URL: 'invalid-private-secret' },
  ])('rejects missing, unsafe or unconfirmed configuration %# without secrets', (overrides) => {
    const env = { ...environment(), ...overrides };
    expect(() => assertE2eDatabaseEnvironment(env)).toThrow();
    try { assertE2eDatabaseEnvironment(env); } catch (error) {
      expect(String(error)).not.toContain('private');
    }
  });

  it.each(['localhost', '127.0.0.1', '[::1]', '%6cocalhost', '%31%32%37.0.0.1', 'LOCALHOST.'])('rejects the regular target disguised as %s', (host) => {
    const env = environment();
    env.DATABASE_URL = `postgresql://other:password@${host}/erp_e2e_test`;
    expect(() => activateE2eDatabase(env)).toThrow('ordinary database');
  });

  it('requires a distinct database name even when a DNS alias hides the same server', () => {
    const env = environment();
    env.DATABASE_URL = 'postgresql://database.internal/erp_e2e_test';
    expect(() => activateE2eDatabase(env)).toThrow('ordinary database');
  });

  it('does not trust a stale original target before database activation', () => {
    const env = environment();
    env.DATABASE_URL = env.E2E_DATABASE_URL;
    env.E2E_ORIGINAL_DATABASE_TARGET = 'localhost:5432/old_ordinary';
    expect(() => assertE2eDatabaseEnvironment(env)).toThrow('ordinary database');
    expect(() => activateE2eDatabase(env)).toThrow('ordinary database');
  });

  it('rechecks a changed ordinary URL instead of reusing an earlier activation marker', () => {
    const env = environment();
    activateE2eDatabase(env);
    env.DATABASE_URL = 'postgresql://different-credentials@127.0.0.1/erp_e2e_test';
    expect(() => activateE2eDatabase(env)).toThrow('ordinary database');
  });

  it('preserves original identity through worker reload and refuses an unactivated URL', () => {
    const env = environment();
    expect(() => assertActivatedE2eDatabase(env)).toThrow('not activated');
    const first = activateE2eDatabase(env);
    expect(activateE2eDatabase(env)).toEqual(first);
    expect(env.E2E_ORIGINAL_DATABASE_TARGET).toBe('localhost:5432/ordinary');
    expect(assertActivatedE2eDatabase(env)).toEqual(first);
  });
});

describe('controlled local browser server', () => {
  it.each(['localhost', '127.0.0.1', '[::1]'])('uses one controlled IPv4 origin for %s', (host) => {
    expect(controlledE2eBaseUrl(`http://${host}:3300`, 'release')).toBe('http://127.0.0.1:3300');
  });
  it.each(['https://example.com:3200', 'http://example.com:3200',
    'http://localhost:3000', 'http://localhost', 'http://localhost:3200/path',
    'http://secret@localhost:3200', 'http://localhost:3200/?target=remote',
    'http://localhost:3200/#remote', 'invalid'])('refuses an uncontrolled target %#', (value) => {
    expect(() => controlledE2eBaseUrl(value, 'release')).toThrow('loopback');
  });
});
