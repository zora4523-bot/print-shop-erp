import { beforeEach, describe, expect, it, vi } from 'vitest';
import { OrderStatus, Role } from '../../../generated/prisma/enums';

const mocks = vi.hoisted(() => ({
  release: vi.fn(),
  settle: vi.fn(),
  createPrint: vi.fn(),
  markPrinted: vi.fn(),
}));

vi.mock('../admin-workflow', () => {
  class AdminOrderWorkflowError extends Error {
    constructor(public readonly code: string, message: string) {
      super(message);
    }
  }
  return {
    AdminOrderWorkflowError,
    releaseFactoryOrder: mocks.release,
    settleFactoryOrder: mocks.settle,
  };
});

vi.mock('../print-jobs', () => {
  class OrderPrintJobError extends Error {
    constructor(public readonly code: string, message: string) {
      super(message);
    }
  }
  return {
    OrderPrintJobError,
    createOrderPrintRequest: mocks.createPrint,
    markOrderPrintRequestPrinted: mocks.markPrinted,
  };
});

vi.mock('../../production/operation-materialization-service', () => {
  class ProductionOperationMaterializationError extends Error {
    constructor(public readonly code: string, message: string) {
      super(message);
    }
  }
  return { ProductionOperationMaterializationError };
});

import { AdminOrderWorkflowError } from '../admin-workflow';
import {
  ADMIN_ORDER_BATCH_COMMANDS,
  runAdminOrderBatch,
} from '../admin-batch';

const admin = { id: 'admin-1', role: Role.ADMIN };

function item(orderId: string) {
  return {
    orderId,
    expectedRevision: 4,
    expectedWorkOrderVersion: 2,
    requestJobId: `print-${orderId}`,
  };
}

describe('admin order batch whitelist', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.release.mockResolvedValue({ status: OrderStatus.RELEASED });
    mocks.settle.mockResolvedValue({ status: OrderStatus.SETTLED });
    mocks.createPrint.mockResolvedValue({ jobId: 'print-1' });
    mocks.markPrinted.mockResolvedValue({ receiptId: 'receipt-1' });
  });

  it('never exposes confirm or reject as batch commands', () => {
    expect(ADMIN_ORDER_BATCH_COMMANDS).toEqual([
      'RELEASE_AND_CREATE_PRINT',
      'CREATE_PRINT',
      'MARK_PRINTED',
      'SETTLE',
    ]);
  });

  it('runs each order independently and returns stable skip codes', async () => {
    mocks.release
      .mockResolvedValueOnce({ status: OrderStatus.RELEASED })
      .mockRejectedValueOnce(
        new AdminOrderWorkflowError(
          'INVALID_STATUS',
          '工单当前状态不允许下发',
        ),
      );

    const result = await runAdminOrderBatch(
      {
        requestId: 'batch-release-20260902',
        command: 'RELEASE_AND_CREATE_PRINT',
        items: [item('order-1'), item('order-2')],
      },
      admin,
    );

    expect(mocks.release).toHaveBeenCalledTimes(2);
    expect(result).toMatchObject({ successCount: 1, skippedCount: 1 });
    expect(result.items).toEqual([
      { orderId: 'order-1', status: 'success', code: 'OK' },
      {
        orderId: 'order-2',
        status: 'skipped',
        code: 'INVALID_STATUS',
        message: '工单当前状态不允许下发',
      },
    ]);
  });

  it('does not accept client amount or settlement time and delegates settlement preflight', async () => {
    const untrusted = {
      ...item('order-1'),
      settledFee: '0.01',
      settledAt: '1999-01-01T00:00:00.000Z',
    };
    await runAdminOrderBatch(
      {
        requestId: 'batch-settle-20260902',
        command: 'SETTLE',
        items: [untrusted],
      },
      admin,
    );

    expect(mocks.settle).toHaveBeenCalledWith(
      {
        orderId: 'order-1',
        expectedRevision: 4,
        expectedWorkOrderVersion: 2,
      },
      admin,
    );
  });

  it('skips mark-printed rows with no current request instead of aborting the batch', async () => {
    const result = await runAdminOrderBatch(
      {
        requestId: 'batch-print-20260902',
        command: 'MARK_PRINTED',
        items: [{ ...item('order-1'), requestJobId: undefined }],
      },
      admin,
    );
    expect(result.items[0]).toMatchObject({
      status: 'skipped',
      code: 'INVALID_INPUT',
    });
    expect(mocks.markPrinted).not.toHaveBeenCalled();
  });
});
