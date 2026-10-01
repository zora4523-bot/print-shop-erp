import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const schema = readFileSync(
  new URL('../../../prisma/schema.prisma', import.meta.url),
  'utf8',
);
const migration = readFileSync(
  new URL(
    '../../../prisma/migrations/20260902120500_order_print_job_superseded_resolution/migration.sql',
    import.meta.url,
  ),
  'utf8',
);

describe('append-only superseded print resolution migration contract', () => {
  it('keeps SUPERSEDED in the generated ledger state model', () => {
    expect(schema).toMatch(
      /enum OrderPrintJobState\s*{[\s\S]*?PENDING[\s\S]*?PRINTED[\s\S]*?SUPERSEDED[\s\S]*?}/,
    );
    expect(schema).toMatch(
      /resolution\s+OrderPrintJob\?\s+@relation\("OrderPrintJobResolution"\)/,
    );
  });

  it('adds an immutable resolution shape and validates it against its request', () => {
    expect(migration).toContain(
      'ALTER TYPE "OrderPrintJobState" ADD VALUE IF NOT EXISTS \'SUPERSEDED\'',
    );
    expect(migration).toMatch(
      /"state" = 'SUPERSEDED'::"OrderPrintJobState"[\s\S]*?"requestJobId" IS NOT NULL[\s\S]*?"printedAt" IS NULL/,
    );
    expect(migration).toContain(
      'CREATE OR REPLACE FUNCTION validate_order_print_job_insert()',
    );
    expect(migration).toMatch(
      /request_row\."orderId" <> NEW\."orderId"[\s\S]*?request_row\."workOrderVersion" <> NEW\."workOrderVersion"/,
    );
    expect(migration).toMatch(
      /request_row\."printKind" <> NEW\."printKind"[\s\S]*?request_row\."reason" <> NEW\."reason"/,
    );
  });
});
