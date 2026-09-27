CREATE TYPE "FormCreationKind" AS ENUM ('PURCHASE', 'BOM');

CREATE TABLE "FormCreationRequest" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "actorId" TEXT NOT NULL REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  "kind" "FormCreationKind" NOT NULL,
  "clientRequestId" UUID NOT NULL,
  "draftId" UUID NOT NULL,
  "payloadHash" VARCHAR(64) NOT NULL,
  "normalizedPayload" JSONB NOT NULL,
  "purchaseOrderId" TEXT REFERENCES "PurchaseOrder"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  "billOfMaterialId" TEXT REFERENCES "BillOfMaterial"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "FormCreationRequest_target_check" CHECK (
    ("kind" = 'PURCHASE' AND "purchaseOrderId" IS NOT NULL AND "billOfMaterialId" IS NULL)
    OR ("kind" = 'BOM' AND "billOfMaterialId" IS NOT NULL AND "purchaseOrderId" IS NULL)
  ),
  CONSTRAINT "FormCreationRequest_payload_check" CHECK (
    "payloadHash" ~ '^[0-9a-f]{64}$' AND jsonb_typeof("normalizedPayload") = 'object'
  )
);
CREATE UNIQUE INDEX "FormCreationRequest_actorId_kind_clientRequestId_key"
  ON "FormCreationRequest"("actorId", "kind", "clientRequestId");
CREATE UNIQUE INDEX "FormCreationRequest_purchaseOrderId_key" ON "FormCreationRequest"("purchaseOrderId");
CREATE UNIQUE INDEX "FormCreationRequest_billOfMaterialId_key" ON "FormCreationRequest"("billOfMaterialId");
CREATE INDEX "FormCreationRequest_actorId_kind_draftId_idx" ON "FormCreationRequest"("actorId", "kind", "draftId");

-- Removing a receipt would turn a retry into a second creation. No automatic
-- retention/GC policy exists in this version; protect the evidence in SQL too.
CREATE FUNCTION protect_form_creation_request() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'Form creation requests are immutable' USING ERRCODE = '23514';
END;
$$;
CREATE TRIGGER "FormCreationRequest_immutable"
  BEFORE UPDATE OR DELETE ON "FormCreationRequest"
  FOR EACH ROW EXECUTE FUNCTION protect_form_creation_request();
