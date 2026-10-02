-- Preserve all historical snapshots; permit the explicit cancellation evidence format.
ALTER TABLE "AgentMonthlyBillItem" DROP CONSTRAINT "AgentMonthlyBillItem_detail_object_check";
ALTER TABLE "AgentMonthlyBillItem" ADD CONSTRAINT "AgentMonthlyBillItem_detail_object_check"
  CHECK ("settlementDetailSnapshot" IS NULL OR
    (jsonb_typeof("settlementDetailSnapshot") = 'object' AND
      ("settlementDetailSnapshot" @> '{"schemaVersion": 1}'::jsonb OR
       "settlementDetailSnapshot" @> '{"schemaVersion": 2, "kind": "CANCELLATION"}'::jsonb)));
