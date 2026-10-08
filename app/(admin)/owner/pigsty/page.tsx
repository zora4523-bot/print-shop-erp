import {
  Activity,
  Database,
  ListChecks,
  Search,
  ShieldCheck,
  Timer,
  TriangleAlert,
} from 'lucide-react';
import { PageHeader, StatCard, StatusBadge, TableScrollArea } from '@/components/ui-business';
import { OpsReadinessBadge } from '@/components/business/ops/OpsReadinessBadge';
import { SensitiveColumnMaskingBadge } from '@/components/business/ops/SensitiveColumnMaskingBadge';
import { requirePermission } from '@/lib/auth/permissions';
import {
  getOpsExtensionReadiness,
  listCronHttpJobReadiness,
  listQueryObservabilityReadiness,
  type CronHttpJobReadiness,
  type QueryObservabilityReadiness,
} from '@/lib/ops-readiness';
import { getPartitionMaintenanceReadiness } from '@/lib/partition-maintenance';
import {
  getSecurityExtensionReadiness,
  listSecurityAuditTableReadiness,
  listSensitiveColumnReadiness,
  type SecurityAuditTableReadiness,
  type SensitiveColumnReadiness,
} from '@/lib/security-readiness';
import {
  listSearchIndexReadiness,
  type SearchIndexReadiness,
} from '@/lib/search-readiness';

export const metadata = { title: 'Pigsty 运维' };
export const dynamic = 'force-dynamic';

type ReadState<T> =
  | { ok: true; data: T }
  | { ok: false; error: string };

async function read<T>(promise: Promise<T>): Promise<ReadState<T>> {
  try {
    return { ok: true, data: await promise };
  } catch (err) {
    return {
      ok: false,
      error: err instanceof Error ? err.message : String(err),
    };
  }
}

function blockersLabel(blockers: readonly string[]): string {
  return blockers.length > 0 ? blockers.join(', ') : '无阻塞项';
}

function ErrorPanel({ title, error }: { title: string; error: string }) {
  return (
    <div className="rounded-lg border border-warning/30 bg-warning/5 p-4">
      <div className="flex items-start gap-3">
        <TriangleAlert className="mt-0.5 size-4 shrink-0 text-warning-foreground" />
        <div className="min-w-0">
          <h2 className="text-sm font-medium">{title}</h2>
          <p className="mt-1 break-words font-mono text-xs text-muted-foreground">
            {error}
          </p>
        </div>
      </div>
    </div>
  );
}

function Section({
  title,
  description,
  children,
}: {
  title: string;
  description?: string;
  children: React.ReactNode;
}) {
  return (
    <section className="space-y-3">
      <div>
        <h2 className="text-lg font-semibold">{title}</h2>
        {description ? (
          <p className="mt-1 text-sm text-muted-foreground">{description}</p>
        ) : null}
      </div>
      {children}
    </section>
  );
}

