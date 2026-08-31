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
    'prisma/migrations/20260830091000_external_processing_truth_repair_integrity_guard/migration.sql',
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
  const schema = `truth_guard_${randomBytes(8).toString('hex')}`;
  const quotedSchema = quotedIdentifier(schema);
  await client.connect();
  try {
    await client.query(`CREATE SCHEMA ${quotedSchema}`);
    await client.query(`SET search_path TO ${quotedSchema}, public`);
    await client.query(`
      CREATE DOMAIN citext AS TEXT;
      CREATE TYPE "OrderSettlementType" AS ENUM ('EXTERNAL_SALES');
      CREATE TYPE "CustomerPriceBookPurpose" AS ENUM ('PROCESSING');

      CREATE TABLE "CustomerPriceBook" (
        "id" TEXT PRIMARY KEY,
        "code" citext NOT NULL,
        "settlementType" "OrderSettlementType" NOT NULL,
        "purpose" "CustomerPriceBookPurpose" NOT NULL,
        "sourceName" TEXT NOT NULL,
        "sourceSha256" TEXT NOT NULL,
        "notes" JSONB
      );

      CREATE TABLE "Product" (
        "id" TEXT PRIMARY KEY,
        "code" citext UNIQUE,
        "isActive" BOOLEAN NOT NULL
      );

      CREATE TABLE "CustomerPriceRule" (
        "id" TEXT PRIMARY KEY,
        "priceBookId" TEXT NOT NULL,
        "productId" TEXT,
        "code" citext NOT NULL,
        "amount" DECIMAL(14, 4),
        "isActive" BOOLEAN NOT NULL
      );
    `);
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

async function seedValidTarget(client: Client): Promise<void> {
  await client.query(`
    INSERT INTO "CustomerPriceBook" (
      "id", "code", "settlementType", "purpose", "sourceName",
      "sourceSha256", "notes"
    ) VALUES (
      'cpb_external_processing_truth_repair_v1',
      'EXTERNAL_SALES_PROCESSING_RULES',
      'EXTERNAL_SALES',
      'PROCESSING',
      '加工费计费规则.md',
      '8a5e1149a2e62920c7ebf9d14a6cedf4e6dac5e0769d556b5a52dbeb99dbd852',
      '{
        "ruleVersion":"2026-08-30-price-truth-repair",
        "workflow":{
          "status":"SYSTEM_RELEASE",
          "publishedBy":"SYSTEM_MIGRATION"
        }
      }'::JSONB
    );

    INSERT INTO "Product" ("id", "code", "isActive") VALUES
      ('retired-square', 'EXT-STOCK-SOFT-TOUCH-200-SQUARE', FALSE);

    INSERT INTO "CustomerPriceRule" (
      "id", "priceBookId", "code", "amount", "isActive"
    ) VALUES
      ('pearl-red-large', 'cpb_external_processing_truth_repair_v1',
        'BASE_STOCK-PEARL-RED-160-LARGE', 0.1300, TRUE),
      ('soft-touch-large', 'cpb_external_processing_truth_repair_v1',
        'BASE_STOCK-SOFT-TOUCH-200-LARGE', 0.2500, TRUE);

    INSERT INTO "CustomerPriceRule" (
      "id", "priceBookId", "code", "amount", "isActive"
    )
    SELECT
      'filler-' || value,
      'cpb_external_processing_truth_repair_v1',
      'FILLER-' || value,
      1.0000,
      TRUE
    FROM generate_series(1, 142) value;
  `);
}

postgresDescribe.sequential(
  'external processing truth-repair integrity guard · PostgreSQL',
  () => {
    it('allows a legitimately absent repair target', async () => {
      await withIsolatedSchema(async (client) => {
        await expect(client.query(migration)).resolves.toBeDefined();
      });
    });

    it('rejects a preoccupied target id with unrelated provenance', async () => {
      await withIsolatedSchema(async (client) => {
        await client.query(`
          INSERT INTO "CustomerPriceBook" (
            "id", "code", "settlementType", "purpose", "sourceName",
            "sourceSha256", "notes"
          ) VALUES (
            'cpb_external_processing_truth_repair_v1',
            'UNRELATED',
            'EXTERNAL_SALES',
            'PROCESSING',
            'unknown',
            repeat('0', 64),
            '{}'::JSONB
          )
        `);

        await expect(client.query(migration)).rejects.toThrow(
          'target id is occupied by invalid provenance',
        );
      });
    });

    it('accepts the exact repaired snapshot', async () => {
      await withIsolatedSchema(async (client) => {
        await seedValidTarget(client);
        await expect(client.query(migration)).resolves.toBeDefined();
      });
    });
  },
);
