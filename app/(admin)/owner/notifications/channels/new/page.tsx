import { requirePermission } from '@/lib/auth/permissions';
import { ChannelForm } from '@/components/business/notification/ChannelForm';
import { createChannelAction } from '@/actions/owner-notifications';

export const metadata = { title: '新建群 · 推送配置' };

export default async function NewChannelPage() {
  await requirePermission('notification:config');

  return (
    <div className="mx-auto max-w-xl space-y-6">
      <div>
        <h1 className="text-xl font-semibold">新建企业微信群</h1>
        <p className="text-sm text-muted-foreground">
          配好后回到列表把群绑到对应事件规则。
        </p>
      </div>
      <ChannelForm mode="create" action={createChannelAction} />
    </div>
  );
}
