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
          },
          {
            id: 'channel-owner',
            channelKey: 'owner_group',
            channelName: '老板群',
            isActive: true,
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
});
