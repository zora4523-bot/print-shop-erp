-- Atomic counters for human-readable master-data codes. Existing business
-- codes remain unchanged; counters are created lazily on first use.

CREATE TABLE "BusinessCodeSequence" (
    "key" TEXT NOT NULL,
    "value" INTEGER NOT NULL DEFAULT 0,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "BusinessCodeSequence_pkey" PRIMARY KEY ("key"),
    CONSTRAINT "BusinessCodeSequence_value_check" CHECK ("value" >= 0)
);
