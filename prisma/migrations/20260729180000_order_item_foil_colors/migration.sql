-- Upgrade the free-text single foil color to a structured multi-value field.
-- Historical values stay intact as one array element: an old custom value may
-- itself contain punctuation, so attempting to split it would corrupt data.
ALTER TABLE "OrderItem"
  RENAME COLUMN "foilColor" TO "foilColors";

ALTER TABLE "OrderItem"
  ALTER COLUMN "foilColors" TYPE TEXT[]
  USING CASE
    WHEN "foilColors" IS NULL OR btrim("foilColors") = '' THEN ARRAY[]::TEXT[]
    ELSE ARRAY["foilColors"]::TEXT[]
  END;

ALTER TABLE "OrderItem"
  ALTER COLUMN "foilColors" SET DEFAULT ARRAY[]::TEXT[],
  ALTER COLUMN "foilColors" SET NOT NULL;
