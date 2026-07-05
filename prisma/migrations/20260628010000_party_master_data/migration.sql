-- A16: Customer / supplier master data.
--
-- Orders keep snapshot fields (customerRef, receiverName, phone, address) for
-- historical correctness. The optional customerPartyId link is only a normalized
-- reference for new orders and future analytics.

CREATE EXTENSION IF NOT EXISTS citext;
CREATE EXTENSION IF NOT EXISTS pg_trgm;

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_available_extensions WHERE name = 'pg_pinyin'
  ) THEN
    EXECUTE 'CREATE EXTENSION IF NOT EXISTS pg_pinyin';
  END IF;
END $$;

CREATE TYPE "PartyType" AS ENUM ('CUSTOMER', 'SUPPLIER', 'BOTH');

CREATE TABLE "Party" (
  "id" TEXT NOT NULL,
  "type" "PartyType" NOT NULL,
  "code" CITEXT NOT NULL,
  "name" TEXT NOT NULL,
  "shortName" TEXT,
  "searchPinyin" TEXT,
  "searchPinyinInitials" TEXT,
  "isActive" BOOLEAN NOT NULL DEFAULT true,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "Party_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "PartyContact" (
  "id" TEXT NOT NULL,
  "partyId" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "phone" TEXT,
  "wechat" TEXT,
  "isPrimary" BOOLEAN NOT NULL DEFAULT false,
  "sortOrder" INTEGER NOT NULL DEFAULT 0,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "PartyContact_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "PartyAddress" (
  "id" TEXT NOT NULL,
  "partyId" TEXT NOT NULL,
  "receiverName" TEXT,
  "receiverPhone" TEXT,
  "province" TEXT,
  "city" TEXT,
  "district" TEXT,
  "detail" TEXT NOT NULL,
  "isDefault" BOOLEAN NOT NULL DEFAULT false,
  "sortOrder" INTEGER NOT NULL DEFAULT 0,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "PartyAddress_pkey" PRIMARY KEY ("id")
);

ALTER TABLE "Order" ADD COLUMN "customerPartyId" TEXT;

CREATE UNIQUE INDEX "Party_code_key" ON "Party"("code");
CREATE INDEX "Party_type_idx" ON "Party"("type");
CREATE INDEX "Party_isActive_idx" ON "Party"("isActive");
CREATE INDEX "Party_name_idx" ON "Party"("name");
CREATE INDEX "Party_name_trgm_idx" ON "Party" USING gin ("name" gin_trgm_ops);
CREATE INDEX "Party_shortName_trgm_idx" ON "Party" USING gin ("shortName" gin_trgm_ops);

CREATE INDEX "PartyContact_partyId_idx" ON "PartyContact"("partyId");
CREATE INDEX "PartyContact_phone_idx" ON "PartyContact"("phone");
CREATE INDEX "PartyContact_isPrimary_idx" ON "PartyContact"("isPrimary");
CREATE INDEX "PartyContact_name_trgm_idx" ON "PartyContact" USING gin ("name" gin_trgm_ops);
CREATE INDEX "PartyContact_phone_trgm_idx" ON "PartyContact" USING gin ("phone" gin_trgm_ops);
CREATE UNIQUE INDEX "PartyContact_one_primary_idx"
  ON "PartyContact"("partyId")
  WHERE "isPrimary";

CREATE INDEX "PartyAddress_partyId_idx" ON "PartyAddress"("partyId");
CREATE INDEX "PartyAddress_isDefault_idx" ON "PartyAddress"("isDefault");
CREATE INDEX "PartyAddress_detail_trgm_idx" ON "PartyAddress" USING gin ("detail" gin_trgm_ops);
CREATE UNIQUE INDEX "PartyAddress_one_default_idx"
  ON "PartyAddress"("partyId")
  WHERE "isDefault";

CREATE INDEX "Order_customerPartyId_idx" ON "Order"("customerPartyId");

ALTER TABLE "PartyContact"
  ADD CONSTRAINT "PartyContact_partyId_fkey"
  FOREIGN KEY ("partyId") REFERENCES "Party"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "PartyAddress"
  ADD CONSTRAINT "PartyAddress_partyId_fkey"
  FOREIGN KEY ("partyId") REFERENCES "Party"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "Order"
  ADD CONSTRAINT "Order_customerPartyId_fkey"
  FOREIGN KEY ("customerPartyId") REFERENCES "Party"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_extension WHERE extname = 'pg_pinyin'
  ) THEN
    EXECUTE '
      ALTER TABLE "Party"
        ALTER COLUMN "searchPinyin" DROP DEFAULT,
        ALTER COLUMN "searchPinyinInitials" DROP DEFAULT
    ';

    EXECUTE '
      ALTER TABLE "Party"
        DROP COLUMN "searchPinyin",
        DROP COLUMN "searchPinyinInitials"
    ';

    EXECUTE '
      ALTER TABLE "Party"
        ADD COLUMN "searchPinyin" TEXT GENERATED ALWAYS AS (
          regexp_replace(
            lower(
              public.pinyin_char_romanize(
                coalesce("code"::text, '''') || '' '' ||
                coalesce("name", '''') || '' '' ||
                coalesce("shortName", '''')
              )
            ),
            ''[^a-z0-9]+'',
            '''',
            ''g''
          )
        ) STORED
    ';

    EXECUTE '
      ALTER TABLE "Party"
        ADD COLUMN "searchPinyinInitials" TEXT GENERATED ALWAYS AS (
          regexp_replace(
            lower(
              regexp_replace(
                public.pinyin_char_romanize(
                  coalesce("code"::text, '''') || '' '' ||
                  coalesce("name", '''') || '' '' ||
                  coalesce("shortName", '''')
                ),
                ''(^|\|)([a-z])[a-z]*'',
                ''\2'',
                ''g''
              )
            ),
            ''[^a-z0-9]+'',
            '''',
            ''g''
          )
        ) STORED
    ';
  END IF;
END $$;

CREATE INDEX "Party_searchPinyin_trgm_idx" ON "Party" USING gin ("searchPinyin" gin_trgm_ops);
CREATE INDEX "Party_searchPinyinInitials_trgm_idx" ON "Party" USING gin ("searchPinyinInitials" gin_trgm_ops);
