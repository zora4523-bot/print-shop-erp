import type { ComponentProps } from 'react';
import { flushSync } from 'react-dom';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { commands, page, userEvent } from 'vitest/browser';
import '@/app/globals.css';

vi.mock('next/link', () => ({
  __esModule: true,
  default: ({ prefetch: _prefetch, ...props }: ComponentProps<'a'> & { prefetch?: boolean }) => {
    void _prefetch;
    return <a {...props} />;
  },
  useLinkStatus: () => ({ pending: false }),
}));

import { ChannelForm } from '../ChannelForm';
import { LegacyNotificationChannels } from '../LegacyNotificationChannels';

let host: HTMLDivElement;
let root: Root;
const action = vi.fn(async () => ({ status: 'success' as const }));
const legacy = [{ id: 'legacy', channelName: 'x'.repeat(64), isActive: true, referencingConfigurationCount: 2 }];

beforeEach(() => {
  action.mockClear();
  host = document.createElement('div');
  host.dataset.testid = 'notification-config-fixture';
  document.body.append(host);
  root = createRoot(host);
  document.documentElement.lang = 'zh-CN';
});

afterEach(() => {
  flushSync(() => root.unmount());
  host.remove();
  document.documentElement.classList.remove('dark');
});

function renderConfiguration(open = true) {
  flushSync(() => root.render(
    <main className="admin-viewport mx-auto max-w-3xl space-y-6 p-4">
      <h1>新建通知目标</h1>
      <ChannelForm mode="create" action={action} />
      <LegacyNotificationChannels channels={legacy} open={open} />
    </main>,
  ));
}

for (const theme of ['light', 'dark']) {
  for (const [width, height] of [[375, 667], [393, 852], [768, 1024], [1024, 768], [1280, 800], [1920, 1080]]) {
    it(`${theme} ${width}×${height}: smart-only configuration, readonly history, accessible layout`, async () => {
      await page.viewport(width!, height!);
      document.documentElement.classList.toggle('dark', theme === 'dark');
      renderConfiguration();
      await expect.element(page.getByRole('textbox', { name: '传输方式' })).toHaveValue('Bot ID + Secret 智能机器人');
      expect(host.querySelector('select, [name="webhookUrl"], [name="secret"], [name="botId"]')).toBeNull();
      await expect.element(page.getByRole('checkbox', { name: /^启用/ })).toBeDisabled();
      const history = host.querySelector('[data-slot="legacy-notification-channels"]')!;
      expect(history.querySelector('form, input, button')).toBeNull();
      expect([...history.querySelectorAll('a')].map(a => a.getAttribute('href'))).toEqual(['/owner/notifications/channels/new']);
      expect(document.documentElement.scrollWidth).toBeLessThanOrEqual(width!);
      for (const control of host.querySelectorAll('input:not([type="hidden"]):not([aria-hidden="true"]), button, a, summary')) {
        const rect = control.getBoundingClientRect();
        if (!rect.width || !rect.height) continue;
        expect(rect.height).toBeGreaterThanOrEqual(44);
        expect(rect.width).toBeGreaterThanOrEqual(44);
      }
      expect(await commands.checkShellAccessibility('[data-testid="notification-config-fixture"]')).toEqual([]);
    });
  }
}

it('submits only smart-bot metadata and lets the keyboard expand read-only history', async () => {
  renderConfiguration(false);
  const summary = host.querySelector('summary')!;
  summary.focus();
  await userEvent.keyboard('{Enter}');
  expect(host.querySelector('details')?.open).toBe(true);
  await page.getByRole('textbox', { name: '通知目标标识（创建后不可修改）' }).fill('new_smart');
  await page.getByRole('textbox', { name: '通知目标名称（用于后台展示）' }).fill('测试群');
  await page.getByRole('button', { name: '创建通知目标', exact: true }).click();
  await vi.waitFor(() => expect(action).toHaveBeenCalledOnce());
  // React invokes the action with previous state and browser-created FormData.
  const data = (action.mock.calls[0] as unknown as [unknown, FormData])[1];
  expect(Object.fromEntries(data)).toEqual({ channelKey: 'new_smart', channelName: '测试群', transport: 'WECOM_SMART_BOT' });
});
