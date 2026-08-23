BEGIN;

CREATE SCHEMA IF NOT EXISTS app_ops;

-- Historical OutsourceOrder rows predate per-item quantity snapshots.  A
-- multi-item order (or a row with no recorded total) cannot be reconstructed
-- from today's OrderItem quantities: the order may have changed after the
-- outsource order was sent.  Keep operator-verified evidence in a staging
-- ledger that is committed before the enforcing migration runs.
CREATE TABLE app_ops.outsource_snapshot_reconciliation (
  outsource_order_id TEXT NOT NULL,
  order_item_id TEXT NOT NULL,
  quantity INTEGER NOT NULL,
  verified_by TEXT NOT NULL,
  verification_note TEXT NOT NULL,
  verified_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),

  CONSTRAINT outsource_snapshot_reconciliation_pkey
    PRIMARY KEY (outsource_order_id, order_item_id),
  CONSTRAINT outsource_snapshot_reconciliation_quantity_positive
    CHECK (quantity > 0),
  CONSTRAINT outsource_snapshot_reconciliation_verified_by_nonempty
    CHECK (btrim(verified_by) <> ''),
  CONSTRAINT outsource_snapshot_reconciliation_note_nonempty
    CHECK (btrim(verification_note) <> '')
);

-- A one-item legacy order with a positive totalQty has an unambiguous split:
-- the total captured on OutsourceOrder creation is that item's frozen amount.
-- This is the only historical shape we can prove without human evidence.
INSERT INTO app_ops.outsource_snapshot_reconciliation (
  outsource_order_id,
  order_item_id,
  quantity,
  verified_by,
  verification_note
)
SELECT
  outsource."id",
  outsource."orderItemIds"[1],
  outsource."totalQty",
  'migration:single-item-totalQty',
  'Single linked item; the creation-time totalQty uniquely determines its quantity'
FROM "OutsourceOrder" AS outsource
JOIN "OrderItem" AS item
  ON item."id" = outsource."orderItemIds"[1]
 AND item."orderId" = outsource."orderId"
WHERE outsource."orderId" IS NOT NULL
  AND outsource."status"::text <> 'CANCELLED'
  AND cardinality(outsource."orderItemIds") = 1
  AND outsource."totalQty" > 0
ON CONFLICT (outsource_order_id, order_item_id) DO NOTHING;

-- Read-only worklist for the deployment operator.  current_quantity is a
-- comparison aid only; it is deliberately never used as migration evidence.
CREATE OR REPLACE VIEW app_ops.outsource_snapshot_reconciliation_worklist AS
SELECT
  outsource."id" AS outsource_order_id,
  outsource."orderId" AS order_id,
  outsource."status"::text AS outsource_status,
  outsource."createdAt" AS outsource_created_at,
  outsource."totalQty" AS recorded_total_quantity,
  linked.order_item_id,
  item."sequence" AS order_item_sequence,
  item."name" AS order_item_name,
  item."quantity" AS current_quantity,
  reconciliation.quantity AS verified_snapshot_quantity,
  reconciliation.verified_by,
  reconciliation.verification_note,
  reconciliation.verified_at
FROM "OutsourceOrder" AS outsource
LEFT JOIN LATERAL unnest(outsource."orderItemIds")
  AS linked(order_item_id) ON TRUE
LEFT JOIN "OrderItem" AS item
  ON item."id" = linked.order_item_id
LEFT JOIN app_ops.outsource_snapshot_reconciliation AS reconciliation
  ON reconciliation.outsource_order_id = outsource."id"
 AND reconciliation.order_item_id = linked.order_item_id
WHERE outsource."orderId" IS NOT NULL
  AND outsource."status"::text <> 'CANCELLED';

COMMENT ON TABLE app_ops.outsource_snapshot_reconciliation IS
  'Operator-verified creation-time quantities used to backfill immutable outsource item snapshots';
COMMENT ON VIEW app_ops.outsource_snapshot_reconciliation_worklist IS
  'Uncancelled legacy outsource rows; NULL verified_snapshot_quantity blocks the enforcing migration';

COMMIT;
