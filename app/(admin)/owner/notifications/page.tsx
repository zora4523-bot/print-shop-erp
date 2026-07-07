import Link from 'next/link';
import { Badge } from '@/components/ui/badge';
import { buttonVariants } from '@/components/ui/button';
import { requirePermission } from '@/lib/auth/permissions';
import {
  countRecentFailures,
  listChannelsWithRefCount,
  listLogs,
  listRules,
} from '@/lib/notification/admin';
import { isMockMode } from '@/lib/notification';
import { DeleteChannelButton } from '@/components/business/notification/DeleteChannelButton';
import { TestChannelButton } from '@/components/business/notification/TestChannelButton';
import { PageHeader } from '@/components/ui-business';

export const metadata = { title: '推送配置 · 红包印刷 ERP' };

// 推送配置 / 规则 / 日志统一在一个 landing 页：3 块独立分区。子路径
// 走表单：/channels/new、/channels/[id]、/rules/[event]。
//
// SPEC §8 + DECISIONS 2026-04-27 mock-mode：dev/test 默认开启不真发；
// landing 顶部展示 mock-mode 状态条让 owner 一眼分清&ldquo;真发&rdquo; vs &ldquo;测试&rdquo;。
export default async function OwnerNotificationsPage() {
  await requirePermission('notification:config');

  const [channels, rules, logs, recentFailures] = await Promise.all([
    listChannelsWithRefCount(),
    listRules(),
    listLogs({ limit: 20 }),
    countRecentFailures(24),
  ]);
  const mock = isMockMode();

  return (
    <div className="space-y-8">
      <PageHeader
        title="推送配置"
        subtitle="企业微信群机器人 webhook 配置 + 11 个事件规则。"
      />

      {mock ? (
        <div
          data-slot="notifications-mock-banner"
          className="rounded-md border border-warning/40 bg-warning/10 px-3 py-2 text-sm text-warning-foreground"
        >
          ⚠️ 当前 <strong>mock-mode</strong>：通知不会真发到企业微信，
          NotificationLog 仍然记录（status=SUCCESS / errorMessage=MOCK）。
          上线时请把 <code>NOTIFICATION_MOCK_MODE</code> 设为{' '}
          <code>false</code>。
        </div>
      ) : null}

      {recentFailures > 0 ? (
        <div className="rounded-md border border-destructive/40 bg-destructive/5 px-3 py-2 text-sm text-destructive">
          🚨 过去 24 小时内有 <strong>{recentFailures}</strong> 条推送失败。
          见下方&ldquo;最近推送日志&rdquo;详情。
        </div>
      ) : null}

      {/* ─── 群配置 ─── */}
      <section className="space-y-3">
        <div className="flex items-baseline justify-between">
          <h2 className="text-base font-semibold">企业微信群</h2>
          <Link
            href="/owner/notifications/channels/new"
            className={buttonVariants({ size: 'sm' })}
          >
            新建群
          </Link>
        </div>
        {channels.length === 0 ? (
          <p className="rounded-xl border border-dashed bg-muted/20 p-6 text-sm text-muted-foreground">
            还没建任何群。点击右上角&ldquo;新建群&rdquo;开始。
          </p>
        ) : (
          <div className="overflow-x-auto rounded-xl border bg-card shadow-sm">
            <table className="w-full text-sm">
              <thead className="border-b bg-muted/40 text-xs text-muted-foreground">
                <tr>
                  <th className="px-3 py-2 text-left">channelKey</th>
                  <th className="px-3 py-2 text-left">群名</th>
                  <th className="px-3 py-2 text-left">Webhook</th>
                  <th className="px-3 py-2 text-center">状态</th>
                  <th className="px-3 py-2 text-center">引用规则</th>
                  <th className="px-3 py-2 text-right">操作</th>
                </tr>
              </thead>
              <tbody className="divide-y">
                {channels.map((c) => (
                  <tr key={c.id}>
                    <td className="px-3 py-2 font-mono text-xs">{c.channelKey}</td>
                    <td className="px-3 py-2">{c.channelName}</td>
                    <td className="px-3 py-2 font-mono text-xs text-muted-foreground">
                      {maskWebhookUrl(c.webhookUrl)}
                    </td>
                    <td className="px-3 py-2 text-center">
                      {c.isActive ? (
                        <Badge>启用</Badge>
                      ) : (
                        <Badge variant="outline">已停用</Badge>
                      )}
                    </td>
                    <td className="px-3 py-2 text-center font-mono text-xs">
                      {c.referencingActiveRuleCount}
                    </td>
                    <td className="px-3 py-2 text-right">
                      <div className="flex items-center justify-end gap-2">
                        <TestChannelButton
                          channelId={c.id}
                          disabled={!c.isActive}
                          disabledReason="该群已停用，请先启用"
                        />
                        <Link
                          href={`/owner/notifications/channels/${c.id}`}
                          className={buttonVariants({
                            size: 'sm',
                            variant: 'outline',
                          })}
                        >
                          编辑
                        </Link>
                        <DeleteChannelButton
                          channelId={c.id}
                          channelName={c.channelName}
                          disabled={c.referencingActiveRuleCount > 0}
                          disabledReason={`被 ${c.referencingActiveRuleCount} 条规则引用（含未启用），先在规则里移除`}
                        />
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      {/* ─── 事件规则（11 条固定） ─── */}
      <section className="space-y-3">
        <h2 className="text-base font-semibold">事件规则</h2>
        {rules.length === 0 ? (
          <p className="rounded-xl border border-dashed bg-muted/20 p-6 text-sm text-muted-foreground">
            seed 还没初始化默认规则。请运行 <code>pnpm prisma db seed</code>。
          </p>
        ) : (
          <div className="overflow-x-auto rounded-xl border bg-card shadow-sm">
            <table className="w-full text-sm">
              <thead className="border-b bg-muted/40 text-xs text-muted-foreground">
                <tr>
                  <th className="px-3 py-2 text-left">事件</th>
                  <th className="px-3 py-2 text-left">模板（前 60 字）</th>
                  <th className="px-3 py-2 text-center">状态</th>
                  <th className="px-3 py-2 text-center">绑群数</th>
                  <th className="px-3 py-2 text-right">操作</th>
                </tr>
              </thead>
              <tbody className="divide-y">
                {rules.map((r) => (
                  <tr key={r.eventType}>
                    <td className="px-3 py-2 font-mono text-xs">{r.eventType}</td>
                    <td className="px-3 py-2 text-xs text-muted-foreground">
                      {firstLine(r.messageTemplate)}
                    </td>
                    <td className="px-3 py-2 text-center">
                      {r.isActive ? (
                        <Badge>启用</Badge>
                      ) : (
                        <Badge variant="outline">未启用</Badge>
                      )}
                    </td>
                    <td className="px-3 py-2 text-center font-mono text-xs">
                      {r.channelIds.length}
                    </td>
                    <td className="px-3 py-2 text-right">
                      <Link
                        href={`/owner/notifications/rules/${r.eventType}`}
                        className={buttonVariants({
                          size: 'sm',
                          variant: 'outline',
                        })}
                      >
                        编辑
                      </Link>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      {/* ─── 最近推送日志 ─── */}
      <section className="space-y-3">
        <h2 className="text-base font-semibold">最近推送日志</h2>
        {logs.length === 0 ? (
          <p className="rounded-xl border border-dashed bg-muted/20 p-6 text-sm text-muted-foreground">
            暂无推送日志。
          </p>
        ) : (
          <div className="overflow-x-auto rounded-xl border bg-card shadow-sm">
            <table className="w-full text-sm">
              <thead className="border-b bg-muted/40 text-xs text-muted-foreground">
                <tr>
                  <th className="px-3 py-2 text-left">时间</th>
                  <th className="px-3 py-2 text-left">事件</th>
                  <th className="px-3 py-2 text-left">群</th>
                  <th className="px-3 py-2 text-center">状态</th>
                  <th className="px-3 py-2 text-left">错误 / 标记</th>
                </tr>
              </thead>
              <tbody className="divide-y">
                {logs.map((l) => (
                  <tr key={l.id}>
                    <td className="px-3 py-2 font-mono text-xs">
                      {formatDateTime(l.createdAt)}
                    </td>
                    <td className="px-3 py-2 font-mono text-xs">{l.eventType}</td>
                    <td className="px-3 py-2 text-xs">
                      {l.channelName ?? <span className="text-muted-foreground">已删除</span>}
                    </td>
                    <td className="px-3 py-2 text-center">
                      <StatusBadge status={l.status} />
                    </td>
                    <td className="px-3 py-2 text-xs text-muted-foreground">
                      {l.errorMessage ?? (l.status === 'SUCCESS' ? '—' : '')}
                      {l.retryCount > 0 ? ` · 重试 ${l.retryCount} 次` : ''}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  );
}

function StatusBadge({ status }: { status: string }) {
  switch (status) {
    case 'SUCCESS':
      return <Badge>成功</Badge>;
    case 'FAILED':
      return <Badge variant="destructive">失败</Badge>;
    case 'RETRYING':
      return <Badge variant="secondary">重试中</Badge>;
    default:
      return <Badge variant="outline">{status}</Badge>;
  }
}

function maskWebhookUrl(url: string): string {
  // qyapi 形如 .../send?key=<uuid>
  const m = url.match(/key=([a-zA-Z0-9-]+)/);
  if (!m) return url;
  const key = m[1]!;
  const masked =
    key.length > 8 ? `${key.slice(0, 4)}…${key.slice(-4)}` : '****';
  return url.replace(/key=[a-zA-Z0-9-]+/, `key=${masked}`);
}

function firstLine(s: string): string {
  const line = s.split('\n')[0] ?? '';
  return line.length > 60 ? `${line.slice(0, 60)}…` : line;
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
