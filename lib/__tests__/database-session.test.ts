import 'dotenv/config';

import { describe, expect, it } from 'vitest';
import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '../../generated/prisma/client';
import {
  DATABASE_SESSION_TIME_ZONE,
  databasePoolConfig,
} from '../database-session';

describe('databasePoolConfig', () => {
  it('forces UTC for timestamp-without-time-zone application writes', () => {
    expect(
      databasePoolConfig('postgresql://app:secret@db.example/erp'),
    ).toEqual({
      connectionString: 'postgresql://app:secret@db.example/erp',
      options: '-c timezone=UTC',
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
