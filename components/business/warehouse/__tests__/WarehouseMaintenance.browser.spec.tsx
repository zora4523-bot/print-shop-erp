import { flushSync } from 'react-dom';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { commands, page } from 'vitest/browser';
import '@/app/globals.css';

vi.mock('@/actions/owner-warehouses', () => ({ maintainWarehouseAction: vi.fn() }));
vi.mock('next/link', () => ({ __esModule: true, default: ({ children, ...props }: React.ComponentProps<'a'>) => <a {...props}>{children}</a> }));
import { WarehouseMaintenance } from '../WarehouseMaintenance';

let host: HTMLElement;
let root: Root;
beforeEach(() => {
  host = document.createElement('main'); host.className = 'bg-background p-4 text-foreground';
  document.body.append(host); root = createRoot(host);
});
afterEach(() => { flushSync(() => root.unmount()); host.remove(); document.documentElement.classList.remove('dark'); });
const props = { kind: 'location' as const, id: 'location', name: '单独停用库位', isActive: false, isDefault: false, updatedAt: '2026-09-28T00:00:00.000Z' };

it.each([[375, 667], [393, 852], [768, 1024], [1024, 768], [1280, 800], [1920, 1080]])('explains the parent prerequisite before permitting restoration at %ix%i', async (width, height) => {
  await page.viewport(width, height);
  flushSync(() => root.render(<WarehouseMaintenance {...props} parentActive={false} />));
  const restore = page.getByRole('button', { name: '恢复使用库位', exact: true });
  await expect.element(restore).toBeDisabled();
  await expect.element(restore).toHaveAccessibleDescription('请先恢复所属仓库，再恢复库位');
  for (const dark of [false, true]) {
    document.documentElement.classList.toggle('dark', dark);
    await vi.waitFor(() => expect(document.getAnimations().filter((animation) => animation.playState === 'running' || animation.pending)).toHaveLength(0));
    expect(await commands.checkShellAccessibility('main')).toEqual([]);
    expect(document.documentElement.scrollWidth).toBeLessThanOrEqual(window.innerWidth);
    const rect = host.querySelector('button[disabled]')!.getBoundingClientRect();
    expect(rect.width).toBeGreaterThanOrEqual(44); expect(rect.height).toBeGreaterThanOrEqual(44);
  }
  flushSync(() => root.render(<WarehouseMaintenance {...props} parentActive />));
  await expect.element(restore).toBeEnabled();
  await restore.click();
  await expect.element(page.getByRole('alertdialog')).toBeVisible();
});
