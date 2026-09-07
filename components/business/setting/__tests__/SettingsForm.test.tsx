import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';

vi.mock('react', async (importOriginal) => {
  const actual = await importOriginal<typeof import('react')>();
  return {
    ...actual,
    useActionState: () => [null, vi.fn(), false],
  };
});
vi.mock('@/actions/owner-settings', () => ({
  updateSettingsAction: vi.fn(),
}));

import { SettingsForm } from '../SettingsForm';
import {
  SETTING_DEFINITIONS,
  SETTING_KEYS,
  formatSettingForInput,
  type SettingKey,
} from '@/lib/settings/definitions';

function initialValues(): Record<SettingKey, string> {
  return Object.fromEntries(
    SETTING_KEYS.map((key) => [
      key,
      formatSettingForInput(key, SETTING_DEFINITIONS[key].fallback as never),
    ]),
  ) as Record<SettingKey, string>;
}

describe('SettingsForm management notification routing', () => {
  it('两个角色只提交开关与真实 channel ID', () => {
    const values = initialValues();
    values.management_notification_routing = JSON.stringify({
      factoryConfirmer: { enabled: true, channelIds: ['channel-factory'] },
      owner: { enabled: false, channelIds: [] },
    });
    const html = renderToStaticMarkup(
      <SettingsForm
        initialValues={values}
        notificationChannels={[
          {
            id: 'channel-factory',
            channelKey: 'factory_group',
            channelName: '工厂确认群',
            isActive: true,
            selectionIssue: null,
          },
          {
            id: 'channel-owner',
            channelKey: 'owner_group',
            channelName: '老板群',
            isActive: true,
            selectionIssue: null,
          },
        ]}
      />,
    );

    expect(html).toContain('工厂确认人');
    expect(html).toContain('老板');
    expect(html).toContain(
      'name="management_notification_routing.factoryConfirmer.enabled"',
    );
    expect(html).toContain(
      'name="management_notification_routing.owner.enabled"',
    );
    expect(html).toContain(
      'name="management_notification_routing.factoryConfirmer.channelIds"',
    );
    expect(html).toContain('value="channel-factory"');
    expect(html).not.toContain('name="management_notification_routing.role"');
  });

  it('不可用目标在原角色中可保留，在其他角色中禁止新绑并显示原因', () => {
    const values = initialValues();
    values.management_notification_routing = JSON.stringify({
      factoryConfirmer: { enabled: true, channelIds: ['smart-old'] },
      owner: { enabled: false, channelIds: [] },
    });
    const html = renderToStaticMarkup(
      <SettingsForm
        initialValues={values}
        notificationChannels={[
          {
            id: 'smart-old',
            channelKey: 'smart_old',
            channelName: '旧机器人群',
            isActive: true,
            selectionIssue: 'SMART_BOT_IDENTITY_MISMATCH',
          },
        ]}
      />,
    );

    expect(html).toContain('绑定时 Bot ID 与当前配置不一致，不可新绑');
    const inputs = html.match(/<input[^>]*value="smart-old"[^>]*>/g) ?? [];
    expect(inputs).toHaveLength(2);
    expect(
      inputs.some(
        (input) => input.includes('checked=""') && !input.includes('disabled=""'),
      ),
    ).toBe(true);
    expect(inputs.some((input) => input.includes('disabled=""'))).toBe(true);
  });
});
