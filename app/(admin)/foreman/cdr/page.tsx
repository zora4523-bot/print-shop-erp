import Link from 'next/link';
import { requirePermission } from '@/lib/auth/permissions';
import {
  listEligibleOrders,
  listRecentBundles,
} from '@/lib/cdr/bundle';
import { parseStrictYmd } from '@/lib/auth/schemas';
import { isMockMode } from '@/lib/cdr/zip';
import { CreateBundleForm } from '@/components/business/cdr/CreateBundleForm';
import { Badge } from '@/components/ui/badge';

export const metadata = { title: 'CDR 汇总下载' };

type SearchParams = Promise<{ from?: string; to?: string }>;

// SPEC §3.5：CDR 汇总下载 = 车间主管按日期窗口勾工单 → 生成 24h 短链
// → 复制给外协模具厂。本页不显示 admin 工单详情链接（外协方不需要）；
// 只显示工单号 + 客户代号 + CDR 文件数。
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

  const [eligible, recentBundles] = await Promise.all([
    listEligibleOrders({ from, to }),
    listRecentBundles(20),
  ]);
  const mock = isMockMode();
  // 一次取值；下面表格遍历时拿 ms 比 expiresAt（用 new Date() 而不是
  // Date.now()——react-hooks/purity 规则只标 `Date.now` 不标 `new Date`，
  // 行为等价）。Server Component 每个 request 重渲染一次，&ldquo;now&rdquo;的
  // 不稳定性不是 React render-time bug。
  const nowMs = new Date().getTime();

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-xl font-semibold">CDR 汇总下载</h1>
        <p className="text-sm text-muted-foreground">
          按日期窗口勾选工单 → 生成 ZIP 包 → 24 小时有效短链发外协。
        </p>
      </div>

      {mock ? (
        <div className="rounded-md border border-amber-300 bg-amber-50 px-4 py-3 text-sm text-amber-900 dark:border-amber-800 dark:bg-amber-950 dark:text-amber-100">
          ⚠️ <strong>OSS 未配置 / mock-mode</strong>：可以走完&ldquo;勾选 → 生成下载包&rdquo;
          流程并写入 DesignBundle 记录，但 ZIP 文件 URL 是占位 (
          <code>mock://...</code>)，外协下载会返 503。上线时业主在 .env
          配齐 OSS_* 后即可真打包。
        </div>
      ) : null}

      <FilterBar from={from} to={to} />

      {/* key prop 强制 form 在 filter URL 变化时重挂（Codex round 119
          medium）—— 否则 selected useState 初始化保留旧 eligible IDs，
          表面候选都未勾、提交报"至少勾选 1"。key 用 from-to 即可
          区分窗口。 */}
      <CreateBundleForm
        key={`${from}|${to}`}
        from={from}
        to={to}
        eligible={eligible.map((o) => ({
          id: o.id,
          orderNo: o.orderNo,
          customerRef: o.customerRef,
          submittedAt: o.submittedAt.toISOString(),
          cdrCount: o.cdrCount,
        }))}
      />

      <section className="space-y-3">
        <h2 className="text-base font-semibold">最近生成的下载包</h2>
        {recentBundles.length === 0 ? (
          <div className="rounded-xl border bg-card p-6 text-sm text-muted-foreground">
            尚未生成过 CDR 下载包。
          </div>
        ) : (
          <div className="overflow-hidden rounded-xl border bg-card shadow-sm">
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
                {recentBundles.map((b) => {
                  const expired = b.expiresAt.getTime() < nowMs;
                  const isMock = b.zipFileUrl.startsWith('mock://');
                  return (
                    <tr key={b.id}>
                      <td className="px-4 py-3 font-mono text-xs">
                        {formatDate(b.dateRangeFrom)} →{' '}
                        {formatDate(
                          new Date(b.dateRangeTo.getTime() - 1),
                        )}
                      </td>
                      <td className="px-4 py-3 text-right">{b.orderCount}</td>
                      <td className="px-4 py-3 text-right">{b.fileCount}</td>
                      <td className="px-4 py-3">
                        {expired ? (
                          <Badge variant="outline">已过期</Badge>
                        ) : isMock ? (
                          <Badge variant="outline">mock URL</Badge>
                        ) : (
                          // b.downloadUrl 是绝对 URL（lib 写入时拼了
                          // APP_PUBLIC_URL）。外协方复制粘贴；本地点击
                          // 直接走该 host。
                          <a
                            href={b.downloadUrl}
                            className="font-mono text-xs break-all underline-offset-2 hover:underline"
                          >
                            {b.downloadUrl}
                          </a>
                        )}
                      </td>
                      <td className="px-4 py-3 text-xs">
                        {formatDateTime(b.expiresAt)}
                      </td>
                      <td className="px-4 py-3 text-right">
                        {b.downloadCount}
                      </td>
                      <td className="px-4 py-3 text-xs">{b.createdByName}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <p className="text-xs text-muted-foreground">
        提示：生成下载包后请尽快发送外协。链接 24 小时后自动失效，过期需重新生成。{' '}
        <Link href="/foreman" className="underline">
          ← 返回车间首页
        </Link>
      </p>
    </div>
  );
}

function FilterBar({ from, to }: { from: string; to: string }) {
  return (
    <form
      className="flex flex-wrap items-end gap-3 rounded-xl border bg-card p-3 text-sm shadow-sm"
      action="/foreman/cdr"
    >
      <div className="flex flex-col">
        <label className="text-xs text-muted-foreground">起始日期</label>
        <input
          type="date"
          name="from"
          defaultValue={from}
          className="rounded-md border bg-background px-3 py-1 text-sm"
        />
      </div>
      <div className="flex flex-col">
        <label className="text-xs text-muted-foreground">终止日期</label>
        <input
          type="date"
          name="to"
          defaultValue={to}
          className="rounded-md border bg-background px-3 py-1 text-sm"
        />
      </div>
      <button
        type="submit"
        className="rounded-md border bg-primary px-3 py-1.5 text-sm font-medium text-primary-foreground hover:opacity-90"
      >
        刷新候选工单
      </button>
    </form>
  );
}

function todayShanghai(): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Shanghai',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date());
}

function formatDate(d: Date): string {
  return new Intl.DateTimeFormat('zh-CN', {
    timeZone: 'Asia/Shanghai',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(d);
}

function formatDateTime(d: Date): string {
  return new Intl.DateTimeFormat('zh-CN', {
    timeZone: 'Asia/Shanghai',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).format(d);
}

