BEGIN;

-- Published price-book rows are immutable audit evidence.  This migration is
-- intentionally a compatibility marker only: the structured route conversion
-- is performed after cloning into `next_book_id` by the rule-centre release
-- migration.  Keeping this file non-mutating also makes a fresh install and an
-- upgrade from an audited workbook produce the same historical v1/v2 rows.
--
-- Installations that applied the earlier mutating form are repaired by the
-- later restore migration; do not add CustomerPriceRule writes here.

COMMIT;
