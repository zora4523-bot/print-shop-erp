-- PR-6: Pinyin search backed by Pigsty pg_pinyin + pg_trgm.
--
-- Pigsty documents pg_pinyin's lightweight search path as generated pinyin
-- columns plus trigram indexes. Keep the app-level search API unchanged:
-- users still type into q, while PostgreSQL maintains romanized search text.
--
-- pinyin_char_romanize emits pipe-delimited syllables such as
-- `|ping| |guo|`; store both a compact full-pinyin form (`pingguo`) and a
-- compact initials form (`pg`) so Chinese, full Pinyin, and initials all use
-- the same q field.
--
-- pg_pinyin is a Pigsty extension. Current local/dev PostgreSQL instances may
-- not have the extension package installed, so this migration keeps the
-- application schema deployable by adding nullable fallback columns when
-- pg_pinyin is unavailable. Pigsty deployments get generated columns and the
-- readiness view still treats missing pg_pinyin as a blocker for pinyin search.

CREATE EXTENSION IF NOT EXISTS pg_trgm;

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_available_extensions WHERE name = 'pg_pinyin'
  ) THEN
    EXECUTE 'CREATE EXTENSION IF NOT EXISTS pg_pinyin';
  END IF;

  IF EXISTS (
    SELECT 1 FROM pg_extension WHERE extname = 'pg_pinyin'
  ) THEN
    EXECUTE $ddl$
      ALTER TABLE "Order"
        ADD COLUMN "searchPinyin" TEXT GENERATED ALWAYS AS (
          lower(
            regexp_replace(
              public.pinyin_char_romanize(
                COALESCE("orderNo", '') ||
                ' ' || COALESCE("customerRef", '') ||
                ' ' || COALESCE("receiverName", '') ||
                ' ' || COALESCE("receiverPhone", '') ||
                ' ' || COALESCE("trackingNo", '') ||
                ' ' || COALESCE("expressCode", '')
              ),
              '[^[:alnum:]]+',
              '',
              'g'
            )
          )
        ) STORED,
        ADD COLUMN "searchPinyinInitials" TEXT GENERATED ALWAYS AS (
          lower(
            regexp_replace(
              regexp_replace(
                public.pinyin_char_romanize(
                  COALESCE("orderNo", '') ||
                  ' ' || COALESCE("customerRef", '') ||
                  ' ' || COALESCE("receiverName", '') ||
                  ' ' || COALESCE("receiverPhone", '') ||
                  ' ' || COALESCE("trackingNo", '') ||
                  ' ' || COALESCE("expressCode", '')
                ),
                '\|([[:alpha:]])[[:alpha:]]*\|',
                '\1',
                'g'
              ),
              '[^[:alnum:]]+',
              '',
              'g'
            )
          )
        ) STORED
    $ddl$;

    EXECUTE $ddl$
      ALTER TABLE "Product"
        ADD COLUMN "searchPinyin" TEXT GENERATED ALWAYS AS (
          lower(
            regexp_replace(
              public.pinyin_char_romanize(
                COALESCE("code"::TEXT, '') ||
                ' ' || COALESCE("name", '') ||
                ' ' || COALESCE("specification", '') ||
                ' ' || COALESCE("paperType", '')
              ),
              '[^[:alnum:]]+',
              '',
              'g'
            )
          )
        ) STORED,
        ADD COLUMN "searchPinyinInitials" TEXT GENERATED ALWAYS AS (
          lower(
            regexp_replace(
              regexp_replace(
                public.pinyin_char_romanize(
                  COALESCE("code"::TEXT, '') ||
                  ' ' || COALESCE("name", '') ||
                  ' ' || COALESCE("specification", '') ||
                  ' ' || COALESCE("paperType", '')
                ),
                '\|([[:alpha:]])[[:alpha:]]*\|',
                '\1',
                'g'
              ),
              '[^[:alnum:]]+',
              '',
              'g'
            )
          )
        ) STORED
    $ddl$;

    EXECUTE $ddl$
      ALTER TABLE "Material"
        ADD COLUMN "searchPinyin" TEXT GENERATED ALWAYS AS (
          lower(
            regexp_replace(
              public.pinyin_char_romanize(
                COALESCE("code"::TEXT, '') ||
                ' ' || COALESCE("name", '') ||
                ' ' || COALESCE("specification", '') ||
                ' ' || COALESCE("unit", '')
              ),
              '[^[:alnum:]]+',
              '',
              'g'
            )
          )
        ) STORED,
        ADD COLUMN "searchPinyinInitials" TEXT GENERATED ALWAYS AS (
          lower(
            regexp_replace(
              regexp_replace(
                public.pinyin_char_romanize(
                  COALESCE("code"::TEXT, '') ||
                  ' ' || COALESCE("name", '') ||
                  ' ' || COALESCE("specification", '') ||
                  ' ' || COALESCE("unit", '')
                ),
                '\|([[:alpha:]])[[:alpha:]]*\|',
                '\1',
                'g'
              ),
              '[^[:alnum:]]+',
              '',
              'g'
            )
          )
        ) STORED
    $ddl$;
  ELSE
    ALTER TABLE "Order"
      ADD COLUMN "searchPinyin" TEXT,
      ADD COLUMN "searchPinyinInitials" TEXT;

    ALTER TABLE "Product"
      ADD COLUMN "searchPinyin" TEXT,
      ADD COLUMN "searchPinyinInitials" TEXT;

    ALTER TABLE "Material"
      ADD COLUMN "searchPinyin" TEXT,
      ADD COLUMN "searchPinyinInitials" TEXT;
  END IF;
END
$$;

CREATE INDEX "Order_searchPinyin_trgm_idx"
  ON "Order" USING gin ("searchPinyin" gin_trgm_ops);
CREATE INDEX "Order_searchPinyinInitials_trgm_idx"
  ON "Order" USING gin ("searchPinyinInitials" gin_trgm_ops);

CREATE INDEX "Product_searchPinyin_trgm_idx"
  ON "Product" USING gin ("searchPinyin" gin_trgm_ops);
CREATE INDEX "Product_searchPinyinInitials_trgm_idx"
  ON "Product" USING gin ("searchPinyinInitials" gin_trgm_ops);

CREATE INDEX "Material_searchPinyin_trgm_idx"
  ON "Material" USING gin ("searchPinyin" gin_trgm_ops);
CREATE INDEX "Material_searchPinyinInitials_trgm_idx"
  ON "Material" USING gin ("searchPinyinInitials" gin_trgm_ops);
