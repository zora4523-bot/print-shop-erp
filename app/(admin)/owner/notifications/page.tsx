import Link from 'next/link';
import { Badge } from '@/components/ui/badge';
import { buttonVariants } from '@/components/ui/button';
import { requirePermission } from '@/lib/auth/permissions';
import {
  countRecentFailures,
  countUnresolvedNotifications,
  listLogs,
  listNotificationConfiguration,
  listUnresolvedNotificationLogs,
} from '@/lib/notification/admin';
import { isMockMode } from '@/lib/notification';
import { DeleteChannelButton } from '@/components/business/notification/DeleteChannelButton';
import { TestChannelButton } from '@/components/business/notification/TestChannelButton';
import { UnknownNotificationActions } from '@/components/business/notification/UnknownNotificationActions';
import {
  EnvNotice,
  ErrorState,
  PageHeader,
  StatusBadge as UiStatusBadge,
  TableEmptyState,
} from '@/components/ui-business';
import { formatDateTimeShanghai } from '@/lib/format/dates';
import type {
  BackgroundJobStatus,
  NotificationStatus,
} from '@/generated/prisma/enums';
import {
  BACKGROUND_JOB_STATUS_REGISTRY,
  NOTIFICATION_STATUS_REGISTRY,
} from '@/lib/ui/status-registry';

export const metadata = { title: '推送配置 · 红包印刷 ERP' };

const UNKNOWN_PAGE_SIZE = 25;

