-- Drafts now store the administrator's proposed time and publication note.
-- Published evidence and existing history triggers remain unchanged.
ALTER TABLE "PieceworkPriceBook"
  DROP CONSTRAINT "PieceworkPriceBook_publication_shape_check",
  ADD CONSTRAINT "PieceworkPriceBook_publication_shape_check" CHECK (
    (
      "status" = 'DRAFT'
      AND "effectiveTo" IS NULL
      AND "publishedById" IS NULL
      AND "publishedAt" IS NULL
      AND "manifestSha256" IS NULL
      AND "ruleSetSha256" IS NULL
      AND ("publishNote" IS NULL OR length("publishNote") <= 500)
      AND ("sourceName" IS NULL OR length("sourceName") <= 500)
    )
    OR (
      "status" = 'PUBLISHED'
      AND "effectiveFrom" IS NOT NULL
      AND "publishedById" IS NOT NULL
      AND "publishedAt" IS NOT NULL
      AND "sourceName" IS NOT NULL
      AND "sourceSha256" IS NOT NULL
      AND "manifestSha256" IS NOT NULL
      AND "ruleSetSha256" IS NOT NULL
      AND length(btrim("publishNote")) BETWEEN 2 AND 500
    )
  );
