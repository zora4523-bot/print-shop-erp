import { db } from './db';

type CountLike = number | bigint;

type RawOpsExtensionReadiness = {
  pgCronAvailable: boolean;
  pgCronInstalled: boolean;
  pgCronPreloaded: boolean;
  cronDatabaseNameSet: boolean;
  pgNetAvailable: boolean;
  pgNetInstalled: boolean;
  pgNetPreloaded: boolean;
  appErpBaseUrlSet: boolean;
  appCronSecretSet: boolean;
  pgStatStatementsAvailable: boolean;
  pgStatStatementsInstalled: boolean;
  pgStatStatementsPreloaded: boolean;
  computeQueryIdEnabled: boolean;
  autoExplainLoaded: boolean;
  indexAdvisorAvailable: boolean;
  indexAdvisorInstalled: boolean;
  enabledCronJobCount: CountLike;
  queryObservationCandidateCount: CountLike;
  readyForPgCronHttp: boolean;
  readyForQueryStats: boolean;
  readyForAutoExplain: boolean;
  readyForIndexAdvisor: boolean;
  blockers: string[] | null;
  recommendedSchedulerSteps: string[] | null;
  recommendedObservabilitySteps: string[] | null;
};

type RawCronHttpJobReadiness = {
  jobName: string;
  endpointPath: string;
  scheduleExpr: string;
  scheduleNote: string;
  requestBody: unknown;
  timeoutMs: number;
  isEnabled: boolean;
  priority: number;
  rationale: string;
  pgCronAvailable: boolean;
  pgCronInstalled: boolean;
  pgCronPreloaded: boolean;
  cronDatabaseNameSet: boolean;
  pgNetAvailable: boolean;
  pgNetInstalled: boolean;
  pgNetPreloaded: boolean;
  appErpBaseUrlSet: boolean;
  appCronSecretSet: boolean;
  readyToSchedule: boolean;
  blockers: string[] | null;
  scheduleSql: string | null;
  unscheduleSql: string;
  manualCurl: string;
};

type RawQueryObservabilityReadiness = {
  candidateKey: string;
  routePath: string;
  businessArea: string;
  suggestedExtension: 'pg_stat_statements' | 'auto_explain' | 'index_advisor';
  representativeSql: string;
  matchPattern: string;
  priority: number;
  rationale: string;
  readyForQueryStats: boolean;
  readyForAutoExplain: boolean;
  readyForIndexAdvisor: boolean;
  diagnosticSql: string;
  blockers: string[] | null;
};

export type OpsExtensionReadiness = Omit<
  RawOpsExtensionReadiness,
  | 'enabledCronJobCount'
  | 'queryObservationCandidateCount'
  | 'blockers'
  | 'recommendedSchedulerSteps'
  | 'recommendedObservabilitySteps'
> & {
  enabledCronJobCount: number;
  queryObservationCandidateCount: number;
  blockers: string[];
  recommendedSchedulerSteps: string[];
  recommendedObservabilitySteps: string[];
};

export type CronHttpJobReadiness = Omit<
  RawCronHttpJobReadiness,
  'blockers'
> & {
  blockers: string[];
};

export type QueryObservabilityReadiness = Omit<
  RawQueryObservabilityReadiness,
  'blockers'
> & {
  blockers: string[];
};

function count(value: CountLike): number {
  return typeof value === 'bigint' ? Number(value) : value;
}

