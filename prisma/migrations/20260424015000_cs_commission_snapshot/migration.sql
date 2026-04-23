-- Add salaryRuleSnapshot to CustomerServiceCommission so we can
-- reproduce the tier table / base / duration that justified the
-- settled commission even after the rules are later edited
-- (CLAUDE.md §4.4 rule-snapshot bedrock).
ALTER TABLE "CustomerServiceCommission"
  ADD COLUMN "salaryRuleSnapshot" JSONB;
