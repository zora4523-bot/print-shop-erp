import Link from 'next/link';
import { Suspense } from 'react';
import { requirePermission } from '@/lib/auth/permissions';
import {
  listEligibleOrders,
  listRecentBundles,
} from '@/lib/cdr/bundle';
import { parseStrictYmd } from '@/lib/auth/schemas';
import { isMockMode } from '@/lib/cdr/zip';
import { CreateBundleForm } from '@/components/business/cdr/CreateBundleForm';
import { RegenerateBundleForm } from '@/components/business/cdr/RegenerateBundleForm';
import { Button } from '@/components/ui/button';
import { EmptyState, EnvNotice, ErrorBoundary, PageHeader, SectionLoading, StatusBadge, TableScrollArea } from '@/components/ui-business';
import {
  formatDateInputShanghai,
  formatDateShanghai,
  formatDateTimeShanghai,
} from '@/lib/format/dates';
import { DesignBundleStatus } from '@/generated/prisma/enums';
import {
  DESIGN_BUNDLE_DISPLAY_STATUS,
  DESIGN_BUNDLE_DISPLAY_STATUS_REGISTRY,
  type DesignBundleDisplayStatus,
} from '@/lib/ui/status-registry';
import { cdrBundleFailureDisplay } from '@/lib/cdr/failure-display';
import { todayShanghai } from '@/lib/dashboard/shanghai-clock';

export const metadata = { title: 'CDR 汇总下载' };

type SearchParams = Promise<{ from?: string; to?: string }>;
type EligibleOrdersPromise = ReturnType<typeof listEligibleOrders>;
type RecentBundlesPromise = ReturnType<typeof listRecentBundles>;

// SPEC §3.5：CDR 汇总下载 = 管理员按日期窗口勾工单 → 生成 24h 短链
// → 复制给外协模具厂。本页不显示 admin 工单详情链接（外协方不需要）；
// 只显示工单号 + 客户名称/简称 + CDR 文件数。
//
// `from` / `to` URL query：foreman 输入起 / 止日期（YYYY-MM-DD），
// 缺省 = 今天，提交后 server fetches eligible orders。
export default async function ForemanCdrPage({
  searchParams,
}: {
  searchParams: SearchParams;
}) {
  await requirePermission('design:bundle:create');

  const sp = await searchParams;
  const today = todayShanghai();
  const from = sp.from && parseStrictYmd(sp.from) ? sp.from : today;
  const to = sp.to && parseStrictYmd(sp.to) ? sp.to : from;

  const eligibleOrdersPromise = listEligibleOrders({ from, to });
  const recentBundlesPromise = listRecentBundles(20);
  const mock = isMockMode();

  return (
    <div className="space-y-6">
      <PageHeader
        title="CDR 汇总下载"
        subtitle="按日期选择工单，生成 24 小时有效的外协下载链接。"
      />

      {mock ? (
        <EnvNotice>
          <strong className="text-foreground">下载功能暂不可用</strong>
          ：文件存储尚未配置，请联系系统管理员。
        </EnvNotice>
      ) : null}

      <FilterBar from={from} to={to} />

      <ErrorBoundary
        scope="section"
        title="CDR 候选工单暂时无法加载"
        description="日期筛选和历史下载包仍可使用；请重试候选区域。"
      >
        <Suspense fallback={<SectionLoading label="CDR 候选工单" />}>
          <CdrEligibleOrdersSection
            from={from}
            to={to}
            eligibleOrdersPromise={eligibleOrdersPromise}
          />
        </Suspense>
      </ErrorBoundary>

      <ErrorBoundary
        scope="section"
        title="最近下载包暂时无法加载"
        description="候选工单和新建下载包仍可使用；请重试历史区域。"
      >
        <Suspense fallback={<SectionLoading label="最近下载包" />}>
          <CdrRecentBundlesSection
            recentBundlesPromise={recentBundlesPromise}
          />
        </Suspense>
      </ErrorBoundary>

      <p className="text-xs text-muted-foreground">
        提示：生成下载包后请尽快发送外协。链接 24 小时后自动失效，过期需重新生成。{' '}
        <Link href="/owner" className="underline">
          ← 返回管理后台
        </Link>
      </p>
    </div>
  );
}

export async function CdrEligibleOrdersSection({
  from,
  to,
  eligibleOrdersPromise,
}: {
  from: string;
  to: string;
  eligibleOrdersPromise: EligibleOrdersPromise;
}) {
  const eligible = await eligibleOrdersPromise;

  return (
    <CreateBundleForm
      // 日期窗口变化时重挂表单，避免保留旧候选 ID 的选中状态。
      key={`${from}|${to}`}
      from={from}
      to={to}
      eligible={eligible.map((order) => ({
        id: order.id,
        orderNo: order.orderNo,
        customerRef: order.customerRef,
        submittedAt: order.submittedAt.toISOString(),
        cdrCount: order.cdrCount,
      }))}
    />
  );
}

