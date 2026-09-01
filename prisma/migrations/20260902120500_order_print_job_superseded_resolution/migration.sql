-- A version upgrade must close every unresolved print request with an
-- append-only relationship fact. An OrderLog note alone is not authoritative:
-- generic consumers are allowed to decide unresolved solely by resolution IS
-- NULL, so SUPERSEDED must occupy the same one-to-one resolution relation as a
-- PRINTED receipt.
ALTER TYPE "OrderPrintJobState" ADD VALUE IF NOT EXISTS 'SUPERSEDED';

ALTER TABLE "OrderPrintJob"
  DROP CONSTRAINT "OrderPrintJob_state_shape_check";

ALTER TABLE "OrderPrintJob"
  ADD CONSTRAINT "OrderPrintJob_state_shape_check"
  CHECK (
    (
      "state" = 'PENDING'::"OrderPrintJobState"
      AND "requestJobId" IS NULL
      AND "printedById" IS NULL
      AND "printedAt" IS NULL
    )
    OR (
      "state" = 'PRINTED'::"OrderPrintJobState"
      AND "requestJobId" IS NOT NULL
      AND "printedById" IS NOT NULL
      AND "printedAt" IS NOT NULL
    )
    OR (
      "state" = 'SUPERSEDED'::"OrderPrintJobState"
      AND "requestJobId" IS NOT NULL
      AND "createdById" IS NOT NULL
      AND "printedById" IS NULL
      AND "printedAt" IS NULL
    )
  );

CREATE OR REPLACE FUNCTION validate_order_print_job_insert()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  request_row "OrderPrintJob"%ROWTYPE;
BEGIN
  IF NEW."state" = 'PENDING'::"OrderPrintJobState" THEN
    RETURN NEW;
  END IF;

  SELECT * INTO request_row
  FROM "OrderPrintJob"
  WHERE "id" = NEW."requestJobId"
  FOR SHARE;

  IF NOT FOUND
    OR request_row."state" <> 'PENDING'::"OrderPrintJobState"
    OR request_row."orderId" <> NEW."orderId"
    OR request_row."workOrderVersion" <> NEW."workOrderVersion"
    OR request_row."printKind" <> NEW."printKind"
    OR request_row."reason" <> NEW."reason"
  THEN
    RAISE EXCEPTION 'OrderPrintJob resolution must match its pending request';
  END IF;

  RETURN NEW;
END;
$$;
