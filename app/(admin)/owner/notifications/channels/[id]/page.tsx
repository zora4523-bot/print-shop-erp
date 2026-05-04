import { notFound } from 'next/navigation';
import { requirePermission } from '@/lib/auth/permissions';
import { ChannelForm } from '@/components/business/notification/ChannelForm';
import { updateChannelAction } from '@/actions/owner-notifications';
import { getChannel } from '@/lib/notification/admin';

export const metadata = { title: '编辑群 · 推送配置' };

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

  return (
    <div className="mx-auto max-w-xl space-y-6">
      <div>
        <h1 className="text-xl font-semibold">编辑群</h1>
        <p className="text-sm text-muted-foreground">
          修改群名 / Webhook URL / 启停。channelKey 不可改。
        </p>
      </div>
      <ChannelForm
        mode="edit"
        action={action}
        initial={{
          channelKey: channel.channelKey,
          channelName: channel.channelName,
          webhookUrl: channel.webhookUrl,
          isActive: channel.isActive,
        }}
      />
    </div>
  );
}
