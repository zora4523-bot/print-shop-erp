import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const schema = readFileSync(
  path.join(process.cwd(), 'prisma', 'schema.prisma'),
  'utf8',
);
const migration = readFileSync(
  path.join(
    process.cwd(),
    'prisma',
    'migrations',
    '20260902121000_order_change_request_base_work_order_version',
    'migration.sql',
  ),
  'utf8',
);

describe('order change request production-version migration contract', () => {
  it('adds a nullable historical base version with a positive-value guard', () => {
    expect(schema).toMatch(/baseWorkOrderVersion\s+Int\?/u);
    expect(migration).toContain('ADD COLUMN "baseWorkOrderVersion" INTEGER');
    expect(migration).toContain(
      '"OrderChangeRequest_base_work_order_version_check"',
    );
    expect(migration).toMatch(/"baseWorkOrderVersion"\s*>=\s*1/u);
    expect(migration).not.toMatch(
      /DROP\s+(?:TABLE|COLUMN)|TRUNCATE|DELETE\s+FROM/u,
    );
  });

  it('enforces workOrderVersionAfter for newly approved rows without rewriting history', () => {
    expect(migration).toContain(
      '"OrderChangeRequest_approved_work_order_version_check"',
    );
    expect(migration).toMatch(
      /"status"\s*<>\s*'APPROVED'::"OrderChangeRequestStatus"[\s\S]*"workOrderVersionAfter" IS NOT NULL/u,
    );
    expect(migration).toMatch(/\) NOT VALID;/u);
    expect(migration).not.toMatch(/UPDATE\s+"OrderChangeRequest"/u);
  });
});
