-- Production reporting must never turn an invalid plan into payable output.
-- Raise a targeted error before adding the CHECK so deploys stop with an
-- actionable remediation message instead of silently accepting dirty rows.
--
-- These two expected preflight failures intentionally run before BEGIN.
-- Prisma's PostgreSQL migration runner otherwise replaces a RAISE EXCEPTION
-- inside an explicit transaction with the unhelpful follow-up error "current
-- transaction is aborted".  No schema/data changes happen before both checks
-- pass, so the actionable root-cause message remains visible to operations.
DO $$
BEGIN
  IF EXISTS (
    SELECT 1
      FROM "ProductionTask"
     WHERE "plannedQty" <= 0
  ) THEN
    RAISE EXCEPTION
      'Cannot enforce ProductionTask plannedQty integrity: rows with plannedQty <= 0 exist; repair them before retrying this migration';
  END IF;
END $$;

-- Every live historical outsource row needs creation-time, per-style evidence
-- in the staging ledger prepared by the preceding migration.  Do this
-- preflight before any DDL in this migration.  In particular, never substitute
-- current OrderItem.quantity: a later order change may have changed either the
-- total or the split while leaving the old outsource order RECEIVED.
DO $$
BEGIN
  IF EXISTS (
    SELECT 1
      FROM "OutsourceOrder" AS outsource
     WHERE outsource."orderId" IS NOT NULL
       AND outsource."status"::text <> 'CANCELLED'
       AND (
         COALESCE(cardinality(outsource."orderItemIds"), 0) = 0
         OR cardinality(outsource."orderItemIds") <> (
           SELECT COUNT(*)
             FROM unnest(outsource."orderItemIds") AS linked("orderItemId")
             JOIN "OrderItem" AS item
               ON item."id" = linked."orderItemId"
              AND item."orderId" = outsource."orderId"
         )
         OR cardinality(outsource."orderItemIds") <> (
           SELECT COUNT(DISTINCT linked."orderItemId")
             FROM unnest(outsource."orderItemIds") AS linked("orderItemId")
         )
         OR cardinality(outsource."orderItemIds") <> (
           SELECT COUNT(*)
             FROM unnest(outsource."orderItemIds") AS linked("orderItemId")
             JOIN app_ops.outsource_snapshot_reconciliation AS reconciliation
               ON reconciliation.outsource_order_id = outsource."id"
              AND reconciliation.order_item_id = linked."orderItemId"
         )
         OR EXISTS (
           SELECT 1
             FROM app_ops.outsource_snapshot_reconciliation AS reconciliation
            WHERE reconciliation.outsource_order_id = outsource."id"
              AND NOT (
                reconciliation.order_item_id = ANY(outsource."orderItemIds")
              )
         )
         OR (
           outsource."totalQty" IS NOT NULL
           AND outsource."totalQty" <> (
             SELECT COALESCE(SUM(reconciliation.quantity), 0)
               FROM unnest(outsource."orderItemIds") AS linked("orderItemId")
               JOIN app_ops.outsource_snapshot_reconciliation AS reconciliation
                 ON reconciliation.outsource_order_id = outsource."id"
                AND reconciliation.order_item_id = linked."orderItemId"
           )
         )
       )
  ) THEN
    RAISE EXCEPTION
      'Cannot backfill outsource snapshots without creation-time evidence. Reconcile every NULL row in app_ops.outsource_snapshot_reconciliation_worklist, keep verified sums equal to non-null OutsourceOrder.totalQty, then mark this migration rolled back and retry';
  END IF;
END $$;

-- deploy/update.sh keeps every writer stopped throughout migrate deploy. Once
-- both read-only preflights pass, make all enforcing DDL/backfill changes
-- atomic so an unexpected later failure rolls the migration back completely.
BEGIN;

ALTER TABLE "ProductionTask"
  ADD CONSTRAINT "ProductionTask_plannedQty_positive_check"
  CHECK ("plannedQty" > 0);

-- Freeze the verified quantity of every style.  The legacy orderItemIds array
-- remains for compatibility, but completion uses only this immutable ledger.
CREATE TABLE "OutsourceOrderItemSnapshot" (
  "id" TEXT NOT NULL,
  "outsourceOrderId" TEXT NOT NULL,
  "orderItemId" TEXT NOT NULL,
  "quantity" INTEGER NOT NULL,

  CONSTRAINT "OutsourceOrderItemSnapshot_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "OutsourceOrderItemSnapshot_quantity_positive_check"
    CHECK ("quantity" > 0)
);

