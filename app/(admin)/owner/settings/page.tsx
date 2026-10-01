import { PageHeader } from '@/components/ui-business';
import { FormPage } from '@/app/_components/FormPage';
import { SettingsForm } from '@/components/business/setting/SettingsForm';
import { requirePermission } from '@/lib/auth/permissions';
import {
  SETTING_KEYS,
  formatSettingForInput,
  getAllSettings,
  type SettingKey,
} from '@/lib/settings';
import { listManagementNotificationChannels } from '@/lib/notification/management-routing';

export const metadata = {
  title: '系统设置',
};

export default async function OwnerSettingsPage() {
  // 页面级 authz（纵深防御：layout 的 gate 在软导航时不会重跑）
  await requirePermission('setting:manage');
  const [settings, notificationChannels] = await Promise.all([
    getAllSettings(),
    listManagementNotificationChannels(),
  ]);

  const initialValues = Object.fromEntries(
    SETTING_KEYS.map((key) => [
      key,
      formatSettingForInput(key, settings[key]),
    ]),
  ) as Record<SettingKey, string>;

  return (
    <FormPage>
      <PageHeader title="系统设置" />
      <SettingsForm
        initialValues={initialValues}
        notificationChannels={notificationChannels}
      />
    </FormPage>
  );
}