export async function getOpsExtensionReadiness(): Promise<OpsExtensionReadiness> {
  const rows = await db.$queryRaw<RawOpsExtensionReadiness[]>`
    SELECT
      pg_cron_available AS "pgCronAvailable",
      pg_cron_installed AS "pgCronInstalled",
      pg_cron_preloaded AS "pgCronPreloaded",
      cron_database_name_set AS "cronDatabaseNameSet",
      pg_net_available AS "pgNetAvailable",
      pg_net_installed AS "pgNetInstalled",
      pg_net_preloaded AS "pgNetPreloaded",
      app_erp_base_url_set AS "appErpBaseUrlSet",
      app_cron_secret_set AS "appCronSecretSet",
      pg_stat_statements_available AS "pgStatStatementsAvailable",
      pg_stat_statements_installed AS "pgStatStatementsInstalled",
      pg_stat_statements_preloaded AS "pgStatStatementsPreloaded",
      compute_query_id_enabled AS "computeQueryIdEnabled",
      auto_explain_loaded AS "autoExplainLoaded",
      index_advisor_available AS "indexAdvisorAvailable",
      index_advisor_installed AS "indexAdvisorInstalled",
      enabled_cron_job_count AS "enabledCronJobCount",
      query_observation_candidate_count AS "queryObservationCandidateCount",
      ready_for_pg_cron_http AS "readyForPgCronHttp",
      ready_for_query_stats AS "readyForQueryStats",
      ready_for_auto_explain AS "readyForAutoExplain",
      ready_for_index_advisor AS "readyForIndexAdvisor",
      blockers,
      recommended_scheduler_steps AS "recommendedSchedulerSteps",
      recommended_observability_steps AS "recommendedObservabilitySteps"
    FROM app_ops.ops_extension_readiness
    LIMIT 1
  `;

  if (!rows[0]) {
    throw new Error('ops_extension_readiness returned no rows');
  }

  const row = rows[0];
  return {
    ...row,
    enabledCronJobCount: count(row.enabledCronJobCount),
    queryObservationCandidateCount: count(row.queryObservationCandidateCount),
    blockers: row.blockers ?? [],
    recommendedSchedulerSteps: row.recommendedSchedulerSteps ?? [],
    recommendedObservabilitySteps: row.recommendedObservabilitySteps ?? [],
  };
}

export async function listCronHttpJobReadiness(): Promise<
  CronHttpJobReadiness[]
> {
  const rows = await db.$queryRaw<RawCronHttpJobReadiness[]>`
    SELECT
      job_name AS "jobName",
      endpoint_path AS "endpointPath",
      schedule_expr AS "scheduleExpr",
      schedule_note AS "scheduleNote",
      request_body AS "requestBody",
      timeout_ms AS "timeoutMs",
      is_enabled AS "isEnabled",
      priority,
      rationale,
      pg_cron_available AS "pgCronAvailable",
      pg_cron_installed AS "pgCronInstalled",
      pg_cron_preloaded AS "pgCronPreloaded",
      cron_database_name_set AS "cronDatabaseNameSet",
      pg_net_available AS "pgNetAvailable",
      pg_net_installed AS "pgNetInstalled",
      pg_net_preloaded AS "pgNetPreloaded",
      app_erp_base_url_set AS "appErpBaseUrlSet",
      app_cron_secret_set AS "appCronSecretSet",
      ready_to_schedule AS "readyToSchedule",
      blockers,
      schedule_sql AS "scheduleSql",
      unschedule_sql AS "unscheduleSql",
      manual_curl AS "manualCurl"
    FROM app_ops.cron_http_job_readiness
    ORDER BY priority ASC, job_name ASC
  `;

  return rows.map((row) => ({
    ...row,
    blockers: row.blockers ?? [],
  }));
}

export async function listQueryObservabilityReadiness(): Promise<
  QueryObservabilityReadiness[]
> {
  const rows = await db.$queryRaw<RawQueryObservabilityReadiness[]>`
    SELECT
      candidate_key AS "candidateKey",
      route_path AS "routePath",
      business_area AS "businessArea",
      suggested_extension AS "suggestedExtension",
      representative_sql AS "representativeSql",
      match_pattern AS "matchPattern",
      priority,
      rationale,
      ready_for_query_stats AS "readyForQueryStats",
      ready_for_auto_explain AS "readyForAutoExplain",
      ready_for_index_advisor AS "readyForIndexAdvisor",
      diagnostic_sql AS "diagnosticSql",
      blockers
    FROM app_ops.query_observability_readiness
    ORDER BY priority ASC, candidate_key ASC
  `;

  return rows.map((row) => ({
    ...row,
    blockers: row.blockers ?? [],
  }));
}
