import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';

vi.mock('next/navigation', () => ({
  useRouter: () => ({ refresh: vi.fn() }),
}));

vi.mock('@/actions/owner-notifications', () => ({
  createSmartBotBindingCodeAction: vi.fn(),
}));

import { SmartBotBindingPanel } from '../SmartBotBindingPanel';

const componentSource = readFileSync(
  join(
    process.cwd(),
    'components/business/notification/SmartBotBindingPanel.tsx',
  ),
  'utf8',
);

describe('SmartBotBindingPanel', () => {
  it('explains the one-time group-binding flow without exposing credentials', () => {
    const html = renderToStaticMarkup(
      <SmartBotBindingPanel
        channelId="channel-1"
        isBound={false}
        targetMasked={null}
        boundAt={null}
      />,
    );

    expect(html).toContain('绑定企业微信群');
    expect(html).toContain('生成一次性绑定码');
    expect(html).toContain('@机器人');
    expect(html).toContain('尚未绑定');
    expect(html).not.toContain('Bot ID');
    expect(html).not.toContain('Secret');
    expect(html).not.toContain('chatid-raw-value');
  });

  it('renders only the masked destination for a bound group', () => {
    const html = renderToStaticMarkup(
      <SmartBotBindingPanel
        channelId="channel-1"
        isBound
        targetMasked="••••a1b2"
        boundAt="2026-09-03T00:00:00.000Z"
      />,
    );

    expect(html).toContain('已绑定企业微信群');
    expect(html).toContain('••••a1b2');
    expect(html).toContain('如需换群，请新建通知目标');
    expect(html).not.toContain('一次性绑定码');
    expect(html).not.toContain('chatid-raw-value');
  });

  it('guards plaintext with the unbound state and clears it before refresh', () => {
    expect(componentSource).toContain('{receipt && !isBound ? (');
    expect(componentSource).toContain('onClick={refreshBindingStatus}');

    const handlerStart = componentSource.indexOf(
      'function refreshBindingStatus()',
    );
    const handlerEnd = componentSource.indexOf('\n  }', handlerStart);
    const handler = componentSource.slice(handlerStart, handlerEnd);
    const clearReceiptAt = handler.indexOf('setReceipt(null)');
    const refreshAt = handler.indexOf('router.refresh()');

    expect(handlerStart).toBeGreaterThan(-1);
    expect(clearReceiptAt).toBeGreaterThan(-1);
    expect(refreshAt).toBeGreaterThan(clearReceiptAt);
  });
});
