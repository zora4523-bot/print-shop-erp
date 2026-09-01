import 'dotenv/config';

import { randomBytes } from 'node:crypto';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { Client } from 'pg';
import { describe, expect, it } from 'vitest';

const databaseUrl = process.env.DATABASE_URL;
const postgresDescribe = databaseUrl ? describe : describe.skip;
const foundationMigration = readFileSync(
  path.join(
    process.cwd(),
    'prisma',
    'migrations',
    '20260902120000_admin_order_workflow_billing_foundations',
    'migration.sql',
  ),
  'utf8',
);
const concurrentIndexMigration = readFileSync(
  path.join(
    process.cwd(),
    'prisma',
    'migrations',
    '20260902120100_order_settlement_candidate_index',
    'migration.sql',
  ),
  'utf8',
);
const billExportMigration = readFileSync(
  path.join(
    process.cwd(),
    'prisma',
    'migrations',
    '20260902120400_agent_monthly_bill_exports',
    'migration.sql',
  ),
  'utf8',
);
const billExportSnapshotMigration = readFileSync(
  path.join(
    process.cwd(),
    'prisma',
    'migrations',
    '20260902120800_agent_monthly_bill_export_request_snapshots',
    'migration.sql',
  ),
  'utf8',
);

function quoteIdentifier(value: string): string {
  return `"${value.replaceAll('"', '""')}"`;
}