export async function CdrRecentBundlesSection({
  recentBundlesPromise,
}: {
  recentBundlesPromise: RecentBundlesPromise;
}) {
  const recentBundles = await recentBundlesPromise;
  // 一次取值；表格遍历时统一与 expiresAt 比较。Server
  // Component 每个 request 只渲染一次，因此这个时间快照在区域内一致。
  const nowMs = new Date().getTime();

  return (
    <section className="space-y-3">
      <h2 className="text-base font-semibold">最近生成的下载包</h2>
      {recentBundles.length === 0 ? (
        <EmptyState
          kind="no-data"
          noun="CDR 下载包"
          onCreate={
            <Button
              render={<Link href="#cdr-bundle-form" prefetch={false} />}
              nativeButton={false}
              variant="outline"
            >
              去勾选候选工单
            </Button>
          }
        />
      ) : (
        <TableScrollArea label="CDR 下载包历史" className="rounded-xl border bg-card shadow-sm">
          <table className="w-full text-sm">
            <thead className="border-b bg-muted/40 text-xs text-muted-foreground">
              <tr>
                <th className="px-4 py-2 text-left">日期窗口</th>
                <th className="px-4 py-2 text-right">工单数</th>
                <th className="px-4 py-2 text-right">CDR 数</th>
                <th className="px-4 py-2 text-left">下载链接</th>
                <th className="px-4 py-2 text-left">过期</th>
                <th className="px-4 py-2 text-right">下载次数</th>
                <th className="px-4 py-2 text-left">生成人</th>
              </tr>
            </thead>
            <tbody className="divide-y">
              {recentBundles.map((bundle) => {
                const expired = bundle.expiresAt.getTime() < nowMs;
                const isMock = bundle.zipFileUrl.startsWith('mock://');
                const regenerateProps = {
                  from: formatDateInputShanghai(bundle.dateRangeFrom),
                  to: formatDateInputShanghai(
                    new Date(bundle.dateRangeTo.getTime() - 1),
                  ),
                  orderIds: bundle.orderIds,
                };
                return (
                  <tr key={bundle.id}>
                    <td className="px-4 py-3 font-sans tabular-nums text-xs">
                      {formatDateShanghai(bundle.dateRangeFrom)} →{' '}
                      {formatDateShanghai(
                        new Date(bundle.dateRangeTo.getTime() - 1),
                      )}
                    </td>
                    <td className="px-4 py-3 text-right font-sans tabular-nums">
                      {bundle.orderCount}
                    </td>
                    <td className="px-4 py-3 text-right font-sans tabular-nums">
                      {bundle.fileCount}
                    </td>
                    <td className="px-4 py-3">
                      {bundle.status === DesignBundleStatus.PENDING ? (
                        <DesignBundleStatusBadge
                          status={DESIGN_BUNDLE_DISPLAY_STATUS.PENDING}
                        />
                      ) : bundle.status === DesignBundleStatus.FAILED ? (
                        <div className="max-w-xs space-y-2">
                          <DesignBundleStatusBadge
                            status={DESIGN_BUNDLE_DISPLAY_STATUS.FAILED}
                          />
                          <BundleFailureMessage
                            errorCode={bundle.lastErrorCode}
                          />
                          <RegenerateBundleForm {...regenerateProps} />
                        </div>
                      ) : expired ? (
                        <div>
                          <DesignBundleStatusBadge
                            status={DESIGN_BUNDLE_DISPLAY_STATUS.EXPIRED}
                          />
                          <RegenerateBundleForm {...regenerateProps} />
                        </div>
                      ) : isMock ? (
                        <DesignBundleStatusBadge
                          status={DESIGN_BUNDLE_DISPLAY_STATUS.MOCK}
                        />
                      ) : (
                        <a
                          href={bundle.downloadUrl}
                          className="font-mono text-xs break-all underline-offset-2 hover:underline"
                        >
                          {bundle.downloadUrl}
                        </a>
                      )}
                    </td>
                    <td className="px-4 py-3 text-xs">
                      {formatDateTimeShanghai(bundle.expiresAt)}
                    </td>
                    <td className="px-4 py-3 text-right font-sans tabular-nums">
                      {bundle.downloadCount}
                    </td>
                    <td className="px-4 py-3 text-xs">
                      {bundle.createdByName}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </TableScrollArea>
      )}
    </section>
  );
}


function BundleFailureMessage({ errorCode }: { errorCode: string | null }) {
  const display = cdrBundleFailureDisplay(errorCode);
  return (
    <p role="alert" className="text-xs text-destructive">
      <span className="font-medium">{display.title}：</span>
      {display.description}
    </p>
  );
}

function DesignBundleStatusBadge({
  status,
}: {
  status: DesignBundleDisplayStatus;
}) {
  const definition = DESIGN_BUNDLE_DISPLAY_STATUS_REGISTRY[status];
  return (
    <StatusBadge tone={definition.tone} dot={definition.dot}>
      {definition.label}
    </StatusBadge>
  );
}

function FilterBar({ from, to }: { from: string; to: string }) {
  return (
    <form
      id="cdr-filter"
      className="flex flex-wrap items-end gap-3 rounded-xl border bg-card p-3 text-sm shadow-sm"
      action="/foreman/cdr"
    >
      <div className="flex flex-col">
        <label htmlFor="cdr-from" className="text-xs text-muted-foreground">
          起始日期
        </label>
        <input
          id="cdr-from"
          type="date"
          name="from"
          defaultValue={from}
          className="rounded-md border bg-background px-3 py-1 text-sm"
        />
      </div>
      <div className="flex flex-col">
        <label htmlFor="cdr-to" className="text-xs text-muted-foreground">
          终止日期
        </label>
        <input
          id="cdr-to"
          type="date"
          name="to"
          defaultValue={to}
          className="rounded-md border bg-background px-3 py-1 text-sm"
        />
      </div>
      <Button type="submit" size="sm">
        刷新候选工单
      </Button>
    </form>
  );
}
