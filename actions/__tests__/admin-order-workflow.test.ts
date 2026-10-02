import { beforeEach, describe, expect, it, vi } from 'vitest';
import { Role } from '@/generated/prisma/enums';

const mocks = vi.hoisted(() => ({
  requirePermission: vi.fn(),
  revalidatePath: vi.fn(),
  confirm: vi.fn(),
  settle: vi.fn(),
  release: vi.fn(),
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
  confirmFactoryOrder: mocks.confirm,
  holdFactoryOrder: vi.fn(),
  rejectFactoryOrder: vi.fn(),
  releaseFactoryOrder: mocks.release,
  resumeFactoryOrder: vi.fn(),
  settleFactoryOrder: mocks.settle,
}));
vi.mock('@/lib/order/admin-batch', () => ({
  ADMIN_ORDER_BATCH_COMMANDS: [
    'RELEASE',
    'CREATE_PRINT',
    'MARK_PRINTED',
    'COMPLETE_PRODUCTION',
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
  confirmFactoryOrderAction,
  releaseFactoryOrderAction,
  runAdminOrderBatchAction,
  settleFactoryOrderAction,
} from '../admin-order-workflow';

const actor = { id: 'admin-1', role: Role.ADMIN };

beforeEach(() => {
  vi.clearAllMocks();
  mocks.requirePermission.mockResolvedValue(actor);
  mocks.confirm.mockResolvedValue({ orderId: 'order-1' });
  mocks.release.mockResolvedValue({ orderId: 'order-1' });
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
  it('工厂确认要求合法的当前价预览凭证并原样传入领域命令', async () => {
    const expectedQuoteToken = `create-order-quote-v2:${'a'.repeat(64)}`;

    await expect(
      confirmFactoryOrderAction({
        orderId: 'order-1',
        expectedRevision: 4,
        expectedWorkOrderVersion: 2,
        expectedQuoteToken,
      }),
    ).resolves.toEqual({ status: 'success', orderId: 'order-1' });

    expect(mocks.confirm).toHaveBeenCalledWith(
      {
        orderId: 'order-1',
        expectedRevision: 4,
        expectedWorkOrderVersion: 2,
        expectedQuoteToken,
      },
      actor,
    );
  });

  it('工厂确认缺少或伪造当前价凭证时不进入领域写流程', async () => {
    for (const expectedQuoteToken of [
      undefined,
      'create-order-quote-v2:forged',
    ]) {
      vi.clearAllMocks();
      mocks.requirePermission.mockResolvedValue(actor);

      await expect(
        confirmFactoryOrderAction({
          orderId: 'order-1',
          expectedRevision: 4,
          expectedWorkOrderVersion: 2,
          expectedQuoteToken,
        }),
      ).resolves.toMatchObject({ status: 'invalid' });
      expect(mocks.confirm).not.toHaveBeenCalled();
    }
  });

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

it('validates and forwards independent release without enabling print creation', async () => {
  const input = { orderId: 'order-1', expectedRevision: 4, expectedWorkOrderVersion: 2,
    printIdempotencyKey: 'release-only-order-1-v2', createPrint: false };
  await expect(releaseFactoryOrderAction(input)).resolves.toMatchObject({ status: 'success' });
  expect(mocks.release).toHaveBeenCalledWith(input, actor);
  await expect(releaseFactoryOrderAction({ ...input, createPrint: 'false' })).resolves.toMatchObject({ status: 'invalid' });
  expect(mocks.release).toHaveBeenCalledTimes(1);
});

const completeInput = { requestId: 'complete-production-request', command: 'COMPLETE_PRODUCTION', items: [{ orderId: 'order-1', expectedRevision: 4, expectedWorkOrderVersion: 2 }] };
it('requires production permission before invoking batch completion', async () => {
  const denied = new Error('Forbidden');
  mocks.requirePermission.mockResolvedValueOnce(actor).mockRejectedValueOnce(denied);
  await expect(runAdminOrderBatchAction(completeInput)).rejects.toBe(denied);
  expect(mocks.requirePermission.mock.calls).toEqual([['order:change:review'], ['production:manage']]);
  expect(mocks.batch).not.toHaveBeenCalled();
  expect(mocks.revalidatePath).not.toHaveBeenCalled();
});
it('refreshes production and wage surfaces and only successful order details', async () => {
  mocks.batch.mockResolvedValueOnce({ command: 'COMPLETE_PRODUCTION', successCount: 1, skippedCount: 1, failedCount: 1, notAttemptedCount: 0,
    items: [{ orderId: 'order-1', status: 'success' }, { orderId: 'order-2', status: 'skipped' }, { orderId: 'order-3', status: 'failed' }] });
  await expect(runAdminOrderBatchAction(completeInput)).resolves.toMatchObject({ status: 'partial_failure' });
  expect(mocks.requirePermission.mock.calls).toEqual([['order:change:review'], ['production:manage']]);
  expect(mocks.batch).toHaveBeenCalledWith(completeInput, actor);
  expect(mocks.revalidatePath.mock.calls.map(([path]) => path).sort()).toEqual(['/orders', '/orders/production', '/worker/tasks', '/worker/orders', '/worker/salary', '/owner/salary/piecework', '/orders/order-1'].sort());
});
