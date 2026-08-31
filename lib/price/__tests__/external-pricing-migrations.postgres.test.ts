import 'dotenv/config';

import { randomBytes } from 'node:crypto';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { Client } from 'pg';
import { describe, expect, it } from 'vitest';

const databaseUrl = process.env.DATABASE_URL;
const postgresDescribe = databaseUrl ? describe : describe.skip;

const repairMigration = readFileSync(
  path.join(
    process.cwd(),
    'prisma/migrations/20260827102000_repair_external_pricing_v2_history/migration.sql',
  ),
  'utf8',
);

const v3Migration = readFileSync(
  path.join(
    process.cwd(),
    'prisma/migrations/20260827103000_external_processing_rule_v3_conditions/migration.sql',
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
  const schema = `migration_regression_${randomBytes(8).toString('hex')}`;
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

async function createPriceBookTimelineSchema(client: Client): Promise<void> {
  await client.query(`
    CREATE DOMAIN citext AS TEXT;
    CREATE TYPE "OrderSettlementType" AS ENUM ('EXTERNAL_SALES');
    CREATE TYPE "CustomerPriceBookPurpose" AS ENUM ('PROCESSING', 'LOGISTICS');
    CREATE TABLE "CustomerPriceBook" (
      "id" TEXT PRIMARY KEY,
      "code" citext NOT NULL,
      "name" TEXT NOT NULL,
      "settlementType" "OrderSettlementType" NOT NULL,
      "purpose" "CustomerPriceBookPurpose" NOT NULL,
      "version" INTEGER NOT NULL,
      "currency" TEXT NOT NULL,
      "sourceName" TEXT,
      "sourceSha256" TEXT,
      "effectiveFrom" TIMESTAMP(3) NOT NULL,
      "effectiveTo" TIMESTAMP(3),
      "isActive" BOOLEAN NOT NULL,
      "notes" JSONB,
      "createdAt" TIMESTAMP(3) NOT NULL,
      "updatedAt" TIMESTAMP(3) NOT NULL
    );
    CREATE TABLE "CustomerChargeCategory" (
      "id" TEXT PRIMARY KEY,
      "code" citext NOT NULL
    );
    CREATE TABLE "CustomerPriceRule" (
      "id" TEXT PRIMARY KEY,
      "priceBookId" TEXT NOT NULL,
      "categoryId" TEXT NOT NULL,
      "sourceSheet" TEXT,
      "sourceName" TEXT,
      "sourceSha256" TEXT,
      "updatedAt" TIMESTAMP(3) NOT NULL
    );
  `);
}

async function createV3RuleSchema(client: Client): Promise<void> {
  await client.query(`
    CREATE TYPE "CustomerPriceRuleKind" AS ENUM ('BASE', 'REFERENCE', 'ADD_ON');
    CREATE TYPE "CustomerPriceCalculationType" AS ENUM ('FIXED_AMOUNT', 'PER_BAG');
    ALTER TABLE "CustomerPriceRule"
      ADD COLUMN "productId" TEXT,
      ADD COLUMN "code" citext,
      ADD COLUMN "name" TEXT,
      ADD COLUMN "kind" "CustomerPriceRuleKind",
      ADD COLUMN "calculationType" "CustomerPriceCalculationType",
      ADD COLUMN "amount" DECIMAL(14, 4),
      ADD COLUMN "includedUnits" DECIMAL(14, 4),
      ADD COLUMN "incrementUnits" DECIMAL(14, 4),
      ADD COLUMN "incrementAmount" DECIMAL(14, 4),
      ADD COLUMN "minQty" INTEGER,
      ADD COLUMN "maxQty" INTEGER,
      ADD COLUMN "triggerCondition" JSONB,
      ADD COLUMN "exclusiveGroup" TEXT,
      ADD COLUMN "priority" INTEGER,
      ADD COLUMN "sourceRange" TEXT,
      ADD COLUMN "note" TEXT,
      ADD COLUMN "blocksAutomaticQuote" BOOLEAN,
      ADD COLUMN "isActive" BOOLEAN,
      ADD COLUMN "createdAt" TIMESTAMP(3);
    CREATE TABLE "Product" ("id" TEXT PRIMARY KEY, "paperType" TEXT);
  `);
}

postgresDescribe('external pricing migrations · PostgreSQL timeline', () => {
  it('restores only a still-future segment after the current successor', async () => {
    await withIsolatedSchema(async (client) => {
      await createPriceBookTimelineSchema(client);
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
              'cpb_external_processing_rule_v2', 'SYSTEM_PROCESSING',
              '系统 v2', 'EXTERNAL_SALES'::"OrderSettlementType",
              'PROCESSING'::"CustomerPriceBookPurpose", 1, 'CNY', NULL, NULL,
              clock.now - INTERVAL '48 hours', clock.now - INTERVAL '24 hours',
              TRUE, '{"workflow":{"status":"SYSTEM_RELEASE"}}'::JSONB,
              clock.now - INTERVAL '48 hours', clock.now - INTERVAL '48 hours'
            ),
            (
              'cpb_external_processing_rule_v2_packaging', 'SYSTEM_PROCESSING',
              '系统包装 successor', 'EXTERNAL_SALES'::"OrderSettlementType",
              'PROCESSING'::"CustomerPriceBookPurpose", 2, 'CNY', NULL, NULL,
              clock.now - INTERVAL '24 hours', NULL, TRUE,
              '{"workflow":{"status":"SYSTEM_RELEASE"}}'::JSONB,
              clock.now - INTERVAL '24 hours', clock.now - INTERVAL '24 hours'
            ),
            (
              'scheduled_before_successor', 'OLD_SCHEDULE', '过早计划版',
              'EXTERNAL_SALES'::"OrderSettlementType",
              'PROCESSING'::"CustomerPriceBookPurpose", 3, 'CNY', NULL, NULL,
              clock.now - INTERVAL '36 hours', NULL, FALSE,
              '{"workflow":{"status":"PUBLISHED"}}'::JSONB,
              clock.now - INTERVAL '72 hours', clock.now - INTERVAL '48 hours'
            ),
            (
              'scheduled_expired', 'OLD_SCHEDULE', '已到期计划版',
              'EXTERNAL_SALES'::"OrderSettlementType",
              'PROCESSING'::"CustomerPriceBookPurpose", 4, 'CNY', NULL, NULL,
              clock.now - INTERVAL '12 hours', clock.now - INTERVAL '6 hours',
              FALSE, '{"workflow":{"status":"PUBLISHED"}}'::JSONB,
              clock.now - INTERVAL '72 hours', clock.now - INTERVAL '48 hours'
            ),
            (
              'scheduled_future', 'OLD_SCHEDULE', '未来计划版',
              'EXTERNAL_SALES'::"OrderSettlementType",
              'PROCESSING'::"CustomerPriceBookPurpose", 5, 'CNY', NULL, NULL,
              clock.now + INTERVAL '24 hours', NULL, FALSE,
              '{"workflow":{"status":"PUBLISHED"}}'::JSONB,
              clock.now - INTERVAL '72 hours', clock.now - INTERVAL '48 hours'
            )
        ) AS seed(
          "id", "code", "name", "settlementType", "purpose", "version",
          "currency", "sourceName", "sourceSha256", "effectiveFrom",
          "effectiveTo", "isActive", "notes", "createdAt", "updatedAt"
        );
      `);

      await client.query(repairMigration);

      const result = await client.query<{
        id: string;
        isActive: boolean;
        closesSuccessor: boolean;
      }>(`
        SELECT
          scheduled."id" AS id,
          scheduled."isActive" AS "isActive",
          successor."effectiveTo" = scheduled."effectiveFrom"
            AS "closesSuccessor"
        FROM "CustomerPriceBook" scheduled
        CROSS JOIN "CustomerPriceBook" successor
        WHERE scheduled."id" IN (
          'scheduled_before_successor',
          'scheduled_expired',
          'scheduled_future'
        )
          AND successor."id" = 'cpb_external_processing_rule_v2_packaging'
        ORDER BY scheduled."id"
      `);

      expect(result.rows).toEqual([
        {
          id: 'scheduled_before_successor',
          isActive: false,
          closesSuccessor: false,
        },
        {
          id: 'scheduled_expired',
          isActive: false,
          closesSuccessor: false,
        },
        {
          id: 'scheduled_future',
          isActive: true,
          closesSuccessor: true,
        },
      ]);
    });
  });

  it('preserves an administrator current version and its lamination facts', async () => {
    await withIsolatedSchema(async (client) => {
      await createPriceBookTimelineSchema(client);
      await createV3RuleSchema(client);
      await client.query(`
        INSERT INTO "CustomerPriceBook" (
          "id", "code", "name", "settlementType", "purpose", "version",
          "currency", "effectiveFrom", "effectiveTo", "isActive", "notes",
          "createdAt", "updatedAt"
        ) VALUES (
          'admin_current_processing', 'ADMIN_PROCESSING', '管理员当前版',
          'EXTERNAL_SALES', 'PROCESSING', 9, 'CNY',
          (CURRENT_TIMESTAMP AT TIME ZONE 'UTC') - INTERVAL '1 day',
          NULL, TRUE, '{"workflow":{"status":"PUBLISHED"}}',
          (CURRENT_TIMESTAMP AT TIME ZONE 'UTC') - INTERVAL '1 day',
          (CURRENT_TIMESTAMP AT TIME ZONE 'UTC') - INTERVAL '1 day'
        );
        INSERT INTO "CustomerPriceRule" (
          "id", "priceBookId", "categoryId", "code", "name", "kind",
          "calculationType", "amount", "triggerCondition", "priority",
          "blocksAutomaticQuote", "isActive", "createdAt", "updatedAt"
        ) VALUES (
          'admin_color_base', 'admin_current_processing', 'admin_category',
          'ADMIN_COLOR_BASE', '管理员彩印规则', 'BASE', 'FIXED_AMOUNT', 88,
          '{"pricingRoutes":["COLOR_PRINT"],"laminations":["ADMIN_CUSTOM"]}',
          1, FALSE, TRUE,
          CURRENT_TIMESTAMP AT TIME ZONE 'UTC',
          CURRENT_TIMESTAMP AT TIME ZONE 'UTC'
        );
      `);

      await client.query(v3Migration);

      const book = await client.query<{
        effectiveTo: Date | null;
        v3Count: string;
      }>(`
        SELECT
          admin."effectiveTo" AS "effectiveTo",
          (
            SELECT COUNT(*)::TEXT
            FROM "CustomerPriceBook"
            WHERE "id" = 'cpb_external_processing_rule_v3'
          ) AS "v3Count"
        FROM "CustomerPriceBook" admin
        WHERE admin."id" = 'admin_current_processing'
      `);
      const rule = await client.query<{ triggerCondition: unknown }>(`
        SELECT "triggerCondition" AS "triggerCondition"
        FROM "CustomerPriceRule"
        WHERE "id" = 'admin_color_base'
      `);

      expect(book.rows[0]).toEqual({ effectiveTo: null, v3Count: '0' });
      expect(rule.rows[0]?.triggerCondition).toEqual({
        pricingRoutes: ['COLOR_PRINT'],
        laminations: ['ADMIN_CUSTOM'],
      });
    });
  });

  it('hands the system predecessor to v3 and then to the future version', async () => {
    await withIsolatedSchema(async (client) => {
      await createPriceBookTimelineSchema(client);
      await createV3RuleSchema(client);
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
              'cpb_external_processing_rule_v2', 'SYSTEM_PROCESSING',
              '系统 v2', 'EXTERNAL_SALES'::"OrderSettlementType",
              'PROCESSING'::"CustomerPriceBookPurpose", 1, 'CNY', NULL, NULL,
              clock.now - INTERVAL '48 hours', clock.now - INTERVAL '24 hours',
              TRUE, '{"workflow":{"status":"SYSTEM_RELEASE"}}'::JSONB,
              clock.now - INTERVAL '48 hours', clock.now - INTERVAL '48 hours'
            ),
            (
              'cpb_external_processing_rule_v2_packaging', 'SYSTEM_PROCESSING',
              '系统包装 successor', 'EXTERNAL_SALES'::"OrderSettlementType",
              'PROCESSING'::"CustomerPriceBookPurpose", 2, 'CNY', NULL, NULL,
              clock.now - INTERVAL '24 hours', NULL, TRUE,
              '{
                "supersedesPriceBookId":"cpb_external_processing_rule_v2",
                "workflow":{
                  "status":"SYSTEM_RELEASE",
                  "basedOn":{"id":"cpb_external_processing_rule_v2"}
                }
              }'::JSONB,
              clock.now - INTERVAL '24 hours', clock.now - INTERVAL '24 hours'
            ),
            (
              'scheduled_system_handoff', 'OLD_SCHEDULE', '未来计划版',
              'EXTERNAL_SALES'::"OrderSettlementType",
              'PROCESSING'::"CustomerPriceBookPurpose", 3, 'CNY', NULL, NULL,
              clock.now + INTERVAL '24 hours', NULL, FALSE,
              '{"workflow":{"status":"PUBLISHED"}}'::JSONB,
              clock.now - INTERVAL '72 hours', clock.now - INTERVAL '48 hours'
            )
        ) AS seed(
          "id", "code", "name", "settlementType", "purpose", "version",
          "currency", "sourceName", "sourceSha256", "effectiveFrom",
          "effectiveTo", "isActive", "notes", "createdAt", "updatedAt"
        );

        INSERT INTO "CustomerChargeCategory" ("id", "code") VALUES
          ('packing_category', 'PACKING'),
          ('reference_category', 'REFERENCE');
        INSERT INTO "Product" ("id", "paperType") VALUES
          ('coated_product', '200g铜版纸');
        INSERT INTO "CustomerPriceRule" (
          "id", "priceBookId", "categoryId", "productId", "code", "name",
          "kind", "calculationType", "amount", "triggerCondition",
          "exclusiveGroup", "priority", "blocksAutomaticQuote", "isActive",
          "createdAt", "updatedAt"
        ) VALUES
          (
            'predecessor_packaging_single',
            'cpb_external_processing_rule_v2_packaging', 'packing_category',
            NULL, 'PACKAGING_SINGLE_STYLE_PER_BAG', '普通入袋',
            'ADD_ON', 'PER_BAG', 0.1,
            '{"schemaVersion":1,"target":"PACKAGING_GROUP","packagingModes":["SINGLE_STYLE"]}',
            'PACKAGING_GROUP_MODE', 300, FALSE, TRUE,
            CURRENT_TIMESTAMP AT TIME ZONE 'UTC',
            CURRENT_TIMESTAMP AT TIME ZONE 'UTC'
          ),
          (
            'predecessor_packaging_mixed',
            'cpb_external_processing_rule_v2_packaging', 'packing_category',
            NULL, 'PACKAGING_MIXED_STYLE_PER_BAG', '混装入袋',
            'ADD_ON', 'PER_BAG', 0.2,
            '{"schemaVersion":1,"target":"PACKAGING_GROUP","packagingModes":["MIXED_STYLE"]}',
            'PACKAGING_GROUP_MODE', 300, FALSE, TRUE,
            CURRENT_TIMESTAMP AT TIME ZONE 'UTC',
            CURRENT_TIMESTAMP AT TIME ZONE 'UTC'
          ),
          (
            'predecessor_color_base',
            'cpb_external_processing_rule_v2_packaging', 'reference_category',
            'coated_product', 'COLOR_BASE', '彩印基础价',
            'BASE', 'FIXED_AMOUNT', 100,
            '{"schemaVersion":1,"target":"ITEM","pricingRoutes":["COLOR_PRINT"]}',
            'COLOR_BASE', 10, FALSE, TRUE,
            CURRENT_TIMESTAMP AT TIME ZONE 'UTC',
            CURRENT_TIMESTAMP AT TIME ZONE 'UTC'
          );
      `);

      await client.query(repairMigration);
      await client.query(v3Migration);

      const timeline = await client.query<{
        futureActive: boolean;
        predecessorToV3: boolean;
        v3ToFuture: boolean;
        currentCount: number;
        overlapCount: number;
      }>(`
        SELECT
          future."isActive" AS "futureActive",
          predecessor."effectiveTo" = v3."effectiveFrom"
            AS "predecessorToV3",
          v3."effectiveTo" = future."effectiveFrom" AS "v3ToFuture",
          (
            SELECT COUNT(*)::INT
            FROM "CustomerPriceBook" current_book
            WHERE current_book."settlementType" =
                'EXTERNAL_SALES'::"OrderSettlementType"
              AND current_book."purpose" =
                'PROCESSING'::"CustomerPriceBookPurpose"
              AND current_book."isActive" = TRUE
              AND current_book."effectiveFrom" <=
                (CURRENT_TIMESTAMP AT TIME ZONE 'UTC')::TIMESTAMP(3)
              AND (
                current_book."effectiveTo" IS NULL
                OR current_book."effectiveTo" >
                  (CURRENT_TIMESTAMP AT TIME ZONE 'UTC')::TIMESTAMP(3)
              )
          ) AS "currentCount",
          (
            SELECT COUNT(*)::INT
            FROM "CustomerPriceBook" left_book
            JOIN "CustomerPriceBook" right_book
              ON left_book."id" < right_book."id"
             AND left_book."settlementType" = right_book."settlementType"
             AND left_book."purpose" = right_book."purpose"
             AND left_book."isActive" = TRUE
             AND right_book."isActive" = TRUE
             AND tsrange(
               left_book."effectiveFrom",
               COALESCE(left_book."effectiveTo", 'infinity'::TIMESTAMP),
               '[)'
             ) && tsrange(
               right_book."effectiveFrom",
               COALESCE(right_book."effectiveTo", 'infinity'::TIMESTAMP),
               '[)'
             )
            WHERE left_book."purpose" =
              'PROCESSING'::"CustomerPriceBookPurpose"
          ) AS "overlapCount"
        FROM "CustomerPriceBook" predecessor
        CROSS JOIN "CustomerPriceBook" v3
        CROSS JOIN "CustomerPriceBook" future
        WHERE predecessor."id" = 'cpb_external_processing_rule_v2_packaging'
          AND v3."id" = 'cpb_external_processing_rule_v3'
          AND future."id" = 'scheduled_system_handoff'
      `);
      const colorRule = await client.query<{ laminations: unknown }>(`
        SELECT "triggerCondition"->'laminations' AS laminations
        FROM "CustomerPriceRule"
        WHERE "priceBookId" = 'cpb_external_processing_rule_v3'
          AND "code" = 'COLOR_BASE'
      `);

      expect(timeline.rows[0]).toEqual({
        futureActive: true,
        predecessorToV3: true,
        v3ToFuture: true,
        currentCount: 1,
        overlapCount: 0,
      });
      expect(colorRule.rows[0]?.laminations).toEqual(['MATTE']);
    });
  });
});
