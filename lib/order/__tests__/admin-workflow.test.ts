import Decimal from 'decimal.js';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  OrderBillingMode,
  OrderPricingStatus,
  OrderStatus,
  OrderWorkflowAction,
  OrderWorkflowReasonCode,
  Role,
} from '../../../generated/prisma/enums';

const { dbMock, tx, databaseClockNowMock, activateMock, createPrintMock, currentPriceMock } =
  vi.hoisted(() => {
    const transaction = {
      $executeRaw: vi.fn(),
      order: {
        findUnique: vi.fn(),
        findUniqueOrThrow: vi.fn(),
        update: vi.fn(),
      },
      orderWorkflowDecision: {
        findUnique: vi.fn(),
        findFirst: vi.fn(),
        create: vi.fn(),
      },
      orderPrintJob: {
        findUnique: vi.fn(),
      },
      orderLog: { create: vi.fn() },
    };
    return {
      tx: transaction,
      dbMock: {
        $transaction: vi.fn(
          async (callback: (client: typeof transaction) => unknown) =>
            callback(transaction),
        ),
      },
      databaseClockNowMock: vi.fn(),
      activateMock: vi.fn(),
      createPrintMock: vi.fn(),
      currentPriceMock: vi.fn(),
    };
  });

vi.mock('@/lib/db', () => ({ db: dbMock }));
vi.mock('@/lib/background-jobs/clock', () => ({
  databaseClockNow: databaseClockNowMock,
}));
vi.mock('@/lib/production/operation-materialization-service', () => ({
  activateProductionOperationsInTx: activateMock,
}));
vi.mock('@/lib/order/print-jobs', async () => {
  const actual = await vi.importActual<typeof import('../print-jobs')>(
    '../print-jobs',
  );
  return {
    ...actual,
    createOrderPrintRequestInTx: createPrintMock,
  };
});
vi.mock('@/lib/order/change-request', () => ({
  OrderChangeRequestError: class OrderChangeRequestError extends Error {},
  confirmOrderPricingAtCurrentPublishedVersionInTx: currentPriceMock,
}));

import {
  AdminOrderWorkflowError,
  confirmFactoryOrder,
  holdFactoryOrder,
  rejectFactoryOrder,
  releaseFactoryOrder,
  resumeFactoryOrder,
  settleFactoryOrder,
} from '../admin-workflow';

const admin = { id: 'admin-1', role: Role.ADMIN };
const sales = { id: 'sales-1', role: Role.SALES };
const settledAt = new Date('2026-09-02T03:04:05.000Z');

function order(overrides: Record<string, unknown> = {}) {
  return {
    id: 'order-1',
    orderNo: 'GD-260902-001',
    status: OrderStatus.PENDING_FACTORY,
    revision: 4,
    workOrderVersion: 2,
    pricingStatus: OrderPricingStatus.AUTO_CONFIRMED,
    quotedFeeCompleteness: 'COMPLETE',
    quotedFee: new Decimal('128.50'),
    confirmedFee: null,
    totalAmount: new Decimal('128.50'),
    billingMode: OrderBillingMode.CHARGE,
    items: [{ fig: 1, quantity: 1_000 }],
    _count: { changeRequests: 0 },
    ...overrides,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  tx.$executeRaw.mockResolvedValue(0);
  tx.order.findUnique.mockResolvedValue(order());
  tx.order.update.mockResolvedValue({ id: 'order-1' });
  tx.orderWorkflowDecision.findUnique.mockResolvedValue(null);
  tx.orderPrintJob.findUnique.mockResolvedValue(null);
  tx.orderWorkflowDecision.create.mockResolvedValue({ id: 'decision-1' });
  tx.orderLog.create.mockResolvedValue({ id: 'log-1' });
  databaseClockNowMock.mockResolvedValue(settledAt);
  activateMock.mockResolvedValue({
    orderId: 'order-1',
    orderStatus: OrderStatus.RELEASED,
  });
  createPrintMock.mockResolvedValue({
    jobId: 'print-1',
    idempotentReplay: false,
  });
  currentPriceMock.mockResolvedValue({
    confirmedFee: '128.50',
    pricingRevisionId: 'pricing-confirmed-1',
    versions: null,
  });
});

