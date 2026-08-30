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
    'prisma/migrations/20260830090000_external_processing_truth_repair/migration.sql',
  ),
  'utf8',
);

const DOCUMENT_SHA256 =
  '8a5e1149a2e62920c7ebf9d14a6cedf4e6dac5e0769d556b5a52dbeb99dbd852';

function quotedIdentifier(value: string): string {
  return `"${value.replaceAll('"', '""')}"`;
}

async function withIsolatedSchema(
  run: (client: Client) => Promise<void>,
): Promise<void> {
  if (!databaseUrl) return;
  const client = new Client({ connectionString: databaseUrl });
  const schema = `price_truth_repair_${randomBytes(8).toString('hex')}`;
  const quotedSchema = quotedIdentifier(schema);
  await client.connect();
  try {
    await client.query(`CREATE SCHEMA ${quotedSchema}`);
    await client.query(`SET search_path TO ${quotedSchema}, public`);
    await run(client);
  } finally {
    await client.query('ROLLBACK').catch(() => undefined);
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
      "code" citext UNIQUE,
      "name" TEXT NOT NULL,
      "isActive" BOOLEAN NOT NULL,
      "createdAt" TIMESTAMP(3) NOT NULL,
      "updatedAt" TIMESTAMP(3) NOT NULL
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
  `);
}

type SeedOptions = {
  sourceVersion: 4 | 6;
  pearlRedAmount: string;
  softTouchLargeAmount: string;
  sourceCode?: string;
};

async function seedCurrentLineage(
  client: Client,
  options: SeedOptions,
): Promise<{ sourceId: string }> {
  const sourceId = `source-v${options.sourceVersion}`;
  const sourceCode = options.sourceCode ?? 'EXTERNAL_SALES_PROCESSING_RULES';
  await client.query(
    `
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
            'historical-processing', $1::citext, 'historical processing',
            'EXTERNAL_SALES'::"OrderSettlementType",
            'PROCESSING'::"CustomerPriceBookPurpose", $2::INTEGER - 1, 'CNY',
            '加工费计费规则.md', $3,
            clock.now - INTERVAL '2 days', clock.now - INTERVAL '1 day', TRUE,
            '{"ruleVersion":"2026-08-29-five-tier"}'::JSONB,
            clock.now - INTERVAL '2 days', clock.now - INTERVAL '2 days'
          ),
          (
            $4, $1::citext, 'current processing',
            'EXTERNAL_SALES'::"OrderSettlementType",
            'PROCESSING'::"CustomerPriceBookPurpose", $2::INTEGER, 'CNY',
            '加工费计费规则.md', $3,
            clock.now - INTERVAL '1 day', NULL, TRUE,
            '{
              "ruleVersion":"2026-08-29-five-tier",
              "ruleSetSha256":"must-not-be-copied",
              "workflow":{
                "status":"PUBLISHED",
                "ruleSetSha256":"must-not-be-copied"
              }
            }'::JSONB,
            clock.now - INTERVAL '1 day', clock.now - INTERVAL '1 day'
          ),
          (
            'unrelated-logistics', 'EXTERNAL_SALES_LOGISTICS'::citext,
            'unrelated logistics', 'EXTERNAL_SALES'::"OrderSettlementType",
            'LOGISTICS'::"CustomerPriceBookPurpose", 2, 'CNY', 'logistics.md',
            repeat('b', 64), clock.now - INTERVAL '3 days', NULL, TRUE,
            '{"workflow":{"status":"SYSTEM_RELEASE"}}'::JSONB,
            clock.now - INTERVAL '3 days', clock.now - INTERVAL '3 days'
          )
      ) AS seed(
        "id", "code", "name", "settlementType", "purpose", "version",
        "currency", "sourceName", "sourceSha256", "effectiveFrom",
        "effectiveTo", "isActive", "notes", "createdAt", "updatedAt"
      )
    `,
    [sourceCode, options.sourceVersion, DOCUMENT_SHA256, sourceId],
  );

  await client.query(`
    INSERT INTO "Product" (
      "id", "code", "name", "isActive", "createdAt", "updatedAt"
    ) VALUES
      ('product-pearl-red-large', 'EXT-STOCK-PEARL-RED-160-LARGE',
        '珠光闪红160g · 大号封', TRUE, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
      ('product-soft-touch-large', 'EXT-STOCK-SOFT-TOUCH-200-LARGE',
        '触感纸200g · 大号封', TRUE, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
      ('product-soft-touch-square', 'EXT-STOCK-SOFT-TOUCH-200-SQUARE',
        '触感纸200g · 方形', TRUE, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
      ('product-custom', 'EXT-CUSTOM-MID', '专版中号', TRUE,
        CURRENT_TIMESTAMP, CURRENT_TIMESTAMP);
  `);

  await client.query(
    `
      INSERT INTO "CustomerPriceRule" (
        "id", "priceBookId", "categoryId", "productId", "code", "name",
        "kind", "calculationType", "amount", "triggerCondition",
        "exclusiveGroup", "priority", "sourceSheet", "sourceRange",
        "sourceName", "sourceSha256", "blocksAutomaticQuote", "isActive",
        "createdAt", "updatedAt"
      ) VALUES
        (
          'rule-pearl-red-large', $1, 'base-category',
          'product-pearl-red-large', 'BASE_STOCK-PEARL-RED-160-LARGE',
          '珠光闪红160g · 大号封', 'BASE', 'PER_PIECE', $2,
          '{"route":"STOCK_LOCAL_FOIL"}', 'STOCK_BASE', 100,
          '加工费计费规则.md', '§1', '加工费计费规则.md', $4,
          FALSE, TRUE, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
        ),
        (
          'rule-soft-touch-large', $1, 'base-category',
          'product-soft-touch-large', 'BASE_STOCK-SOFT-TOUCH-200-LARGE',
          '触感纸200g · 大号封', 'BASE', 'PER_PIECE', $3,
          '{"route":"STOCK_LOCAL_FOIL"}', 'STOCK_BASE', 100,
          '加工费计费规则.md', '§1', '加工费计费规则.md', $4,
          FALSE, TRUE, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
        ),
        (
          'rule-soft-touch-square', $1, 'base-category',
          'product-soft-touch-square', 'BASE_STOCK-SOFT-TOUCH-200-SQUARE',
          '触感纸200g · 方形', 'BASE', 'PER_PIECE', 0.2200,
          '{"route":"STOCK_LOCAL_FOIL"}', 'STOCK_BASE', 100,
          '加工费计费规则.md', '§1', '加工费计费规则.md', $4,
          FALSE, TRUE, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
        )
    `,
    [
      sourceId,
      options.pearlRedAmount,
      options.softTouchLargeAmount,
      DOCUMENT_SHA256,
    ],
  );

  await client.query(
    `
      INSERT INTO "CustomerPriceRule" (
        "id", "priceBookId", "categoryId", "productId", "code", "name",
        "kind", "calculationType", "amount", "minQty", "maxQty",
        "triggerCondition", "exclusiveGroup", "priority",
        "blocksAutomaticQuote", "isActive", "createdAt", "updatedAt"
      )
      SELECT
        'custom-rule-' || value, $1, 'base-category', 'product-custom',
        'CUSTOM_TIER_' || value, 'custom tier ' || value, 'BASE', 'PER_PIECE',
        0.1800, value, value, '{}'::JSONB, 'CUSTOM_BASE', 100,
        FALSE, TRUE, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
      FROM generate_series(1, 50) value
    `,
    [sourceId],
  );

  await client.query(
    `
      INSERT INTO "CustomerPriceRule" (
        "id", "priceBookId", "categoryId", "code", "name", "kind",
        "priority", "blocksAutomaticQuote", "isActive", "createdAt", "updatedAt"
      )
      SELECT
        'filler-rule-' || value, $1, 'reference-category',
        'REFERENCE_' || value, 'reference ' || value, 'REFERENCE', 500,
        TRUE, TRUE, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
      FROM generate_series(1, 92) value
    `,
    [sourceId],
  );

  return { sourceId };
}

async function sourceRules(client: Client, sourceId: string): Promise<unknown[]> {
  const result = await client.query(
    `
      SELECT
        "id", "priceBookId", "categoryId", "productId", "code"::TEXT,
        "name", "kind"::TEXT, "calculationType"::TEXT, "amount"::TEXT,
        "includedUnits"::TEXT, "incrementUnits"::TEXT,
        "incrementAmount"::TEXT, "minQty", "maxQty", "triggerCondition",
        "exclusiveGroup", "priority", "sourceSheet", "sourceRange",
        "sourceName", "sourceSha256", "note", "blocksAutomaticQuote",
        "isActive", "createdAt", "updatedAt"
      FROM "CustomerPriceRule"
      WHERE "priceBookId" = $1
      ORDER BY "id"
    `,
    [sourceId],
  );
  return result.rows;
}

postgresDescribe('external processing price-truth repair migration · PostgreSQL', () => {
  it.each([
    {
      label: 'clean v4 to v5',
      sourceVersion: 4 as const,
      pearlRedAmount: '0.1300',
      softTouchLargeAmount: '0.2500',
    },
    {
      label: 'polluted v6 to v7',
      sourceVersion: 6 as const,
      pearlRedAmount: '0.8000',
      softTouchLargeAmount: '0.2600',
    },
  ])('$label publishes a continuous corrected snapshot', async (options) => {
    await withIsolatedSchema(async (client) => {
      await createSchema(client);
      const { sourceId } = await seedCurrentLineage(client, options);
      const rulesBefore = await sourceRules(client, sourceId);
      const unrelatedBefore = await client.query(
        `SELECT * FROM "CustomerPriceBook" WHERE "id" = 'unrelated-logistics'`,
      );
      const historicalBefore = await client.query(
        `SELECT * FROM "CustomerPriceBook" WHERE "id" = 'historical-processing'`,
      );

      await client.query(migration);

      const publication = await client.query<{
        sourceVersion: number;
        repairedVersion: number;
        continuous: boolean;
        currentCount: number;
        repairedRuleCount: number;
        squareRuleCount: number;
        productActive: boolean;
        status: string;
        publishedBy: string;
        topLevelRuleHash: boolean;
        workflowRuleHash: string | null;
      }>(`
        SELECT
          source."version" AS "sourceVersion",
          repaired."version" AS "repairedVersion",
          source."effectiveTo" = repaired."effectiveFrom" AS continuous,
          (
            SELECT COUNT(*)::INT
            FROM "CustomerPriceBook" current_book
            WHERE current_book."settlementType" = 'EXTERNAL_SALES'
              AND current_book."purpose" = 'PROCESSING'
              AND current_book."isActive" = TRUE
              AND current_book."effectiveFrom" <= CURRENT_TIMESTAMP
              AND (
                current_book."effectiveTo" IS NULL
                OR current_book."effectiveTo" > CURRENT_TIMESTAMP
              )
          ) AS "currentCount",
          (
            SELECT COUNT(*)::INT FROM "CustomerPriceRule"
            WHERE "priceBookId" = repaired."id"
          ) AS "repairedRuleCount",
          (
            SELECT COUNT(*)::INT FROM "CustomerPriceRule" rule
            WHERE rule."priceBookId" = repaired."id"
              AND rule."code"::TEXT = 'BASE_STOCK-SOFT-TOUCH-200-SQUARE'
          ) AS "squareRuleCount",
          product."isActive" AS "productActive",
          repaired."notes" #>> '{workflow,status}' AS status,
          repaired."notes" #>> '{workflow,publishedBy}' AS "publishedBy",
          repaired."notes" ? 'ruleSetSha256' AS "topLevelRuleHash",
          repaired."notes" #>> '{workflow,ruleSetSha256}' AS "workflowRuleHash"
        FROM "CustomerPriceBook" source
        CROSS JOIN "CustomerPriceBook" repaired
        CROSS JOIN "Product" product
        WHERE source."id" = $1
          AND repaired."id" = 'cpb_external_processing_truth_repair_v1'
          AND product."code" = 'EXT-STOCK-SOFT-TOUCH-200-SQUARE'
      `, [sourceId]);
      expect(publication.rows[0]).toEqual({
        sourceVersion: options.sourceVersion,
        repairedVersion: options.sourceVersion + 1,
        continuous: true,
        currentCount: 1,
        repairedRuleCount: 144,
        squareRuleCount: 0,
        productActive: false,
        status: 'SYSTEM_RELEASE',
        publishedBy: 'SYSTEM_MIGRATION',
        topLevelRuleHash: false,
        workflowRuleHash: null,
      });

      const corrected = await client.query<{ code: string; amount: string }>(`
        SELECT "code"::TEXT AS code, "amount"::TEXT AS amount
        FROM "CustomerPriceRule"
        WHERE "priceBookId" = 'cpb_external_processing_truth_repair_v1'
          AND "code"::TEXT IN (
            'BASE_STOCK-PEARL-RED-160-LARGE',
            'BASE_STOCK-SOFT-TOUCH-200-LARGE'
          )
        ORDER BY "code"::TEXT
      `);
      expect(corrected.rows).toEqual([
        { code: 'BASE_STOCK-PEARL-RED-160-LARGE', amount: '0.1300' },
        { code: 'BASE_STOCK-SOFT-TOUCH-200-LARGE', amount: '0.2500' },
      ]);
      expect(await sourceRules(client, sourceId)).toEqual(rulesBefore);
      expect(
        await client.query(
          `SELECT * FROM "CustomerPriceBook" WHERE "id" = 'unrelated-logistics'`,
        ),
      ).toMatchObject({ rows: unrelatedBefore.rows });
      expect(
        await client.query(
          `SELECT * FROM "CustomerPriceBook" WHERE "id" = 'historical-processing'`,
        ),
      ).toMatchObject({ rows: historicalBefore.rows });

      const repairedBeforeRetry = await client.query(`
        SELECT book.*, jsonb_agg(to_jsonb(rule) ORDER BY rule."id") AS rules
        FROM "CustomerPriceBook" book
        JOIN "CustomerPriceRule" rule ON rule."priceBookId" = book."id"
        WHERE book."id" = 'cpb_external_processing_truth_repair_v1'
        GROUP BY book."id"
      `);
      const productBeforeRetry = await client.query(`
        SELECT * FROM "Product"
        WHERE "code" = 'EXT-STOCK-SOFT-TOUCH-200-SQUARE'
      `);
      await client.query(migration);
      const repairedAfterRetry = await client.query(`
        SELECT book.*, jsonb_agg(to_jsonb(rule) ORDER BY rule."id") AS rules
        FROM "CustomerPriceBook" book
        JOIN "CustomerPriceRule" rule ON rule."priceBookId" = book."id"
        WHERE book."id" = 'cpb_external_processing_truth_repair_v1'
        GROUP BY book."id"
      `);
      const productAfterRetry = await client.query(`
        SELECT * FROM "Product"
        WHERE "code" = 'EXT-STOCK-SOFT-TOUCH-200-SQUARE'
      `);
      expect(repairedAfterRetry.rows).toEqual(repairedBeforeRetry.rows);
      expect(productAfterRetry.rows).toEqual(productBeforeRetry.rows);
    });
  });

  it('does not touch an unrelated current processing lineage', async () => {
    await withIsolatedSchema(async (client) => {
      await createSchema(client);
      const { sourceId } = await seedCurrentLineage(client, {
        sourceVersion: 6,
        pearlRedAmount: '0.8000',
        softTouchLargeAmount: '0.2600',
        sourceCode: 'ADMINISTRATOR_PROCESSING_RULES',
      });
      const sourceBefore = await client.query(
        `SELECT * FROM "CustomerPriceBook" WHERE "id" = $1`,
        [sourceId],
      );
      const productBefore = await client.query(`
        SELECT * FROM "Product"
        WHERE "code" = 'EXT-STOCK-SOFT-TOUCH-200-SQUARE'
      `);

      await client.query(migration);

      expect(
        await client.query(
          `SELECT * FROM "CustomerPriceBook" WHERE "id" = $1`,
          [sourceId],
        ),
      ).toMatchObject({ rows: sourceBefore.rows });
      expect(
        await client.query(`
          SELECT * FROM "Product"
          WHERE "code" = 'EXT-STOCK-SOFT-TOUCH-200-SQUARE'
        `),
      ).toMatchObject({ rows: productBefore.rows });
      const repaired = await client.query(`
        SELECT 1 FROM "CustomerPriceBook"
        WHERE "id" = 'cpb_external_processing_truth_repair_v1'
      `);
      expect(repaired.rowCount).toBe(0);
    });
  });

  it('fails closed when the recognized five-tier snapshot is incomplete', async () => {
    await withIsolatedSchema(async (client) => {
      await createSchema(client);
      await seedCurrentLineage(client, {
        sourceVersion: 4,
        pearlRedAmount: '0.1300',
        softTouchLargeAmount: '0.2500',
      });
      await client.query(`DELETE FROM "CustomerPriceRule" WHERE "id" = 'filler-rule-92'`);

      await expect(client.query(migration)).rejects.toThrow(
        'Expected five-tier processing source to contain 145 rules',
      );
      await client.query('ROLLBACK');

      const repaired = await client.query(`
        SELECT 1 FROM "CustomerPriceBook"
        WHERE "id" = 'cpb_external_processing_truth_repair_v1'
      `);
      expect(repaired.rowCount).toBe(0);
    });
  });
});
