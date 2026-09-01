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
    'prisma/migrations/20260830170000_external_processing_print_null_sentinel/migration.sql',
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
  const client = new Client({
    connectionString: databaseUrl,
    query_timeout: 10_000,
  });
  const schema = `print_sentinel_${randomBytes(8).toString('hex')}`;
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
    CREATE TYPE "CustomerPriceBookPurpose" AS ENUM ('PROCESSING');
    CREATE TYPE "CustomerPriceRuleKind" AS ENUM ('BASE', 'ADD_ON', 'REFERENCE');
    CREATE TYPE "CustomerPriceCalculationType" AS ENUM (
      'FIXED_AMOUNT', 'PER_PIECE', 'PER_SHEET', 'PER_10K', 'PER_ITEM'
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
      UNIQUE ("priceBookId", "code"),
      CONSTRAINT "CustomerPriceRule_values_valid" CHECK (
        btrim("code"::TEXT) <> '' AND
        btrim("name") <> '' AND
        "priority" >= 0 AND
        ("amount" IS NULL OR "amount" BETWEEN 0 AND 9999999999.9999) AND
        ("minQty" IS NULL OR "minQty" BETWEEN 1 AND 9999999) AND
        ("maxQty" IS NULL OR "maxQty" BETWEEN 1 AND 9999999) AND
        ("minQty" IS NULL OR "maxQty" IS NULL OR "minQty" <= "maxQty") AND
        ("triggerCondition" IS NULL OR jsonb_typeof("triggerCondition") = 'object') AND
        (("calculationType" IS NULL) = ("amount" IS NULL)) AND
        (
          "kind" = 'REFERENCE'::"CustomerPriceRuleKind" OR
          ("calculationType" IS NOT NULL AND "amount" IS NOT NULL)
        ) AND
        ("kind" <> 'BASE'::"CustomerPriceRuleKind" OR "productId" IS NOT NULL) AND
        (NOT "blocksAutomaticQuote" OR "kind" = 'REFERENCE'::"CustomerPriceRuleKind") AND
        (
          "calculationType" IS DISTINCT FROM 'PER_SHEET'::"CustomerPriceCalculationType" OR
          ("triggerCondition" IS NOT NULL AND "triggerCondition" ? 'unitsPerSheet')
        )
      )
    );
  `);
}

async function seedTruthRepair(
  client: Client,
  version: 5 | 7,
): Promise<void> {
  await client.query(`
    INSERT INTO "CustomerPriceBook" (
      "id", "code", "name", "settlementType", "purpose", "version",
      "currency", "sourceName", "sourceSha256", "effectiveFrom",
      "effectiveTo", "isActive", "notes", "createdAt", "updatedAt"
    ) VALUES (
      'cpb_external_processing_truth_repair_v1',
      'EXTERNAL_SALES_PROCESSING_RULES', 'v${version}', 'EXTERNAL_SALES',
      'PROCESSING', ${version}, 'CNY', '加工费计费规则.md',
      '8a5e1149a2e62920c7ebf9d14a6cedf4e6dac5e0769d556b5a52dbeb99dbd852',
      CURRENT_TIMESTAMP - INTERVAL '1 day', NULL, TRUE,
      '{"ruleVersion":"2026-08-30-price-truth-repair"}'::JSONB,
      CURRENT_TIMESTAMP - INTERVAL '1 day', CURRENT_TIMESTAMP - INTERVAL '1 day'
    );

    INSERT INTO "Product" ("id", "code", "name") VALUES (
      'product-ice-mid', 'EXT-COLOR-ICE-WHITE-160-MID', '冰白纸160g · 中号封'
    );

    INSERT INTO "CustomerPriceRule" (
      "id", "priceBookId", "categoryId", "productId", "code", "name",
      "kind", "calculationType", "amount", "minQty", "maxQty",
      "triggerCondition", "exclusiveGroup", "priority", "sourceSheet",
      "sourceRange", "sourceName", "sourceSha256", "note",
      "blocksAutomaticQuote", "isActive", "createdAt", "updatedAt"
    ) VALUES (
      'ice-mid-q1000', 'cpb_external_processing_truth_repair_v1',
      'base-processing', 'product-ice-mid',
      'BASE_COLOR-ICE-WHITE-160-MID_Q1000', '冰白纸160g中号 Q1000',
      'BASE', 'FIXED_AMOUNT', 320.0000, 1000, 1000,
      '{
        "target":"ITEM",
        "pricingRoutes":["COLOR_PRINT"],
        "productCodes":["EXT-COLOR-ICE-WHITE-160-MID"],
        "specifications":["中号封"],
        "paperTypes":["冰白纸"]
      }'::JSONB,
      'COLOR_BASE', 100, '加工费计费规则.md', '§3 Q1000',
      '加工费计费规则.md',
      '8a5e1149a2e62920c7ebf9d14a6cedf4e6dac5e0769d556b5a52dbeb99dbd852',
      NULL, FALSE, TRUE, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
    );

    INSERT INTO "CustomerPriceRule" (
      "id", "priceBookId", "categoryId", "code", "name", "kind",
      "calculationType", "amount", "triggerCondition", "exclusiveGroup",
      "priority", "blocksAutomaticQuote", "isActive", "createdAt", "updatedAt"
    )
    SELECT
      'filler-' || value,
      'cpb_external_processing_truth_repair_v1',
      'base-processing', 'FILLER-' || value, 'filler ' || value,
      'ADD_ON', 'FIXED_AMOUNT', 1.0000, '{}'::JSONB, 'FILLER', 1,
      FALSE, TRUE, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
    FROM generate_series(1, 143) value;
  `);
}

async function insertDerivedNullRule(
  client: Client,
  input: {
    id: string;
    quantity: number;
    exclusiveGroup: string;
    triggerMutation: 'NONE' | 'MISSING_TARGET' | 'NULL_PRODUCT_CODE';
  },
): Promise<void> {
  const triggerExpression =
    input.triggerMutation === 'MISSING_TARGET'
      ? '"triggerCondition" - \'target\''
      : input.triggerMutation === 'NULL_PRODUCT_CODE'
        ? `jsonb_set(
            "triggerCondition",
            '{productCodes}',
            '[null]'::JSONB
          )`
        : '"triggerCondition"';
  await client.query(
    `
      INSERT INTO "CustomerPriceRule" (
        "id", "priceBookId", "categoryId", "productId", "code", "name",
        "kind", "calculationType", "amount", "minQty", "maxQty",
        "triggerCondition", "exclusiveGroup", "priority", "sourceSheet",
        "sourceRange", "blocksAutomaticQuote", "isActive",
        "createdAt", "updatedAt"
      )
      SELECT
        $1, "priceBookId", "categoryId", "productId", $2, 'illegal null',
        "kind", "calculationType", NULL, $3, $3, ${triggerExpression}, $4,
        "priority", "sourceSheet", "sourceRange", FALSE, TRUE,
        CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
      FROM "CustomerPriceRule"
      WHERE "id" = 'cpr_printsentinel_ice_mid_q2000'
    `,
    [
      input.id,
      `ILLEGAL_COLOR_Q${input.quantity}`,
      input.quantity,
      input.exclusiveGroup,
    ],
  );
}

postgresDescribe.sequential(
  'external processing print null-sentinel migration · PostgreSQL',
  () => {
    it.each([5, 7] as const)(
      'preserves truth-repair v%i and publishes one terminal null tier in its successor',
      async (sourceVersion) => {
        await withIsolatedSchema(async (client) => {
          await createSchema(client);
          await seedTruthRepair(client, sourceVersion);

        await client.query(migration);

        const books = await client.query<{
          id: string;
          version: number;
          effectiveTo: Date | null;
        }>(`
          SELECT "id", "version", "effectiveTo"
          FROM "CustomerPriceBook"
          ORDER BY "version"
        `);
        expect(books.rows).toHaveLength(2);
        expect(books.rows[0]).toMatchObject({
          id: 'cpb_external_processing_truth_repair_v1',
          version: sourceVersion,
        });
        expect(books.rows[0]!.effectiveTo).not.toBeNull();
        expect(books.rows[1]).toMatchObject({
          id: 'cpb_external_processing_print_sentinel_v1',
          version: sourceVersion + 1,
          effectiveTo: null,
        });

        const counts = await client.query<{ priceBookId: string; count: string }>(`
          SELECT "priceBookId", COUNT(*)::TEXT AS count
          FROM "CustomerPriceRule"
          GROUP BY "priceBookId"
          ORDER BY "priceBookId"
        `);
        expect(counts.rows).toEqual([
          {
            priceBookId: 'cpb_external_processing_print_sentinel_v1',
            count: '145',
          },
          {
            priceBookId: 'cpb_external_processing_truth_repair_v1',
            count: '144',
          },
        ]);

        const sentinel = await client.query<{
          amount: string | null;
          minQty: number;
          maxQty: number;
        }>(`
          SELECT "amount", "minQty", "maxQty"
          FROM "CustomerPriceRule"
          WHERE "priceBookId" = 'cpb_external_processing_print_sentinel_v1'
            AND "code" = 'BASE_COLOR-ICE-WHITE-160-MID_Q2000'
        `);
        expect(sentinel.rows).toEqual([
          { amount: null, minQty: 2000, maxQty: 2000 },
        ]);

        await client.query(migration);
        const afterRetry = await client.query<{ count: string }>(`
          SELECT COUNT(*)::TEXT AS count FROM "CustomerPriceBook"
        `);
        expect(afterRetry.rows[0]?.count).toBe('2');
        });
      },
    );

    it('fails closed when the sole current truth-repair identity has drifted provenance', async () => {
      await withIsolatedSchema(async (client) => {
        await createSchema(client);
        await seedTruthRepair(client, 7);
        await client.query(`
          UPDATE "CustomerPriceBook"
          SET "sourceSha256" = repeat('0', 64)
          WHERE "id" = 'cpb_external_processing_truth_repair_v1'
        `);

        await expect(client.query(migration)).rejects.toThrow(
          'Expected current processing truth-repair identity has invalid source provenance',
        );
      });
    });

    it('keeps rejecting every non-sentinel null amount shape', async () => {
      await withIsolatedSchema(async (client) => {
        await createSchema(client);
        await seedTruthRepair(client, 7);
        await client.query(migration);

        for (const illegal of [
          {
            id: 'illegal-null-wrong-group',
            quantity: 3_000,
            exclusiveGroup: 'NOT_COLOR_BASE',
            triggerMutation: 'NONE' as const,
          },
          {
            id: 'illegal-null-missing-target',
            quantity: 3_001,
            exclusiveGroup: 'COLOR_BASE',
            triggerMutation: 'MISSING_TARGET' as const,
          },
          {
            id: 'illegal-null-product-code',
            quantity: 3_002,
            exclusiveGroup: 'COLOR_BASE',
            triggerMutation: 'NULL_PRODUCT_CODE' as const,
          },
        ]) {
          await expect(insertDerivedNullRule(client, illegal)).rejects
            .toMatchObject({
              constraint: 'CustomerPriceRule_values_valid',
            });
        }
      });
    });

    it('fails closed when the expected truth-repair rule set has drifted', async () => {
      await withIsolatedSchema(async (client) => {
        await createSchema(client);
        await seedTruthRepair(client, 7);
        await client.query(`DELETE FROM "CustomerPriceRule" WHERE "id" = 'filler-1'`);

        await expect(client.query(migration)).rejects.toThrow(
          'Expected processing truth-repair source to contain 144 rules',
        );
      });
    });

    it('does not let an inactive higher version mask sole-current truth-repair drift', async () => {
      await withIsolatedSchema(async (client) => {
        await createSchema(client);
        await seedTruthRepair(client, 7);
        await client.query(`
          UPDATE "CustomerPriceBook"
          SET "sourceSha256" = repeat('0', 64)
          WHERE "id" = 'cpb_external_processing_truth_repair_v1';

          INSERT INTO "CustomerPriceBook" (
            "id", "code", "name", "settlementType", "purpose", "version",
            "currency", "sourceName", "sourceSha256", "effectiveFrom",
            "effectiveTo", "isActive", "notes", "createdAt", "updatedAt"
          )
          SELECT
            'inactive-v8', "code", 'inactive successor', "settlementType",
            "purpose", 8, "currency", "sourceName", "sourceSha256",
            "effectiveFrom" + INTERVAL '2 days', NULL, FALSE, "notes",
            CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
          FROM "CustomerPriceBook"
          WHERE "id" = 'cpb_external_processing_truth_repair_v1'
        `);

        await expect(client.query(migration)).rejects.toThrow(
          'Expected current processing truth-repair identity has invalid source provenance',
        );
      });
    });

    it('fails closed instead of treating an active future version as a current successor', async () => {
      await withIsolatedSchema(async (client) => {
        await createSchema(client);
        await seedTruthRepair(client, 7);
        await client.query(`
          INSERT INTO "CustomerPriceBook" (
            "id", "code", "name", "settlementType", "purpose", "version",
            "currency", "sourceName", "sourceSha256", "effectiveFrom",
            "effectiveTo", "isActive", "notes", "createdAt", "updatedAt"
          )
          SELECT
            'future-v8', "code", 'scheduled successor', "settlementType",
            "purpose", 8, "currency", "sourceName", "sourceSha256",
            CURRENT_TIMESTAMP + INTERVAL '2 days', NULL, TRUE, "notes",
            CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
          FROM "CustomerPriceBook"
          WHERE "id" = 'cpb_external_processing_truth_repair_v1'
        `);

        await expect(client.query(migration)).rejects.toThrow(
          'Expected current processing truth-repair identity has invalid source provenance',
        );
        await client.query('ROLLBACK');

        const books = await client.query<{
          id: string;
          effectiveTo: Date | null;
        }>(`
          SELECT "id", "effectiveTo"
          FROM "CustomerPriceBook"
          ORDER BY "version"
        `);
        expect(books.rows).toEqual([
          {
            id: 'cpb_external_processing_truth_repair_v1',
            effectiveTo: null,
          },
          { id: 'future-v8', effectiveTo: null },
        ]);
        expect(
          books.rows.some(
            (book) =>
              book.id === 'cpb_external_processing_print_sentinel_v1',
          ),
        ).toBe(false);
      });
    });
  },
);
