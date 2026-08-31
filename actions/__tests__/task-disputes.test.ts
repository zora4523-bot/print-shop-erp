import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ProductionTaskDisputeStatus, Role } from '@/generated/prisma/enums';

const { permissionMock, domainMock, revalidatePathMock, MockError } = vi.hoisted(
  () => ({
    permissionMock: vi.fn(),
    domainMock: {
      createTaskDispute: vi.fn(),
      reviewTaskDispute: vi.fn(),
    },
    revalidatePathMock: vi.fn(),
    MockError: class extends Error {},
  }),
);

vi.mock('@/lib/auth/permissions', () => ({
  requirePermission: permissionMock,
}));
vi.mock('@/lib/production/task-dispute', () => ({
  createTaskDispute: domainMock.createTaskDispute,
  reviewTaskDispute: domainMock.reviewTaskDispute,
  TaskDisputeError: MockError,
}));
vi.mock('next/cache', () => ({ revalidatePath: revalidatePathMock }));

import {
  createTaskDisputeAction,
  reviewTaskDisputeAction,
} from '../task-disputes';

function form(values: Record<string, string>) {
  const result = new FormData();
  for (const [key, value] of Object.entries(values)) result.set(key, value);
  return result;
}

beforeEach(() => {
  permissionMock.mockReset();
  domainMock.createTaskDispute.mockReset();
  domainMock.reviewTaskDispute.mockReset();
  revalidatePathMock.mockReset();
});

describe('createTaskDisputeAction', () => {
  it('authorizes first, validates, delegates and revalidates both views', async () => {
    const actor = { id: 'worker-1', role: Role.WORKER };
    permissionMock.mockResolvedValue(actor);
    domainMock.createTaskDispute.mockResolvedValue({
      disputeId: 'dispute-1',
      taskId: 'task-1',
      orderId: 'order-1',
    });

    const result = await createTaskDisputeAction(
      'task-1',
      null,
      form({ reason: '计件金额与实际报工不一致' }),
    );

    expect(permissionMock).toHaveBeenCalledWith('task:dispute:create');
    expect(domainMock.createTaskDispute).toHaveBeenCalledWith(
      { taskId: 'task-1', reason: '计件金额与实际报工不一致' },
      actor,
    );
    expect(result.status).toBe('success');
    expect(revalidatePathMock).toHaveBeenCalledWith('/worker/tasks/task-1');
    expect(revalidatePathMock).toHaveBeenCalledWith('/orders/order-1');
  });

  it('returns field errors without calling the domain', async () => {
    permissionMock.mockResolvedValue({ id: 'worker-1', role: Role.WORKER });
    const result = await createTaskDisputeAction(
      'task-1',
      null,
      form({ reason: '短' }),
    );
    expect(result.status).toBe('invalid');
    expect(domainMock.createTaskDispute).not.toHaveBeenCalled();
  });

  it('maps ownership/pending domain errors to a recoverable result', async () => {
    permissionMock.mockResolvedValue({ id: 'worker-1', role: Role.WORKER });
    domainMock.createTaskDispute.mockRejectedValue(
      new MockError('该任务已有待处理异议'),
    );
    await expect(
      createTaskDisputeAction(
        'task-1',
        null,
        form({ reason: '再次提交同一任务的异议' }),
      ),
    ).resolves.toEqual({
      status: 'error',
      message: '该任务已有待处理异议',
    });
  });
});

describe('reviewTaskDisputeAction', () => {
  it('records an administrator decision and refreshes worker/admin surfaces', async () => {
    const actor = { id: 'admin-1', role: Role.ADMIN };
    permissionMock.mockResolvedValue(actor);
    domainMock.reviewTaskDispute.mockResolvedValue({
      disputeId: 'dispute-1',
      taskId: 'task-1',
      orderId: 'order-1',
      status: ProductionTaskDisputeStatus.RESOLVED,
    });

    const result = await reviewTaskDisputeAction(
      'dispute-1',
      null,
      form({
        decision: 'RESOLVED',
        resolution: '已核对，后续走工资调整流程',
      }),
    );

    expect(permissionMock).toHaveBeenCalledWith('task:dispute:review');
    expect(domainMock.reviewTaskDispute).toHaveBeenCalledWith(
      {
        disputeId: 'dispute-1',
        decision: 'RESOLVED',
        resolution: '已核对，后续走工资调整流程',
      },
      actor,
    );
    expect(result).toEqual(
      expect.objectContaining({ status: 'success', message: '已确认处理该异议' }),
    );
    expect(revalidatePathMock).toHaveBeenCalledWith('/orders/order-1');
    expect(revalidatePathMock).toHaveBeenCalledWith('/worker/tasks/task-1');
  });
});
