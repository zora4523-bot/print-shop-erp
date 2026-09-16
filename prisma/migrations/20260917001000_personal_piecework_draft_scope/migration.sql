-- Each account and the unified scope can independently hold one editable draft.
DROP INDEX "PieceworkPriceBook_single_draft_key";
CREATE UNIQUE INDEX "PieceworkPriceBook_single_draft_key"
  ON "PieceworkPriceBook" (COALESCE("workerId", '')) WHERE "status" = 'DRAFT';
