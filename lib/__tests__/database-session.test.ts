import 'dotenv/config';

import { describe, expect, it } from 'vitest';
import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '../../generated/prisma/client';
import {
  DATABASE_SESSION_TIME_ZONE,
  databasePoolConfig,
  assertWorkerPoolCapacity,
} from '../database-session';

describe('databasePoolConfig', () => {
  it('forces UTC for timestamp-without-time-zone application writes', () => {
    expect(
      databasePoolConfig('postgresql://app:secret@db.example/erp'),
    ).toEqual({
      connectionString: 'postgresql://app:secret@db.example/erp',
      options: '-c timezone=UTC',
      max: 25,
      connectionTimeoutMillis: 10_000,
    });
    expect(DATABASE_SESSION_TIME_ZONE).toBe('UTC');
  });

  it('preserves existing startup options and makes UTC authoritative', () => {
    const connectionString =
      'postgresql://app:secret@db.example/erp?options=-c%20statement_timeout%3D5000%20-c%20timezone%3DAsia%2FShanghai';

    expect(databasePoolConfig(connectionString).options).toBe(
      '-c statement_timeout=5000 -c timezone=Asia/Shanghai -c timezone=UTC',
    );
    expect(databasePoolConfig(connectionString).connectionString).toBe(
      'postgresql://app:secret@db.example/erp',
    );
  });

  it.runIf(Boolean(process.env.DATABASE_URL))(
    'applies UTC through a real Prisma adapter when the URL has conflicting options',
    async () => {
      const connectionString = new URL(process.env.DATABASE_URL!);
      connectionString.searchParams.set(
        'options',
        '-c statement_timeout=5000 -c timezone=Asia/Shanghai',
      );
      const client = new PrismaClient({
        adapter: new PrismaPg(databasePoolConfig(connectionString.toString())),
      });

      try {
        const result = await client.$queryRaw<Array<{ timeZone: string }>>`
          SELECT current_setting('TimeZone') AS "timeZone"
        `;
        expect(result).toEqual([{ timeZone: DATABASE_SESSION_TIME_ZONE }]);
      } finally {
        await client.$disconnect();
      }
    },
  );
});

it('bounds pool borrowing and gives web processes an explicit pool budget', () => {
  expect(databasePoolConfig('postgresql://app:secret@localhost/test')).toMatchObject({ max: 25, connectionTimeoutMillis: 10000 });
});

it('uses worker defaults and rejects concurrency without heartbeat capacity', () => {
  expect(databasePoolConfig('postgresql://localhost/test', { role: 'worker' }).max).toBe(5);
  expect(() => assertWorkerPoolCapacity(5, 2)).not.toThrow();
  expect(() => assertWorkerPoolCapacity(5, 3)).toThrow('twice');
  expect(() => assertWorkerPoolCapacity(16, 8)).not.toThrow();
});
it('resolves explicit pool overrides and refuses unlimited connection waiting', () => {
  expect(databasePoolConfig('postgresql://localhost/test?max=16&connectionTimeoutMillis=9000', { role: 'worker' })).toMatchObject({ max: 16, connectionTimeoutMillis: 9000, connectionString: 'postgresql://localhost/test' });
  expect(databasePoolConfig('postgresql://localhost/test?max=16', { max: 20 }).max).toBe(20);
  expect(() => databasePoolConfig('postgresql://localhost/test', { max: 0 })).toThrow('positive');
  expect(() => databasePoolConfig('postgresql://localhost/test', { connectionTimeoutMillis: 0 })).toThrow('positive');
});
