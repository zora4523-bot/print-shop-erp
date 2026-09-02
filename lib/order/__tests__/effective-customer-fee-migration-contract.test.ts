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
    '20260902120900_order_effective_customer_fee_sort',
    'migration.sql',
  ),
  'utf8',
);

describe('effective customer fee sort migration contract', () => {
  it('persists the display precedence for ordering before pagination', () => {
    expect(migration).toMatch(
      /COALESCE\("settledFee", "confirmedFee", "quotedFee", "totalAmount"\)/u,
    );
    expect(migration).toContain('GENERATED ALWAYS AS');
    expect(migration).toContain('STORED');
    expect(migration).toContain(
      '"Order_effectiveCustomerFee_createdAt_id_idx"',
    );
  });

  it('keeps the generated sort column and stable tie-break index in Prisma', () => {
    expect(schema).toMatch(
      /effectiveCustomerFee\s+Decimal\?\s+@default\(dbgenerated\("COALESCE\(\\"settledFee\\", \\"confirmedFee\\", \\"quotedFee\\", \\"totalAmount\\"\)"\)\)\s+@db\.Decimal\(12, 2\)/u,
    );
    expect(schema).toContain(
      '@@index([effectiveCustomerFee, createdAt(sort: Desc), id(sort: Desc)])',
    );
  });
});
