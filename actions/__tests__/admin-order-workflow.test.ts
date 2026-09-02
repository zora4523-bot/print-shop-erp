import { beforeEach, describe, expect, it, vi } from 'vitest';
import { Role } from '@/generated/prisma/enums';

const mocks = vi.hoisted(() => ({
  requirePermission: vi.fn(),
  revalidatePath: vi.fn(),
  settle: vi.fn(),
  batch: vi.fn(),
}));

vi.mock('next/cache', () => ({ revalidatePath: mocks.revalidatePath }));
vi.mock('@/lib/auth/permissions', () => ({
  requirePermission: mocks.requirePermission,
}));
vi.mock('@/lib/order/admin-workflow', () => ({
  AdminOrderWorkflowError: class AdminOrderWorkflowError extends Error {
    code = 'INVALID_INPUT';
  },
  confirmFactoryOrder: vi.fn(),
  holdFactoryOrder: vi.fn(),
  rejectFactoryOrder: vi.fn(),
  releaseFactoryOrder: vi.fn(),
  resumeFactoryOrder: vi.fn(),
  settleFactoryOrder: mocks.settle,
}));
vi.mock('@/lib/order/admin-batch', () => ({
  ADMIN_ORDER_BATCH_COMMANDS: [
    'RELEASE',
    'CREATE_PRINT',
    'MARK_PRINTED',
    'SETTLE',
  ],
  runAdminOrderBatch: mocks.batch,
}));
vi.mock('@/lib/order/status-machine', () => ({
  InvalidOrderTransitionError: class InvalidOrderTransitionError extends Error {},
}));
vi.mock('@/lib/order/print-jobs', () => ({
  OrderPrintJobError: class OrderPrintJobError extends Error {
    code = 'INVALID_INPUT';
  },
}));
vi.mock('@/lib/production/operation-materialization-service', () => ({
  ProductionOperationMaterializationError:
    class ProductionOperationMaterializationError extends Error {
      code = 'INVALID_STATUS';
    },
}));

import {
  runAdminOrderBatchAction,
  settleFactoryOrderAction,
} from '../admin-order-workflow';

const actor = { id: 'admin-1', role: Role.ADMIN };

beforeEach(() => {
  vi.clearAllMocks();
  mocks.requirePermission.mockResolvedValue(actor);
  mocks.settle.mockResolvedValue({ orderId: 'order-1' });
  mocks.batch.mockResolvedValue({
    command: 'SETTLE',
    successCount: 1,
    skippedCount: 0,
    failedCount: 0,
    notAttemptedCount: 0,
    items: [{ orderId: 'order-1', status: 'success', code: 'OK' }],
  });
});

describe('admin order workflow cache invalidation', () => {
  it('revalidates the canonical agent bill route after one settlement', async () => {
    await expect(
      settleFactoryOrderAction({
        orderId: 'order-1',
        expectedRevision: 4,
        expectedWorkOrderVersion: 2,
      }),
    ).resolves.toEqual({ status: 'success', orderId: 'order-1' });

    expect(mocks.revalidatePath).toHaveBeenCalledWith('/owner/agent-bills');
    expect(mocks.revalidatePath).toHaveBeenCalledWith('/owner/bills');
  });

  it('revalidates the canonical agent bill route after batch settlement', async () => {
    await expect(
      runAdminOrderBatchAction({
        requestId: 'batch-settle-request',
        command: 'SETTLE',
        items: [
          {
            orderId: 'order-1',
            expectedRevision: 4,
            expectedWorkOrderVersion: 2,
          },
        ],
      }),
    ).resolves.toMatchObject({ status: 'success' });

    expect(mocks.revalidatePath).toHaveBeenCalledWith('/owner/agent-bills');
    expect(mocks.revalidatePath).toHaveBeenCalledWith('/owner/bills');
  });

  it('does not convert an unknown batch failure into a successful response', async () => {
    const databaseFailure = new Error('database unavailable');
    mocks.batch.mockRejectedValueOnce(databaseFailure);

    await expect(
      runAdminOrderBatchAction({
        requestId: 'batch-settle-unknown-error',
        command: 'SETTLE',
        items: [
          {
            orderId: 'order-1',
            expectedRevision: 4,
            expectedWorkOrderVersion: 2,
          },
        ],
      }),
    ).rejects.toBe(databaseFailure);
    expect(mocks.revalidatePath).not.toHaveBeenCalled();
  });

  it('returns structured partial progress and revalidates every affected surface', async () => {
    mocks.batch.mockResolvedValueOnce({
      command: 'SETTLE',
      successCount: 1,
      skippedCount: 0,
      failedCount: 1,
      notAttemptedCount: 1,
      items: [
        { orderId: 'order-1', status: 'success', code: 'OK' },
        {
          orderId: 'order-2',
          status: 'failed',
          code: 'UNEXPECTED_ERROR',
          message: '系统异常，该工单的处理结果未知；请刷新后核对',
        },
        {
          orderId: 'order-3',
          status: 'not_attempted',
          code: 'ABORTED_AFTER_FAILURE',
          message: '前序工单发生系统异常，本次未继续处理',
        },
      ],
    });

    await expect(
      runAdminOrderBatchAction({
        requestId: 'batch-settle-partial-error',
        command: 'SETTLE',
        items: [
          {
            orderId: 'order-1',
            expectedRevision: 4,
            expectedWorkOrderVersion: 2,
          },
        ],
      }),
    ).resolves.toMatchObject({
      status: 'partial_failure',
      result: { successCount: 1, failedCount: 1, notAttemptedCount: 1 },
    });

    expect(mocks.revalidatePath).toHaveBeenCalledWith('/orders');
    expect(mocks.revalidatePath).toHaveBeenCalledWith('/owner/agent-bills');
    expect(mocks.revalidatePath).toHaveBeenCalledWith('/owner/bills');
  });
});
