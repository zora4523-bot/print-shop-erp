import { renderToStaticMarkup } from 'react-dom/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ProductionTaskDisputeStatus } from '@/generated/prisma/enums';

const { refreshMock, actionState } = vi.hoisted(() => ({
  refreshMock: vi.fn(),
  actionState: { current: null as unknown, pending: false },
}));
// 注入 useActionState 结果：默认 null（首屏），单个用例里改成成功回执。
vi.mock('react', async (importOriginal) => {
  const actual = await importOriginal<typeof import('react')>();
  return {
    ...actual,
    useActionState: () => [actionState.current, vi.fn(), actionState.pending],
  };
});
vi.mock('next/navigation', () => ({
  useRouter: () => ({ refresh: refreshMock }),
}));
vi.mock('@/actions/task-disputes', () => ({
  createTaskDisputeAction: vi.fn(),
  reviewTaskDisputeAction: vi.fn(),
}));

import { TaskDisputePanel } from '../TaskDisputePanel';
import { TaskDisputeAdminPanel } from '../TaskDisputeAdminPanel';

const createdAt = new Date('2026-08-26T06:00:00.000Z');

beforeEach(() => {
  refreshMock.mockReset();
  actionState.current = null;
  actionState.pending = false;
});

describe('TaskDisputePanel', () => {
  it('offers an accessible create form when there is no pending record', () => {
    const html = renderToStaticMarkup(
      <TaskDisputePanel taskId="task-1" disputes={[]} />,
    );
    expect(html).toContain('任务 / 计件异议');
    expect(html).toContain('name="reason"');
    expect(html).toContain('minLength="5"');
    expect(html).toContain('提交异议');
  });

  it('shows history and suppresses a second create form while pending', () => {
    const html = renderToStaticMarkup(
      <TaskDisputePanel
        taskId="task-1"
        disputes={[
          {
            id: 'dispute-1',
            productionTaskId: 'task-1',
            status: ProductionTaskDisputeStatus.PENDING,
            reason: '计件数量与实际合格数不一致',
            resolution: null,
            resolvedAt: null,
            createdAt,
            updatedAt: createdAt,
            resolvedBy: null,
          },
        ]}
      />,
    );
    expect(html).toContain('待处理');
    // 异议状态徽章已从 shadcn Badge 迁到 StatusBadge + registry，
    // 除文案外一并锁住色档：待处理 = warning。
    expect(html).toContain('data-tone="warning"');
    expect(html).toContain('已有一条待处理异议');
    expect(html).not.toContain('name="reason"');
  });
});

describe('TaskDisputeAdminPanel', () => {
  const base = {
    id: 'dispute-1',
    status: ProductionTaskDisputeStatus.PENDING,
    reason: '计件数金额有异议',
    resolution: null,
    resolvedAt: null,
    createdAt,
    workerName: '张师傅',
    resolvedByName: null,
    task: {
      id: 'task-1',
      itemSequence: 1,
      itemName: '款式 A',
      craftName: '局部烫金',
      plannedQty: 1000,
      completedQty: 980,
      pieceworkAmount: '40.00',
    },
  };

  it('renders resolve and reject decisions only for pending disputes', () => {
    const html = renderToStaticMarkup(
      <TaskDisputeAdminPanel disputes={[base]} />,
    );
    expect(html).toContain('name="resolution"');
    expect(html).toContain('value="RESOLVED"');
    expect(html).toContain('value="REJECTED"');
    expect(html).toContain('¥ 40.00');
  });

  it('renders immutable handler history after resolution', () => {
    const html = renderToStaticMarkup(
      <TaskDisputeAdminPanel
        disputes={[
          {
            ...base,
            status: ProductionTaskDisputeStatus.RESOLVED,
            resolution: '已核对，后续按工资调整流程处理',
            resolvedAt: createdAt,
            resolvedByName: '管理员',
          },
        ]}
      />,
    );
    expect(html).toContain('已解决');
    // 正常终态用 success，与 registry 的 RESOLVED 一致。
    expect(html).toContain('data-tone="success"');
    expect(html).toContain('已核对，后续按工资调整流程处理');
    expect(html).not.toContain('name="resolution"');
  });

  it('keeps the success receipt visible after the dispute leaves PENDING', () => {
    // revalidate 之后 status 已是终态：表单字段收起，但 useActionState 的
    // 成功回执必须留在原位，否则「确认已解决」看起来像什么也没发生。
    actionState.current = {
      status: 'success',
      disputeId: 'dispute-1',
      taskId: 'task-1',
      orderId: 'order-1',
      message: '已确认处理该异议',
    };
    const html = renderToStaticMarkup(
      <TaskDisputeAdminPanel
        disputes={[
          {
            ...base,
            status: ProductionTaskDisputeStatus.RESOLVED,
            resolution: '已核对',
            resolvedAt: createdAt,
            resolvedByName: '管理员',
          },
        ]}
      />,
    );
    expect(html).toContain('data-slot="action-notice"');
    expect(html).toContain('已确认处理该异议');
    expect(html).toContain('role="status"');
    expect(html).not.toContain('name="resolution"');
    expect(html).toContain('已核对');
  });
});
