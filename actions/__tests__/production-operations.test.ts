import { beforeEach, describe, expect, it, vi } from 'vitest';
import { Role } from '../../generated/prisma/enums';

const {
  requirePermissionMock,
  reportMock,
  progressReportMock,
  claimMock,
  revalidatePathMock,
} = vi.hoisted(
  () => ({
    requirePermissionMock: vi.fn(),
    reportMock: vi.fn(),
    progressReportMock: vi.fn(),
    claimMock: vi.fn(),
    revalidatePathMock: vi.fn(),
  }),
);

vi.mock('@/lib/auth/permissions', () => ({
  requirePermission: requirePermissionMock,
}));
vi.mock('@/lib/production/operation-reporting', () => ({
  OperationReportingError: class OperationReportingError extends Error {},
  reportProductionOperation: reportMock,
}));
vi.mock('@/lib/production/progress-reporting', () => ({
  ProgressReportingError: class ProgressReportingError extends Error {
    constructor(
      public readonly code: string,
      message: string,
    ) {
      super(message);
    }
  },
  reportProductionProgress: progressReportMock,
}));
vi.mock('@/lib/production/work-order-progress', () => ({
  WorkOrderProgressError: class WorkOrderProgressError extends Error {},
  claimProductionOperationFromScan: claimMock,
}));
vi.mock('next/cache', () => ({ revalidatePath: revalidatePathMock }));

import {
  claimProductionOperationAction,
  reportProductionOperationAction,
  reportProductionProgressAction,
} from '../production-operations';
import { ProgressReportingError } from '@/lib/production/progress-reporting';

function formData() {
  const data = new FormData();
  data.set('expectedRateKey', 'book:unified');
  data.set('expectedPayrollRevision', '0');
  data.set('completedQty', '100');
  data.set('defectQty', '2');
  data.set('reworkQty', '1');
  data.set('workOrderProgressQuantity', '80');
  data.set('idempotencyKey', 'scan-request-0001');
  // An injected reporter must be ignored even if a future form adds one.
  data.set('workerId', 'attacker-selected-worker');
  return data;
}

beforeEach(() => {
  requirePermissionMock.mockReset().mockResolvedValue({
    id: 'session-worker',
    role: Role.WORKER,
  });
  reportMock.mockReset().mockResolvedValue({
    reportId: 'report-1',
    operationId: 'operation-1',
    orderId: 'order-1',
    amount: '1.50',
    idempotentReplay: false,
  });
  progressReportMock.mockReset().mockResolvedValue({
    reportId: 'progress-report-1',
    progressStepId: 'progress-1',
    orderId: 'order-1',
    idempotentReplay: false,
  });
  claimMock.mockReset().mockResolvedValue({
    claimId: 'claim-1',
    claimedAt: new Date('2026-09-02T08:00:00.000Z'),
    idempotentReplay: false,
  });
  revalidatePathMock.mockReset();
});

describe('reportProductionProgressAction', () => {
  it('用 task:report 会话账号提交无计件进度并刷新必要页面', async () => {
    await expect(
      reportProductionProgressAction('progress-1', null, formData()),
    ).resolves.toEqual({
      status: 'success',
      reportId: 'progress-report-1',
      progressStepId: 'progress-1',
      orderId: 'order-1',
      idempotentReplay: false,
    });
    expect(requirePermissionMock).toHaveBeenCalledWith('task:report');
    expect(progressReportMock).toHaveBeenCalledWith(
      {
        progressStepId: 'progress-1',
        completedQty: 100,
        defectQty: 2,
        reworkQty: 1,
        idempotencyKey: 'scan-request-0001',
      },
      { id: 'session-worker', role: Role.WORKER },
    );
    expect(JSON.stringify(progressReportMock.mock.calls[0])).not.toContain(
      'attacker-selected-worker',
    );
    expect(revalidatePathMock).toHaveBeenCalledWith('/worker/tasks');
    expect(revalidatePathMock).toHaveBeenCalledWith(
      '/worker/tasks/progress-1',
    );
    expect(revalidatePathMock).toHaveBeenCalledWith('/worker/orders');
    expect(revalidatePathMock).toHaveBeenCalledWith('/worker/orders/order-1');
    expect(revalidatePathMock).toHaveBeenCalledWith('/orders/order-1');
  });

  it('要求独立的工单件数进度', async () => {
    const data = formData();
    data.delete('workOrderProgressQuantity');
    await expect(
      reportProductionOperationAction('operation-1', null, data),
    ).resolves.toEqual({
      status: 'invalid',
      message: '报工数量或请求标识不合法',
    });
    expect(reportMock).not.toHaveBeenCalled();
  });

  it('权限拒绝时不解析也不写入进度', async () => {
    requirePermissionMock.mockRejectedValue(new Error('unauthorized'));
    await expect(
      reportProductionProgressAction('progress-1', null, formData()),
    ).rejects.toThrow('unauthorized');
    expect(progressReportMock).not.toHaveBeenCalled();
  });

  it('把预期的数量与幂等冲突转成可读表单错误', async () => {
    progressReportMock.mockRejectedValue(
      new ProgressReportingError('OVER_REPORT', '合格完成数超过剩余数量'),
    );

    await expect(
      reportProductionProgressAction('progress-1', null, formData()),
    ).resolves.toEqual({
      status: 'error',
      message: '合格完成数超过剩余数量',
    });
  });

  it('拒绝非整数进度数量且不调用服务', async () => {
    const data = formData();
    data.set('completedQty', '1.5');

    await expect(
      reportProductionProgressAction('progress-1', null, data),
    ).resolves.toEqual({
      status: 'invalid',
      message: '报工数量或请求标识不合法',
    });
    expect(progressReportMock).not.toHaveBeenCalled();
  });
});

describe('claimProductionOperationAction', () => {
  it('只使用会话工人写入显式扫码认领', async () => {
    await expect(
      claimProductionOperationAction('operation-1', null, formData()),
    ).resolves.toEqual({
      status: 'success',
      claimId: 'claim-1',
      claimedAt: '2026-09-02T08:00:00.000Z',
      idempotentReplay: false,
    });
    expect(requirePermissionMock).toHaveBeenCalledWith('task:report');
    expect(claimMock).toHaveBeenCalledWith(
      {
        operationId: 'operation-1',
        idempotencyKey: 'scan-request-0001',
      },
      { id: 'session-worker', role: Role.WORKER },
    );
  });
});

describe('reportProductionOperationAction', () => {
  it('checks task:report first and passes only the session reporter', async () => {
    await expect(
      reportProductionOperationAction('operation-1', null, formData()),
    ).resolves.toMatchObject({ status: 'success', reportId: 'report-1' });
    expect(requirePermissionMock).toHaveBeenCalledWith('task:report');
    expect(reportMock).toHaveBeenCalledWith(
      {
        operationId: 'operation-1',
        expectedPayrollRevision: 0,
        expectedRateKey: 'book:unified',
        completedQty: 100,
        defectQty: 2,
        reworkQty: 1,
        workOrderProgressQuantity: 80,
        idempotencyKey: 'scan-request-0001',
      },
      { id: 'session-worker', role: Role.WORKER },
    );
    expect(JSON.stringify(reportMock.mock.calls[0])).not.toContain(
      'attacker-selected-worker',
    );
  });

  it('does not parse or mutate when permission is denied', async () => {
    requirePermissionMock.mockRejectedValue(new Error('unauthorized'));
    await expect(
      reportProductionOperationAction('operation-1', null, formData()),
    ).rejects.toThrow('unauthorized');
    expect(reportMock).not.toHaveBeenCalled();
  });
});
