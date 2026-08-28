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
    'prisma/migrations/20260827104000_external_logistics_weight_policy_v3/migration.sql',
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
  const schema = `logistics_weight_v3_${randomBytes(8).toString('hex')}`;
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
    CREATE TABLE "CustomerPriceRule" (
      "id" TEXT PRIMARY KEY,
      "priceBookId" TEXT NOT NULL,
      "categoryId" TEXT NOT NULL,
      "productId" TEXT,
      "code" citext NOT NULL,
      "name" TEXT NOT NULL,
      "kind" TEXT NOT NULL,
      "calculationType" TEXT,
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

postgresDescribe('external logistics weight policy v3 · PostgreSQL', () => {
  it('replaces every current/future segment with a compatible successor', async () => {
    await withIsolatedSchema(async (client) => {
      await createSchema(client);
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
              'cpb_external_logistics_rule_v2',
              'EXTERNAL_SALES_LOGISTICS_RULES', '当前物流版',
              'EXTERNAL_SALES'::"OrderSettlementType",
              'LOGISTICS'::"CustomerPriceBookPurpose", 1, 'CNY',
              '长昆中通报价表(1).xlsx + 纸箱价格表1(1).xlsx',
              '7d3d0b6dddb2ee910046b3bc80f1d7fc8e35aa94dd25d5cf14f23c58a6ab8a69',
              clock.now - INTERVAL '1 day', clock.now + INTERVAL '1 day',
              TRUE,
              '{
                "sources":[{"fileName":"长昆中通报价表(1).xlsx"}],
                "shipping":{"billableWeightInput":"CARRIER_CONFIRMED"},
                "workflow":{"status":"SYSTEM_RELEASE"}
              }'::JSONB,
              clock.now - INTERVAL '1 day', clock.now - INTERVAL '1 day'
            ),
            (
              'scheduled_logistics_v2',
              'EXTERNAL_SALES_LOGISTICS_RULES', '未来物流版',
              'EXTERNAL_SALES'::"OrderSettlementType",
              'LOGISTICS'::"CustomerPriceBookPurpose", 2, 'CNY',
              'future.xlsx',
              'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
              clock.now + INTERVAL '1 day', clock.now + INTERVAL '2 days', TRUE,
              '{
                "futureRateFact":"keep-me",
                "workflow":{
                  "status":"PUBLISHED",
                  "approvalTicket":"LOGISTICS-FUTURE-001"
                }
              }'::JSONB,
              clock.now - INTERVAL '2 days', clock.now - INTERVAL '2 days'
            ),
            (
              'scheduled_logistics_v3',
              'FUTURE_LOGISTICS_SECOND', '第二个未来物流版',
              'EXTERNAL_SALES'::"OrderSettlementType",
              'LOGISTICS'::"CustomerPriceBookPurpose", 7, 'CNY',
              'future-2.xlsx',
              'bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb',
              clock.now + INTERVAL '2 days', NULL, TRUE,
              '{
                "futureRateFact":"keep-me-too",
                "workflow":{"status":"PUBLISHED"}
              }'::JSONB,
              clock.now - INTERVAL '2 days', clock.now - INTERVAL '2 days'
            )
        ) AS seed(
          "id", "code", "name", "settlementType", "purpose", "version",
          "currency", "sourceName", "sourceSha256", "effectiveFrom",
          "effectiveTo", "isActive", "notes", "createdAt", "updatedAt"
        );

        INSERT INTO "CustomerPriceRule" (
          "id", "priceBookId", "categoryId", "code", "name", "kind",
          "calculationType", "amount", "includedUnits", "incrementUnits",
          "incrementAmount", "triggerCondition", "exclusiveGroup", "priority",
          "sourceSheet", "sourceRange", "sourceName", "sourceSha256", "note",
          "blocksAutomaticQuote", "isActive", "createdAt", "updatedAt"
        ) VALUES
          (
            'source_shipping', 'cpb_external_logistics_rule_v2',
            'shipping_category', 'SHANGHAI', '上海', 'BASE', 'FIXED_AMOUNT',
            3.5, 1, 1, 3.5, '{"province":"上海"}', 'PROVINCE', 10,
            '中通', 'A1:D29', '长昆中通报价表(1).xlsx',
            'a92088a9ba0093afcbb96c6b3b182ab29e4f7d675cacf929c6745987bf4d6060',
            NULL, FALSE, TRUE, CURRENT_TIMESTAMP AT TIME ZONE 'UTC',
            CURRENT_TIMESTAMP AT TIME ZONE 'UTC'
          ),
          (
            'source_inactive_carton', 'cpb_external_logistics_rule_v2',
            'carton_category', 'CARTON_OLD', '历史纸箱档', 'ADD_ON',
            'FIXED_AMOUNT', 8, NULL, NULL, NULL, '{"maxQty":5000}',
            'CARTON', 20, 'Sheet1', 'A1:B6', '纸箱价格表1(1).xlsx',
            '9f0c30333a737ab9d36398b8af2c84ece599317f9df21af5dacb8f365fa5401b',
            '停用但仍需复制', FALSE, FALSE,
            CURRENT_TIMESTAMP AT TIME ZONE 'UTC',
            CURRENT_TIMESTAMP AT TIME ZONE 'UTC'
          ),
          (
            'future_shipping', 'scheduled_logistics_v2',
            'shipping_category', 'SHANGHAI', '未来上海', 'BASE', 'FIXED_AMOUNT',
            9.5, 1, 1, 4.5, '{"province":"上海"}', 'PROVINCE', 10,
            '未来中通', 'A1:D29', 'future.xlsx',
            'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
            '未来费率', FALSE, TRUE,
            CURRENT_TIMESTAMP AT TIME ZONE 'UTC',
            CURRENT_TIMESTAMP AT TIME ZONE 'UTC'
          ),
          (
            'future_inactive_carton', 'scheduled_logistics_v2',
            'carton_category', 'CARTON_FUTURE', '未来纸箱档', 'ADD_ON',
            'FIXED_AMOUNT', 12, NULL, NULL, NULL, '{"maxQty":5000}',
            'CARTON', 20, 'Sheet1', 'A1:B6', 'future.xlsx',
            'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
            '未来停用规则也需复制', FALSE, FALSE,
            CURRENT_TIMESTAMP AT TIME ZONE 'UTC',
            CURRENT_TIMESTAMP AT TIME ZONE 'UTC'
          ),
          (
            'future_2_shipping', 'scheduled_logistics_v3',
            'shipping_category', 'SHANGHAI', '第二个未来上海',
            'BASE', 'FIXED_AMOUNT', 11.5, 1, 1, 5.5,
            '{"province":"上海"}', 'PROVINCE', 10,
            '未来中通二', 'A1:D29', 'future-2.xlsx',
            'bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb',
            '第二个未来费率', FALSE, TRUE,
            CURRENT_TIMESTAMP AT TIME ZONE 'UTC',
            CURRENT_TIMESTAMP AT TIME ZONE 'UTC'
          );
      `);

      const predecessorBefore = await client.query<{
        notes: unknown;
        sourceName: string;
        sourceSha256: string;
      }>(`
        SELECT
          "notes" AS notes,
          "sourceName" AS "sourceName",
          "sourceSha256" AS "sourceSha256"
        FROM "CustomerPriceBook"
        WHERE "id" = 'cpb_external_logistics_rule_v2'
      `);
      const futureBefore = await client.query<{
        effectiveFrom: Date;
        effectiveTo: Date | null;
        isActive: boolean;
        notes: unknown;
        sourceName: string;
        sourceSha256: string;
        updatedAt: Date;
      }>(`
        SELECT
          "effectiveFrom" AS "effectiveFrom",
          "effectiveTo" AS "effectiveTo",
          "isActive" AS "isActive",
          "notes" AS notes,
          "sourceName" AS "sourceName",
          "sourceSha256" AS "sourceSha256",
          "updatedAt" AS "updatedAt"
        FROM "CustomerPriceBook"
        WHERE "id" = 'scheduled_logistics_v2'
      `);

      await client.query(migration);

      const timeline = await client.query<{
        code: string;
        oldFutureActive: boolean;
        oldSecondFutureActive: boolean;
        futureSuccessorActive: boolean;
        secondFutureSuccessorActive: boolean;
        predecessorToV3: boolean;
        v3ToFuture: boolean;
        futureToSecondFuture: boolean;
        currentVersion: number;
        futureVersion: number;
        secondFutureVersion: number;
        currentCount: number;
        futureCompatibleCount: number;
        secondFutureCompatibleCount: number;
        overlapCount: number;
      }>(`
        SELECT
          target."code"::TEXT AS code,
          future."isActive" AS "oldFutureActive",
          future_2."isActive" AS "oldSecondFutureActive",
          future_successor."isActive" AS "futureSuccessorActive",
          future_2_successor."isActive" AS "secondFutureSuccessorActive",
          predecessor."effectiveTo" = target."effectiveFrom"
            AS "predecessorToV3",
          target."effectiveTo" = future_successor."effectiveFrom"
            AS "v3ToFuture",
          future_successor."effectiveTo" = future_2_successor."effectiveFrom"
            AS "futureToSecondFuture",
          target."version" AS "currentVersion",
          future_successor."version" AS "futureVersion",
          future_2_successor."version" AS "secondFutureVersion",
          (
            SELECT COUNT(*)::INT
            FROM "CustomerPriceBook" current_book
            WHERE current_book."settlementType" = 'EXTERNAL_SALES'
              AND current_book."purpose" = 'LOGISTICS'
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
            FROM "CustomerPriceBook" selected
            WHERE selected."settlementType" = 'EXTERNAL_SALES'
              AND selected."purpose" = 'LOGISTICS'
              AND selected."isActive" = TRUE
              AND selected."effectiveFrom" <=
                future."effectiveFrom" + INTERVAL '1 hour'
              AND (
                selected."effectiveTo" IS NULL
                OR selected."effectiveTo" >
                  future."effectiveFrom" + INTERVAL '1 hour'
              )
              AND selected."notes"->'shipping'->>'billableWeightInput' =
                'SERVER_ESTIMATE_WITH_ACTUAL_OVERRIDE'
          ) AS "futureCompatibleCount",
          (
            SELECT COUNT(*)::INT
            FROM "CustomerPriceBook" selected
            WHERE selected."settlementType" = 'EXTERNAL_SALES'
              AND selected."purpose" = 'LOGISTICS'
              AND selected."isActive" = TRUE
              AND selected."effectiveFrom" <=
                future_2."effectiveFrom" + INTERVAL '1 hour'
              AND (
                selected."effectiveTo" IS NULL
                OR selected."effectiveTo" >
                  future_2."effectiveFrom" + INTERVAL '1 hour'
              )
              AND selected."notes"->'shipping'->>'billableWeightInput' =
                'SERVER_ESTIMATE_WITH_ACTUAL_OVERRIDE'
          ) AS "secondFutureCompatibleCount",
          (
            SELECT COUNT(*)::INT
            FROM "CustomerPriceBook" left_book
            JOIN "CustomerPriceBook" right_book
              ON left_book."id" < right_book."id"
             AND left_book."isActive" = TRUE
             AND right_book."isActive" = TRUE
             AND left_book."settlementType" = right_book."settlementType"
             AND left_book."purpose" = right_book."purpose"
             AND tsrange(
               left_book."effectiveFrom",
               COALESCE(left_book."effectiveTo", 'infinity'::TIMESTAMP),
               '[)'
             ) && tsrange(
               right_book."effectiveFrom",
               COALESCE(right_book."effectiveTo", 'infinity'::TIMESTAMP),
               '[)'
             )
            WHERE left_book."purpose" = 'LOGISTICS'
          ) AS "overlapCount"
        FROM "CustomerPriceBook" predecessor
        CROSS JOIN "CustomerPriceBook" target
        CROSS JOIN "CustomerPriceBook" future
        CROSS JOIN "CustomerPriceBook" future_successor
        CROSS JOIN "CustomerPriceBook" future_2
        CROSS JOIN "CustomerPriceBook" future_2_successor
        WHERE predecessor."id" = 'cpb_external_logistics_rule_v2'
          AND target."id" = 'cpb_external_logistics_weight_policy_v3'
          AND future."id" = 'scheduled_logistics_v2'
          AND future_successor."notes"->>'supersedesPriceBookId' =
            future."id"
          AND future_2."id" = 'scheduled_logistics_v3'
          AND future_2_successor."notes"->>'supersedesPriceBookId' =
            future_2."id"
      `);
      const policies = await client.query<{
        approvalTicket: string | null;
        shipping: unknown;
        supersedesPriceBookId: string;
        futureRateFact: string | null;
      }>(`
        SELECT
          "notes"->'workflow'->>'approvalTicket' AS "approvalTicket",
          "notes"->'shipping' AS shipping,
          "notes"->>'supersedesPriceBookId' AS "supersedesPriceBookId",
          "notes"->>'futureRateFact' AS "futureRateFact"
        FROM "CustomerPriceBook"
        WHERE "notes"->>'ruleVersion' = '2026-08-27-logistics-weight-v3'
        ORDER BY "effectiveFrom"
      `);
      const predecessorAfter = await client.query<{
        notes: unknown;
        sourceName: string;
        sourceSha256: string;
      }>(`
        SELECT
          "notes" AS notes,
          "sourceName" AS "sourceName",
          "sourceSha256" AS "sourceSha256"
        FROM "CustomerPriceBook"
        WHERE "id" = 'cpb_external_logistics_rule_v2'
      `);
      const futureAfter = await client.query<{
        effectiveFrom: Date;
        effectiveTo: Date | null;
        isActive: boolean;
        notes: unknown;
        sourceName: string;
        sourceSha256: string;
        updatedAt: Date;
      }>(`
        SELECT
          "effectiveFrom" AS "effectiveFrom",
          "effectiveTo" AS "effectiveTo",
          "isActive" AS "isActive",
          "notes" AS notes,
          "sourceName" AS "sourceName",
          "sourceSha256" AS "sourceSha256",
          "updatedAt" AS "updatedAt"
        FROM "CustomerPriceBook"
        WHERE "id" = 'scheduled_logistics_v2'
      `);
      const rules = await client.query<{
        currentSourceCount: number;
        currentTargetCount: number;
        futureSourceCount: number;
        futureTargetCount: number;
        secondFutureSourceCount: number;
        secondFutureTargetCount: number;
        futureShippingAmount: string;
        secondFutureShippingAmount: string;
      }>(`
        SELECT
          COUNT(*) FILTER (
            WHERE "priceBookId" = 'cpb_external_logistics_rule_v2'
          )::INT AS "currentSourceCount",
          COUNT(*) FILTER (
            WHERE "priceBookId" = 'cpb_external_logistics_weight_policy_v3'
          )::INT AS "currentTargetCount",
          COUNT(*) FILTER (
            WHERE "priceBookId" = 'scheduled_logistics_v2'
          )::INT AS "futureSourceCount",
          COUNT(*) FILTER (
            WHERE "priceBookId" = (
              SELECT "id"
              FROM "CustomerPriceBook"
              WHERE "notes"->>'supersedesPriceBookId' =
                'scheduled_logistics_v2'
            )
          )::INT AS "futureTargetCount",
          COUNT(*) FILTER (
            WHERE "priceBookId" = 'scheduled_logistics_v3'
          )::INT AS "secondFutureSourceCount",
          COUNT(*) FILTER (
            WHERE "priceBookId" = (
              SELECT "id"
              FROM "CustomerPriceBook"
              WHERE "notes"->>'supersedesPriceBookId' =
                'scheduled_logistics_v3'
            )
          )::INT AS "secondFutureTargetCount",
          MAX("amount") FILTER (
            WHERE "code" = 'SHANGHAI'
              AND "priceBookId" = (
                SELECT "id"
                FROM "CustomerPriceBook"
                WHERE "notes"->>'supersedesPriceBookId' =
                  'scheduled_logistics_v2'
              )
          )::TEXT AS "futureShippingAmount",
          MAX("amount") FILTER (
            WHERE "code" = 'SHANGHAI'
              AND "priceBookId" = (
                SELECT "id"
                FROM "CustomerPriceBook"
                WHERE "notes"->>'supersedesPriceBookId' =
                  'scheduled_logistics_v3'
              )
          )::TEXT AS "secondFutureShippingAmount"
        FROM "CustomerPriceRule"
      `);

      expect(timeline.rows[0]).toEqual({
        code: 'EXTERNAL_SALES_LOGISTICS_RULES',
        oldFutureActive: false,
        oldSecondFutureActive: false,
        futureSuccessorActive: true,
        secondFutureSuccessorActive: true,
        predecessorToV3: true,
        v3ToFuture: true,
        futureToSecondFuture: true,
        currentVersion: 3,
        futureVersion: 4,
        secondFutureVersion: 5,
        currentCount: 1,
        futureCompatibleCount: 1,
        secondFutureCompatibleCount: 1,
        overlapCount: 0,
      });
      const expectedPolicy = {
        billableWeightInput: 'SERVER_ESTIMATE_WITH_ACTUAL_OVERRIDE',
        billableWeightRounding: 'CEIL_KG',
        gramsPerItemByPaperWeightGsm: {
          '120': 4.5,
          '150': 6,
          '160': 6,
          '180': 6.75,
          '200': 8,
          '230': 10,
        },
        maxOrderQuantity: 2000,
        minimumBillableWeightKg: 1,
        source: {
          fileName: '加工费计费规则.md',
          section: '§6',
          sha256:
            '3596993e283d1d06f01dd7048b6ccf2f1c0e4b27394541e004a37419c856d817',
        },
        tenThousandEnvelopeGramsPerItem: 10,
        weightResolutionOrder: [
          'ACTUAL_FULFILLMENT_WEIGHT',
          'SERVER_ESTIMATE',
        ],
      };
      expect(policies.rows).toEqual([
        {
          approvalTicket: null,
          shipping: expectedPolicy,
          supersedesPriceBookId: 'cpb_external_logistics_rule_v2',
          futureRateFact: null,
        },
        {
          approvalTicket: 'LOGISTICS-FUTURE-001',
          shipping: expectedPolicy,
          supersedesPriceBookId: 'scheduled_logistics_v2',
          futureRateFact: 'keep-me',
        },
        {
          approvalTicket: null,
          shipping: expectedPolicy,
          supersedesPriceBookId: 'scheduled_logistics_v3',
          futureRateFact: 'keep-me-too',
        },
      ]);
      expect(predecessorAfter.rows[0]).toEqual(predecessorBefore.rows[0]);
      expect(futureAfter.rows[0]).toEqual({
        ...futureBefore.rows[0],
        isActive: false,
      });
      expect(rules.rows[0]).toEqual({
        currentSourceCount: 2,
        currentTargetCount: 2,
        futureSourceCount: 2,
        futureTargetCount: 2,
        secondFutureSourceCount: 1,
        secondFutureTargetCount: 1,
        futureShippingAmount: '9.5000',
        secondFutureShippingAmount: '11.5000',
      });
    });
  });
});
