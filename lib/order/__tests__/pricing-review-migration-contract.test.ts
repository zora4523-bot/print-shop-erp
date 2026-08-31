import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const migration = readFileSync(
  path.join(
    process.cwd(),
    'prisma',
    'migrations',
    '20260826130000_order_pricing_review',
    'migration.sql',
  ),
  'utf8',
);
const schema = readFileSync(
  path.join(process.cwd(), 'prisma', 'schema.prisma'),
  'utf8',
);

describe('order pricing review migration contract', () => {
  it('runs as one forward transaction and declares every pricing state', () => {
    expect(migration.trimStart()).toMatch(/^BEGIN;/);
    expect(migration.trimEnd()).toMatch(/COMMIT;$/);
    expect(migration).toContain('CREATE TYPE "OrderPricingStatus" AS ENUM');
    expect(migration).toContain("'LEGACY_CONFIRMED'");
    expect(migration).toContain("'AUTO_CONFIRMED'");
    expect(migration).toContain("'PENDING_ADMIN_CONFIRMATION'");
    expect(migration).toContain("'ADMIN_CONFIRMED'");
  });

  it('adds closed-by-default review metadata with a valid revision floor', () => {
    expect(migration).toContain(
      'DEFAULT \'PENDING_ADMIN_CONFIRMATION\'',
    );
    expect(migration).toContain(
      'ADD COLUMN "priceRevision" INTEGER NOT NULL DEFAULT 1',
    );
    expect(migration).toContain(
      'ADD COLUMN "pricingConfirmedAt" TIMESTAMP(3)',
    );
    expect(migration).toContain(
      'ADD COLUMN "pricingConfirmedById" TEXT',
    );
    expect(migration).toContain('CHECK ("priceRevision" >= 1)');
    expect(schema).toMatch(
      /pricingStatus\s+OrderPricingStatus\s+@default\(PENDING_ADMIN_CONFIRMATION\)/,
    );
  });

  it('marks pre-migration orders LEGACY_CONFIRMED and snapshots their actual amounts', () => {
    expect(migration).toContain(
      '"pricingStatus" = \'LEGACY_CONFIRMED\'',
    );
    expect(migration).toContain("'LEGACY_BACKFILL'");
    expect(migration).toContain('FROM "OrderItem" oi');
    expect(migration).toContain('FROM "OrderCustomerCharge" oc');
    expect(migration).toContain('o."processingAmount"::text');
    expect(migration).toContain('o."totalAmount"::text');
  });

  it('enforces revision uniqueness and valid confirmation shape in PostgreSQL', () => {
    expect(migration).toContain('"Order_priceRevision_check"');
    expect(migration).toContain('"Order_pricing_confirmation_shape_check"');
    expect(migration).toContain(
      '"pricingStatus" = \'ADMIN_CONFIRMED\' AND "pricingConfirmedAt" IS NOT NULL AND "pricingConfirmedById" IS NOT NULL',
    );
    expect(migration).toContain(
      '"pricingStatus" = \'PENDING_ADMIN_CONFIRMATION\' AND "pricingConfirmedAt" IS NULL AND "pricingConfirmedById" IS NULL',
    );
    expect(migration).toContain(
      '"pricingStatus" IN (\'AUTO_CONFIRMED\', \'LEGACY_CONFIRMED\') AND "pricingConfirmedAt" IS NOT NULL AND "pricingConfirmedById" IS NULL',
    );
    expect(migration).toContain(
      'CREATE UNIQUE INDEX "OrderPricingRevision_orderId_revision_key"',
    );
  });

  it('requires every immutable revision to hold a JSON object snapshot', () => {
    expect(migration).toContain('CREATE TABLE "OrderPricingRevision"');
    expect(migration).toContain(
      'CONSTRAINT "OrderPricingRevision_revision_check" CHECK ("revision" >= 1)',
    );
    expect(migration).toContain(
      'CONSTRAINT "OrderPricingRevision_snapshot_object_check"',
    );
    expect(migration).toContain(
      'CHECK (jsonb_typeof("snapshot") = \'object\')',
    );
    expect(migration).toContain(
      'ON "OrderPricingRevision"("orderId", "revision")',
    );
  });

  it('makes every pricing revision immutable at the database boundary', () => {
    expect(schema).toContain('model OrderPricingRevision {');
    expect(migration).toContain(
      'CREATE OR REPLACE FUNCTION prevent_order_pricing_revision_mutation()',
    );
    expect(migration).toContain('BEFORE UPDATE OR DELETE');
    expect(migration).toContain(
      "RAISE EXCEPTION 'OrderPricingRevision rows are immutable'",
    );
  });
});
