import Link from 'next/link';
import { Badge } from '@/components/ui/badge';
import { buttonVariants } from '@/components/ui/button';
import { AdminPagination } from '@/components/business/admin/AdminDataTable';
import { requirePermission } from '@/lib/auth/permissions';
import {
  countRecentFailures,
  countUnresolvedNotifications,
  listLogs,
  listNotificationConfiguration,
  listUnresolvedNotificationLogs,
} from '@/lib/notification/admin';
import { isMockMode } from '@/lib/notification';
import {
  notificationDeliveryMessage,
  notificationEventLabel,
} from '@/lib/notification/event-labels';
import { DeleteChannelButton } from '@/components/business/notification/DeleteChannelButton';
import { TestChannelButton } from '@/components/business/notification/TestChannelButton';
import { LegacyNotificationChannels } from '@/components/business/notification/LegacyNotificationChannels';
import { UnknownNotificationActions } from '@/components/business/notification/UnknownNotificationActions';
import { EnvNotice, ErrorState, PageHeader, StatusBadge as UiStatusBadge, TableEmptyState, TableScrollArea, ReceiptNotice } from '@/components/ui-business';
import { readReceipt } from '@/lib/admin/receipt';
import { firstSearchParam } from '@/lib/admin/table';
import { formatDateTimeShanghai } from '@/lib/format/dates';
import type {
  BackgroundJobStatus,
  NotificationStatus,
  SmartBotConnectionStatus,
} from '@/generated/prisma/enums';
import {
  BACKGROUND_JOB_STATUS_REGISTRY,
  NOTIFICATION_STATUS_REGISTRY,
} from '@/lib/ui/status-registry';
import { managementNotificationRoleForEvent } from '@/lib/notification/events';
import {
  getBackgroundJobHealth,
  summarizeSmartBotConnection,
} from '@/lib/background-jobs/health';

export const metadata = { title: '推送配置' };

const UNKNOWN_PAGE_SIZE = 25;

