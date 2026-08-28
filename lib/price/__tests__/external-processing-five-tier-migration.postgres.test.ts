import 'dotenv/config';

import { randomBytes } from 'node:crypto';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { Client } from 'pg';
import { describe, expect, it } from 'vitest';

const databaseUrl = process.env.DATABASE_URL;
const postgresDescribe = databaseUrl ? describe : describe.skip;
const migration = readFileSync(
  path.join(
    process.cwd(),
    'prisma/migrations/20260829013000_external_processing_five_tier/migration.sql',
  ),
  'utf8',
);

function quotedIdentifier(value: string): string {
  return `"${value.replaceAll('"', '""')}"`;
}

async function withIsolatedSchema(
  run: (client: Client) => Promise<void>,
): Promise<void> {
  if (!databaseUrl) return;
  const client = new Client({ connectionString: databaseUrl });
  const schema = `five_tier_${randomBytes(8).toString('hex')}`;
  const quotedSchema = quotedIdentifier(schema);
  await client.connect();
  try {
    await client.query(`CREATE SCHEMA ${quotedSchema}`);
    await client.query(`SET search_path TO ${quotedSchema}, public`);
    await run(client);
  } finally {
    await client.query('RESET search_path').catch(() => undefined);
    await client
      .query(`DROP SCHEMA IF EXISTS ${quotedSchema} CASCADE`)
      .catch(() => undefined);
    await client.end();
  }
}

async function createSchema(client: Client): Promise<void> {
  await client.query(`
    CREATE DOMAIN citext AS TEXT;
    CREATE TYPE "OrderSettlementType" AS ENUM ('EXTERNAL_SALES');
    CREATE TYPE "CustomerPriceBookPurpose" AS ENUM ('PROCESSING', 'LOGISTICS');
    CREATE TYPE "CustomerPriceRuleKind" AS ENUM ('BASE', 'ADD_ON', 'REFERENCE');
    CREATE TYPE "CustomerPriceCalculationType" AS ENUM (
      'FIXED_AMOUNT', 'PER_PIECE', 'PER_BAG'
    );

    CREATE TABLE "CustomerPriceBook" (
      "id" TEXT PRIMARY KEY,
      "code" citext NOT NULL,
      "name" TEXT NOT NULL,
      "settlementType" "OrderSettlementType" NOT NULL,
      "purpose" "CustomerPriceBookPurpose" NOT NULL,
      "version" INTEGER NOT NULL,
      "currency" TEXT NOT NULL,
      "sourceName" TEXT NOT NULL,
      "sourceSha256" TEXT NOT NULL,
      "effectiveFrom" TIMESTAMP(3) NOT NULL,
      "effectiveTo" TIMESTAMP(3),
      "isActive" BOOLEAN NOT NULL,
      "notes" JSONB,
      "createdAt" TIMESTAMP(3) NOT NULL,
      "updatedAt" TIMESTAMP(3) NOT NULL,
      UNIQUE ("code", "version")
    );

    CREATE TABLE "Product" (
      "id" TEXT PRIMARY KEY,
      "code" citext NOT NULL,
      "name" TEXT NOT NULL
    );

    CREATE TABLE "CustomerPriceRule" (
      "id" TEXT PRIMARY KEY,
      "priceBookId" TEXT NOT NULL,
      "categoryId" TEXT NOT NULL,
      "productId" TEXT,
      "code" citext NOT NULL,
      "name" TEXT NOT NULL,
      "kind" "CustomerPriceRuleKind" NOT NULL,
      "calculationType" "CustomerPriceCalculationType",
      "amount" DECIMAL(14, 4),
      "includedUnits" DECIMAL(10, 3),
      "incrementUnits" DECIMAL(10, 3),
      "incrementAmount" DECIMAL(14, 4),
      "minQty" INTEGER,
      "maxQty" INTEGER,
      "triggerCondition" JSONB,
      "exclusiveGroup" TEXT,
      "priority" INTEGER NOT NULL,
      "sourceSheet" TEXT,
      "sourceRange" TEXT,
      "sourceName" TEXT,
      "sourceSha256" TEXT,
      "note" TEXT,
      "blocksAutomaticQuote" BOOLEAN NOT NULL,
      "isActive" BOOLEAN NOT NULL,
      "createdAt" TIMESTAMP(3) NOT NULL,
      "updatedAt" TIMESTAMP(3) NOT NULL,
      UNIQUE ("priceBookId", "code")
    );

    CREATE TABLE "OrderPriceVersionLock" (
      "id" TEXT PRIMARY KEY,
      "priceBookId" TEXT NOT NULL
    );

    CREATE TABLE "OrderCustomerCharge" (
      "id" TEXT PRIMARY KEY,
      "priceBookId" TEXT,
      "sourceRuleId" TEXT
    );
  `);
}

