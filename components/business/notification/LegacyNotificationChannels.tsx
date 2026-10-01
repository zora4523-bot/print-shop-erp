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
        旧版通知记录（{channels.length}）· 已归档
      </DisclosureSummary>
      <div className="space-y-3 pb-4 text-sm">
        <p className="text-muted-foreground">
          如需继续接收通知，请新建通知目标并调整推送规则。
        </p>
        <ul className="space-y-2">
          {channels.map((channel) => (
            <li key={channel.id} className="flex flex-wrap items-center gap-x-3 gap-y-1">
              <span className="min-w-0 break-words">{channel.channelName}</span>
              <span className="text-xs text-muted-foreground">
                {channel.isActive ? '原状态：启用' : '已停用'}
              </span>
              {channel.referencingConfigurationCount !== undefined ? (
                <span className="text-xs text-muted-foreground">
                  {channel.referencingConfigurationCount} 项关联配置
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
