import { PageHeader } from '@/components/ui-business';
import { SettingsForm } from '@/components/business/setting/SettingsForm';
import { requirePermission } from '@/lib/auth/permissions';
import {
  SETTING_KEYS,
  formatSettingForInput,
  getAllSettings,
  type SettingKey,
} from '@/lib/settings';

export const metadata = {
  title: '系统设置 · 红包印刷 ERP',
};

export default async function OwnerSettingsPage() {
  // 页面级 authz（纵深防御：layout 的 gate 在软导航时不会重跑）
  await requirePermission('setting:manage');
  const settings = await getAllSettings();

  const initialValues = Object.fromEntries(
    SETTING_KEYS.map((key) => [
      key,
      formatSettingForInput(key, settings[key]),
    ]),
  ) as Record<SettingKey, string>;

  return (
    <div className="space-y-6">
      <PageHeader title="系统设置" />
      <SettingsForm initialValues={initialValues} />
    </div>
  );
}
