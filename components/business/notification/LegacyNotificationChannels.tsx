import Link from 'next/link';
import { ChevronDown } from 'lucide-react';
import { buttonVariants } from '@/components/ui/button';
import { Disclosure, DisclosureSummary } from '@/components/ui/disclosure';

type LegacyChannel = {
  id: string;
  channelName: string;
  isActive: boolean;
  referencingConfigurationCount?: number;
};

/** Only historical metadata: never accept or serialize a webhook URL here. */
export function LegacyNotificationChannels({
  channels,
  open = false,
}: {
  channels: readonly LegacyChannel[];
  open?: boolean;
}) {
  if (channels.length === 0) return null;

  return (
    <Disclosure
      open={open}
      data-slot="legacy-notification-channels"
      className="rounded-lg border bg-muted/20 px-4"
    >
      <DisclosureSummary className="gap-2">
        <ChevronDown className="size-4 shrink-0 transition-transform group-open:rotate-180" aria-hidden="true" />
        旧版通知记录（{channels.length}）· 只读
      </DisclosureSummary>
      <div className="space-y-3 pb-4 text-sm">
        <p className="text-muted-foreground">
          Webhook 不再支持创建、编辑、测试或新增绑定。存量投递和历史日志仍保留；已有路由请改绑到智能机器人，不能直接更换旧目标的传输方式。
        </p>
        <ul className="space-y-2">
          {channels.map((channel) => (
            <li key={channel.id} className="flex flex-wrap items-center gap-x-3 gap-y-1">
              <span className="min-w-0 break-words">{channel.channelName}</span>
              <span className="text-xs text-muted-foreground">
                {channel.isActive ? '原开关开启（仅兼容存量投递）' : '已停用'}
              </span>
              {channel.referencingConfigurationCount !== undefined ? (
                <span className="text-xs text-muted-foreground">
                  {channel.referencingConfigurationCount} 项存量配置引用
                </span>
              ) : null}
            </li>
          ))}
        </ul>
        <Link
          href="/owner/notifications/channels/new"
          className={buttonVariants({ variant: 'outline', className: 'min-h-11' })}
        >
          新建智能机器人目标
        </Link>
      </div>
    </Disclosure>
  );
}
