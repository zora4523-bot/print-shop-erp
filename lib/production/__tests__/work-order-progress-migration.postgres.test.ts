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
    'prisma',
    'migrations',
    '20260902120200_production_work_order_progress_and_scan_claim',
    'migration.sql',
  ),
  'utf8',
);

function quoteIdentifier(value: string): string {
  return `"${value.replaceAll('"', '""')}"`;
}

async function prepareClient(client: Client, schema: string) {
  await client.connect();
  await client.query(`SET search_path TO ${quoteIdentifier(schema)}, public`);
  await client.query(`SET statement_timeout TO '10s'`);
}

postgresDescribe.sequential(
  'work-order progress and scan claim migration · PostgreSQL',
  () => {
    it('并发硬拒超单量、同版 claim 唯一、新版可追加且事实不可改删', async () => {
      const isolatedSchema = `work_order_progress_${randomBytes(8).toString('hex')}`;
      const quotedSchema = quoteIdentifier(isolatedSchema);
      const admin = new Client({ connectionString: databaseUrl });
      const first = new Client({ connectionString: databaseUrl });
      const second = new Client({ connectionString: databaseUrl });

      await admin.connect();
      try {
        await admin.query(`CREATE SCHEMA ${quotedSchema}`);
        await admin.query(`SET search_path TO ${quotedSchema}, public`);
        await admin.query(`SET statement_timeout TO '10s'`);
        await admin.query(`
          CREATE TYPE "OrderStatus" AS ENUM (
            'RELEASED', 'FOILING', 'PACKING', 'SHIPPED'
          );
          CREATE TYPE "PieceworkOperationType" AS ENUM (
            'PARTIAL', 'FULL', 'PACKING'
          );
          CREATE TYPE "Role" AS ENUM ('ADMIN', 'SALES', 'CUSTOMER_SERVICE', 'WORKER');

          CREATE TABLE "User" (
            "id" TEXT PRIMARY KEY,
            "role" "Role" NOT NULL,
            "isActive" BOOLEAN NOT NULL
          );
          CREATE TABLE "Order" (
            "id" TEXT PRIMARY KEY,
            "status" "OrderStatus" NOT NULL,
            "scheduledAt" TIMESTAMPTZ(3),
            "workOrderVersion" INTEGER NOT NULL,
            "settlementType" TEXT NOT NULL
          );
          CREATE TABLE "OrderItem" (
            "id" TEXT PRIMARY KEY,
            "orderId" TEXT NOT NULL,
            "quantity" INTEGER NOT NULL
          );
          CREATE TABLE "ProductionOperation" (
            "id" TEXT PRIMARY KEY,
            "orderId" TEXT NOT NULL,
            "operationType" "PieceworkOperationType" NOT NULL
          );
          CREATE TABLE "ProductionReport" (
            "id" TEXT PRIMARY KEY,
            "operationId" TEXT NOT NULL,
            "reporterId" TEXT NOT NULL,
            "idempotencyKey" VARCHAR(128) NOT NULL UNIQUE,
            "reportedAt" TIMESTAMPTZ(3) NOT NULL
          );
          CREATE TABLE "ProductionProgressStep" (
            "id" TEXT PRIMARY KEY,
            "orderId" TEXT NOT NULL
          );

          INSERT INTO "User" ("id", "role", "isActive")
          VALUES ('worker-1', 'WORKER', TRUE), ('worker-2', 'WORKER', TRUE);
          INSERT INTO "Order" (
            "id", "status", "scheduledAt", "workOrderVersion",
            "settlementType"
          ) VALUES (
            'order-1', 'RELEASED', clock_timestamp() - INTERVAL '3 days', 1,
            'FACTORY_DIRECT'
          );
          INSERT INTO "OrderItem" ("id", "orderId", "quantity")
          VALUES ('item-1', 'order-1', 100);
          INSERT INTO "ProductionOperation" (
            "id", "orderId", "operationType"
          ) VALUES
            ('foil-1', 'order-1', 'PARTIAL'),
            ('pack-1', 'order-1', 'PACKING');
          INSERT INTO "ProductionReport" (
            "id", "operationId", "reporterId", "idempotencyKey", "reportedAt"
          ) VALUES
            ('report-1', 'foil-1', 'worker-1', 'progress-concurrent-1', clock_timestamp()),
            ('report-2', 'foil-1', 'worker-2', 'progress-concurrent-2', clock_timestamp());
        `);

        await admin.query(migration);
        await Promise.all([
          prepareClient(first, isolatedSchema),
          prepareClient(second, isolatedSchema),
        ]);

        const progressInsert = (
          client: Client,
          suffix: string,
          reporterId: string,
        ) =>
          client.query(
            `INSERT INTO "ProductionWorkOrderProgress" (
              "id", "orderId", "operationId", "sourceReportId",
              "reporterId", "stage", "workOrderProgressQuantity",
              "idempotencyKey", "reportedAt"
            ) VALUES ($1, 'order-1', 'foil-1', $2, $3, 'FOILING', 60, $4, '2000-01-01')`,
            [
              `progress-${suffix}`,
              `report-${suffix}`,
              reporterId,
              `progress-concurrent-${suffix}`,
            ],
          );
        const progressResults = await Promise.allSettled([
          progressInsert(first, '1', 'worker-1'),
          progressInsert(second, '2', 'worker-2'),
        ]);
        expect(progressResults.filter((result) => result.status === 'fulfilled')).toHaveLength(1);
        const progressFailure = progressResults.find(
          (result) => result.status === 'rejected',
        );
        expect(progressFailure).toMatchObject({
          status: 'rejected',
          reason: expect.objectContaining({ code: 'P0001' }),
        });

        const claimInsert = (client: Client, suffix: string) =>
          client.query(
            `INSERT INTO "ProductionScanClaim" (
              "id", "orderId", "workOrderVersion", "operationId",
              "reporterId", "idempotencyKey", "claimedAt"
            ) VALUES ($1, 'order-1', 1, 'foil-1', $2, $3, '2000-01-01')`,
            [
              `claim-v1-${suffix}`,
              `worker-${suffix}`,
              `scan-claim-v1-${suffix}`,
            ],
          );
        const claimResults = await Promise.allSettled([
          claimInsert(first, '1'),
          claimInsert(second, '2'),
        ]);
        expect(claimResults.filter((result) => result.status === 'fulfilled')).toHaveLength(1);
        const claimFailure = claimResults.find(
          (result) => result.status === 'rejected',
        );
        expect(claimFailure).toMatchObject({
          status: 'rejected',
          reason: expect.objectContaining({ code: '23505' }),
        });

        await admin.query(`
          UPDATE "Order"
          SET "workOrderVersion" = 2,
              "scheduledAt" = clock_timestamp()
          WHERE "id" = 'order-1'
        `);
        await expect(
          admin.query(`
            INSERT INTO "ProductionScanClaim" (
              "id", "orderId", "workOrderVersion", "operationId",
              "reporterId", "idempotencyKey", "claimedAt"
            ) VALUES (
              'claim-v2', 'order-1', 2, 'foil-1', 'worker-1',
              'scan-claim-version-2', '2000-01-01'
            )
          `),
        ).resolves.toMatchObject({ rowCount: 1 });

        const claims = await admin.query<{
          workOrderVersion: number;
          claimedAt: Date;
        }>(`
          SELECT "workOrderVersion", "claimedAt"
          FROM "ProductionScanClaim"
          WHERE "orderId" = 'order-1'
          ORDER BY "workOrderVersion"
        `);
        expect(claims.rows.map((row) => row.workOrderVersion)).toEqual([1, 2]);
        expect(claims.rows[1]!.claimedAt.getUTCFullYear()).toBeGreaterThan(2020);

        const storedProgress = await admin.query<{ id: string }>(
          `SELECT "id" FROM "ProductionWorkOrderProgress" LIMIT 1`,
        );
        await expect(
          admin.query(
            `UPDATE "ProductionWorkOrderProgress"
             SET "workOrderProgressQuantity" = 1 WHERE "id" = $1`,
            [storedProgress.rows[0]!.id],
          ),
        ).rejects.toMatchObject({ code: 'P0001' });
        await expect(
          admin.query(
            `DELETE FROM "ProductionScanClaim" WHERE "id" = 'claim-v2'`,
          ),
        ).rejects.toMatchObject({ code: 'P0001' });
      } finally {
        await Promise.allSettled([first.end(), second.end()]);
        await admin.query(`DROP SCHEMA IF EXISTS ${quotedSchema} CASCADE`);
        await admin.end();
      }
    });
  },
);
