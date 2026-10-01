-- Nullable: legacy workers and existing rows are unknown, never PDF-ready.
ALTER TABLE "BackgroundWorkerHeartbeat" ADD COLUMN "pdfReady" BOOLEAN;
