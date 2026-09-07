import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';

vi.mock('next/navigation', () => ({
  useRouter: () => ({ refresh: vi.fn() }),
}));
vi.mock('@/actions/owner-notifications', () => ({
  deleteChannelAction: vi.fn(),
  testChannelAction: vi.fn(),
}));

import { DeleteChannelButton } from '../DeleteChannelButton';
import { TestChannelButton } from '../TestChannelButton';

describe('notification disabled actions', () => {
  it('keeps the inactive-channel test reason and repair path visible', () => {
    const html = renderToStaticMarkup(
      <TestChannelButton
        channelId="channel-1"
        disabled
        disabledReason="该群已停用，请先启用"
      />,
    );

    expect(html).toContain('该群已停用，请先启用');
    expect(html).toContain('/owner/notifications/channels/channel-1');
    expect(html).toContain('去启用通知目标');
    expect(html).not.toContain('title="该群已停用');
  });

  it('keeps the referenced-channel delete reason and rule path visible', () => {
    const html = renderToStaticMarkup(
      <DeleteChannelButton
        channelId="channel-1"
        channelName="排产群"
        disabled
        disabledReason="被 2 条规则引用，先在规则里移除"
      />,
    );

    expect(html).toContain('被 2 条规则引用，先在规则里移除');
    expect(html).toContain('/owner/notifications#notification-rules');
    expect(html).toContain('去规则移除');
    expect(html).not.toContain('title="被 2 条');
  });

  it('uses shared confirmation and inline feedback instead of native browser dialogs', () => {
    const files = [
      'components/business/notification/UnknownNotificationActions.tsx',
      'components/business/notification/DeleteChannelButton.tsx',
      'components/business/notification/TestChannelButton.tsx',
    ];
    const sources = files.map((file) =>
      readFileSync(join(process.cwd(), file), 'utf8'),
    );

    for (const [index, source] of sources.entries()) {
      expect(source, files[index]).not.toMatch(
        /(?:window\.)?(?:alert|confirm)\s*\(/,
      );
      expect(source, files[index]).toContain('ActionNotice');
    }
    expect(sources[0]).toContain('ConfirmActionDialog');
    expect(sources[1]).toContain('ConfirmActionDialog');
    expect(sources[2]).toContain("result?.status === 'queued'");
    expect(sources[2]).toContain('测试消息已排队');
  });
});
