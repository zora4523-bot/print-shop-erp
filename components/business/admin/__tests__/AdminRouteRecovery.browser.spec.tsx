import '@/app/globals.css';
import { flushSync } from 'react-dom';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { commands, page, userEvent } from 'vitest/browser';

vi.mock('next/link', () => ({ __esModule: true, default: ({ prefetch, ...props }: import('react').ComponentProps<'a'> & { prefetch?: boolean }) => {
  void prefetch;
  return <a {...props} />;
} }));
vi.mock('@/components/ui-business', () => import('@/components/ui-business/ErrorState'));
import { AdminRouteError } from '../AdminRouteError';

let host: HTMLDivElement;
let root: Root;
const retry = vi.fn();
beforeEach(() => {
  retry.mockReset();
  host = document.createElement('div');
  host.dataset.testid = 'route-recovery';
  host.className = 'admin-viewport bg-background p-4 text-foreground';
  document.body.append(host);
  root = createRoot(host);
});
afterEach(() => { flushSync(() => root.unmount()); host.remove(); document.documentElement.classList.remove('dark'); });

it('keeps ordinary Next retry reachable by keyboard and also offers reload', async () => {
  flushSync(() => root.render(<AdminRouteError error={new Error('private server details')} retry={retry} />));
  await page.getByRole('button', { name: '重试当前页面', exact: true }).click();
  await userEvent.keyboard('{Enter}');
  expect(retry).toHaveBeenCalledTimes(2);
  await expect.element(page.getByRole('button', { name: '重新加载页面', exact: true })).toBeVisible();
  expect(host.textContent).not.toContain('private server details');
});

for (const [width, height] of [[375, 667], [393, 852], [768, 1024], [1024, 768], [1280, 800], [1920, 1080]]) {
  for (const theme of ['light', 'dark']) {
    it(`${width}×${height} ${theme}: chunk recovery fits and passes axe`, async () => {
      await page.viewport(width, height);
      document.documentElement.classList.toggle('dark', theme === 'dark');
      flushSync(() => root.render(<AdminRouteError error={Object.assign(new Error('private URL'), { name: 'ChunkLoadError' })} retry={retry} />));
      await expect.element(page.getByRole('button', { name: '重新加载页面', exact: true })).toBeVisible();
      expect(retry).not.toHaveBeenCalled();
      expect(document.documentElement.scrollWidth).toBeLessThanOrEqual(width);
      for (const control of host.querySelectorAll('button, a')) {
        const rect = control.getBoundingClientRect();
        expect(rect.left).toBeGreaterThanOrEqual(0);
        expect(rect.right).toBeLessThanOrEqual(width);
        expect(rect.height).toBeGreaterThanOrEqual(44);
      }
      expect(await commands.checkShellAccessibility('[data-testid="route-recovery"]')).toEqual([]);
    });
  }
}
