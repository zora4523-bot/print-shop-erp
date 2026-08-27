'use server';

import { requirePermission } from '@/lib/auth/permissions';
import { revalidatePaths } from '@/lib/admin/action-helpers';
import {
  SETTING_KEYS,
  SettingValidationError,
  parseSettingInput,
  updateSettings,
  type AllSettings,
} from '@/lib/settings';
import type { SettingsMutationResult } from './owner-settings.types';

export async function updateSettingsAction(
  _prev: SettingsMutationResult | null,
  formData: FormData,
): Promise<SettingsMutationResult> {
  const actor = await requirePermission('setting:manage');

  const fieldErrors: Record<string, string[]> = {};
  // 逐项解析：mapped type 在写入侧会把目标类型收敛成各项 value 类型的交集，
  // 这里用宽松容器收集、末尾一次断言（和 lib/settings/index.ts 的
  // getAllSettings 同样的取舍）。
  const values: Record<string, unknown> = {};

  for (const key of SETTING_KEYS) {
    const raw = formData.get(key);
    if (typeof raw !== 'string') {
      // 表单少字段只可能是前端被改过或请求被截断，不要当成「用户没填」
      // 而写入默认值——那会静默改掉一项业主没碰过的配置。
      fieldErrors[key] = ['表单字段缺失，请刷新后重试'];
      continue;
    }
    const parsed = parseSettingInput(key, raw);
    if (!parsed.ok) {
      fieldErrors[key] = [parsed.message];
      continue;
    }
    values[key] = parsed.value;
  }

  if (Object.keys(fieldErrors).length > 0) {
    return { status: 'invalid', fieldErrors };
  }

  try {
    await updateSettings(values as Partial<AllSettings>, actor);
  } catch (err) {
    if (err instanceof SettingValidationError) {
      return { status: 'invalid', fieldErrors: { [err.key]: [err.message] } };
    }
    throw err;
  }

  // 设置页自己要显示新值；/owner 是超期外协阈值的消费方，阈值改了看板
  // 必须跟着变。打印视图是每次请求现读的，不需要失效。
  revalidatePaths(['/owner/settings', '/owner', '/worker/tasks']);
  return { status: 'success', message: '设置已保存' };
}
