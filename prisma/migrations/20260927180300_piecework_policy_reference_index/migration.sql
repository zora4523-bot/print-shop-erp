-- Publication/cancellation holds the global publication lock while checking
-- both direct and inherited policy references. Index both sides of that OR.
CREATE INDEX "ProductionReport_policyBookId_idx"
ON "ProductionReport" ((snapshot #>> '{payroll,policyBookId}'))
WHERE snapshot #>> '{payroll,policyBookId}' IS NOT NULL;