function PigstyReadinessSummary({ ops, searchIndexes, security, partitions }: {
  ops: ReadState<Awaited<ReturnType<typeof getOpsExtensionReadiness>>>;
  searchIndexes: ReadState<Awaited<ReturnType<typeof listSearchIndexReadiness>>>;
  security: ReadState<Awaited<ReturnType<typeof getSecurityExtensionReadiness>>>;
  partitions: ReadState<Awaited<ReturnType<typeof getPartitionMaintenanceReadiness>>>;
}) {
  return (
    <section className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-5">
      {ops.ok ? (
        <>
          <StatCard
            label="HTTP Cron"
            value={ops.data.readyForPgCronHttp ? '就绪' : '未就绪'}
            icon={Timer}
            tone={ops.data.readyForPgCronHttp ? 'success' : 'warning'}
            hint={`${ops.data.enabledCronJobCount} 个候选任务 · ${blockersLabel(
              ops.data.blockers.filter((b) =>
                b.startsWith('pg_cron') ||
                b.startsWith('pg_net') ||
                b.startsWith('cron_') ||
                b.startsWith('app_'),
              ),
            )}`}
          />
          <StatCard
            label="查询观测"
            value={ops.data.readyForQueryStats ? '就绪' : '未就绪'}
            icon={Activity}
            tone={ops.data.readyForQueryStats ? 'success' : 'warning'}
            hint={`${ops.data.queryObservationCandidateCount} 个诊断候选`}
          />
        </>
      ) : (
        <StatCard
          label="调度与观测"
          value="待迁移"
          icon={Database}
          tone="warning"
          hint="app_ops.ops_extension_readiness 不可读"
        />
      )}
      {searchIndexes.ok ? (
        <StatCard
          label="搜索索引"
          value={`${searchIndexes.data.filter((row) => row.readyForSearch).length}/${searchIndexes.data.length}`}
          icon={Search}
          tone={
            searchIndexes.data.every((row) => row.readyForSearch)
              ? 'success'
              : 'warning'
          }
          hint={
            searchIndexes.data.some((row) => row.blockers.length > 0)
              ? '存在必需扩展或索引缺口'
              : '工单/商品搜索必需索引就绪'
          }
        />
      ) : (
        <StatCard
          label="搜索索引"
          value="待迁移"
          icon={Search}
          tone="warning"
          hint="app_ops.search_index_readiness 不可读"
        />
      )}
      {security.ok ? (
        <StatCard
          label="脱敏审计"
          value={
            security.data.readyForAnonMasking || security.data.readyForPgaudit
              ? '部分就绪'
              : '未就绪'
          }
          icon={ShieldCheck}
          tone={
            security.data.readyForAnonMasking && security.data.readyForPgaudit
              ? 'success'
              : 'warning'
          }
          hint={`${security.data.policyCount} 条敏感列策略 · ${security.data.auditTableCount} 张审计候选表`}
        />
      ) : (
        <StatCard
          label="脱敏审计"
          value="待迁移"
          icon={ShieldCheck}
          tone="warning"
          hint="app_ops.security_extension_readiness 不可读"
        />
      )}
      {partitions.ok ? (
        <StatCard
          label="分区维护"
          value={`${partitions.data.length} 张候选表`}
          icon={ListChecks}
          tone={partitions.data.some((row) => row.readyForPartman) ? 'success' : 'warning'}
          hint={
            partitions.data.some((row) => row.blockers.length > 0)
              ? '仍有表结构切换阻塞项'
              : '候选表无阻塞项'
          }
        />
      ) : (
        <StatCard
          label="分区维护"
          value="待迁移"
          icon={ListChecks}
          tone="warning"
          hint="app_ops.partition_readiness 不可读"
        />
      )}
    </section>
  );
}

