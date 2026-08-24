import { describe, it, expect, vi, beforeEach } from 'vitest';

const { dbMock } = vi.hoisted(() => ({
  dbMock: {
    $queryRaw: vi.fn(),
  },
}));
vi.mock('@/lib/db', () => ({ db: dbMock }));

import {
  getOpsExtensionReadiness,
  listCronHttpJobReadiness,
  listQueryObservabilityReadiness,
} from '../ops-readiness';

beforeEach(() => {
  dbMock.$queryRaw.mockReset();
});

describe('getOpsExtensionReadiness', () => {
  it('normalizes bigint counts, arrays, and readiness flags', async () => {
    dbMock.$queryRaw.mockResolvedValue([
      {
        pgCronAvailable: true,
        pgCronInstalled: true,
        pgCronPreloaded: true,
        cronDatabaseNameSet: true,
        pgNetAvailable: true,
        pgNetInstalled: true,
        pgNetPreloaded: true,
        appErpBaseUrlSet: true,
        appCronSecretSet: true,
        pgStatStatementsAvailable: true,
        pgStatStatementsInstalled: true,
        pgStatStatementsPreloaded: true,
        computeQueryIdEnabled: true,
        autoExplainLoaded: false,
        indexAdvisorAvailable: true,
        indexAdvisorInstalled: false,
        enabledCronJobCount: BigInt(6),
        queryObservationCandidateCount: BigInt(6),
        readyForPgCronHttp: true,
        readyForQueryStats: true,
        readyForAutoExplain: false,
        readyForIndexAdvisor: false,
        blockers: ['auto_explain_not_loaded', 'index_advisor_not_installed'],
        recommendedSchedulerSteps: ['CREATE EXTENSION IF NOT EXISTS pg_cron;'],
        recommendedObservabilitySteps: ['Use pg_stat_statements.'],
      },
    ]);

    const readiness = await getOpsExtensionReadiness();

    expect(readiness).toMatchObject({
      enabledCronJobCount: 6,
      queryObservationCandidateCount: 6,
      readyForPgCronHttp: true,
      readyForQueryStats: true,
      readyForAutoExplain: false,
      readyForIndexAdvisor: false,
      blockers: ['auto_explain_not_loaded', 'index_advisor_not_installed'],
    });
  });

  it('normalizes nullable recommendation arrays to empty arrays', async () => {
    dbMock.$queryRaw.mockResolvedValue([
      {
        pgCronAvailable: false,
        pgCronInstalled: false,
        pgCronPreloaded: false,
        cronDatabaseNameSet: false,
        pgNetAvailable: false,
        pgNetInstalled: false,
        pgNetPreloaded: false,
        appErpBaseUrlSet: false,
        appCronSecretSet: false,
        pgStatStatementsAvailable: false,
        pgStatStatementsInstalled: false,
        pgStatStatementsPreloaded: false,
        computeQueryIdEnabled: false,
        autoExplainLoaded: false,
        indexAdvisorAvailable: false,
        indexAdvisorInstalled: false,
        enabledCronJobCount: 0,
        queryObservationCandidateCount: 0,
        readyForPgCronHttp: false,
        readyForQueryStats: false,
        readyForAutoExplain: false,
        readyForIndexAdvisor: false,
        blockers: null,
        recommendedSchedulerSteps: null,
        recommendedObservabilitySteps: null,
      },
    ]);

    await expect(getOpsExtensionReadiness()).resolves.toMatchObject({
      blockers: [],
      recommendedSchedulerSteps: [],
      recommendedObservabilitySteps: [],
    });
  });
});

describe('listCronHttpJobReadiness', () => {
  it('returns the retired database scheduler marker and host command', async () => {
    dbMock.$queryRaw.mockResolvedValue([
      {
        jobName: 'erp-daily-salary',
        endpointPath: '/api/cron/daily-salary',
        scheduleExpr: '5 0 * * *',
        scheduleNote: '每日 00:05 Asia/Shanghai',
        requestBody: {},
        timeoutMs: 45000,
        isEnabled: true,
        priority: 10,
        rationale: 'payroll',
        pgCronAvailable: true,
        pgCronInstalled: true,
        pgCronPreloaded: true,
        cronDatabaseNameSet: true,
        pgNetAvailable: true,
        pgNetInstalled: true,
        pgNetPreloaded: true,
        appErpBaseUrlSet: false,
        appCronSecretSet: false,
        readyToSchedule: false,
        blockers: ['database_http_scheduler_retired'],
        scheduleSql: null,
        unscheduleSql: "SELECT cron.unschedule('erp-daily-salary');",
        manualCurl: '/usr/local/sbin/print-shop-erp-cron daily-salary',
      },
    ]);

    await expect(listCronHttpJobReadiness()).resolves.toEqual([
      expect.objectContaining({
        jobName: 'erp-daily-salary',
        readyToSchedule: false,
        blockers: ['database_http_scheduler_retired'],
        scheduleSql: null,
        manualCurl: '/usr/local/sbin/print-shop-erp-cron daily-salary',
      }),
    ]);
  });
});

describe('listQueryObservabilityReadiness', () => {
  it('normalizes diagnostic candidates and blockers', async () => {
    dbMock.$queryRaw.mockResolvedValue([
      {
        candidateKey: 'product-search-index-advisor',
        routePath: '/owner/products?q=...',
        businessArea: '商品搜索',
        suggestedExtension: 'index_advisor',
        representativeSql: 'SELECT id FROM public."Product";',
        matchPattern: '%"Product"%',
        priority: 20,
        rationale: 'diagnose indexes',
        readyForQueryStats: true,
        readyForAutoExplain: false,
        readyForIndexAdvisor: false,
        diagnosticSql:
          'SELECT * FROM index_advisor(\'SELECT id FROM public."Product";\');',
        blockers: ['index_advisor_not_ready'],
      },
    ]);

    await expect(listQueryObservabilityReadiness()).resolves.toEqual([
      expect.objectContaining({
        candidateKey: 'product-search-index-advisor',
        suggestedExtension: 'index_advisor',
        blockers: ['index_advisor_not_ready'],
      }),
    ]);
  });
});
