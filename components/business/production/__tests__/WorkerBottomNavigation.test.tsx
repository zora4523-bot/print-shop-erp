import { readFileSync } from 'node:fs';
import path from 'node:path';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';

vi.mock('next/navigation', () => ({
  usePathname: () => '/worker/tasks/task-1',
}));

import {
  WorkerBottomNavigation,
  workerNavItemIsCurrent,
} from '../WorkerBottomNavigation';

describe('WorkerBottomNavigation', () => {
  it('matches detail routes to their owning tab', () => {
    expect(workerNavItemIsCurrent('/worker/tasks/task-1', '/worker/tasks')).toBe(
      true,
    );
    expect(workerNavItemIsCurrent('/worker/reports/report-1', '/worker/tasks')).toBe(true);
    expect(workerNavItemIsCurrent('/worker/orders', '/worker/tasks')).toBe(
      false,
    );
  });

  it('renders exactly three thumb-reachable business tabs with current-page semantics', () => {
    const html = renderToStaticMarkup(<WorkerBottomNavigation />);

    expect(html.match(/href="\/worker\//g)).toHaveLength(3);
    expect(html).toContain('我的任务');
    expect(html).toContain('我的工单');
    expect(html).toContain('我的工资');
    const currentTab = html.match(/<a[^>]*aria-current="page"[^>]*>/)?.[0];
    expect(currentTab).toContain('href="/worker/tasks"');
    expect(currentTab).toContain('min-h-12');
    expect(html).not.toContain('>我的</a>');
  });

  it('keeps account actions outside the fixed business navigation', () => {
    const layoutSource = readFileSync(
      path.join(process.cwd(), 'app', '(worker)', 'worker', 'layout.tsx'),
      'utf8',
    );

    expect(layoutSource).toContain('<WorkerBottomNavigation />');
    expect(layoutSource).toContain('href="/worker/account"');
    expect(layoutSource).not.toContain('grid-cols-4');
  });
});
