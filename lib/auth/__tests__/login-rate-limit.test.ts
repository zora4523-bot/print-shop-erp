import { beforeEach, describe, expect, it, vi } from 'vitest';

const { queryRawMock } = vi.hoisted(() => ({
  queryRawMock: vi.fn(),
}));

vi.mock('server-only', () => ({}));
vi.mock('@/lib/db', () => ({
  db: { $queryRaw: queryRawMock },
}));

import {
  consumeLoginRateLimit,
  loginRateLimitBucketKey,
} from '../login-rate-limit';

describe('loginRateLimitBucketKey', () => {
  it('prefers the proxy-overwritten real IP and never stores it verbatim', () => {
    const headers = new Headers({
      'x-real-ip': '203.0.113.7',
      'x-forwarded-for': 'spoofed, 198.51.100.9',
    });
    const key = loginRateLimitBucketKey(headers);
    expect(key).toMatch(/^[0-9a-f]{64}$/);
    expect(key).not.toContain('203.0.113.7');
    expect(key).toBe(loginRateLimitBucketKey(headers));
  });

  it('uses the final forwarded hop instead of a spoofable prefix', () => {
    const attackerA = new Headers({
      'x-forwarded-for': '1.1.1.1, 198.51.100.9',
    });
    const attackerB = new Headers({
      'x-forwarded-for': '8.8.8.8, 198.51.100.9',
    });
    expect(loginRateLimitBucketKey(attackerA)).toBe(
      loginRateLimitBucketKey(attackerB),
    );
  });
});

describe('consumeLoginRateLimit', () => {
  beforeEach(() => queryRawMock.mockReset());

  it('allows only when the atomic INSERT/UPDATE returned a bucket row', async () => {
    queryRawMock.mockResolvedValueOnce([{ key: 'accepted' }]);
    await expect(consumeLoginRateLimit(new Headers())).resolves.toBe(true);

    queryRawMock.mockResolvedValueOnce([]);
    await expect(consumeLoginRateLimit(new Headers())).resolves.toBe(false);
  });

  it('locks the database-clock GCRA admission and token-advance SQL shape', async () => {
    const headers = new Headers({ 'x-real-ip': '203.0.113.7' });
    queryRawMock.mockResolvedValueOnce([{ key: 'accepted' }]);

    await expect(consumeLoginRateLimit(headers)).resolves.toBe(true);

    const statement = queryRawMock.mock.calls[0]![0] as {
      strings: readonly string[];
      values: readonly unknown[];
    };
    const sql = statement.strings.join('?').replace(/\s+/g, ' ').trim();
    expect(sql).toContain(
      'WITH db_clock AS ( SELECT clock_timestamp() AS at )',
    );
    expect(sql.match(/clock_timestamp\(\)/g)).toHaveLength(1);
    expect(sql).toContain(
      "at + (?::integer * interval '1 millisecond')",
    );
    expect(sql).toContain(
      'GREATEST( "LoginRateLimitBucket"."theoreticalArrivalAt", EXCLUDED."updatedAt" ) + (?::integer * interval \'1 millisecond\')',
    );
    expect(sql).toContain(
      'WHERE "LoginRateLimitBucket"."theoreticalArrivalAt" <= EXCLUDED."updatedAt" + (?::integer * interval \'1 millisecond\')',
    );
    expect(sql).toContain('RETURNING "key"');
    expect(statement.values).toEqual([
      loginRateLimitBucketKey(headers),
      6_000,
      6_000,
      30_000,
    ]);
  });

  it('does not turn a database failure into an allowed login attempt', async () => {
    const failure = new Error('database unavailable');
    queryRawMock.mockRejectedValueOnce(failure);
    await expect(consumeLoginRateLimit(new Headers())).rejects.toBe(failure);
  });
});