// 推送配置 / 规则 / 日志统一在一个 landing 页：3 块独立分区。子路径
// 走表单：/channels/new、/channels/[id]、/rules/[event]。
//
// SPEC §8 + DECISIONS 2026-04-27 mock-mode：dev/test 默认开启不真发；
// landing 顶部展示 mock-mode 状态条让 owner 一眼分清&ldquo;真发&rdquo; vs &ldquo;测试&rdquo;。
export default async function OwnerNotificationsPage({
  searchParams,
}: {
  searchParams?: Promise<{ unknownPage?: string }>;
}) {
  await requirePermission('notification:config');
  const query = (await searchParams) ?? {};
  const parsedPage = Number(query.unknownPage);
  const unknownPage =
    Number.isSafeInteger(parsedPage) && parsedPage > 0 ? parsedPage : 1;

  const [
    notificationConfiguration,
    logs,
    recentFailures,
    unresolvedLogs,
    unresolvedCount,
  ] = await Promise.all([
    listNotificationConfiguration(),
    listLogs({ limit: 20 }),
    countRecentFailures(24),
    listUnresolvedNotificationLogs({
      limit: UNKNOWN_PAGE_SIZE,
      skip: (unknownPage - 1) * UNKNOWN_PAGE_SIZE,
    }),
    countUnresolvedNotifications(),
  ]);
  const { channels, rules } = notificationConfiguration;
  const mock = isMockMode();
  const unknownPageCount = Math.max(
    1,
    Math.ceil(unresolvedCount / UNKNOWN_PAGE_SIZE),
  );

  return (
    <div className="space-y-8">
      <PageHeader
        title="推送配置"
        subtitle="企业微信群机器人 webhook 配置 + 11 个事件规则。"
      />

      {mock ? (
        <div data-slot="notifications-mock-banner">
          <EnvNotice>
            当前 <strong className="text-foreground">mock-mode</strong>：通知不会真发到企业微信，
            NotificationLog 仍然记录（status=SUCCESS / errorMessage=MOCK）。
            上线时请把 <code>NOTIFICATION_MOCK_MODE</code> 设为{' '}
            <code>false</code>。
          </EnvNotice>
        </div>
      ) : null}

      {recentFailures > 0 ? (
        <div
          data-slot="notifications-owner-alert"
          className="rounded-md border border-destructive/40 bg-destructive/5 px-3 py-2 text-sm text-destructive"
        >
          🚨 过去 24 小时内有 <strong>{recentFailures}</strong>{' '}
          条推送失败、结果不明或重试已耗尽。见下方待人工处理队列与
          &ldquo;最近推送日志&rdquo;详情。
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
          <TableEmptyState
            variant="compact"
            title="尚未配置企业微信群"
            description="新建群并验证 Webhook 后，才能把通知规则投递到对应群。"
            action={
              <Link
                href="/owner/notifications/channels/new"
                className={buttonVariants({ size: 'sm' })}
              >
                新建群
              </Link>
            }
          />
        ) : (
          <div
            className="overflow-x-auto rounded-xl border bg-card shadow-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
            role="region"
            aria-label="企业微信群列表"
            tabIndex={0}
          >
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
      <section id="notification-rules" className="space-y-3">
        <h2 className="text-base font-semibold">事件规则</h2>
        {rules.length === 0 ? (
          <ErrorState
            blocking
            title="默认通知规则尚未初始化"
            description={
              <>
                请由开发或运维人员运行 <code>pnpm prisma db seed</code>，完成后刷新本页。
              </>
            }
          />
        ) : (
          <div
            className="overflow-x-auto rounded-xl border bg-card shadow-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
            role="region"
            aria-label="通知事件规则"
            tabIndex={0}
          >
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

      {/* UNKNOWN 与 RETRYING + DEAD 都不能只混在最近 20 条中：
          新日志会把它们挤走，而它们都是 owner 的持久化待办。 */}
      <section className="space-y-3">
        <div className="flex items-baseline justify-between gap-3">
          <h2 className="text-base font-semibold">待人工处理</h2>
          <span className="text-xs text-muted-foreground">
            共 {unresolvedCount} 条 · 第 {unknownPage}/{unknownPageCount} 页
          </span>
        </div>
        {unresolvedLogs.length === 0 ? (
          <TableEmptyState
            variant="compact"
            title="没有待人工处理的消息"
            description="当前没有结果不明或自动重试已耗尽的投递。"
          />
        ) : (
          <div
            className="overflow-x-auto rounded-xl border bg-card shadow-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
            role="region"
            aria-label="待人工处理的推送"
            tabIndex={0}
          >
            <table className="w-full text-sm">
              <thead className="border-b bg-muted/40 text-xs text-muted-foreground">
                <tr>
                  <th className="px-3 py-2 text-left">最后尝试</th>
                  <th className="px-3 py-2 text-left">事件</th>
                  <th className="px-3 py-2 text-left">群</th>
                  <th className="px-3 py-2 text-center">投递状态</th>
                  <th className="px-3 py-2 text-center">后台任务</th>
                  <th className="px-3 py-2 text-left">原因</th>
                  <th className="px-3 py-2 text-right">人工处置</th>
                </tr>
              </thead>
              <tbody className="divide-y">
                {unresolvedLogs.map((log) => (
                  <tr key={log.id}>
                    <td className="px-3 py-2 font-mono text-xs">
                      {formatDateTimeShanghai(log.lastAttemptAt)}
                    </td>
                    <td className="px-3 py-2 font-mono text-xs">
                      {log.eventType}
                    </td>
                    <td className="px-3 py-2 text-xs">
                      {log.channelName ?? '已删除'}
                    </td>
                    <td className="px-3 py-2 text-center">
                      <NotificationStatusBadge
                        status={log.status}
                      />
                    </td>
                    <td className="px-3 py-2 text-center">
                      <BackgroundJobStatusBadge
                        status={log.backgroundJobStatus}
                        hasDurableJob={log.deliveryKey !== null}
                      />
                    </td>
                    <td className="px-3 py-2 text-xs text-muted-foreground">
                      {log.errorMessage ?? '未获得可信的下游确认'}
                    </td>
                    <td className="px-3 py-2 text-right">
                      {log.status === 'UNKNOWN' ? (
                        <UnknownNotificationActions
                          logId={log.id}
                          stateVersion={log.deliveryStateVersion}
                          canRetry={log.deliveryKey !== null}
                        />
                      ) : (
                        <Link
                          href="/owner/background-jobs"
                          className={buttonVariants({
                            variant: 'outline',
                            size: 'sm',
                          })}
                        >
                          查看死信任务
                        </Link>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        {unresolvedCount > UNKNOWN_PAGE_SIZE ? (
          <nav className="flex items-center justify-end gap-2" aria-label="待处理推送分页">
            {unknownPage > 1 ? (
              <Link
                href={`/owner/notifications?unknownPage=${unknownPage - 1}`}
                className={buttonVariants({ variant: 'outline', size: 'sm' })}
              >
                上一页
              </Link>
            ) : null}
            {unknownPage < unknownPageCount ? (
              <Link
                href={`/owner/notifications?unknownPage=${unknownPage + 1}`}
                className={buttonVariants({ variant: 'outline', size: 'sm' })}
              >
                下一页
              </Link>
            ) : null}
          </nav>
        ) : null}
      </section>

      {/* ─── 最近推送日志 ─── */}
      <section className="space-y-3">
        <h2 className="text-base font-semibold">最近推送日志</h2>
        {logs.length === 0 ? (
          <TableEmptyState
            variant="compact"
            title="尚无推送日志"
            description="规则触发或发送测试消息后，最近结果会显示在这里。"
          />
        ) : (
          <div
            className="overflow-x-auto rounded-xl border bg-card shadow-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
            role="region"
            aria-label="最近推送日志"
            tabIndex={0}
          >
            <table className="w-full text-sm">
              <thead className="border-b bg-muted/40 text-xs text-muted-foreground">
                <tr>
                  <th className="px-3 py-2 text-left">时间</th>
                  <th className="px-3 py-2 text-left">事件</th>
                  <th className="px-3 py-2 text-left">群</th>
                  <th className="px-3 py-2 text-center">投递状态</th>
                  <th className="px-3 py-2 text-center">后台任务</th>
                  <th className="px-3 py-2 text-left">错误 / 标记</th>
                </tr>
              </thead>
              <tbody className="divide-y">
                {logs.map((l) => (
                  <tr key={l.id}>
                    <td className="px-3 py-2 font-mono text-xs">
                      {formatDateTimeShanghai(l.lastAttemptAt)}
                    </td>
                    <td className="px-3 py-2 font-mono text-xs">{l.eventType}</td>
                    <td className="px-3 py-2 text-xs">
                      {l.channelName ?? <span className="text-muted-foreground">已删除</span>}
                    </td>
                    <td className="px-3 py-2 text-center">
                      <NotificationStatusBadge
                        status={l.status}
                      />
                    </td>
                    <td className="px-3 py-2 text-center">
                      <BackgroundJobStatusBadge
                        status={l.backgroundJobStatus}
                        hasDurableJob={l.deliveryKey !== null}
                      />
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

function NotificationStatusBadge({
  status,
}: {
  status: NotificationStatus;
}) {
  const definition = NOTIFICATION_STATUS_REGISTRY[status];
  return (
    <UiStatusBadge tone={definition.tone} dot={definition.dot}>
      {definition.label}
    </UiStatusBadge>
  );
}

function BackgroundJobStatusBadge({
  status,
  hasDurableJob,
}: {
  status: BackgroundJobStatus | null;
  hasDurableJob: boolean;
}) {
  if (!hasDurableJob) {
    return <UiStatusBadge tone="neutral">无持久任务</UiStatusBadge>;
  }
  if (!status) {
    return <UiStatusBadge tone="danger">任务缺失</UiStatusBadge>;
  }
  const definition = BACKGROUND_JOB_STATUS_REGISTRY[status];
  return (
    <UiStatusBadge tone={definition.tone} dot={definition.dot}>
      {definition.label}
    </UiStatusBadge>
  );
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
