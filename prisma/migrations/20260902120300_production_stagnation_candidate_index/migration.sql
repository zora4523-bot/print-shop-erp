CREATE INDEX CONCURRENTLY IF NOT EXISTS "Order_production_stagnation_candidate_idx"
ON "Order" ("scheduledAt", "id")
INCLUDE ("orderNo", "workOrderVersion")
WHERE "scheduledAt" IS NOT NULL
  AND "status" IN (
    'RELEASED'::"OrderStatus",
    'FOILING'::"OrderStatus",
    'PACKING'::"OrderStatus"
  );
