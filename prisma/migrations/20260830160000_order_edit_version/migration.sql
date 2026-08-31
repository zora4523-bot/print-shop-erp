-- `updatedAt` is a millisecond timestamp and can repeat across adjacent
-- writes. Keep a separate, database-owned monotonic token for stale edit
-- detection; `revision` has an existing business meaning and is not reused.
ALTER TABLE "Order"
  ADD COLUMN "editVersion" INTEGER NOT NULL DEFAULT 0;

CREATE OR REPLACE FUNCTION bump_order_edit_version()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  NEW."editVersion" := OLD."editVersion" + 1;
  RETURN NEW;
END;
$$;

CREATE TRIGGER order_edit_version_bump
BEFORE UPDATE ON "Order"
FOR EACH ROW
EXECUTE FUNCTION bump_order_edit_version();
