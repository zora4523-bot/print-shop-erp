-- Historical requests predate production-version concurrency control, so the
-- captured version is nullable. Every newly created request writes this field.
ALTER TABLE "OrderChangeRequest"
  ADD COLUMN "baseWorkOrderVersion" INTEGER;

ALTER TABLE "OrderChangeRequest"
  ADD CONSTRAINT "OrderChangeRequest_base_work_order_version_check"
  CHECK (
    "baseWorkOrderVersion" IS NULL
    OR "baseWorkOrderVersion" >= 1
  );

-- Existing approved rows may predate workOrderVersionAfter. NOT VALID keeps
-- those historical rows readable while PostgreSQL enforces the invariant for
-- every new insert or update immediately.
ALTER TABLE "OrderChangeRequest"
  ADD CONSTRAINT "OrderChangeRequest_approved_work_order_version_check"
  CHECK (
    "status" <> 'APPROVED'::"OrderChangeRequestStatus"
    OR "workOrderVersionAfter" IS NOT NULL
  ) NOT VALID;