async function seedSystemLineage(client: Client): Promise<void> {
  await client.query(`
    WITH clock AS (
      SELECT (CURRENT_TIMESTAMP AT TIME ZONE 'UTC')::TIMESTAMP(3) AS now
    )
    INSERT INTO "CustomerPriceBook" (
      "id", "code", "name", "settlementType", "purpose", "version",
      "currency", "sourceName", "sourceSha256", "effectiveFrom",
      "effectiveTo", "isActive", "notes", "createdAt", "updatedAt"
    )
    SELECT seed.*
    FROM clock
    CROSS JOIN LATERAL (
      VALUES
        (
          'cpb_external_processing_rule_v3',
          'EXTERNAL_SALES_PROCESSING_RULES', 'current v3',
          'EXTERNAL_SALES'::"OrderSettlementType",
          'PROCESSING'::"CustomerPriceBookPurpose", 3, 'CNY',
          '加工费计费规则.md',
          '3596993e283d1d06f01dd7048b6ccf2f1c0e4b27394541e004a37419c856d817',
          clock.now - INTERVAL '1 day', clock.now + INTERVAL '1 day', TRUE,
          '{"workflow":{"status":"SYSTEM_RELEASE"}}'::JSONB,
          clock.now - INTERVAL '1 day', clock.now - INTERVAL '1 day'
        ),
        (
          'cpb_stock_local_foil_bef5f8d170b81d40ad1e338e',
          'EXTERNAL_SALES_PROCESSING_202608', 'legacy scheduled v4',
          'EXTERNAL_SALES'::"OrderSettlementType",
          'PROCESSING'::"CustomerPriceBookPurpose", 4, 'CNY',
          'legacy.xlsx',
          'ec2e83a5b8fd219eef4619c09afc2617d0e8f7f9a34f916c53350dd1c9f38f32',
          clock.now + INTERVAL '1 day', NULL, TRUE,
          '{"workflow":{"status":"SYSTEM_RELEASE"}}'::JSONB,
          clock.now - INTERVAL '2 days', clock.now - INTERVAL '2 days'
        )
    ) AS seed(
      "id", "code", "name", "settlementType", "purpose", "version",
      "currency", "sourceName", "sourceSha256", "effectiveFrom",
      "effectiveTo", "isActive", "notes", "createdAt", "updatedAt"
    );

    INSERT INTO "Product" ("id", "code", "name") VALUES
      ('product-mid', 'EXT-CUSTOM-MID', '中号'),
      ('product-square', 'EXT-CUSTOM-SQUARE', '方形'),
      ('product-west-mid', 'EXT-CUSTOM-WEST-MID', '西封中号'),
      ('product-large', 'EXT-CUSTOM-LARGE', '大号'),
      ('product-west-large', 'EXT-CUSTOM-WEST-LARGE', '西封大号');

    WITH tier("suffix", "minQty", "maxQty", "midRate", "largeRate") AS (
      VALUES
        ('LE_750', 1, 750, 0.4800, 0.5200),
        ('751_1500', 751, 1500, 0.3100, 0.3250),
        ('1501_2500', 1501, 2500, 0.2700, 0.2850),
        ('2501_3500', 2501, 3500, 0.2500, 0.2700),
        ('3501_4500', 3501, 4500, 0.2300, 0.2450),
        ('4501_7500', 4501, 7500, 0.2000, 0.2200),
        ('7501_15000', 7501, 15000, 0.1800, 0.2000),
        ('15001_25000', 15001, 25000, 0.1700, 0.1900),
        ('GTE_25001', 25001, 9999999, 0.1700, 0.1900)
    )
    INSERT INTO "CustomerPriceRule" (
      "id", "priceBookId", "categoryId", "productId", "code", "name",
      "kind", "calculationType", "amount", "minQty", "maxQty",
      "triggerCondition", "exclusiveGroup", "priority", "sourceSheet",
      "sourceRange", "sourceName", "sourceSha256", "blocksAutomaticQuote",
      "isActive", "createdAt", "updatedAt"
    )
    SELECT
      'custom-' || product."id" || '-' || tier."suffix",
      'cpb_external_processing_rule_v3', 'base-category', product."id",
      'BASE_' || replace(product."code"::TEXT, 'EXT-', '') || '_' || tier."suffix",
      product."name" || ' · ' || tier."suffix",
      'BASE', 'PER_PIECE',
      CASE
        WHEN product."code"::TEXT IN (
          'EXT-CUSTOM-MID', 'EXT-CUSTOM-SQUARE', 'EXT-CUSTOM-WEST-MID'
        ) THEN tier."midRate"
        ELSE tier."largeRate"
      END,
      tier."minQty", tier."maxQty", '{}'::JSONB, 'CUSTOM_BASE', 100,
      '加工费计费规则.md', '§2.1', '加工费计费规则.md',
      '3596993e283d1d06f01dd7048b6ccf2f1c0e4b27394541e004a37419c856d817',
      FALSE, TRUE, CURRENT_TIMESTAMP AT TIME ZONE 'UTC',
      CURRENT_TIMESTAMP AT TIME ZONE 'UTC'
    FROM "Product" product
    CROSS JOIN tier;

    INSERT INTO "CustomerPriceRule" (
      "id", "priceBookId", "categoryId", "code", "name", "kind",
      "priority", "blocksAutomaticQuote", "isActive", "createdAt", "updatedAt"
    )
    SELECT
      'filler-' || value,
      'cpb_external_processing_rule_v3', 'reference-category',
      'REFERENCE_' || value, 'reference ' || value, 'REFERENCE', 500,
      TRUE, TRUE, CURRENT_TIMESTAMP AT TIME ZONE 'UTC',
      CURRENT_TIMESTAMP AT TIME ZONE 'UTC'
    FROM generate_series(1, 95) value;

    INSERT INTO "OrderPriceVersionLock" ("id", "priceBookId")
    VALUES ('historical-lock', 'cpb_external_processing_rule_v3');
  `);
}

