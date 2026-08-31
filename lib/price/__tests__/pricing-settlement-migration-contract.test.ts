import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const migration = readFileSync(
  path.join(
    process.cwd(),
    'prisma',
    'migrations',
    '20260807180000_order_pricing_and_settlement',
    'migration.sql',
  ),
  'utf8',
);
const suggestedPriceMigration = readFileSync(
  path.join(
    process.cwd(),
    'prisma',
    'migrations',
    '20260807182000_restore_suggested_price_semantics',
    'migration.sql',
  ),
  'utf8',
);
const compatibilityFenceMigration = readFileSync(
  path.join(
    process.cwd(),
    'prisma',
    'migrations',
    '20260807184000_pricing_compatibility_fence',
    'migration.sql',
  ),
  'utf8',
);
const prismaSchema = readFileSync(
  path.join(process.cwd(), 'prisma', 'schema.prisma'),
  'utf8',
);

describe('pricing and settlement migration safety contract', () => {
  it('wraps the pricing and settlement changes in one explicit transaction', () => {
    expect(migration.trimStart()).toMatch(/^BEGIN;/);
    expect(migration.trimEnd()).toMatch(/COMMIT;$/);
  });

  it('locks every inspected financial table in a fixed order before preflight', () => {
    const lock = migration.indexOf('LOCK TABLE');
    const firstPreflight = migration.indexOf('DO $$');

    expect(lock).toBeGreaterThan(migration.indexOf('BEGIN;'));
    expect(firstPreflight).toBeGreaterThan(lock);
    expect(migration.slice(lock, firstPreflight)).toMatch(
      /"Product",\s+"PriceTier",\s+"PriceAdjustment",\s+"Order",\s+"OrderItem",\s+"Bill",\s+"BillItem",\s+"BillPayment",\s+"User"\s+IN SHARE ROW EXCLUSIVE MODE;/,
    );
  });

  it('requires an explicit role-consistent settlement direction without a default', () => {
    expect(migration).toMatch(
      /ADD COLUMN "settlementType" "OrderSettlementType";[\s\S]+UPDATE "Order"[\s\S]+ALTER COLUMN "settlementType" SET NOT NULL;/,
    );
    expect(migration).not.toMatch(
      /ADD COLUMN "settlementType"[^;]+DEFAULT/,
    );
    expect(migration).toContain(
      'CONSTRAINT "Order_settlement_role_consistent"',
    );
    expect(migration).toContain(
      '("submitterRole" = \'SALES\' AND "settlementType" = \'EXTERNAL_SALES\')',
    );
    expect(migration).toContain(
      '("submitterRole" = \'CUSTOMER_SERVICE\' AND "settlementType" = \'INTERNAL_SALES\')',
    );
    expect(migration).toContain(
      'VALIDATE CONSTRAINT "Order_settlement_role_consistent"',
    );

    const orderModel = prismaSchema.slice(
      prismaSchema.indexOf('model Order {'),
      prismaSchema.indexOf('model OrderItem {'),
    );
    const settlementField = orderModel
      .split('\n')
      .find((line) => line.includes('settlementType'));
    expect(settlementField).toBeDefined();
    expect(settlementField).not.toContain('@default');
  });

  it('preflights quote numbers and effective windows before installing matching checks', () => {
    const createSettlementType = migration.indexOf(
      'CREATE TYPE "OrderSettlementType"',
    );
    const preflight = migration.slice(0, createSettlementType);

    expect(preflight).toContain('FROM "Product" AS product');
    expect(preflight).toContain('FROM "PriceTier" AS tier');
    expect(preflight).toContain('FROM "PriceAdjustment" AS adjustment');
    expect(preflight).toContain('product."baseUnitPrice" < 0');
    expect(preflight).toContain('product."minOrderQty" < 1');
    expect(preflight).toContain('tier."unitPrice" < 0');
    expect(preflight).toContain('tier."effectiveTo" <= tier."effectiveFrom"');
    expect(preflight).toContain('adjustment."amount" < 0');
    expect(preflight).toContain('Repair them before retrying');

    expect(migration).toContain('CONSTRAINT "Product_quote_values_valid"');
    expect(migration).toContain('CONSTRAINT "PriceTier_quote_values_valid"');
    expect(migration).toContain('CONSTRAINT "PriceAdjustment_amount_valid"');
    expect(migration).toContain(
      'VALIDATE CONSTRAINT "Product_quote_values_valid"',
    );
    expect(migration).toContain(
      'VALIDATE CONSTRAINT "PriceTier_quote_values_valid"',
    );
    expect(migration).toContain(
      'VALIDATE CONSTRAINT "PriceAdjustment_amount_valid"',
    );
  });

  it('fails fast on active legacy adjustment JSON before changing financial tables', () => {
    const preflight = migration.slice(
      0,
      migration.indexOf('CREATE TYPE "OrderSettlementType"'),
    );

    expect(preflight).toContain('FROM "PriceAdjustment"');
    expect(preflight).toContain('WHERE "isActive" = TRUE');
    expect(preflight).toContain("jsonb_typeof(condition) <> 'object'");
    expect(preflight).toContain("'productIds'");
    expect(preflight).toContain("'perFoilColor'");
    expect(preflight).toContain('jsonb_array_elements(condition -> condition_key)');
    expect(preflight).toContain('9007199254740991');
    expect(preflight).toContain("'craftMode requires craftIds'");
    expect(preflight).toContain("'minQty must not exceed maxQty'");
    expect(preflight).toContain(
      "'PER_SHEET requires a positive-integer unitsPerSheet'",
    );
    expect(preflight).toContain("'EXTERNAL_SALES'");
    expect(preflight).toContain('Disable or repair them before retrying');
    expect(preflight).not.toMatch(
      /UPDATE\s+"PriceAdjustment"[\s\S]+SET\s+"isActive"\s*=\s*FALSE/i,
    );
  });

  it('blocks unsafe or ambiguous legacy bills before deleting any ledger item', () => {
    const settlementUpdate = migration.indexOf('UPDATE "Order"');
    const firstBillGuard = migration.indexOf(
      '-- Legacy bill generation included every charged finished order',
    );
    const deleteItem = migration.indexOf('DELETE FROM "BillItem"');
    const guardedSection = migration.slice(firstBillGuard, deleteItem);

    expect(settlementUpdate).toBeGreaterThan(-1);
    expect(firstBillGuard).toBeGreaterThan(settlementUpdate);
    expect(deleteItem).toBeGreaterThan(firstBillGuard);
    expect(guardedSection).toContain('bill."status" <> \'DRAFT\'');
    expect(guardedSection).toContain('bill."paidAmount" <> 0');
    expect(guardedSection).toContain('FROM "BillPayment" AS payment');
    expect(guardedSection).toContain('bill."issuedAt" IS NOT NULL');
    expect(guardedSection).toContain('bill."paidAt" IS NOT NULL');
    expect(guardedSection).toContain(
      'source_order."submitterId" <> bill."salesUserId"',
    );
    expect(guardedSection).toContain('bill."openingAmount" <> 0');
    expect(guardedSection).toContain(
      'Do not infer financial direction from a current user role',
    );
    expect(guardedSection.match(/RAISE EXCEPTION USING/g)).toHaveLength(4);

    const contaminatedBillGuard = migration.slice(
      firstBillGuard,
      migration.indexOf('IF problem_count > 0 THEN', firstBillGuard),
    );
    expect(contaminatedBillGuard).toContain('bill."openingAmount" <> 0');
  });

  it('only cleans proven-safe non-external items and recomputes from surviving immutable rows', () => {
    const cleanup = migration.slice(
      migration.indexOf(
        '-- Every remaining contaminated bill is now proven to be DRAFT',
      ),
      migration.indexOf('ALTER TABLE "OrderItem"'),
    );

    expect(cleanup).toContain('DELETE FROM "BillItem" AS item');
    expect(cleanup).toContain('bill."status" = \'DRAFT\'');
    expect(cleanup).toContain('bill."paidAmount" = 0');
    expect(cleanup).toContain('bill."openingAmount" = 0');
    expect(cleanup).toContain('bill."issuedAt" IS NULL');
    expect(cleanup).toContain('bill."paidAt" IS NULL');
    expect(cleanup).toContain('IF NOT EXISTS (');
    expect(cleanup).toContain(
      'no longer satisfies the DRAFT, zero-balance, unissued, unpaid cleanup contract',
    );
    expect(cleanup).toContain(
      'source_order."settlementType" <> \'EXTERNAL_SALES\'::"OrderSettlementType"',
    );
    expect(cleanup).toContain(
      'bill."openingAmount" + COALESCE(sum(item."orderAmount"), 0)',
    );
    expect(cleanup).toContain('"totalAmount" = remaining_total');
    expect(cleanup).toContain('remaining_total > 9999999999.99');
    expect(cleanup).not.toMatch(/DELETE FROM "(?:Bill|BillPayment)"/);
  });

  it('restores suggestedPrice unit semantics through a guarded subtotal migration', () => {
    expect(suggestedPriceMigration.trimStart()).toMatch(/^BEGIN;/);
    expect(suggestedPriceMigration.trimEnd()).toMatch(/COMMIT;$/);

    const lock = suggestedPriceMigration.indexOf('LOCK TABLE');
    expect(lock).toBeGreaterThan(
      suggestedPriceMigration.indexOf('BEGIN;'),
    );
    expect(lock).toBeLessThan(suggestedPriceMigration.indexOf('DO $$'));
    expect(suggestedPriceMigration).toContain(
      'LOCK TABLE "Order", "OrderItem" IN SHARE ROW EXCLUSIVE MODE;',
    );

    const addColumn = suggestedPriceMigration.indexOf(
      'ADD COLUMN "suggestedSubtotal"',
    );
    const preflight = suggestedPriceMigration.slice(0, addColumn);
    expect(preflight).toContain('item."quantity" < 1');
    expect(preflight).toContain('item."quantity" > 9999999');
    expect(preflight).toContain('item."suggestedPrice" < 0');
    expect(preflight).toContain(
      'item."suggestedPrice" * item."quantity" > 9999999999.99',
    );
    expect(preflight).toContain('Repair them before retrying');

    expect(suggestedPriceMigration).toContain(
      'SET "suggestedSubtotal" = "suggestedPrice" * "quantity"',
    );
    const historicalBackfill = suggestedPriceMigration.slice(
      suggestedPriceMigration.indexOf(
        '-- Historical rows retain suggestedPrice as their unit-price evidence.',
      ),
      suggestedPriceMigration.indexOf(
        '-- Quote transition rows use the independently stored snapshot subtotal',
      ),
    );
    expect(historicalBackfill).toContain('WHERE "pricingSnapshot" IS NULL');
    expect(historicalBackfill).not.toContain('"suggestedPrice" = NULL');

    const transitionPreflight = suggestedPriceMigration.slice(
      suggestedPriceMigration.indexOf(
        '-- A non-null pricingSnapshot identifies the short-lived rollout rows.',
      ),
      addColumn,
    );
    expect(transitionPreflight).toContain(
      "transition.pricing_snapshot ? 'suggestedSubtotal'",
    );
    expect(transitionPreflight).toContain(
      "jsonb_typeof(snapshot_value) <> 'string'",
    );
    expect(transitionPreflight).toContain(
      "'^(0|[1-9][0-9]{0,9})\\.[0-9]{2}$'",
    );
    expect(transitionPreflight).toContain(
      'transition.current_suggested_price <> snapshot_subtotal',
    );
    expect(transitionPreflight).toContain(
      "transition.pricing_snapshot ->> 'complete' <> 'true'",
    );
    expect(transitionPreflight).toContain(
      "transition.pricing_snapshot ->> 'source' = 'FREE_REWORK'",
    );
    expect(transitionPreflight).toContain(
      'cannot prove the suggested subtotal from pricingSnapshot',
    );

    const transitionBackfill = suggestedPriceMigration.slice(
      suggestedPriceMigration.indexOf(
        '-- Quote transition rows use the independently stored snapshot subtotal',
      ),
      suggestedPriceMigration.indexOf(
        '-- Proven FREE_REWORK rows carry no customer-price suggestion.',
      ),
    );
    expect(transitionBackfill).toContain(
      '("pricingSnapshot" ->> \'suggestedSubtotal\')::NUMERIC',
    );
    expect(transitionBackfill).toContain('"suggestedPrice" = NULL');
    expect(transitionBackfill).toContain(
      'WHERE "pricingSnapshot" IS NOT NULL',
    );
    expect(suggestedPriceMigration).toContain(
      'CONSTRAINT "OrderItem_quantity_valid"',
    );
    expect(suggestedPriceMigration).toContain(
      'CONSTRAINT "OrderItem_suggested_prices_nonnegative"',
    );
    expect(suggestedPriceMigration).toContain(
      'CONSTRAINT "OrderItem_suggested_snapshot_consistent"',
    );
    expect(suggestedPriceMigration).toContain(
      'CREATE TRIGGER "OrderItem_suggestedPrice_insert_guard"',
    );
    expect(suggestedPriceMigration).toContain(
      'CREATE TRIGGER "OrderItem_suggestedPrice_update_guard"',
    );
    expect(suggestedPriceMigration).toContain(
      'NEW."suggestedPrice" IS DISTINCT FROM OLD."suggestedPrice"',
    );
    expect(suggestedPriceMigration).toContain(
      'OrderItem.suggestedPrice is legacy read-only data; new rows must use suggestedSubtotal',
    );
    expect(suggestedPriceMigration).not.toMatch(
      /(?:DROP|RENAME)\s+(?:COLUMN\s+)?"suggestedPrice"/i,
    );
  });

  it('reconciles already-applied drafts with an idempotent forward fence', () => {
    expect(compatibilityFenceMigration.trimStart()).toMatch(/^BEGIN;/);
    expect(compatibilityFenceMigration.trimEnd()).toMatch(/COMMIT;$/);

    const lock = compatibilityFenceMigration.indexOf('LOCK TABLE');
    const firstPreflight = compatibilityFenceMigration.indexOf('DO $$');
    expect(lock).toBeGreaterThan(
      compatibilityFenceMigration.indexOf('BEGIN;'),
    );
    expect(firstPreflight).toBeGreaterThan(lock);
    expect(compatibilityFenceMigration).toContain(
      'ALTER COLUMN "settlementType" DROP DEFAULT',
    );
    expect(compatibilityFenceMigration).toContain(
      'ALTER COLUMN "settlementType" SET NOT NULL',
    );
    expect(compatibilityFenceMigration).toContain(
      'missing or role-inconsistent settlement direction',
    );
    expect(compatibilityFenceMigration).toContain(
      'DROP CONSTRAINT IF EXISTS "Order_settlement_role_consistent"',
    );
    expect(compatibilityFenceMigration).toContain(
      'DROP CONSTRAINT IF EXISTS "OrderItem_suggested_snapshot_consistent"',
    );
    expect(compatibilityFenceMigration).toContain(
      'DROP TRIGGER IF EXISTS "OrderItem_suggestedPrice_insert_guard"',
    );
    expect(compatibilityFenceMigration).toContain(
      'CREATE OR REPLACE FUNCTION "enforce_order_item_suggested_price_legacy"',
    );
    expect(compatibilityFenceMigration).toContain(
      'incomplete manual quotes and FREE_REWORK remain valid',
    );
    expect(compatibilityFenceMigration).toContain(
      'quote snapshot and suggestedSubtotal are inconsistent',
    );
    expect(compatibilityFenceMigration).toContain(
      `jsonb_typeof("pricingSnapshot" -> 'version') IS DISTINCT FROM 'number'`,
    );
    expect(compatibilityFenceMigration).toContain(
      `"pricingSnapshot" ->> 'version' IS DISTINCT FROM '1'`,
    );
  });
});
