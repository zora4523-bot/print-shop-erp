import { describe, expect, it, vi } from 'vitest';
import type { Prisma } from '../../../generated/prisma/client';
import {
  MachineType,
  OrderStatus,
  PieceworkOperationType,
  ProductionOperationStatus,
  Role,
  WorkerType,
} from '../../../generated/prisma/enums';

const service = vi.hoisted(() => {
  const tx = {
    $executeRaw: vi.fn(),
    productionOperation: { findUnique: vi.fn() },
    productionScanClaim: { findUnique: vi.fn(), create: vi.fn() },
    user: { findUnique: vi.fn() },
  };
  return {
    tx,
    db: {
      $transaction: vi.fn(
        async (callback: (client: typeof tx) => unknown) => callback(tx),
      ),
    },
    clock: vi.fn(),
  };
});

vi.mock('@/lib/db', () => ({ db: service.db }));
vi.mock('@/lib/background-jobs/clock', () => ({
  databaseClockNow: service.clock,
}));

import {
  claimProductionOperationFromScan,
  ensureFirstProductionScanClaimInTx,
} from '../work-order-progress';

const RELEASED_AT = new Date('2026-09-01T08:00:00.000Z');
const CLAIMED_AT = new Date('2026-09-02T08:00:00.000Z');

function context(overrides: Record<string, unknown> = {}) {
  return {
    orderId: 'order-1',
    workOrderVersion: 2,
    operationId: 'operation-1',
    progressStepId: null,
    reporterId: 'worker-1',
    idempotencyKey: 'scan-claim-v2-0001',
    orderStatus: OrderStatus.RELEASED,
    scheduledAt: RELEASED_AT,
    claimedAt: CLAIMED_AT,
    ...overrides,
  };
}

describe('ensureFirstProductionScanClaimInTx', () => {
  it('新 workOrderVersion 可追加新的首次 claim，旧版本事实不阻塞', async () => {
    const findUnique = vi.fn().mockResolvedValue(null);
    const create = vi.fn().mockResolvedValue({
      id: 'claim-v2',
      claimedAt: CLAIMED_AT,
    });
    const tx = {
      productionScanClaim: { findUnique, create },
    } as unknown as Prisma.TransactionClient;

    await expect(
      ensureFirstProductionScanClaimInTx(tx, context()),
    ).resolves.toEqual({
      claimId: 'claim-v2',
      claimedAt: CLAIMED_AT,
      idempotentReplay: false,
    });
    expect(findUnique).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({
        where: {
          orderId_workOrderVersion: {
            orderId: 'order-1',
            workOrderVersion: 2,
          },
        },
      }),
    );
    expect(create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        orderId: 'order-1',
        workOrderVersion: 2,
      }),
      select: { id: true, claimedAt: true },
    });
  });

  it('后续报工可复用同版本首次 claim，但不覆盖也不新增', async () => {
    const existing = {
      id: 'claim-first',
      orderId: 'order-1',
      workOrderVersion: 2,
      operationId: 'operation-other',
      progressStepId: null,
      reporterId: 'worker-other',
      idempotencyKey: 'scan-claim-v2-first',
      claimedAt: CLAIMED_AT,
    };
    const findUnique = vi
      .fn()
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce(existing);
    const create = vi.fn();
    const tx = {
      productionScanClaim: { findUnique, create },
    } as unknown as Prisma.TransactionClient;

    await expect(
      ensureFirstProductionScanClaimInTx(tx, context(), { source: 'REPORT' }),
    ).resolves.toEqual({
      claimId: 'claim-first',
      claimedAt: CLAIMED_AT,
      idempotentReplay: true,
    });
    expect(create).not.toHaveBeenCalled();
  });

  it('显式扫码不能把新 key 当作已有首次 claim 的 replay', async () => {
    const existing = {
      id: 'claim-first',
      orderId: 'order-1',
      workOrderVersion: 2,
      operationId: 'operation-other',
      progressStepId: null,
      reporterId: 'worker-other',
      idempotencyKey: 'scan-claim-v2-first',
      claimedAt: CLAIMED_AT,
    };
    const findUnique = vi
      .fn()
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce(existing);
    const create = vi.fn();
    const tx = {
      productionScanClaim: { findUnique, create },
    } as unknown as Prisma.TransactionClient;

    await expect(
      ensureFirstProductionScanClaimInTx(tx, context()),
    ).rejects.toMatchObject({ code: 'IDEMPOTENCY_CONFLICT' });
    expect(create).not.toHaveBeenCalled();
  });
});