postgresDescribe('external processing five-tier migration · PostgreSQL', () => {
  it('publishes a continuous successor and preserves historical rows', async () => {
    await withIsolatedSchema(async (client) => {
      await createSchema(client);
      await seedSystemLineage(client);
      await client.query(migration);

      const timeline = await client.query<{
        sourceRuleCount: number;
        successorRuleCount: number;
        successorCustomCount: number;
        legacyActive: boolean;
        sourceClosedAtSuccessor: boolean;
        currentCount: number;
        historicalLockCount: number;
      }>(`
        SELECT
          (
            SELECT COUNT(*)::INT FROM "CustomerPriceRule"
            WHERE "priceBookId" = 'cpb_external_processing_rule_v3'
          ) AS "sourceRuleCount",
          (
            SELECT COUNT(*)::INT FROM "CustomerPriceRule"
            WHERE "priceBookId" = 'cpb_external_processing_rule_v4_five_tier'
          ) AS "successorRuleCount",
          (
            SELECT COUNT(*)::INT FROM "CustomerPriceRule"
            WHERE "priceBookId" = 'cpb_external_processing_rule_v4_five_tier'
              AND "exclusiveGroup" = 'CUSTOM_BASE'
          ) AS "successorCustomCount",
          legacy."isActive" AS "legacyActive",
          source."effectiveTo" = successor."effectiveFrom"
            AS "sourceClosedAtSuccessor",
          (
            SELECT COUNT(*)::INT
            FROM "CustomerPriceBook" current_book
            WHERE current_book."isActive" = TRUE
              AND current_book."purpose" = 'PROCESSING'
              AND current_book."effectiveFrom" <=
                (CURRENT_TIMESTAMP AT TIME ZONE 'UTC')::TIMESTAMP(3)
              AND (
                current_book."effectiveTo" IS NULL
                OR current_book."effectiveTo" >
                  (CURRENT_TIMESTAMP AT TIME ZONE 'UTC')::TIMESTAMP(3)
              )
          ) AS "currentCount",
          (
            SELECT COUNT(*)::INT FROM "OrderPriceVersionLock"
            WHERE "id" = 'historical-lock'
              AND "priceBookId" = 'cpb_external_processing_rule_v3'
          ) AS "historicalLockCount"
        FROM "CustomerPriceBook" source
        CROSS JOIN "CustomerPriceBook" successor
        CROSS JOIN "CustomerPriceBook" legacy
        WHERE source."id" = 'cpb_external_processing_rule_v3'
          AND successor."id" = 'cpb_external_processing_rule_v4_five_tier'
          AND legacy."id" = 'cpb_stock_local_foil_bef5f8d170b81d40ad1e338e'
      `);
      expect(timeline.rows[0]).toEqual({
        sourceRuleCount: 140,
        successorRuleCount: 145,
        successorCustomCount: 50,
        legacyActive: false,
        sourceClosedAtSuccessor: true,
        currentCount: 1,
        historicalLockCount: 1,
      });

      const terminalTiers = await client.query<{
        productCode: string;
        minQty: number;
        maxQty: number;
        amount: string;
      }>(`
        SELECT
          product."code"::TEXT AS "productCode",
          rule."minQty" AS "minQty",
          rule."maxQty" AS "maxQty",
          rule."amount"::TEXT AS amount
        FROM "CustomerPriceRule" rule
        JOIN "Product" product ON product."id" = rule."productId"
        WHERE rule."priceBookId" = 'cpb_external_processing_rule_v4_five_tier'
          AND rule."exclusiveGroup" = 'CUSTOM_BASE'
          AND rule."minQty" IN (25001, 40001)
        ORDER BY product."code"::TEXT, rule."minQty"
      `);
      expect(terminalTiers.rows).toEqual([
        { productCode: 'EXT-CUSTOM-LARGE', minQty: 25001, maxQty: 40000, amount: '0.1900' },
        { productCode: 'EXT-CUSTOM-LARGE', minQty: 40001, maxQty: 9999999, amount: '0.1800' },
        { productCode: 'EXT-CUSTOM-MID', minQty: 25001, maxQty: 40000, amount: '0.1700' },
        { productCode: 'EXT-CUSTOM-MID', minQty: 40001, maxQty: 9999999, amount: '0.1600' },
        { productCode: 'EXT-CUSTOM-SQUARE', minQty: 25001, maxQty: 40000, amount: '0.1700' },
        { productCode: 'EXT-CUSTOM-SQUARE', minQty: 40001, maxQty: 9999999, amount: '0.1600' },
        { productCode: 'EXT-CUSTOM-WEST-LARGE', minQty: 25001, maxQty: 40000, amount: '0.1900' },
        { productCode: 'EXT-CUSTOM-WEST-LARGE', minQty: 40001, maxQty: 9999999, amount: '0.1800' },
        { productCode: 'EXT-CUSTOM-WEST-MID', minQty: 25001, maxQty: 40000, amount: '0.1700' },
        { productCode: 'EXT-CUSTOM-WEST-MID', minQty: 40001, maxQty: 9999999, amount: '0.1600' },
      ]);
    });
  });
});
