import { db } from './db';

type RawPartitionReadinessRow = {
  parentTable: string;
  controlColumn: string;
  partitionInterval: string;
  retention: string | null;
  retentionKeepTable: boolean;
  priority: number;
  rationale: string;
  pgPartmanAvailable: boolean;
  pgPartmanInstalled: boolean;
  parentExists: boolean;
  parentIsPartitioned: boolean;
  controlColumnExists: boolean;
  primaryKeyColumns: string[] | null;
  primaryKeyIncludesControlColumn: boolean;
  incomingForeignKeyCount: number | bigint;
  blockers: string[] | null;
  createParentSql: string | null;
  runMaintenanceSql: string | null;
};

export type PartitionReadinessRow = {
  parentTable: string;
  controlColumn: string;
  partitionInterval: string;
  retention: string | null;
  retentionKeepTable: boolean;
  priority: number;
  rationale: string;
  pgPartmanAvailable: boolean;
  pgPartmanInstalled: boolean;
  parentExists: boolean;
  parentIsPartitioned: boolean;
  controlColumnExists: boolean;
  primaryKeyColumns: string[];
  primaryKeyIncludesControlColumn: boolean;
  incomingForeignKeyCount: number;
  blockers: string[];
  readyForPartman: boolean;
  createParentSql: string | null;
  runMaintenanceSql: string | null;
};

function count(v: number | bigint): number {
  return typeof v === 'bigint' ? Number(v) : v;
}

export async function getPartitionMaintenanceReadiness(): Promise<
  PartitionReadinessRow[]
> {
  const rows = await db.$queryRaw<RawPartitionReadinessRow[]>`
    SELECT
      parent_table AS "parentTable",
      control_column AS "controlColumn",
      partition_interval AS "partitionInterval",
      retention,
      retention_keep_table AS "retentionKeepTable",
      priority,
      rationale,
      pg_partman_available AS "pgPartmanAvailable",
      pg_partman_installed AS "pgPartmanInstalled",
      parent_exists AS "parentExists",
      parent_is_partitioned AS "parentIsPartitioned",
      control_column_exists AS "controlColumnExists",
      primary_key_columns AS "primaryKeyColumns",
      primary_key_includes_control_column AS "primaryKeyIncludesControlColumn",
      incoming_foreign_key_count AS "incomingForeignKeyCount",
      blockers,
      create_parent_sql AS "createParentSql",
      run_maintenance_sql AS "runMaintenanceSql"
    FROM app_ops.partition_readiness
    ORDER BY priority ASC, parent_table ASC
  `;

  return rows.map((row) => {
    const blockers = row.blockers ?? [];
    return {
      ...row,
      primaryKeyColumns: row.primaryKeyColumns ?? [],
      incomingForeignKeyCount: count(row.incomingForeignKeyCount),
      blockers,
      readyForPartman: blockers.length === 0,
    };
  });
}
