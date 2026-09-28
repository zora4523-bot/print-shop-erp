-- Trigger records have different shapes; resolve the relevant field in separate statements.
-- A corrected zero ledger can become a pending wage on a new actual completion.
CREATE OR REPLACE FUNCTION check_production_wage_balance() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE wage_id text; actual numeric; expected numeric; n bigint;
BEGIN
  IF TG_TABLE_NAME = 'ProductionWage' THEN wage_id := NEW.id; ELSE wage_id := NEW."wageId"; END IF;
  SELECT amount INTO expected FROM "ProductionWage" WHERE id=wage_id;
  SELECT coalesce(sum(amount),0),count(*) INTO actual,n FROM "ProductionWageEntry" WHERE "wageId"=wage_id;
  IF (expected IS NULL AND actual <> 0) OR (expected IS NOT NULL AND (n=0 OR expected <> actual)) THEN RAISE EXCEPTION 'Wage projection does not match append-only ledger'; END IF;
  RETURN NULL;
END $$;
