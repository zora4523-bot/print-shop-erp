import { describe, it, expect, vi, beforeEach } from 'vitest';
import { UnauthorizedError } from '../../lib/auth/errors';
import { SETTING_KEYS } from '../../lib/settings/definitions';

const { permissionsMock, settingsMock, revalidatePathMock, MockValidationError } =
  vi.hoisted(() => ({
    permissionsMock: { requirePermission: vi.fn() },
    settingsMock: { updateSettings: vi.fn() },
    revalidatePathMock: vi.fn(),
    MockValidationError: class extends Error {
      readonly key: string;
      constructor(key: string, message: string) {
        super(message);
        this.name = 'SettingValidationError';
        this.key = key;
      }
    },
  }));

vi.mock('@/lib/auth/permissions', () => ({
  requirePermission: permissionsMock.requirePermission,
}));
vi.mock('next/cache', () => ({ revalidatePath: revalidatePathMock }));
vi.mock('@/lib/settings', async () => {
  // definitions 是纯模块，照原样透出；只把落库那一步换成 mock
  const definitions = await import('../../lib/settings/definitions');
  return {
    ...definitions,
    updateSettings: settingsMock.updateSettings,
    SettingValidationError: MockValidationError,
  };
});

import { updateSettingsAction } from '../owner-settings';

const ACTOR = {
  id: 'u1',
  role: 'ADMIN',
  username: 'admin',
  displayName: '业主',
};

function formWith(overrides: Record<string, string> = {}): FormData {
  const fd = new FormData();
  const valid: Record<string, string> = {
    factory_name: '佛山红包印刷厂',
    cdr_link_expire_hours: '24',
    outsource_overdue_days: '1',
    report_qty_max_multiple: '3',
    worker_self_claim_enabled: 'false',
  };
  for (const key of SETTING_KEYS) {
    const value = overrides[key] ?? valid[key];
    // 新增 SETTING_KEY 却忘了给 fixture 值时，要在这里当场炸掉而不是
    // 少发一个字段。updateSettingsAction 把缺字段一律当成「表单被改过」
    // 报 invalid，静默跳过会让本文件里**每一条**用例都变成在测缺字段路径，
    // 而报错信息只会说「表单字段缺失」，一眼看不出是 fixture 漏了。
    if (value === undefined) {
      throw new Error(`formWith 缺少 ${key} 的合法值，请在 valid 里补上`);
    }
    fd.set(key, value);
  }
  return fd;
}

beforeEach(() => {
  permissionsMock.requirePermission.mockReset().mockResolvedValue(ACTOR);
  settingsMock.updateSettings.mockReset().mockResolvedValue(undefined);
  revalidatePathMock.mockReset();
});

describe('updateSettingsAction', () => {
  it('权限检查是第一行，没权限时不落库', async () => {
    permissionsMock.requirePermission.mockRejectedValue(new UnauthorizedError());
    await expect(updateSettingsAction(null, formWith())).rejects.toBeInstanceOf(
      UnauthorizedError,
    );
    expect(settingsMock.updateSettings).not.toHaveBeenCalled();
  });

  it('合法输入 → 解析后交给 lib，并带上 actor 供审计', async () => {
    const result = await updateSettingsAction(null, formWith());
    expect(result.status).toBe('success');
    expect(settingsMock.updateSettings).toHaveBeenCalledWith(
      {
        factory_name: { name: '佛山红包印刷厂' },
        cdr_link_expire_hours: { hours: 24 },
        outsource_overdue_days: { days: 1 },
        report_qty_max_multiple: { multiple: 3 },
        worker_self_claim_enabled: { enabled: false },
      },
      ACTOR,
    );
  });

  it('单项非法 → invalid，且一项都不写', async () => {
    const result = await updateSettingsAction(
      null,
      formWith({ outsource_overdue_days: '999' }),
    );
    expect(result.status).toBe('invalid');
    if (result.status === 'invalid') {
      expect(result.fieldErrors.outsource_overdue_days?.[0]).toContain('30');
      // 厂名是合法的，但整份表单都不能落库——半截生效比不生效更难查
      expect(result.fieldErrors.factory_name).toBeUndefined();
    }
    expect(settingsMock.updateSettings).not.toHaveBeenCalled();
  });

  it('表单缺字段 → 报错，而不是拿默认值悄悄覆盖', async () => {
    // 少字段只可能是前端被改过或请求被截断。当成「用户没填」写入默认值，
    // 会静默改掉一项业主根本没碰过的配置。
    const fd = formWith();
    fd.delete('factory_name');

    const result = await updateSettingsAction(null, fd);
    expect(result.status).toBe('invalid');
    if (result.status === 'invalid') {
      expect(result.fieldErrors.factory_name?.[0]).toContain('刷新');
    }
    expect(settingsMock.updateSettings).not.toHaveBeenCalled();
  });

  it('lib 抛 SettingValidationError → 映射成对应字段的错误', async () => {
    settingsMock.updateSettings.mockRejectedValue(
      new MockValidationError('cdr_link_expire_hours', '有效期最多 168 小时'),
    );
    const result = await updateSettingsAction(null, formWith());
    expect(result).toEqual({
      status: 'invalid',
      fieldErrors: { cdr_link_expire_hours: ['有效期最多 168 小时'] },
    });
  });

  it('未知异常继续抛，不伪装成业务错误', async () => {
    settingsMock.updateSettings.mockRejectedValue(new Error('connection lost'));
    await expect(updateSettingsAction(null, formWith())).rejects.toThrow(
      'connection lost',
    );
  });
});
