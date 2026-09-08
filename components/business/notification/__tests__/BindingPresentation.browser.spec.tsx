import { flushSync } from 'react-dom';
import { createRoot } from 'react-dom/client';
import { expect, it, vi } from 'vitest';
import { commands, page, userEvent } from 'vitest/browser';
import '@/app/globals.css';
vi.mock('next/link', () => ({default: ({children, ...props}: React.ComponentProps<'a'>) => <a {...props}>{children}</a>}));
vi.mock('next/navigation', () => ({useRouter: () => ({refresh: vi.fn()})}));
vi.mock('@/actions/owner-notifications', () => ({createSmartBotBindingCodeAction: vi.fn()}));
import { SmartBotBindingPanel } from '../SmartBotBindingPanel';

for (const [width,height] of [[360,800],[390,844],[768,1024],[1024,768],[1440,900],[1920,1080]]) {
  it(`binding instructions remain usable at ${width}x${height}`, async () => {
    await page.viewport(width,height);
    document.documentElement.lang='zh-CN';
    const host=document.createElement('main');host.className='p-4';document.body.append(host);
    const root=createRoot(host);
    try {
      flushSync(()=>root.render(<><h1>通知目标</h1><SmartBotBindingPanel channelId="example" isBound={false} targetMasked={null} boundAt={null} /></>));
      expect(host.textContent).not.toMatch(/Bot ID|Secret|环境变量|worker/);
      expect(host.textContent?.split('在目标企业微信群 @机器人并发送完整绑定码')).toHaveLength(2);
      expect(host.scrollWidth).toBeLessThanOrEqual(width);
      expect(await commands.checkShellAccessibility('main')).toEqual([]);
      await userEvent.keyboard('{Tab}');
      expect(document.activeElement?.tagName).toBe('BUTTON');
      flushSync(()=>root.render(<><h1>通知目标</h1><SmartBotBindingPanel channelId="example" isBound targetMasked="••••a1b2" boundAt="2026-09-03T00:00:00.000Z" /></>));
      expect(host.textContent).toContain('••••a1b2');
      expect(host.textContent).not.toContain('生成一次性绑定码');
      expect(host.scrollWidth).toBeLessThanOrEqual(width);
    } finally {flushSync(()=>root.unmount());host.remove();}
  });
}