INSERT INTO "OutsourceOrderItemSnapshot" (
  "id",
  "outsourceOrderId",
  "orderItemId",
  "quantity"
)
SELECT
  'osis_' || md5(outsource."id" || ':' || reconciliation.order_item_id),
  outsource."id",
  reconciliation.order_item_id,
  reconciliation.quantity
FROM "OutsourceOrder" AS outsource
CROSS JOIN LATERAL unnest(outsource."orderItemIds") AS linked("orderItemId")
JOIN app_ops.outsource_snapshot_reconciliation AS reconciliation
  ON reconciliation.outsource_order_id = outsource."id"
 AND reconciliation.order_item_id = linked."orderItemId"
WHERE outsource."orderId" IS NOT NULL
  AND outsource."status"::text <> 'CANCELLED';

UPDATE "OutsourceOrder" AS outsource
   SET "totalQty" = snapshot."totalQty"
  FROM (
    SELECT "outsourceOrderId", SUM("quantity")::integer AS "totalQty"
      FROM "OutsourceOrderItemSnapshot"
     GROUP BY "outsourceOrderId"
  ) AS snapshot
 WHERE outsource."id" = snapshot."outsourceOrderId"
   AND outsource."totalQty" IS NULL;

CREATE UNIQUE INDEX "OutsourceOrderItemSnapshot_outsourceOrderId_orderItemId_key"
  ON "OutsourceOrderItemSnapshot"("outsourceOrderId", "orderItemId");

CREATE INDEX "OutsourceOrderItemSnapshot_orderItemId_idx"
  ON "OutsourceOrderItemSnapshot"("orderItemId");

ALTER TABLE "OutsourceOrderItemSnapshot"
  ADD CONSTRAINT "OutsourceOrderItemSnapshot_outsourceOrderId_fkey"
  FOREIGN KEY ("outsourceOrderId") REFERENCES "OutsourceOrder"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "OutsourceOrderItemSnapshot"
  ADD CONSTRAINT "OutsourceOrderItemSnapshot_orderItemId_fkey"
  FOREIGN KEY ("orderItemId") REFERENCES "OrderItem"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;

-- Persist partial-posting outcomes in the same transaction as the count so a
-- lost response can be replayed byte-for-byte without claiming stale rows were
-- posted.
ALTER TABLE "InventoryCount"
  ADD COLUMN "staleKeys" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
  ADD COLUMN "staleMessage" TEXT;

-- Freeze the first durable daily-cron roster. Without this checkpoint, an
-- account deactivation between attempts can remove an unpaid base-only worker
-- from the next scan, while a newly activated worker can be added to a date
-- whose settlement already started.
CREATE TABLE "DailySalaryCronRun" (
  "date" DATE NOT NULL,
  "roster" JSONB NOT NULL,
  "completedAt" TIMESTAMP(3),
  "summaryWorkerCount" INTEGER,
  "summaryTotalAmount" DECIMAL(14,2),
  "notificationDedupeKey" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "DailySalaryCronRun_pkey" PRIMARY KEY ("date"),
  CONSTRAINT "DailySalaryCronRun_roster_array_check"
    CHECK (jsonb_typeof("roster") = 'array'),
  CONSTRAINT "DailySalaryCronRun_summary_nonnegative_check"
    CHECK (
      "summaryWorkerCount" IS NULL OR "summaryWorkerCount" >= 0
    ),
  CONSTRAINT "DailySalaryCronRun_total_nonnegative_check"
    CHECK (
      "summaryTotalAmount" IS NULL OR "summaryTotalAmount" >= 0
    ),
  CONSTRAINT "DailySalaryCronRun_completion_shape_check"
    CHECK (
      (
        "completedAt" IS NULL
        AND "summaryWorkerCount" IS NULL
        AND "summaryTotalAmount" IS NULL
        AND "notificationDedupeKey" IS NULL
      )
      OR
      (
        "completedAt" IS NOT NULL
        AND "summaryWorkerCount" IS NOT NULL
        AND "summaryTotalAmount" IS NOT NULL
        AND "notificationDedupeKey" IS NOT NULL
      )
    )
);

CREATE UNIQUE INDEX "DailySalaryCronRun_notificationDedupeKey_key"
  ON "DailySalaryCronRun"("notificationDedupeKey");

COMMIT;
