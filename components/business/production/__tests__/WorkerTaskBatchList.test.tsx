import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import {
  MachineType,
  TaskStatus,
  WorkerType,
} from '@/generated/prisma/enums';

vi.mock('next/navigation', () => ({
  useRouter: () => ({ refresh: vi.fn() }),
}));
vi.mock('@/actions/production', () => ({
  beginTasksAction: vi.fn(),
  reportTasksAction: vi.fn(),
}));

import { WorkerTaskBatchList } from '../WorkerTaskBatchList';

function task(
  id: string,
  status: TaskStatus,
  name: string,
  isUrgent = false,
) {
  return {
    id,
    status,
    workerType: WorkerType.MACHINE,
    machineType: MachineType.HAND_PRESS,
    plannedQty: 5000,
    item: {
      name,
      sequence: 1,
      isDoubleSided: false,
      isDoubleColor: false,
    },
    craft: { name: '模切' },
    order: {
      orderNo: `PS-${id}`,
      customName: null,
      isUrgent,
      submitterName: '销售 A',
    },
  };
}

describe('WorkerTaskBatchList groups', () => {
  it('renders in-progress before pending with independent counts', () => {
    const html = renderToStaticMarkup(
      <WorkerTaskBatchList
        tasks={[
          task('pending-1', TaskStatus.PENDING, '待开款式'),
          task('progress-1', TaskStatus.IN_PROGRESS, '在制款式'),
          task('progress-2', TaskStatus.IN_PROGRESS, '在制款式二'),
        ]}
      />,
    );

    const progressHeading = html.indexOf(
      'id="worker-task-group-IN_PROGRESS"',
    );
    const pendingHeading = html.indexOf('id="worker-task-group-PENDING"');
    expect(progressHeading).toBeGreaterThan(-1);
    expect(pendingHeading).toBeGreaterThan(progressHeading);
    expect(html).toContain('在制款式');
    expect(html).toContain('待开款式');
    expect(html).toMatch(/进行中<\/h2>[\s\S]*?>2<\/span>/);
    expect(html).toMatch(/待开始<\/h2>[\s\S]*?>1<\/span>/);
    expect(html).toMatch(
      /data-tone="info"[^>]*>[\s\S]*?进行中<\/span>/,
    );
    expect(html).toMatch(
      /data-tone="neutral"[^>]*>[\s\S]*?待开始<\/span>/,
    );
  });

  it('keeps an explicit empty group so the two-state queue stays legible', () => {
    const html = renderToStaticMarkup(
      <WorkerTaskBatchList
        tasks={[task('pending-1', TaskStatus.PENDING, '待开款式')]}
      />,
    );

    expect(html).toContain('暂无进行中任务');
  });

  it('renders urgency as warning rather than destructive red', () => {
    const html = renderToStaticMarkup(
      <WorkerTaskBatchList
        tasks={[task('urgent-1', TaskStatus.IN_PROGRESS, '急单款式', true)]}
      />,
    );

    expect(html).toMatch(/data-tone="warning"[^>]*>急单<\/span>/);
    expect(html).not.toMatch(/bg-destructive[^>]*>急单/);
  });
});