postgresDescribe.sequential(
  'admin workflow and monthly billing foundations · PostgreSQL',
  () => {
    it('migrates the legacy shape and enforces immutable workflow and billing facts', async () => {
      const isolatedSchema = `admin_workflow_${randomBytes(8).toString('hex')}`;
      const quotedSchema = quoteIdentifier(isolatedSchema);
      const client = new Client({ connectionString: databaseUrl });

      await client.connect();
      try {
        await client.query(`CREATE SCHEMA ${quotedSchema}`);
        await client.query(`SET search_path TO ${quotedSchema}, public`);
        await client.query(`SET statement_timeout TO '10s'`);
        await client.query(`
          CREATE TYPE "OrderStatus" AS ENUM (
            'DRAFT',
            'PENDING_FACTORY',
            'SUBMITTED',
            'SCHEDULING',
            'IN_PRODUCTION',
            'COMPLETED',
            'SHIPPED',
            'FINISHED',
            'CANCELLED'
          );
          CREATE TYPE "OrderChangeRequestStatus" AS ENUM (
            'PENDING',
            'APPROVED',
            'REJECTED',
            'CANCELLED',
            'STALE'
          );
          CREATE TYPE "OrderSettlementType" AS ENUM (
            'EXTERNAL_SALES',
            'INTERNAL_SALES',
            'FACTORY_DIRECT',
            'NO_CHARGE'
          );
          CREATE TYPE "OrderBillingMode" AS ENUM ('CHARGE', 'NO_CHARGE');

          CREATE TABLE "User" (
            "id" TEXT PRIMARY KEY
          );
          CREATE TABLE "Order" (
            "id" TEXT PRIMARY KEY,
            "orderNo" TEXT NOT NULL UNIQUE,
            "submitterId" TEXT NOT NULL,
            "status" "OrderStatus" NOT NULL,
            "billingMode" "OrderBillingMode" NOT NULL,
            "settlementType" "OrderSettlementType" NOT NULL,
            "customerRef" TEXT,
            "settledFee" DECIMAL(12,2)
          );
          CREATE TABLE "OrderChangeRequest" (
            "id" TEXT PRIMARY KEY,
            "status" "OrderChangeRequestStatus" NOT NULL,
            "reviewedById" TEXT,
            "reviewedAt" TIMESTAMPTZ(3),
            "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
          );
          CREATE TABLE "OrderExport" (
            "id" TEXT PRIMARY KEY
          );
          CREATE TABLE "NotificationRule" (
            "id" TEXT PRIMARY KEY,
            "eventType" TEXT NOT NULL UNIQUE,
            "channelIds" TEXT[] NOT NULL,
            "messageTemplate" TEXT NOT NULL,
            "isActive" BOOLEAN NOT NULL DEFAULT TRUE,
            "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
            "updatedAt" TIMESTAMPTZ(3) NOT NULL
          );
          CREATE TABLE "Setting" (
            "id" TEXT PRIMARY KEY,
            "key" TEXT NOT NULL UNIQUE,
            "value" JSONB NOT NULL,
            "remark" TEXT,
            "updatedAt" TIMESTAMPTZ(3) NOT NULL
          );

          INSERT INTO "NotificationRule" (
            "id", "eventType", "channelIds", "messageTemplate", "isActive",
            "updatedAt"
          ) VALUES (
            'legacy-order-submitted', 'ORDER_SUBMITTED', ARRAY[]::TEXT[],
            '**新工单** {orderNo} {totalAmount}', TRUE, CURRENT_TIMESTAMP
          );

          INSERT INTO "User" ("id")
          VALUES ('agent-1'), ('agent-2'), ('admin-1');
          INSERT INTO "Order" (
            "id", "orderNo", "submitterId", "status", "billingMode",
            "settlementType", "customerRef", "settledFee"
          ) VALUES (
            'legacy-order', 'LEGACY-1', 'agent-1', 'SUBMITTED', 'CHARGE',
            'EXTERNAL_SALES', NULL, NULL
          );
          INSERT INTO "OrderChangeRequest" ("id", "status")
          VALUES ('legacy-request', 'PENDING');
        `);

        await client.query(foundationMigration);
        await client.query(concurrentIndexMigration);
        await client.query(billExportMigration);
        await client.query(billExportSnapshotMigration);

        const notificationDefaults = await client.query<{
          eventType: string;
          isActive: boolean;
          channelCount: number;
        }>(`
          SELECT
            "eventType",
            "isActive",
            cardinality("channelIds") AS "channelCount"
          FROM "NotificationRule"
          WHERE "eventType" IN (
            'ORDER_CHANGE_REQUESTED',
            'PRODUCTION_PROGRESS_ANOMALY',
            'PRODUCTION_STAGNANT',
            'PENDING_FACTORY_BACKLOG'
          )
          ORDER BY "eventType"
        `);
        expect(notificationDefaults.rows).toHaveLength(4);
        expect(
          notificationDefaults.rows.every(
            (row) => row.isActive === false && row.channelCount === 0,
          ),
        ).toBe(true);
        const submittedTemplate = await client.query<{ template: string }>(`
          SELECT "messageTemplate" AS template
          FROM "NotificationRule"
          WHERE "eventType" = 'ORDER_SUBMITTED'
        `);
        expect(submittedTemplate.rows[0]?.template).not.toContain(
          '{totalAmount}',
        );
        const settingDefaults = await client.query<{ count: number }>(`
          SELECT count(*)::INTEGER AS count
          FROM "Setting"
          WHERE "key" IN (
            'production_stagnation_days',
            'pending_factory_backlog_threshold',
            'production_alert_scan_batch_size',
            'notify_order_submitted_enabled',
            'notify_order_change_enabled',
            'notify_production_anomaly_enabled',
            'notify_production_stagnation_enabled',
            'notify_pending_factory_backlog_enabled'
          )
        `);
        expect(settingDefaults.rows[0]?.count).toBe(8);

        const legacy = await client.query<{
          status: string;
          workOrderVersion: number;
          requestType: string;
        }>(`
          SELECT
            orders."status"::TEXT AS "status",
            orders."workOrderVersion" AS "workOrderVersion",
            requests."type"::TEXT AS "requestType"
          FROM "Order" orders
          CROSS JOIN "OrderChangeRequest" requests
          WHERE orders."id" = 'legacy-order'
            AND requests."id" = 'legacy-request'
        `);
        expect(legacy.rows).toEqual([
          {
            status: 'SUBMITTED',
            workOrderVersion: 1,
            requestType: 'MODIFY',
          },
        ]);

        const settlementIndex = await client.query<{ indexdef: string }>(
          `SELECT indexdef
             FROM pg_indexes
            WHERE schemaname = $1
              AND indexname = 'Order_settlement_candidate_idx'`,
          [isolatedSchema],
        );
        expect(settlementIndex.rows).toHaveLength(1);
        expect(settlementIndex.rows[0]?.indexdef).toContain(
          'WHERE ("settledFee" IS NOT NULL)',
        );

        await expect(
          client.query(`
            INSERT INTO "Order" (
              "id", "orderNo", "submitterId", "status", "billingMode",
              "settlementType", "customerRef", "settledFee"
            ) VALUES (
              'implicit-settled', 'BAD-SETTLED', 'agent-1', 'SETTLED',
              'CHARGE', 'EXTERNAL_SALES', NULL, 10
            )
          `),
        ).rejects.toMatchObject({ code: '23514' });

        await client.query(`
          INSERT INTO "Order" (
            "id", "orderNo", "submitterId", "status", "billingMode",
            "settlementType", "customerRef", "settledFee", "settledAt",
            "settlementContractVersion", "workOrderVersion"
          ) VALUES
            (
              'settled-order', 'WO-SETTLED', 'agent-1', 'SETTLED', 'CHARGE',
              'EXTERNAL_SALES', 'customer-A', 100,
              '2026-09-01T00:30:00.000Z', 2, 3
            ),
            (
              'zero-order', 'WO-ZERO', 'agent-1', 'SETTLED', 'CHARGE',
              'EXTERNAL_SALES', NULL, 0,
              '2026-10-01T00:30:00.000Z', 2, 1
            )
        `);

        await expect(
          client.query(`
            INSERT INTO "OrderChangeRequest" (
              "id", "status", "type", "reviewedById", "reviewedAt"
            ) VALUES (
              'denied-without-reason', 'DENIED', 'MODIFY', 'admin-1',
              CURRENT_TIMESTAMP
            )
          `),
        ).rejects.toMatchObject({ code: '23514' });
        await expect(
          client.query(`
            INSERT INTO "OrderChangeRequest" (
              "id", "status", "type", "reviewedById", "reviewedAt"
            ) VALUES (
              'cancel-without-settlement', 'APPROVED', 'CANCEL', 'admin-1',
              CURRENT_TIMESTAMP
            )
          `),
        ).rejects.toMatchObject({ code: '23514' });
        await client.query(`
          INSERT INTO "OrderChangeRequest" (
            "id", "status", "type", "producedQty", "settleFee",
            "workOrderVersionAfter", "reviewedById", "reviewedAt"
          ) VALUES (
            'approved-cancel', 'APPROVED', 'CANCEL', 25, 12.50, 4,
            'admin-1', CURRENT_TIMESTAMP
          )
        `);

        await expect(
          client.query(`
            INSERT INTO "OrderWorkflowDecision" (
              "id", "orderId", "fromStatus", "toStatus", "action",
              "reasonCode", "actorId", "idempotencyKey"
            ) VALUES (
              'invalid-hold', 'settled-order', 'CONFIRMED', 'ON_HOLD', 'HOLD',
              'PAPER_OUT', 'admin-1', 'decision-invalid-hold'
            )
          `),
        ).rejects.toMatchObject({ code: '23514' });
        await client.query(`
          INSERT INTO "OrderWorkflowDecision" (
            "id", "orderId", "fromStatus", "toStatus", "action",
            "reasonCode", "reasonNote", "affectedFigs", "actorId",
            "idempotencyKey"
          ) VALUES (
            'reject-1', 'settled-order', 'PENDING_FACTORY', 'REJECTED',
            'REJECT', 'DESIGN_ERROR', '重传第二款图稿', '["fig-2"]',
            'admin-1', 'decision-reject-1'
          )
        `);
        await expect(
          client.query(`
            INSERT INTO "OrderWorkflowDecision" (
              "id", "orderId", "fromStatus", "toStatus", "action",
              "recoveryEvidence", "actorId", "idempotencyKey"
            ) VALUES (
              'resume-empty', 'settled-order', 'ON_HOLD', 'PACKING', 'RESUME',
              '{}', 'admin-1', 'decision-resume-empty'
            )
          `),
        ).rejects.toMatchObject({ code: '23514' });
        await client.query(`
          INSERT INTO "OrderWorkflowDecision" (
            "id", "orderId", "fromStatus", "toStatus", "action",
            "reasonNote", "recoveryEvidence", "actorId", "idempotencyKey"
          ) VALUES (
            'resume-1', 'settled-order', 'ON_HOLD', 'PACKING', 'RESUME',
            '已复核纸张', '{"checkedBy":"admin-1"}', 'admin-1',
            'decision-resume-1'
          )
        `);
        await expect(
          client.query(`
            UPDATE "OrderWorkflowDecision"
               SET "reasonNote" = '覆盖历史'
             WHERE "id" = 'resume-1'
          `),
        ).rejects.toMatchObject({ code: 'P0001' });

        await client.query(`
          INSERT INTO "UserOrderStar" ("id", "userId", "orderId")
          VALUES ('star-1', 'admin-1', 'settled-order');
          INSERT INTO "OrderExport" ("id") VALUES ('export-1');
          INSERT INTO "OrderExportSelection" (
            "id", "exportId", "orderId", "sequence"
          ) VALUES ('selection-1', 'export-1', 'settled-order', 0)
        `);
        await expect(
          client.query(`
            INSERT INTO "UserOrderStar" ("id", "userId", "orderId")
            VALUES ('star-duplicate', 'admin-1', 'settled-order')
          `),
        ).rejects.toMatchObject({ code: '23505' });
        await expect(
          client.query(`
            INSERT INTO "OrderExportSelection" (
              "id", "exportId", "orderId", "sequence"
            ) VALUES ('selection-duplicate', 'export-1', 'zero-order', 0)
          `),
        ).rejects.toMatchObject({ code: '23505' });
        await client.query(`DELETE FROM "OrderExport" WHERE "id" = 'export-1'`);
        const remainingSelections = await client.query(
          `SELECT 1 FROM "OrderExportSelection" WHERE "exportId" = 'export-1'`,
        );
        expect(remainingSelections.rowCount).toBe(0);

        await client.query(`
          INSERT INTO "OrderPrintJob" (
            "id", "orderId", "workOrderVersion", "printKind", "reason",
            "state", "idempotencyKey", "createdById"
          ) VALUES (
            'print-request', 'settled-order', 3, 'INITIAL', '首次打印',
            'PENDING', 'print-request-key', 'admin-1'
          )
        `);
        await expect(
          client.query(`
            INSERT INTO "OrderPrintJob" (
              "id", "orderId", "workOrderVersion", "printKind", "reason",
              "state", "requestJobId", "idempotencyKey", "printedById",
              "printedAt"
            ) VALUES (
              'print-mismatch', 'settled-order', 3, 'INITIAL', '错误理由',
              'PRINTED', 'print-request', 'print-mismatch-key', 'admin-1',
              CURRENT_TIMESTAMP
            )
          `),
        ).rejects.toMatchObject({ code: 'P0001' });
        await client.query(`
          INSERT INTO "OrderPrintJob" (
            "id", "orderId", "workOrderVersion", "printKind", "reason",
            "state", "requestJobId", "idempotencyKey", "printedById",
            "printedAt"
          ) VALUES (
            'print-ack', 'settled-order', 3, 'INITIAL', '首次打印',
            'PRINTED', 'print-request', 'print-ack-key', 'admin-1',
            CURRENT_TIMESTAMP
          )
        `);
        await expect(
          client.query(`
            DELETE FROM "OrderPrintJob" WHERE "id" = 'print-request'
          `),
        ).rejects.toMatchObject({ code: 'P0001' });

        await client.query(`
          INSERT INTO "AgentMonthlyBill" (
            "id", "agentUserId", "period", "agentUsernameSnapshot",
            "agentDisplayNameSnapshot", "memberSubtotal", "adjustmentAmount",
            "totalAmount", "status", "updatedAt"
          ) VALUES
            (
              'bill-source', 'agent-1', '2026-09', 'agent-1', '代理商一',
              100, 0, 100, 'DRAFT', CURRENT_TIMESTAMP
            ),
            (
              'bill-oct', 'agent-1', '2026-10', 'agent-1', '代理商一',
              0, 0, 0, 'DRAFT', CURRENT_TIMESTAMP
            ),
            (
              'bill-nov', 'agent-1', '2026-11', 'agent-1', '代理商一',
              0, 0, 0, 'DRAFT', CURRENT_TIMESTAMP
            ),
            (
              'bill-dec', 'agent-1', '2026-12', 'agent-1', '代理商一',
              0, 0, 0, 'DRAFT', CURRENT_TIMESTAMP
            ),
            (
              'bill-earlier', 'agent-1', '2026-08', 'agent-1', '代理商一',
              0, 0, 0, 'DRAFT', CURRENT_TIMESTAMP
            ),
            (
              'bill-other-agent', 'agent-2', '2026-10', 'agent-2', '代理商二',
              0, 0, 0, 'DRAFT', CURRENT_TIMESTAMP
            ),
            (
              'bill-zero', 'agent-1', '2027-01', 'agent-1', '代理商一',
              0, 0, 0, 'DRAFT', CURRENT_TIMESTAMP
            )
        `);
        await client.query(`
          INSERT INTO "AgentMonthlyBillItem" (
            "id", "billId", "orderId", "orderNoSnapshot",
            "workOrderVersionSnapshot", "orderStatusSnapshot",
            "customerRefSnapshot", "settledFeeSnapshot", "settledAtSnapshot",
            "updatedAt"
          ) VALUES (
            'source-item', 'bill-source', 'settled-order', 'WO-SETTLED', 3,
            'SETTLED', 'customer-A', 100, '2026-09-01T00:30:00.000Z',
            CURRENT_TIMESTAMP
          )
        `);

        await client.query(`
          INSERT INTO "Order" (
            "id", "orderNo", "submitterId", "status", "billingMode",
            "settlementType", "customerRef", "settledFee", "settledAt",
            "settlementContractVersion", "workOrderVersion"
          ) VALUES (
            'race-order', 'WO-RACE', 'agent-2', 'SETTLED', 'CHARGE',
            'EXTERNAL_SALES', 'customer-race', 80,
            '2026-09-02T00:30:00.000Z', 2, 1
          );
          INSERT INTO "AgentMonthlyBill" (
            "id", "agentUserId", "period", "agentUsernameSnapshot",
            "agentDisplayNameSnapshot", "memberSubtotal", "adjustmentAmount",
            "totalAmount", "status", "updatedAt"
          ) VALUES (
            'bill-race', 'agent-2', '2026-09', 'agent-2', '代理商二',
            80, 0, 80, 'DRAFT', CURRENT_TIMESTAMP
          );
          INSERT INTO "AgentMonthlyBillItem" (
            "id", "billId", "orderId", "orderNoSnapshot",
            "workOrderVersionSnapshot", "orderStatusSnapshot",
            "customerRefSnapshot", "settledFeeSnapshot", "settledAtSnapshot",
            "updatedAt"
          ) VALUES (
            'race-item', 'bill-race', 'race-order', 'WO-RACE', 1,
            'SETTLED', 'customer-race', 80,
            '2026-09-02T00:30:00.000Z', CURRENT_TIMESTAMP
          )
        `);

        const confirmer = new Client({ connectionString: databaseUrl });
        const settlementWriter = new Client({ connectionString: databaseUrl });
        await Promise.all([confirmer.connect(), settlementWriter.connect()]);
        try {
          for (const peer of [confirmer, settlementWriter]) {
            await peer.query(`SET search_path TO ${quotedSchema}, public`);
          }
          await confirmer.query('BEGIN');
          await confirmer.query(`
            UPDATE "AgentMonthlyBill"
               SET "status" = 'CONFIRMED',
                   "confirmedById" = 'admin-1',
                   "confirmedAt" = '2026-10-01T00:00:00.000Z',
                   "updatedAt" = CURRENT_TIMESTAMP
             WHERE "id" = 'bill-race'
          `);

          await settlementWriter.query('BEGIN');
          await settlementWriter.query(`SET LOCAL lock_timeout TO '200ms'`);
          await expect(
            settlementWriter.query(`
              UPDATE "Order"
                 SET "settledFee" = 81
               WHERE "id" = 'race-order'
            `),
          ).rejects.toMatchObject({ code: '55P03' });
          await settlementWriter.query('ROLLBACK');
          await confirmer.query('COMMIT');

          await expect(
            settlementWriter.query(`
              UPDATE "Order"
                 SET "settledFee" = 81
               WHERE "id" = 'race-order'
            `),
          ).rejects.toMatchObject({ code: 'P0001' });
        } finally {
          await Promise.all([
            confirmer.query('ROLLBACK').catch(() => undefined),
            settlementWriter.query('ROLLBACK').catch(() => undefined),
          ]);
          await Promise.all([confirmer.end(), settlementWriter.end()]);
        }

        await client.query(`
          UPDATE "AgentMonthlyBill"
             SET "status" = 'CONFIRMED',
                 "confirmedById" = 'admin-1',
                 "confirmedAt" = '2026-10-01T00:00:00.000Z',
                 "updatedAt" = CURRENT_TIMESTAMP
           WHERE "id" = 'bill-source'
        `);
        await expect(
          client.query(`
            UPDATE "Order"
               SET "settledFee" = 99
             WHERE "id" = 'settled-order'
          `),
        ).rejects.toMatchObject({ code: 'P0001' });

        await expect(
          client.query(`
            INSERT INTO "AgentMonthlyBillCredit" (
              "id", "sourceItemId", "requestedAmount", "reason",
              "idempotencyKey", "createdById"
            ) VALUES (
              'credit-too-large', 'source-item', -101, '错单全额撤回',
              'credit-too-large-key', 'admin-1'
            )
          `),
        ).rejects.toMatchObject({ code: 'P0001' });
        await client.query(`
          INSERT INTO "AgentMonthlyBillCredit" (
            "id", "sourceItemId", "requestedAmount", "reason",
            "idempotencyKey", "createdById"
          ) VALUES (
            'credit-1', 'source-item', -60, '错单部分调整',
            'credit-1-key', 'admin-1'
          )
        `);
        await expect(
          client.query(`
            UPDATE "AgentMonthlyBillCredit"
               SET "reason" = '覆盖不可变事实'
             WHERE "id" = 'credit-1'
          `),
        ).rejects.toMatchObject({ code: 'P0001' });
        await expect(
          client.query(`
            INSERT INTO "AgentMonthlyBillAdjustment" (
              "id", "billId", "creditId", "amount"
            ) VALUES ('allocation-earlier', 'bill-earlier', 'credit-1', -1)
          `),
        ).rejects.toMatchObject({ code: 'P0001' });
        await expect(
          client.query(`
            INSERT INTO "AgentMonthlyBillAdjustment" (
              "id", "billId", "creditId", "amount"
            ) VALUES (
              'allocation-other-agent', 'bill-other-agent', 'credit-1', -1
            )
          `),
        ).rejects.toMatchObject({ code: 'P0001' });
        await client.query(`
          INSERT INTO "AgentMonthlyBillAdjustment" (
            "id", "billId", "creditId", "amount"
          ) VALUES
            ('allocation-oct', 'bill-oct', 'credit-1', -40),
            ('allocation-nov', 'bill-nov', 'credit-1', -20)
        `);
        await expect(
          client.query(`
            INSERT INTO "AgentMonthlyBillAdjustment" (
              "id", "billId", "creditId", "amount"
            ) VALUES ('allocation-overflow', 'bill-dec', 'credit-1', -1)
          `),
        ).rejects.toMatchObject({ code: 'P0001' });

        await expect(
          client.query(`
            INSERT INTO "AgentMonthlyBillReceipt" (
              "id", "billId", "amount", "receivedAt", "idempotencyKey",
              "recordedById"
            ) VALUES (
              'receipt-wrong', 'bill-source', 99,
              '2026-10-02T00:00:00.000Z', 'receipt-wrong-key', 'admin-1'
            )
          `),
        ).rejects.toMatchObject({ code: 'P0001' });
        await client.query(`
          INSERT INTO "AgentMonthlyBillReceipt" (
            "id", "billId", "amount", "receivedAt", "idempotencyKey",
            "recordedById"
          ) VALUES (
            'receipt-source', 'bill-source', 100,
            '2026-10-02T00:00:00.000Z', 'receipt-source-key', 'admin-1'
          );
          UPDATE "AgentMonthlyBill"
             SET "status" = 'PAID',
                 "paidById" = 'admin-1',
                 "paidAt" = '2026-10-02T00:00:00.000Z',
                 "updatedAt" = CURRENT_TIMESTAMP
           WHERE "id" = 'bill-source'
        `);

        await client.query(`
          UPDATE "AgentMonthlyBill"
             SET "status" = 'CONFIRMED',
                 "confirmedById" = 'admin-1',
                 "confirmedAt" = '2027-02-01T00:00:00.000Z',
                 "updatedAt" = CURRENT_TIMESTAMP
           WHERE "id" = 'bill-zero';
          INSERT INTO "AgentMonthlyBillReceipt" (
            "id", "billId", "amount", "receivedAt", "idempotencyKey",
            "recordedById"
          ) VALUES (
            'receipt-zero', 'bill-zero', 0,
            '2027-02-02T00:00:00.000Z', 'receipt-zero-key', 'admin-1'
          );
          UPDATE "AgentMonthlyBill"
             SET "status" = 'PAID',
                 "paidById" = 'admin-1',
                 "paidAt" = '2027-02-02T00:00:00.000Z',
                 "updatedAt" = CURRENT_TIMESTAMP
           WHERE "id" = 'bill-zero'
        `);
        const paidBills = await client.query<{
          id: string;
          status: string;
          totalAmount: string;
        }>(`
          SELECT
            "id",
            "status"::TEXT AS "status",
            "totalAmount"::TEXT AS "totalAmount"
          FROM "AgentMonthlyBill"
          WHERE "id" IN ('bill-source', 'bill-zero')
          ORDER BY "id"
        `);
        expect(paidBills.rows).toEqual([
          { id: 'bill-source', status: 'PAID', totalAmount: '100.00' },
          { id: 'bill-zero', status: 'PAID', totalAmount: '0.00' },
        ]);
      } finally {
        await client.query('ROLLBACK').catch(() => undefined);
        await client.query('RESET search_path').catch(() => undefined);
        await client
          .query(`DROP SCHEMA IF EXISTS ${quotedSchema} CASCADE`)
          .catch(() => undefined);
        await client.end();
      }
    }, 30_000);
  },
);
