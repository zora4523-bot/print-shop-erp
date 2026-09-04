import { notFound } from 'next/navigation';
import { requirePermission } from '@/lib/auth/permissions';
import { ChannelForm } from '@/components/business/notification/ChannelForm';
import { SmartBotBindingPanel } from '@/components/business/notification/SmartBotBindingPanel';
import { updateChannelAction } from '@/actions/owner-notifications';
import { getChannel } from '@/lib/notification/admin';

export const metadata = { title: '编辑通知目标 · 推送配置' };

function maskSmartBotTarget(targetId: string | null): string | null {
  if (!targetId) return null;
  return `••••${targetId.slice(-4)}`;
}

export default async function EditChannelPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  await requirePermission('notification:config');
  const { id } = await params;
  const channel = await getChannel(id);
  if (!channel) notFound();

  // bind id 进 server action（同 owner-accounts/[id] 的 .bind() 模式）
  const action = updateChannelAction.bind(null, id);
  const smartBot = channel.transport === 'WECOM_SMART_BOT';
  const targetMasked = maskSmartBotTarget(channel.smartBotTargetId);
  const boundAt = channel.smartBotBoundAt?.toISOString() ?? null;

  return (
    <div className="mx-auto max-w-xl space-y-6">
      <div>
        <h1 className="text-xl font-semibold">编辑通知目标</h1>
        <p className="text-sm text-muted-foreground">
          修改展示名称和启停状态。通知目标标识与传输方式不可修改。
        </p>
      </div>
      <ChannelForm
        mode="edit"
        action={action}
        initial={{
          channelKey: channel.channelKey,
          channelName: channel.channelName,
          transport: channel.transport,
          webhookUrl: channel.webhookUrl,
          smartBotTargetMasked: targetMasked,
          smartBotChatType: channel.smartBotChatType,
          smartBotBoundAt: boundAt,
          smartBotBotMatchesConfigured:
            channel.smartBotBotMatchesConfigured,
          isActive: channel.isActive,
        }}
      />
      {smartBot ? (
        <SmartBotBindingPanel
          channelId={channel.id}
          isBound={Boolean(channel.smartBotTargetId && channel.smartBotBoundAt)}
          targetMasked={targetMasked}
          boundAt={boundAt}
        />
      ) : null}
    </div>
  );
}