// 推送配置 / 规则 / 日志统一在一个 landing 页：3 块独立分区。子路径
// 走表单：/channels/new、/channels/[id]、/rules/[event]。
//
// SPEC §8 + DECISIONS 2026-04-27 mock-mode：dev/test 默认开启不真发；
// landing 顶部展示 mock-mode 状态条让 owner 一眼分清&ldquo;真发&rdquo; vs &ldquo;测试&rdquo;。
export default async function OwnerNotificationsPage({
  searchParams,
}: {
  searchParams?: Promise<Record<string, string | string[] | undefined>>;
}) {
  await requirePermission('notification:config');
  const query = (await searchParams) ?? {};
  const receipt = readReceipt(query);
  const parsedPage = Number(firstSearchParam(query.unknownPage));
  const unknownPage =
    Number.isSafeInteger(parsedPage) && parsedPage > 0 ? parsedPage : 1;

  const [
    notificationConfiguration,
    logs,
    recentFailures,
    unresolvedLogs,
    unresolvedCount,
    backgroundHealth,
  ] = await Promise.all([
    listNotificationConfiguration(),
    listLogs({ limit: 20 }),
    countRecentFailures(24),
    listUnresolvedNotificationLogs({
      limit: UNKNOWN_PAGE_SIZE,
      skip: (unknownPage - 1) * UNKNOWN_PAGE_SIZE,
    }),
    countUnresolvedNotifications(),
    getBackgroundJobHealth().catch(() => null),
  ]);
  const { channels, rules } = notificationConfiguration;
  const mock = isMockMode();
  const smartBotConnection = backgroundHealth
    ? summarizeSmartBotConnection(backgroundHealth, {
        expectedVersion: process.env.APP_VERSION ?? 'dev',
      })
    : { status: null, lastSeenAt: null };
  const unknownPageCount = Math.max(
    1,
    Math.ceil(unresolvedCount / UNKNOWN_PAGE_SIZE),
  );

  return (
    <div className="space-y-8">
      <ReceiptNotice
        receipt={receipt}
        messages={{
          created: (value) => ({
            title: value === 'rule' ? '通知规则已创建' : '通知目标已创建',
          }),
          updated: (value) => ({
            title: value === 'rule' ? '通知规则已保存' : '通知目标已保存',
          }),
        }}
      />
      <PageHeader
        title="推送配置"
        subtitle="管理企业微信通知目标、通知规则和投递记录。"
      />

      {mock ? (
        <div data-slot="notifications-mock-banner">
          <EnvNotice>
            当前为测试模式，通知不会发送到企业微信。
          </EnvNotice>
        </div>
      ) : null}

      <SmartBotConnectionPanel
        status={smartBotConnection.status}
        lastSeenAt={smartBotConnection.lastSeenAt}
        mock={mock}
      />

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

      {/* ─── 通知目标 ─── */}
      <NotificationChannelsSection channels={channels.filter((c) => c.transport === 'WECOM_SMART_BOT')} />
      <LegacyNotificationChannels
        channels={channels.filter((c) => c.transport === 'WECOM_GROUP_WEBHOOK').map((c) => ({
          id: c.id,
          channelName: c.channelName,
          isActive: c.isActive,
          referencingConfigurationCount: c.referencingConfigurationCount,
        }))}
      />

      {/* ─── 事件规则（跟随 NOTIFICATION_EVENTS，当前 15 条） ─── */}
      <NotificationRulesSection rules={rules} />

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
          <TableScrollArea label="待人工处理的推送" className="rounded-xl border bg-card shadow-sm">
            <table className="w-full text-sm">
              <thead className="border-b bg-muted/40 text-xs text-muted-foreground">
                <tr>
                  <th className="px-3 py-2 text-left">最后尝试</th>
                  <th className="px-3 py-2 text-left">事件</th>
                  <th className="px-3 py-2 text-left">群</th>
                  <th className="px-3 py-2 text-center">投递状态</th>
                  <th className="px-3 py-2 text-center">重发状态</th>
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
                    <td className="px-3 py-2 text-xs">
                      {notificationEventLabel(log.eventType)}
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
                      {notificationDeliveryMessage(log.errorMessage) ??
                        '未获得可信的送达确认'}
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
                          查看失败记录
                        </Link>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </TableScrollArea>
        )}
        {unresolvedCount > UNKNOWN_PAGE_SIZE ? (
          <AdminPagination
            basePath="/owner/notifications"
            pageParam="unknownPage"
            page={unknownPage}
            pageCount={unknownPageCount}
            total={unresolvedCount}
            pageSize={UNKNOWN_PAGE_SIZE}
            queryParams={{}}
          />
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
          <TableScrollArea label="最近推送日志" className="rounded-xl border bg-card shadow-sm">
            <table className="w-full text-sm">
              <thead className="border-b bg-muted/40 text-xs text-muted-foreground">
                <tr>
                  <th className="px-3 py-2 text-left">时间</th>
                  <th className="px-3 py-2 text-left">事件</th>
                  <th className="px-3 py-2 text-left">群</th>
                  <th className="px-3 py-2 text-center">投递状态</th>
                  <th className="px-3 py-2 text-center">重发状态</th>
                  <th className="px-3 py-2 text-left">结果</th>
                </tr>
              </thead>
              <tbody className="divide-y">
                {logs.map((l) => (
                  <tr key={l.id}>
                    <td className="px-3 py-2 font-mono text-xs">
                      {formatDateTimeShanghai(l.lastAttemptAt)}
                    </td>
                    <td className="px-3 py-2 text-xs">
                      {notificationEventLabel(l.eventType)}
                    </td>
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
                      {notificationDeliveryMessage(l.errorMessage) ??
                        (l.status === 'SUCCESS' ? '—' : '推送失败')}
                      {l.retryCount > 0 ? ` · 重试 ${l.retryCount} 次` : ''}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </TableScrollArea>
        )}
      </section>
    </div>
  );
}

function NotificationChannelsSection({ channels }: {
  channels: Awaited<ReturnType<typeof listNotificationConfiguration>>['channels'];
}) {
  return (
    <section className="space-y-3">
      <div className="flex items-baseline justify-between">
        <h2 className="text-base font-semibold">企业微信通知目标</h2>
        <Link
          href="/owner/notifications/channels/new"
          className={buttonVariants({ size: 'sm' })}
        >
          新建通知目标
        </Link>
      </div>
      {channels.length === 0 ? (
        <TableEmptyState
          variant="compact"
          title="尚未配置企业微信通知目标"
          description="新建智能机器人通知目标并完成群绑定后，才能把通知规则投递到对应群。"
          action={
            <Link
              href="/owner/notifications/channels/new"
              className={buttonVariants({ size: 'sm' })}
            >
              新建通知目标
            </Link>
          }
        />
      ) : (
        <TableScrollArea label="企业微信通知目标列表" className="rounded-xl border bg-card shadow-sm">
          <table className="w-full text-sm">
            <thead className="border-b bg-muted/40 text-xs text-muted-foreground">
              <tr>
                <th className="px-3 py-2 text-left">通知目标</th>
                <th className="px-3 py-2 text-left">目的地</th>
                <th className="px-3 py-2 text-center">状态</th>
                <th className="px-3 py-2 text-center">配置引用</th>
                <th className="px-3 py-2 text-right">操作</th>
              </tr>
            </thead>
            <tbody className="divide-y">
              {channels.map((c) => {
                const smartBotUnbound =
                  !c.smartBotTargetId || !c.smartBotBoundAt;
                const smartBotIdentityMismatch =
                  !smartBotUnbound &&
                  !c.smartBotBotMatchesConfigured;
                const testDisabled =
                  smartBotUnbound || smartBotIdentityMismatch || !c.isActive;

                return (
                  <tr key={c.id}>
                    <td className="px-3 py-2">{c.channelName}</td>
                    <td className="px-3 py-2 font-mono text-xs text-muted-foreground">
                      {c.smartBotTargetId
                        ? `群聊 ••••${c.smartBotTargetId.slice(-4)}`
                        : '待绑定群聊'}
                    </td>
                    <td className="px-3 py-2 text-center">
                      {smartBotUnbound ? (
                        <Badge variant="outline">未绑定</Badge>
                      ) : smartBotIdentityMismatch ? (
                        <Badge variant="destructive">Bot ID 已变更</Badge>
                      ) : c.isActive ? (
                        <Badge>启用</Badge>
                      ) : (
                        <Badge variant="outline">已停用</Badge>
                      )}
                    </td>
                    <td className="px-3 py-2 text-center font-mono text-xs">
                      {c.referencingConfigurationCount}
                    </td>
                    <td className="px-3 py-2 text-right">
                      <div className="flex items-center justify-end gap-2">
                        <TestChannelButton
                          channelId={c.id}
                          disabled={testDisabled}
                          disabledReason={
                            smartBotUnbound
                              ? '智能机器人尚未绑定企业微信群'
                              : smartBotIdentityMismatch
                                ? '当前 Bot ID 与该群绑定时不一致'
                                : '该通知目标已停用，请先启用'
                          }
                          disabledFixLabel={
                            smartBotUnbound
                              ? '去绑定企业微信群'
                              : smartBotIdentityMismatch
                                ? '查看处理方式'
                                : undefined
                          }
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
                          disabled={c.referencingConfigurationCount > 0}
                          disabledReason={`被 ${c.referencingConfigurationCount} 项通知配置引用，先在规则或系统设置里移除`}
                        />
                      </div>
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

function NotificationRulesSection({ rules }: {
  rules: Awaited<ReturnType<typeof listNotificationConfiguration>>['rules'];
}) {
  return (
    <section id="notification-rules" className="space-y-3">
      <h2 className="text-base font-semibold">事件规则</h2>
      {rules.length === 0 ? (
        <ErrorState
          blocking
          title="默认通知规则尚未初始化"
          description="请联系运维人员完成初始化，然后刷新本页。"
        />
      ) : (
        <TableScrollArea label="通知事件规则" className="rounded-xl border bg-card shadow-sm">
          <table className="w-full text-sm">
            <thead className="border-b bg-muted/40 text-xs text-muted-foreground">
              <tr>
                <th className="px-3 py-2 text-left">事件</th>
                <th className="px-3 py-2 text-left">模板（前 60 字）</th>
                <th className="px-3 py-2 text-center">状态</th>
                <th className="px-3 py-2 text-center">路由</th>
                <th className="px-3 py-2 text-right">操作</th>
              </tr>
            </thead>
            <tbody className="divide-y">
              {rules.map((r) => (
                <tr key={r.eventType}>
                  <td className="px-3 py-2 text-xs">
                    {notificationEventLabel(r.eventType)}
                  </td>
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
                  <td className="px-3 py-2 text-center text-xs">
                    {notificationRouteLabel(r.eventType, r.channelIds.length)}
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
        </TableScrollArea>
      )}
    </section>
  );
}

function SmartBotConnectionPanel({
  status,
  lastSeenAt,
  mock,
}: {
  status: SmartBotConnectionStatus | null;
  lastSeenAt: Date | null;
  mock: boolean;
}) {
  const presentation = smartBotConnectionPresentation(status);
  return (
    <div
      data-slot="notifications-smart-bot-connection"
      className={`rounded-md border px-3 py-2 text-sm ${presentation.danger ? 'border-destructive/40 bg-destructive/5' : 'bg-card'}`}
    >
      <div className="flex flex-wrap items-center gap-2">
        <strong>智能机器人长连接</strong>
        <Badge variant={presentation.badgeVariant}>{presentation.label}</Badge>
        {lastSeenAt ? (
          <span className="text-xs text-muted-foreground">
            最近心跳 {formatDateTimeShanghai(lastSeenAt)}
          </span>
        ) : null}
      </div>
      <p className={presentation.danger ? 'mt-1 text-destructive' : 'mt-1 text-muted-foreground'}>
        {presentation.description}
        {mock ? ' 当前为测试模式，不会向企业微信真实发送。' : ''}
      </p>
      <p className="mt-1 text-xs text-muted-foreground">
        此状态来自当前版本 LIGHT worker 的数据库心跳，不是 Web 进程根据环境变量推断。
      </p>
    </div>
  );
}

function smartBotConnectionPresentation(
  status: SmartBotConnectionStatus | null,
): {
  label: string;
  description: string;
  badgeVariant: 'default' | 'outline' | 'destructive';
  danger: boolean;
} {
  switch (status) {
    case 'CONNECTED':
      return {
        label: '已连接',
        description: 'LIGHT worker 已通过企业微信认证，可以接收群绑定消息并主动推送。',
        badgeVariant: 'default',
        danger: false,
      };
    case 'CONNECTING':
      return {
        label: '连接中',
        description: 'LIGHT worker 正在连接企业微信，请稍后刷新查看。',
        badgeVariant: 'outline',
        danger: false,
      };
    case 'DISCONNECTED':
      return {
        label: '暂时断开',
        description: '企业微信连接暂时中断，worker 会自动重连；Web 服务仍可正常使用。',
        badgeVariant: 'outline',
        danger: false,
      };
    case 'AUTH_FAILED':
      return {
        label: '认证失败',
        description: '请立即轮换或核对 Bot Secret，更新受限环境中的凭据，并重启唯一的 LIGHT worker。',
        badgeVariant: 'destructive',
        danger: true,
      };
    case 'CONNECTION_CONFLICT':
      return {
        label: '连接冲突',
        description: '同一 Bot ID 被另一条长连接占用。请确认只运行一个 LIGHT worker，并排查其他连接者。',
        badgeVariant: 'destructive',
        danger: true,
      };
    case 'NOT_CONFIGURED':
      return {
        label: '未配置',
        description: 'LIGHT worker 尚未获得成对的 Bot ID 与轮换后 Secret，当前不能绑定或真实推送。',
        badgeVariant: 'destructive',
        danger: true,
      };
    default:
      return {
        label: '状态未知',
        description: '未读到当前版本 LIGHT worker 的连接心跳，请检查 worker 是否运行及版本是否一致。',
        badgeVariant: 'destructive',
        danger: true,
      };
  }
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
    return <UiStatusBadge tone="neutral">不可重发</UiStatusBadge>;
  }
  if (!status) {
    return <UiStatusBadge tone="danger">记录缺失</UiStatusBadge>;
  }
  const definition = BACKGROUND_JOB_STATUS_REGISTRY[status];
  return (
    <UiStatusBadge tone={definition.tone} dot={definition.dot}>
      {definition.label}
    </UiStatusBadge>
  );
}

function firstLine(s: string): string {
  const line = s.split('\n')[0] ?? '';
  return line.length > 60 ? `${line.slice(0, 60)}…` : line;
}

function notificationRouteLabel(eventType: string, legacyCount: number): string {
  const role = managementNotificationRoleForEvent(eventType);
  if (role === 'factoryConfirmer') return '工厂确认人';
  if (role === 'owner') return '老板';
  return `${legacyCount} 个群`;
}
