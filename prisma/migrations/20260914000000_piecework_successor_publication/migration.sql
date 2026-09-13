-- Rates, publication evidence and reports remain immutable. A successor may
-- close an open validity interval prospectively in the same transaction.
CREATE OR REPLACE FUNCTION protect_piecework_price_book_history()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' AND OLD."status" = 'PUBLISHED' THEN
    RAISE EXCEPTION 'Published PieceworkPriceBook rows are immutable';
  END IF;
  IF TG_OP = 'UPDATE' THEN
    IF OLD."status" = 'PUBLISHED' THEN
      IF OLD."effectiveTo" IS NOT NULL OR NEW."effectiveTo" IS NULL
        OR NEW."effectiveTo" < CURRENT_TIMESTAMP
        OR NEW."effectiveTo" <= OLD."effectiveFrom"
        OR (to_jsonb(NEW) - 'effectiveTo' - 'updatedAt') IS DISTINCT FROM
           (to_jsonb(OLD) - 'effectiveTo' - 'updatedAt')
        OR EXISTS (SELECT 1 FROM "ProductionReport"
          WHERE "priceBookId" = OLD."id" AND "reportedAt" >= NEW."effectiveTo") THEN
        RAISE EXCEPTION 'Published PieceworkPriceBook rows are immutable';
      END IF;
    END IF;
    IF NEW."id" <> OLD."id" OR NEW."version" <> OLD."version" THEN
      RAISE EXCEPTION 'PieceworkPriceBook identity is immutable';
    END IF;
  END IF;
  RETURN COALESCE(NEW, OLD);
END;
$$;

CREATE FUNCTION require_piecework_successor_publication()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF OLD."status" = 'PUBLISHED' AND NEW."effectiveTo" IS DISTINCT FROM OLD."effectiveTo"
    AND NOT EXISTS (
      SELECT 1 FROM "PieceworkPriceBook" successor
      WHERE successor."status" = 'PUBLISHED'
        AND successor."version" = OLD."version" + 1
        AND successor."effectiveFrom" = NEW."effectiveTo"
    ) THEN
    RAISE EXCEPTION 'Closing a piecework price book requires its published successor';
  END IF;
  RETURN NEW;
END;
$$;

CREATE CONSTRAINT TRIGGER "PieceworkPriceBook_require_successor"
AFTER UPDATE ON "PieceworkPriceBook" DEFERRABLE INITIALLY DEFERRED
FOR EACH ROW EXECUTE FUNCTION require_piecework_successor_publication();