describe('admin order workflow', () => {
  it('rejects non-admin actors before opening a transaction', async () => {
    await expect(
      confirmFactoryOrder(
        {
          orderId: 'order-1',
          expectedRevision: 4,
          expectedWorkOrderVersion: 2,
        },
        sales,
      ),
    ).rejects.toMatchObject({ code: 'FORBIDDEN' });
    expect(dbMock.$transaction).not.toHaveBeenCalled();
  });

  it('confirms only a complete server-owned price and keeps settlement empty', async () => {
    await expect(
      confirmFactoryOrder(
        {
          orderId: 'order-1',
          expectedRevision: 4,
          expectedWorkOrderVersion: 2,
        },
        admin,
      ),
    ).resolves.toEqual({
      orderId: 'order-1',
      status: OrderStatus.CONFIRMED,
      confirmedFee: '128.50',
    });
    expect(tx.order.update).toHaveBeenCalledWith({
      where: { id: 'order-1' },
      data: {
        status: OrderStatus.CONFIRMED,
        confirmedFee: '128.50',
        revision: { increment: 1 },
      },
      select: { id: true },
    });
    expect(tx.order.update.mock.calls[0]?.[0].data).not.toHaveProperty(
      'settledFee',
    );
  });

  it('fails factory confirmation while a pricing or change review is pending', async () => {
    tx.order.findUnique.mockResolvedValueOnce(
      order({
        pricingStatus: OrderPricingStatus.PENDING_ADMIN_CONFIRMATION,
        _count: { changeRequests: 1 },
      }),
    );
    await expect(
      confirmFactoryOrder(
        {
          orderId: 'order-1',
          expectedRevision: 4,
          expectedWorkOrderVersion: 2,
        },
        admin,
      ),
    ).rejects.toBeInstanceOf(AdminOrderWorkflowError);
    expect(tx.order.update).not.toHaveBeenCalled();
  });

  it('records a typed immutable reject decision with affected figs', async () => {
    await expect(
      rejectFactoryOrder(
        {
          orderId: 'order-1',
          reasonCode: OrderWorkflowReasonCode.DESIGN_ERROR,
          reasonNote: '第 1 款图稿尺寸不符',
          affectedFigs: [1],
          idempotencyKey: 'reject-order-1-v4',
        },
        admin,
      ),
    ).resolves.toMatchObject({
      status: OrderStatus.REJECTED,
      idempotentReplay: false,
    });
    expect(tx.orderWorkflowDecision.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        action: OrderWorkflowAction.REJECT,
        fromStatus: OrderStatus.PENDING_FACTORY,
        toStatus: OrderStatus.REJECTED,
        affectedFigs: [1],
      }),
    });
  });

  it('rejects PRICE_PENDING as a reject reason while keeping it available to hold', async () => {
    await expect(
      rejectFactoryOrder(
        {
          orderId: 'order-1',
          reasonCode: OrderWorkflowReasonCode.PRICE_PENDING,
          reasonNote: '等待核价',
          affectedFigs: [],
          idempotencyKey: 'reject-price-pending',
        },
        admin,
      ),
    ).rejects.toMatchObject({ code: 'INVALID_INPUT' });
    expect(dbMock.$transaction).not.toHaveBeenCalled();
  });

  it('restores the exact pre-hold status only with recovery evidence', async () => {
    tx.order.findUnique.mockResolvedValueOnce(
      order({ status: OrderStatus.ON_HOLD }),
    );
    tx.orderWorkflowDecision.findFirst.mockResolvedValueOnce({
      fromStatus: OrderStatus.FOILING,
    });
    await expect(
      resumeFactoryOrder(
        {
          orderId: 'order-1',
          recoveryEvidence: { proof: '纸张已补齐并经仓库复核' },
          idempotencyKey: 'resume-order-1-v2',
        },
        admin,
      ),
    ).resolves.toMatchObject({ status: OrderStatus.FOILING });
    expect(tx.order.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ status: OrderStatus.FOILING }),
      }),
    );
  });

  it('releases production before creating the initial versioned print request', async () => {
    tx.order.findUnique.mockResolvedValueOnce(
      order({
        status: OrderStatus.CONFIRMED,
        confirmedFee: new Decimal('128.50'),
      }),
    );
    await releaseFactoryOrder(
      {
        orderId: 'order-1',
        expectedRevision: 4,
        expectedWorkOrderVersion: 2,
        printIdempotencyKey: 'release-print-order-1-v2',
      },
      admin,
    );
    expect(activateMock).toHaveBeenCalledWith(
      tx,
      'order-1',
      admin,
      undefined,
      { targetStatus: OrderStatus.RELEASED },
    );
    expect(createPrintMock).toHaveBeenCalledWith(
      tx,
      expect.objectContaining({
        orderId: 'order-1',
        workOrderVersion: 2,
      }),
      admin,
    );
    expect(activateMock.mock.invocationCallOrder[0]).toBeLessThan(
      createPrintMock.mock.invocationCallOrder[0]!,
    );
  });

  it('rejects a stale release request even when the order is already released', async () => {
    tx.order.findUnique.mockResolvedValueOnce(
      order({
        status: OrderStatus.RELEASED,
        revision: 5,
        workOrderVersion: 3,
        confirmedFee: new Decimal('128.50'),
      }),
    );
    await expect(
      releaseFactoryOrder(
        {
          orderId: 'order-1',
          expectedRevision: 4,
          expectedWorkOrderVersion: 2,
          printIdempotencyKey: 'release-print-stale-v2',
        },
        admin,
      ),
    ).rejects.toMatchObject({ code: 'STALE_VERSION' });
    expect(createPrintMock).not.toHaveBeenCalled();
  });

  it('rejects a new release effect while a change request is pending', async () => {
    tx.order.findUnique.mockResolvedValueOnce(
      order({
        status: OrderStatus.RELEASED,
        confirmedFee: new Decimal('128.50'),
        _count: { changeRequests: 1 },
      }),
    );
    await expect(
      releaseFactoryOrder(
        {
          orderId: 'order-1',
          expectedRevision: 4,
          expectedWorkOrderVersion: 2,
          printIdempotencyKey: 'release-print-new-effect',
        },
        admin,
      ),
    ).rejects.toMatchObject({ code: 'PREFLIGHT_FAILED' });
    expect(createPrintMock).not.toHaveBeenCalled();
  });

  it('allows only an exact release idempotency replay across a later pending change', async () => {
    tx.order.findUnique.mockResolvedValueOnce(
      order({
        status: OrderStatus.RELEASED,
        revision: 5,
        _count: { changeRequests: 1 },
      }),
    );
    tx.orderPrintJob.findUnique.mockResolvedValueOnce({
      id: 'print-1',
      orderId: 'order-1',
      workOrderVersion: 2,
      printKind: 'INITIAL',
      reason: '工单首次下发',
      state: 'PENDING',
      requestJobId: null,
    });
    await expect(
      releaseFactoryOrder(
        {
          orderId: 'order-1',
          expectedRevision: 4,
          expectedWorkOrderVersion: 2,
          printIdempotencyKey: 'release-print-order-1-v2',
        },
        admin,
      ),
    ).resolves.toEqual({
      orderId: 'order-1',
      status: OrderStatus.RELEASED,
      printJobId: 'print-1',
      idempotentReplay: true,
    });
    expect(activateMock).not.toHaveBeenCalled();
    expect(createPrintMock).not.toHaveBeenCalled();
  });

  it('takes the global shared cutoff lock as the first settlement statement', async () => {
    tx.order.findUnique.mockResolvedValueOnce(
      order({
        status: OrderStatus.SHIPPED,
        confirmedFee: new Decimal('130.75'),
      }),
    );
    await expect(
      settleFactoryOrder(
        {
          orderId: 'order-1',
          expectedRevision: 4,
          expectedWorkOrderVersion: 2,
        },
        admin,
      ),
    ).resolves.toEqual({
      orderId: 'order-1',
      status: OrderStatus.SETTLED,
      settledFee: '130.75',
      settledAt,
      idempotentReplay: false,
    });
    const firstSql = (
      tx.$executeRaw.mock.calls[0]?.[0] as TemplateStringsArray
    ).join('?');
    const secondSql = (
      tx.$executeRaw.mock.calls[1]?.[0] as TemplateStringsArray
    ).join('?');
    expect(firstSql).toContain('pg_advisory_xact_lock_shared');
    expect(secondSql).toContain('pg_advisory_xact_lock');
    expect(tx.order.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          status: OrderStatus.SETTLED,
          settledFee: '130.75',
          settledAt,
          settlementContractVersion: 2,
        }),
      }),
    );
  });

  it('holds an active order with a finite reason and can replay by key', async () => {
    tx.order.findUnique.mockResolvedValueOnce(
      order({ status: OrderStatus.RELEASED }),
    );
    await holdFactoryOrder(
      {
        orderId: 'order-1',
        reasonCode: OrderWorkflowReasonCode.PAPER_OUT,
        reasonNote: '主纸缺货',
        affectedFigs: [],
        idempotencyKey: 'hold-order-1-release',
      },
      admin,
    );
    expect(tx.orderWorkflowDecision.create).toHaveBeenCalledWith({
      data: expect.objectContaining({ action: OrderWorkflowAction.HOLD }),
    });
  });
});
