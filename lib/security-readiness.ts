import { db } from './db';

type CountLike = number | bigint;

type RawSecurityExtensionReadiness = {
  anonAvailable: boolean;
  anonInstalled: boolean;
  anonPreloaded: boolean;
  pgauditAvailable: boolean;
  pgauditInstalled: boolean;
  pgauditPreloaded: boolean;
  policyCount: CountLike;
  anonLabelPolicyCount: CountLike;
  anonLabelAppliedCount: CountLike;
  manualRedactPolicyCount: CountLike;
  auditOnlyPolicyCount: CountLike;
  missingColumnCount: CountLike;
  auditTableCount: CountLike;
  blockers: string[] | null;
  recommendedAnonSteps: string[] | null;
  recommendedPgauditSteps: string[] | null;
};

type RawSensitiveColumnReadiness = {
  tableSchema: string;
  tableName: string;
  columnName: string;
  dataClass: string;
  maskingStrategy: 'anon_security_label' | 'manual_export_redact' | 'audit_only';
  anonMaskExpression: string | null;
  auditScope: 'NONE' | 'WRITE' | 'READ_WRITE';
  priority: number;
  rationale: string;
  columnExists: boolean;
  currentAnonLabel: string | null;
  anonLabelApplied: boolean;
  applyAnonLabelSql: string | null;
  handlingNote: string;
};

type RawSecurityAuditTableReadiness = {
  tableSchema: string;
  tableName: string;
  auditReads: boolean;
  auditWrites: boolean;
  allColumnsExist: boolean;
  sensitiveColumns: string[] | null;
  auditOperations: string[] | null;
  auditGrantSql: string;
};

export type SecurityExtensionReadiness = {
  anonAvailable: boolean;
  anonInstalled: boolean;
  anonPreloaded: boolean;
  pgauditAvailable: boolean;
  pgauditInstalled: boolean;
  pgauditPreloaded: boolean;
  policyCount: number;
  anonLabelPolicyCount: number;
  anonLabelAppliedCount: number;
  manualRedactPolicyCount: number;
  auditOnlyPolicyCount: number;
  missingColumnCount: number;
  auditTableCount: number;
  blockers: string[];
  recommendedAnonSteps: string[];
  recommendedPgauditSteps: string[];
  readyForAnonMasking: boolean;
  readyForPgaudit: boolean;
};

export type SensitiveColumnReadiness = RawSensitiveColumnReadiness;

export type SecurityAuditTableReadiness = {
  tableSchema: string;
  tableName: string;
  auditReads: boolean;
  auditWrites: boolean;
  allColumnsExist: boolean;
  sensitiveColumns: string[];
  auditOperations: string[];
  auditGrantSql: string;
};

function count(value: CountLike): number {
  return typeof value === 'bigint' ? Number(value) : value;
}

function normalizeExtensionReadiness(
  row: RawSecurityExtensionReadiness,
): SecurityExtensionReadiness {
  const anonLabelPolicyCount = count(row.anonLabelPolicyCount);
  const anonLabelAppliedCount = count(row.anonLabelAppliedCount);
  const missingColumnCount = count(row.missingColumnCount);

  return {
    ...row,
    policyCount: count(row.policyCount),
    anonLabelPolicyCount,
    anonLabelAppliedCount,
    manualRedactPolicyCount: count(row.manualRedactPolicyCount),
    auditOnlyPolicyCount: count(row.auditOnlyPolicyCount),
    missingColumnCount,
    auditTableCount: count(row.auditTableCount),
    blockers: row.blockers ?? [],
    recommendedAnonSteps: row.recommendedAnonSteps ?? [],
    recommendedPgauditSteps: row.recommendedPgauditSteps ?? [],
    readyForAnonMasking:
      row.anonAvailable &&
      row.anonInstalled &&
      row.anonPreloaded &&
      missingColumnCount === 0 &&
      anonLabelPolicyCount === anonLabelAppliedCount,
    readyForPgaudit:
      row.pgauditAvailable && row.pgauditInstalled && row.pgauditPreloaded,
  };
}

export async function getSecurityExtensionReadiness(): Promise<SecurityExtensionReadiness> {
  const rows = await db.$queryRaw<RawSecurityExtensionReadiness[]>`
    SELECT
      anon_available AS "anonAvailable",
      anon_installed AS "anonInstalled",
      anon_preloaded AS "anonPreloaded",
      pgaudit_available AS "pgauditAvailable",
      pgaudit_installed AS "pgauditInstalled",
      pgaudit_preloaded AS "pgauditPreloaded",
      policy_count AS "policyCount",
      anon_label_policy_count AS "anonLabelPolicyCount",
      anon_label_applied_count AS "anonLabelAppliedCount",
      manual_redact_policy_count AS "manualRedactPolicyCount",
      audit_only_policy_count AS "auditOnlyPolicyCount",
      missing_column_count AS "missingColumnCount",
      audit_table_count AS "auditTableCount",
      blockers,
      recommended_anon_steps AS "recommendedAnonSteps",
      recommended_pgaudit_steps AS "recommendedPgauditSteps"
    FROM app_ops.security_extension_readiness
    LIMIT 1
  `;

  if (!rows[0]) {
    throw new Error('security_extension_readiness returned no rows');
  }

  return normalizeExtensionReadiness(rows[0]);
}

export async function listSensitiveColumnReadiness(): Promise<
  SensitiveColumnReadiness[]
> {
  return db.$queryRaw<SensitiveColumnReadiness[]>`
    SELECT
      table_schema AS "tableSchema",
      table_name AS "tableName",
      column_name AS "columnName",
      data_class AS "dataClass",
      masking_strategy AS "maskingStrategy",
      anon_mask_expression AS "anonMaskExpression",
      audit_scope AS "auditScope",
      priority,
      rationale,
      column_exists AS "columnExists",
      current_anon_label AS "currentAnonLabel",
      anon_label_applied AS "anonLabelApplied",
      apply_anon_label_sql AS "applyAnonLabelSql",
      handling_note AS "handlingNote"
    FROM app_ops.sensitive_column_readiness
    ORDER BY priority ASC, table_schema ASC, table_name ASC, column_name ASC
  `;
}

export async function listSecurityAuditTableReadiness(): Promise<
  SecurityAuditTableReadiness[]
> {
  const rows = await db.$queryRaw<RawSecurityAuditTableReadiness[]>`
    SELECT
      table_schema AS "tableSchema",
      table_name AS "tableName",
      audit_reads AS "auditReads",
      audit_writes AS "auditWrites",
      all_columns_exist AS "allColumnsExist",
      sensitive_columns AS "sensitiveColumns",
      audit_operations AS "auditOperations",
      audit_grant_sql AS "auditGrantSql"
    FROM app_ops.security_audit_table_readiness
    ORDER BY table_schema ASC, table_name ASC
  `;

  return rows.map((row) => ({
    ...row,
    sensitiveColumns: row.sensitiveColumns ?? [],
    auditOperations: row.auditOperations ?? [],
  }));
}
