import { requirePermission } from '@/lib/auth/permissions';
import { ChannelForm } from '@/components/business/notification/ChannelForm';
import { createChannelAction } from '@/actions/owner-notifications';

export const metadata = { title: '新建通知目标 · 推送配置' };

export default async function NewChannelPage() {
  await requirePermission('notification:config');

  return (
    <div className="mx-auto max-w-xl space-y-6">
      <div>
        <h1 className="text-xl font-semibold">新建企业微信通知目标</h1>
        <p className="text-sm text-muted-foreground">
          默认使用 Bot ID + Secret 智能机器人。创建后先绑定企业微信群，再启用并配置事件规则。
        </p>
      </div>
      <ChannelForm mode="create" action={createChannelAction} />
    </div>
  );
}
