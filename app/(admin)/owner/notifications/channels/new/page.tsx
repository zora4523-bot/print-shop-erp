import { PageHeader } from '@/components/ui-business';
import { FormPage } from '@/app/_components/FormPage';
import { requirePermission } from '@/lib/auth/permissions';
import { ChannelForm } from '@/components/business/notification/ChannelForm';
import { createChannelAction } from '@/actions/owner-notifications';

export const metadata = { title: '新建通知目标 · 推送配置' };

export default async function NewChannelPage() {
  await requirePermission('notification:config');

  return (
    <FormPage>
      <PageHeader
        title="新建通知目标"
        back={{ href: '/owner/notifications', label: '返回推送配置' }}
      />
      <ChannelForm mode="create" action={createChannelAction} />
    </FormPage>
  );
}
