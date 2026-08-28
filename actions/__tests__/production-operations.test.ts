import { beforeEach, describe, expect, it, vi } from 'vitest';
import { Role } from '../../generated/prisma/enums';

const { requirePermissionMock, reportMock, revalidatePathMock } = vi.hoisted(
  () => ({
    requirePermissionMock: vi.fn(),
    reportMock: vi.fn(),
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
vi.mock('next/cache', () => ({ revalidatePath: revalidatePathMock }));

import { reportProductionOperationAction } from '../production-operations';

function formData() {
  const data = new FormData();
  data.set('completedQty', '100');
  data.set('defectQty', '2');
  data.set('reworkQty', '1');
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
  revalidatePathMock.mockReset();
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
        completedQty: 100,
        defectQty: 2,
        reworkQty: 1,
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
