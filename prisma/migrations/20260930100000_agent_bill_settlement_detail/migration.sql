-- Additive only: confirmed historic members remain untouched. The existing
-- AgentMonthlyBillItem_parent_draft_guard protects all columns, including this one.
ALTER TABLE "AgentMonthlyBillItem" ADD COLUMN "settlementDetailSnapshot" JSONB;
ALTER TABLE "AgentMonthlyBillItem" ADD CONSTRAINT "AgentMonthlyBillItem_detail_object_check"
  CHECK ("settlementDetailSnapshot" IS NULL OR
    (jsonb_typeof("settlementDetailSnapshot") = 'object'
      AND "settlementDetailSnapshot" @> '{"schemaVersion": 1}'::jsonb));