export default async function PigstyOpsPage() {
  await requirePermission('ops:pigsty:view');

  const [
    ops,
    searchIndexes,
    cronJobs,
    queryObservability,
    security,
    sensitiveColumns,
    auditTables,
    partitions,
  ] = await Promise.all([
    read(getOpsExtensionReadiness()),
    read(listSearchIndexReadiness()),
    read(listCronHttpJobReadiness()),
    read(listQueryObservabilityReadiness()),
    read(getSecurityExtensionReadiness()),
    read(listSensitiveColumnReadiness()),
    read(listSecurityAuditTableReadiness()),
    read(getPartitionMaintenanceReadiness()),
  ]);

  const migrationErrors: Array<[string, string]> = [];
  if (!ops.ok) migrationErrors.push(['调度与观测 readiness', ops.error]);
  if (!searchIndexes.ok) {
    migrationErrors.push(['搜索索引 readiness', searchIndexes.error]);
  }
  if (!cronJobs.ok) migrationErrors.push(['Cron job manifest', cronJobs.error]);
  if (!queryObservability.ok) {
    migrationErrors.push(['查询诊断候选', queryObservability.error]);
  }
  if (!security.ok) {
    migrationErrors.push(['脱敏与审计 readiness', security.error]);
  }
  if (!sensitiveColumns.ok) {
    migrationErrors.push(['敏感列策略', sensitiveColumns.error]);
  }
  if (!auditTables.ok) migrationErrors.push(['审计表策略', auditTables.error]);
  if (!partitions.ok) migrationErrors.push(['分区 readiness', partitions.error]);

  return (
    <div className="space-y-6">
      <PageHeader
        title="Pigsty 运维"
        subtitle="扩展启用状态、调度 SQL、脱敏审计与分区预检"
      />

      {migrationErrors.length > 0 ? (
        <div className="space-y-3">
          {migrationErrors.map(([title, error]) => (
            <ErrorPanel
              key={title}
              title={`${title} 不可读，请先应用 Pigsty roadmap migrations`}
              error={error}
            />
          ))}
        </div>
      ) : null}

      <PigstyReadinessSummary {...{ ops, searchIndexes, security, partitions }} />

      {ops.ok ? (
        <Section
          title="扩展总览"
          description="只读检查，不会安装扩展或修改集群配置。"
        >
          <div className="grid grid-cols-1 gap-3 lg:grid-cols-2">
            <ExtensionLine
              name="数据库 HTTP 调度（已退役）"
              ready={false}
              blockers={['database_http_scheduler_retired']}
            />
            <ExtensionLine
              name="pg_stat_statements"
              ready={ops.data.readyForQueryStats}
              blockers={ops.data.blockers.filter((b) =>
                b.startsWith('pg_stat_statements') ||
                b.startsWith('compute_query_id'),
              )}
            />
            <ExtensionLine
              name="auto_explain"
              ready={ops.data.readyForAutoExplain}
              blockers={ops.data.blockers.filter((b) =>
                b.startsWith('auto_explain'),
              )}
            />
            <ExtensionLine
              name="index_advisor"
              ready={ops.data.readyForIndexAdvisor}
              blockers={ops.data.blockers.filter((b) =>
                b.startsWith('index_advisor'),
              )}
            />
          </div>
          <div className="grid grid-cols-1 gap-3 lg:grid-cols-2">
            <StepsPanel
              title="调度启用步骤"
              steps={ops.data.recommendedSchedulerSteps}
            />
            <StepsPanel
              title="查询观测步骤"
              steps={ops.data.recommendedObservabilitySteps}
            />
          </div>
        </Section>
      ) : null}

      {searchIndexes.ok ? (
        <SearchReadinessTable rows={searchIndexes.data} />
      ) : null}

      {cronJobs.ok ? (
        <CronJobsTable rows={cronJobs.data} />
      ) : null}

      {queryObservability.ok ? (
        <QueryObservabilityTable rows={queryObservability.data} />
      ) : null}

      {security.ok || sensitiveColumns.ok || auditTables.ok ? (
        <Section
          title="脱敏与审计"
          description="anon 标签和 pgaudit 授权只输出建议 SQL，实际启用由 Pigsty 运维执行。"
        >
          <div className="grid grid-cols-1 gap-3 lg:grid-cols-2">
            {security.ok ? (
              <>
                <ExtensionLine
                  name="anon masked export"
                  ready={security.data.readyForAnonMasking}
                  blockers={security.data.blockers.filter((b) =>
                    b.startsWith('anon') ||
                    b.startsWith('sensitive_policy'),
                  )}
                />
                <ExtensionLine
                  name="pgaudit"
                  ready={security.data.readyForPgaudit}
                  blockers={security.data.blockers.filter((b) =>
                    b.startsWith('pgaudit'),
                  )}
                />
              </>
            ) : null}
          </div>
          {security.ok ? (
            <div className="grid grid-cols-1 gap-3 lg:grid-cols-2">
              <StepsPanel
                title="anon 脱敏步骤"
                steps={security.data.recommendedAnonSteps}
              />
              <StepsPanel
                title="pgaudit 审计步骤"
                steps={security.data.recommendedPgauditSteps}
              />
            </div>
          ) : null}
          {sensitiveColumns.ok ? (
            <SensitiveColumnsTable rows={sensitiveColumns.data} />
          ) : null}
          {auditTables.ok ? (
            <AuditTablesTable rows={auditTables.data} />
          ) : null}
        </Section>
      ) : null}

      {partitions.ok ? (
        <Section
          title="分区维护"
          description="当前只做 pg_partman 候选表预检，不自动重写现有主键和外键。"
        >
          <TableScrollArea label="分区维护预检" className="rounded-lg border bg-card">
            <table className="w-full min-w-[780px] text-sm">
              <thead className="border-b bg-muted/40 text-left text-xs text-muted-foreground">
                <tr>
                  <th className="px-3 py-2 font-medium">表</th>
                  <th className="px-3 py-2 font-medium">分区键</th>
                  <th className="px-3 py-2 font-medium">状态</th>
                  <th className="px-3 py-2 font-medium">阻塞项</th>
                  <th className="px-3 py-2 font-medium">运维 SQL</th>
                </tr>
              </thead>
              <tbody className="divide-y">
                {partitions.data.map((row) => (
                  <tr key={row.parentTable}>
                    <td className="px-3 py-2 font-mono text-xs">{row.parentTable}</td>
                    <td className="px-3 py-2 font-mono text-xs">{row.controlColumn}</td>
                    <td className="px-3 py-2">
                      <OpsReadinessBadge
                        ready={row.readyForPartman}
                        blockers={row.blockers}
                      />
                    </td>
                    <td className="px-3 py-2 text-xs text-muted-foreground">
                      {blockersLabel(row.blockers)}
                    </td>
                    <td className="px-3 py-2">
                      <div className="space-y-2">
                        <SqlBlock sql={row.createParentSql} emptyLabel="暂不可创建 parent" />
                        <SqlBlock sql={row.runMaintenanceSql} emptyLabel="暂无维护 SQL" />
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </TableScrollArea>
        </Section>
      ) : null}
    </div>
  );
}

function compactList(items: readonly string[], emptyLabel = '无'): string {
  return items.length > 0 ? items.join(', ') : emptyLabel;
}

function StepsPanel({
  title,
  steps,
}: {
  title: string;
  steps: readonly string[];
}) {
  return (
    <div className="rounded-lg border bg-card p-3">
      <div className="text-sm font-medium">{title}</div>
      {steps.length > 0 ? (
        <ol className="mt-2 space-y-2 text-xs text-muted-foreground">
          {steps.map((step, index) => (
            <li key={`${index}-${step}`} className="flex gap-2">
              <span className="shrink-0 tabular-nums">{index + 1}.</span>
              <code className="min-w-0 whitespace-pre-wrap break-all rounded-md bg-muted px-2 py-1">
                {step}
              </code>
            </li>
          ))}
        </ol>
      ) : (
        <p className="mt-2 text-xs text-muted-foreground">暂无推荐步骤</p>
      )}
    </div>
  );
}

function SearchReadinessTable({ rows }: { rows: SearchIndexReadiness[] }) {
  return (
    <Section
      title="搜索索引预检"
      description="工单/商品搜索上线前，确认必需扩展和索引齐全，并执行 EXPLAIN 检查真实生产计划。"
    >
      <TableScrollArea label="搜索索引预检" className="rounded-lg border bg-card">
        <table className="w-full min-w-[980px] text-sm">
          <thead className="border-b bg-muted/40 text-left text-xs text-muted-foreground">
            <tr>
              <th className="px-3 py-2 font-medium">搜索面</th>
              <th className="px-3 py-2 font-medium">状态</th>
              <th className="px-3 py-2 font-medium">缺失项</th>
              <th className="px-3 py-2 font-medium">可选增强</th>
              <th className="px-3 py-2 font-medium">EXPLAIN SQL</th>
            </tr>
          </thead>
          <tbody className="divide-y">
            {rows.map((row) => (
              <tr key={row.surfaceKey}>
                <td className="px-3 py-2">
                  <div className="font-medium">{row.businessArea}</div>
                  <div className="mt-1 font-mono text-xs text-muted-foreground">
                    {row.routePath}
                  </div>
                  <div className="mt-1 text-xs text-muted-foreground">
                    样例：{row.sampleQuery}
                  </div>
                </td>
                <td className="px-3 py-2">
                  <OpsReadinessBadge
                    ready={row.readyForSearch}
                    blockers={row.blockers}
                  />
                </td>
                <td className="px-3 py-2 text-xs text-muted-foreground">
                  <div className="space-y-1">
                    <div>
                      扩展：{compactList(row.missingRequiredExtensions)}
                    </div>
                    <div>
                      索引：{compactList(row.missingRequiredIndexes)}
                    </div>
                  </div>
                </td>
                <td className="px-3 py-2 text-xs text-muted-foreground">
                  <div className="space-y-1">
                    <div>
                      可选扩展缺失：{compactList(row.missingOptionalExtensions)}
                    </div>
                    <div>
                      可选索引缺失：{compactList(row.missingOptionalIndexes)}
                    </div>
                  </div>
                </td>
                <td className="px-3 py-2">
                  <SqlBlock sql={row.explainSql} emptyLabel="暂无 EXPLAIN SQL" />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </TableScrollArea>
    </Section>
  );
}

function SqlBlock({
  sql,
  emptyLabel,
}: {
  sql: string | null;
  emptyLabel: string;
}) {
  return sql ? (
    <code className="block max-w-[420px] whitespace-pre-wrap break-all rounded-md bg-muted px-2 py-1 text-xs">
      {sql}
    </code>
  ) : (
    <span className="text-xs text-muted-foreground">{emptyLabel}</span>
  );
}

function ExtensionLine({
  name,
  ready,
  blockers,
}: {
  name: string;
  ready: boolean;
  blockers: string[];
}) {
  return (
    <div className="flex items-start justify-between gap-3 rounded-lg border bg-card p-3">
      <div className="min-w-0">
        <div className="text-sm font-medium">{name}</div>
        <div className="mt-1 break-words text-xs text-muted-foreground">
          {blockersLabel(blockers)}
        </div>
      </div>
      <OpsReadinessBadge ready={ready} blockers={blockers} />
    </div>
  );
}

function CronJobsTable({ rows }: { rows: CronHttpJobReadiness[] }) {
  return (
    <Section
      title="主机 Cron 任务"
      description="数据库 HTTP 调度已停用；请在应用主机安装 deploy/run-cron.sh 与 deploy/crontab.example，密钥仅保存在 root 可读文件中。"
    >
      <TableScrollArea label="HTTP Cron 任务" className="rounded-lg border bg-card">
        <table className="w-full min-w-[980px] text-sm">
          <thead className="border-b bg-muted/40 text-left text-xs text-muted-foreground">
            <tr>
              <th className="px-3 py-2 font-medium">任务</th>
              <th className="px-3 py-2 font-medium">Endpoint</th>
              <th className="px-3 py-2 font-medium">计划</th>
              <th className="px-3 py-2 font-medium">状态</th>
              <th className="px-3 py-2 font-medium">SQL</th>
            </tr>
          </thead>
          <tbody className="divide-y">
            {rows.map((row) => (
              <tr key={row.jobName}>
                <td className="px-3 py-2">
                  <div className="font-medium">{row.jobName}</div>
                  <div className="mt-1 text-xs text-muted-foreground">
                    {row.scheduleNote}
                  </div>
                </td>
                <td className="px-3 py-2 font-mono text-xs">{row.endpointPath}</td>
                <td className="px-3 py-2 font-mono text-xs">{row.scheduleExpr}</td>
                <td className="px-3 py-2">
                  <div className="space-y-1">
                    <OpsReadinessBadge
                      ready={row.readyToSchedule}
                      blockers={row.blockers}
                    />
                    <div className="max-w-[220px] break-words text-xs text-muted-foreground">
                      {blockersLabel(row.blockers)}
                    </div>
                  </div>
                </td>
                <td className="px-3 py-2">
                  <div className="space-y-2">
                    <SqlBlock sql={row.scheduleSql} emptyLabel="暂无调度 SQL" />
                    <SqlBlock sql={row.unscheduleSql} emptyLabel="暂无取消 SQL" />
                    <SqlBlock sql={row.manualCurl} emptyLabel="暂无手工 curl" />
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </TableScrollArea>
    </Section>
  );
}

function QueryObservabilityTable({
  rows,
}: {
  rows: QueryObservabilityReadiness[];
}) {
  return (
    <Section
      title="查询观测候选"
      description="用于定位搜索、Dashboard、账单、库存和薪资路径的慢查询。"
    >
      <TableScrollArea label="查询观测候选" className="rounded-lg border bg-card">
        <table className="w-full min-w-[920px] text-sm">
          <thead className="border-b bg-muted/40 text-left text-xs text-muted-foreground">
            <tr>
              <th className="px-3 py-2 font-medium">业务路径</th>
              <th className="px-3 py-2 font-medium">扩展</th>
              <th className="px-3 py-2 font-medium">状态</th>
              <th className="px-3 py-2 font-medium">诊断 SQL</th>
            </tr>
          </thead>
          <tbody className="divide-y">
            {rows.map((row) => {
              const ready =
                row.suggestedExtension === 'pg_stat_statements'
                  ? row.readyForQueryStats
                  : row.suggestedExtension === 'auto_explain'
                    ? row.readyForAutoExplain
                    : row.readyForIndexAdvisor;
              return (
                <tr key={row.candidateKey}>
                  <td className="px-3 py-2">
                    <div className="font-medium">{row.businessArea}</div>
                    <div className="mt-1 font-mono text-xs text-muted-foreground">
                      {row.routePath}
                    </div>
                  </td>
                  <td className="px-3 py-2">
                    <StatusBadge tone="info">{row.suggestedExtension}</StatusBadge>
                  </td>
                  <td className="px-3 py-2">
                    <div className="space-y-1">
                      <OpsReadinessBadge ready={ready} blockers={row.blockers} />
                      <div className="max-w-[220px] break-words text-xs text-muted-foreground">
                        {blockersLabel(row.blockers)}
                      </div>
                    </div>
                  </td>
                  <td className="px-3 py-2">
                    <code className="block max-w-[420px] whitespace-pre-wrap break-all rounded-md bg-muted px-2 py-1 text-xs">
                      {row.diagnosticSql}
                    </code>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </TableScrollArea>
    </Section>
  );
}

function SensitiveColumnsTable({
  rows,
}: {
  rows: SensitiveColumnReadiness[];
}) {
  return (
    <TableScrollArea label="敏感列策略" className="rounded-lg border bg-card">
      <table className="w-full min-w-[860px] text-sm">
        <thead className="border-b bg-muted/40 text-left text-xs text-muted-foreground">
          <tr>
            <th className="px-3 py-2 font-medium">列</th>
            <th className="px-3 py-2 font-medium">类别</th>
            <th className="px-3 py-2 font-medium">策略</th>
            <th className="px-3 py-2 font-medium">状态</th>
            <th className="px-3 py-2 font-medium">建议 SQL / 说明</th>
          </tr>
        </thead>
        <tbody className="divide-y">
          {rows.slice(0, 12).map((row) => (
            <tr key={`${row.tableSchema}.${row.tableName}.${row.columnName}`}>
              <td className="px-3 py-2 font-mono text-xs">
                {row.tableSchema}.{row.tableName}.{row.columnName}
              </td>
              <td className="px-3 py-2">{row.dataClass}</td>
              <td className="px-3 py-2">{row.maskingStrategy}</td>
              <td className="px-3 py-2">
                <SensitiveColumnMaskingBadge
                  maskingStrategy={row.maskingStrategy}
                  anonLabelApplied={row.anonLabelApplied}
                />
              </td>
              <td className="px-3 py-2">
                {row.applyAnonLabelSql ? (
                  <SqlBlock sql={row.applyAnonLabelSql} emptyLabel="暂无标签 SQL" />
                ) : (
                  <div className="max-w-[360px] text-xs text-muted-foreground">
                    {row.handlingNote}
                  </div>
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      {rows.length > 12 ? (
        <div className="border-t px-3 py-2 text-xs text-muted-foreground">
          仅显示前 12 条敏感列策略，共 {rows.length} 条。
        </div>
      ) : null}
    </TableScrollArea>
  );
}

function AuditTablesTable({ rows }: { rows: SecurityAuditTableReadiness[] }) {
  return (
    <TableScrollArea label="审计表授权" className="rounded-lg border bg-card">
      <table className="w-full min-w-[720px] text-sm">
        <thead className="border-b bg-muted/40 text-left text-xs text-muted-foreground">
          <tr>
            <th className="px-3 py-2 font-medium">审计表</th>
            <th className="px-3 py-2 font-medium">操作</th>
            <th className="px-3 py-2 font-medium">授权 SQL</th>
          </tr>
        </thead>
        <tbody className="divide-y">
          {rows.map((row) => (
            <tr key={`${row.tableSchema}.${row.tableName}`}>
              <td className="px-3 py-2 font-mono text-xs">
                {row.tableSchema}.{row.tableName}
              </td>
              <td className="px-3 py-2 text-xs">
                {row.auditOperations.join(', ')}
              </td>
              <td className="px-3 py-2">
                <code className="block max-w-[420px] break-all rounded-md bg-muted px-2 py-1 text-xs">
                  {row.auditGrantSql}
                </code>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </TableScrollArea>
  );
}