describe('claimProductionOperationFromScan', () => {
  const actor = { id: 'worker-1', role: Role.WORKER };
  const account = {
    id: 'worker-1',
    role: Role.WORKER,
    isActive: true,
    workerType: WorkerType.MACHINE,
    machineType: MachineType.HAND_PRESS,
  };

  function operation(overrides: Record<string, unknown> = {}) {
    return {
      id: 'operation-1',
      orderId: 'order-1',
      workOrderVersion: 2,
      operationType: PieceworkOperationType.PARTIAL,
      status: ProductionOperationStatus.PENDING,
      order: {
        status: OrderStatus.RELEASED,
        scheduledAt: RELEASED_AT,
        workOrderVersion: 2,
      },
      ...overrides,
    };
  }

  function arrange(
    row: ReturnType<typeof operation>,
    user: Record<string, unknown> = account,
  ) {
    vi.clearAllMocks();
    service.tx.$executeRaw.mockResolvedValue(0);
    service.tx.productionOperation.findUnique
      .mockResolvedValueOnce({ id: 'operation-1', orderId: 'order-1' })
      .mockResolvedValueOnce(row);
    service.tx.user.findUnique.mockResolvedValue(user);
    service.clock.mockResolvedValue(CLAIMED_AT);
  }

  it('rejects a stale operation generation before writing a first claim', async () => {
    arrange(
      operation({
        workOrderVersion: 1,
        order: {
          status: OrderStatus.RELEASED,
          scheduledAt: RELEASED_AT,
          workOrderVersion: 2,
        },
      }),
    );

    await expect(
      claimProductionOperationFromScan(
        { operationId: 'operation-1', idempotencyKey: 'scan-stale-v1' },
        actor,
      ),
    ).rejects.toMatchObject({ code: 'ORDER_NOT_RELEASED' });
    expect(service.tx.productionScanClaim.create).not.toHaveBeenCalled();
  });

  it('rejects completed current-version operations', async () => {
    arrange(operation({ status: ProductionOperationStatus.COMPLETED }));

    await expect(
      claimProductionOperationFromScan(
        { operationId: 'operation-1', idempotencyKey: 'scan-completed' },
        actor,
      ),
    ).rejects.toMatchObject({ code: 'ORDER_NOT_RELEASED' });
    expect(service.tx.productionScanClaim.create).not.toHaveBeenCalled();
  });

  it('rejects a worker whose fixed lane does not match the operation', async () => {
    arrange(operation({ operationType: PieceworkOperationType.FULL }));

    await expect(
      claimProductionOperationFromScan(
        { operationId: 'operation-1', idempotencyKey: 'scan-wrong-lane' },
        actor,
      ),
    ).rejects.toMatchObject({ code: 'ACCOUNT_NOT_AUTHORIZED' });
    expect(service.tx.productionScanClaim.create).not.toHaveBeenCalled();
  });

  it('rejects a fresh scan key when the order version already has a first claim', async () => {
    arrange(operation());
    service.tx.productionScanClaim.findUnique
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce({
        id: 'claim-first',
        orderId: 'order-1',
        workOrderVersion: 2,
        operationId: 'operation-other',
        progressStepId: null,
        reporterId: 'worker-other',
        idempotencyKey: 'scan-first-key',
        claimedAt: CLAIMED_AT,
      });

    await expect(
      claimProductionOperationFromScan(
        { operationId: 'operation-1', idempotencyKey: 'scan-second-key' },
        actor,
      ),
    ).rejects.toMatchObject({ code: 'IDEMPOTENCY_CONFLICT' });
    expect(service.tx.productionScanClaim.create).not.toHaveBeenCalled();
  });
});
