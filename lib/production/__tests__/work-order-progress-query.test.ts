import Decimal from 'decimal.js';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ProductionWorkOrderStage } from '../../../generated/prisma/enums';

const { dbMock, databaseClockNowMock } = vi.hoisted(() => ({
  databaseClockNowMock: vi.fn(),
  dbMock: {
    orderItem: { groupBy: vi.fn() },
    productionWorkOrderProgress: {
      groupBy: vi.fn(),
      findMany: vi.fn(),
    },
    productionScanClaim: { findMany: vi.fn() },
    order: { findMany: vi.fn() },
    $queryRaw: vi.fn(),
  },
}));

vi.mock('@/lib/db', () => ({ db: dbMock }));
vi.mock('@/lib/background-jobs/clock', () => ({
  databaseClockNow: databaseClockNowMock,
}));

import {
  getWorkOrderProgressByOrderIds,
  loadProductionAlertFacts,
  scanStagnantProductionOrders,
} from '../work-order-progress-query';

beforeEach(() => {
  for (const delegate of Object.values(dbMock)) {
    if (typeof delegate === 'function') {
      delegate.mockReset();
      continue;
    }
    for (const mock of Object.values(delegate)) mock.mockReset();
  }
  databaseClockNowMock
    .mockReset()
    .mockResolvedValue(new Date('2026-09-02T08:00:00.000Z'));
  dbMock.orderItem.groupBy.mockResolvedValue([]);
  dbMock.productionWorkOrderProgress.groupBy.mockResolvedValue([]);
  dbMock.productionWorkOrderProgress.findMany.mockResolvedValue([]);
  dbMock.productionScanClaim.findMany.mockResolvedValue([]);
  dbMock.order.findMany.mockResolvedValue([]);
  dbMock.$queryRaw.mockResolvedValue([]);
});

describe('getWorkOrderProgressByOrderIds', () => {
  it('当前代次承接量与新增报工合并，旧代承接量不再重复加入', async () => {
    dbMock.order.findMany.mockResolvedValue([{ id: 'order-1', workOrderVersion: 3, scheduledAt: null, productionOperations: [
      { workOrderVersion: 2, operationType: 'PARTIAL', carriedWorkOrderProgressQty: new Decimal(60) },
      { workOrderVersion: 3, operationType: 'PARTIAL', carriedWorkOrderProgressQty: new Decimal(70) },
    ] }]);
    dbMock.orderItem.groupBy.mockResolvedValue([{ orderId: 'order-1', _sum: { quantity: 100 } }]);
    dbMock.productionWorkOrderProgress.groupBy.mockResolvedValue([{ orderId: 'order-1', workOrderVersion: 3, stage: ProductionWorkOrderStage.FOILING, _sum: { workOrderProgressQuantity: new Decimal(10) } }]);
    expect((await getWorkOrderProgressByOrderIds(['order-1'])).get('order-1')).toMatchObject({ foilingProgress: '80', packingProgress: '0' });
  });

  it('批量投影两道工单件数进度，打包超前只派生提示', async () => {
    dbMock.order.findMany.mockResolvedValue([
      {
        id: 'order-1',
        workOrderVersion: 2,
        scheduledAt: new Date('2026-09-01T00:00:00.000Z'),
      },
    ]);
    dbMock.orderItem.groupBy.mockResolvedValue([
      { orderId: 'order-1', _sum: { quantity: 100 } },
    ]);
    dbMock.productionWorkOrderProgress.groupBy.mockResolvedValue([
      {
        orderId: 'order-1',
        workOrderVersion: 1,
        stage: ProductionWorkOrderStage.FOILING,
        _sum: { workOrderProgressQuantity: new Decimal(90) },
      },
      {
        orderId: 'order-1',
        workOrderVersion: 2,
        stage: ProductionWorkOrderStage.FOILING,
        _sum: { workOrderProgressQuantity: new Decimal(35) },
      },
      {
        orderId: 'order-1',
        workOrderVersion: 2,
        stage: ProductionWorkOrderStage.PACKING,
        _sum: { workOrderProgressQuantity: new Decimal(40) },
      },
    ]);
    dbMock.productionScanClaim.findMany.mockResolvedValue([
      {
        orderId: 'order-1',
        workOrderVersion: 1,
        claimedAt: new Date('2026-08-31T00:00:00.000Z'),
      },
      {
        orderId: 'order-1',
        workOrderVersion: 2,
        claimedAt: new Date('2026-08-31T23:59:59.999Z'),
      },
      {
        orderId: 'order-1',
        workOrderVersion: 2,
        claimedAt: new Date('2026-09-01T01:00:00.000Z'),
      },
    ]);

    await expect(
      getWorkOrderProgressByOrderIds(['order-1', 'order-1']),
    ).resolves.toEqual(
      new Map([
        [
          'order-1',
          {
            orderId: 'order-1',
            orderTotal: '100',
            foilingProgress: '35',
            packingProgress: '40',
            foilingOverLimit: false,
            packingOverLimit: false,
            packingAhead: true,
            firstClaimedAt: new Date('2026-09-01T01:00:00.000Z'),
          },
        ],
      ]),
    );
    expect(dbMock.order.findMany).toHaveBeenCalledOnce();
    expect(dbMock.orderItem.groupBy).toHaveBeenCalledOnce();
    expect(dbMock.productionWorkOrderProgress.groupBy).toHaveBeenCalledOnce();
    expect(dbMock.productionScanClaim.findMany).toHaveBeenCalledOnce();
  });

  it('坏数据超单量与打包超前是两个独立派生标记', async () => {
    dbMock.order.findMany.mockResolvedValue([
      { id: 'order-1', workOrderVersion: 1, scheduledAt: null },
    ]);
    dbMock.orderItem.groupBy.mockResolvedValue([
      { orderId: 'order-1', _sum: { quantity: 100 } },
    ]);
    dbMock.productionWorkOrderProgress.groupBy.mockResolvedValue([
      {
        orderId: 'order-1',
        workOrderVersion: 1,
        stage: ProductionWorkOrderStage.PACKING,
        _sum: { workOrderProgressQuantity: new Decimal(101) },
      },
    ]);

    const projection = (
      await getWorkOrderProgressByOrderIds(['order-1'])
    ).get('order-1');
    expect(projection).toMatchObject({
      packingOverLimit: true,
      packingAhead: true,
    });
  });
});

describe('scanStagnantProductionOrders', () => {
  it('只读真实生产态、scheduledAt 和缺失的扫码 claim，截止时间来自数据库', async () => {
    dbMock.$queryRaw.mockResolvedValue([
      {
        id: 'order-1',
        orderNo: 'GD-260902-001',
        workOrderVersion: 3,
        scheduledAt: new Date('2026-08-31T08:00:00.000Z'),
      },
    ]);

    await expect(
      scanStagnantProductionOrders({ thresholdDays: 2, batchSize: 200 }),
    ).resolves.toEqual([
      {
        orderId: 'order-1',
        orderNo: 'GD-260902-001',
        workOrderVersion: 3,
        scheduledAt: new Date('2026-08-31T08:00:00.000Z'),
        releaseKey: 'order-1:v3:2026-08-31T08:00:00.000Z',
      },
    ]);

    const [segments, ...parameters] = dbMock.$queryRaw.mock.calls[0]!;
    const sql = Array.from(segments as TemplateStringsArray).join('?');
    expect(sql).toContain('FROM "Order" orders');
    expect(sql).toContain('FROM "ProductionScanClaim" claim');
    expect(sql).toContain(
      'claim."workOrderVersion" = orders."workOrderVersion"',
    );
    expect(sql).toContain('claim."claimedAt" >= orders."scheduledAt"');
    expect(parameters).toContainEqual(new Date('2026-08-31T08:00:00.000Z'));
    expect(sql).not.toMatch(/ProductionTask|PER_BAG|ProductionReport/);
  });

  // 审计 L-13：寄样单、改单后全部承接完成的新代次在结构上不可能被扫码认领，不能判停滞。
  it('只把当前代次仍有待开工/进行中工序或进度步骤、且不是寄样单的工单列为停滞候选', async () => {
    await scanStagnantProductionOrders({ thresholdDays: 2, batchSize: 200 });
    const [segments, ...parameters] = dbMock.$queryRaw.mock.calls[0]!;
    const sql = Array.from(segments as TemplateStringsArray).join('?');
    expect(sql).toContain('orders."purpose" <> ?::"OrderPurpose"');
    expect(parameters).toContain('SAMPLE_SHIPMENT');
    for (const table of ['"ProductionOperation" unit', '"ProductionProgressStep" unit']) {
      expect(sql).toContain(`FROM ${table}`);
    }
    expect(sql).toContain('unit."workOrderVersion" = orders."workOrderVersion"');
    expect(sql).toContain('unit."status" IN (?::"ProductionOperationStatus", ?::"ProductionOperationStatus")');
    expect(parameters).toEqual(expect.arrayContaining(['PENDING', 'IN_PROGRESS']));
  });
});

describe('loadProductionAlertFacts', () => {
  it('通知适配器仅从 W2 进度与认领 ledger 读取', async () => {
    dbMock.order.findMany.mockResolvedValue([
      {
        id: 'order-1',
        orderNo: 'GD-260902-001',
        workOrderVersion: 2,
        scheduledAt: new Date('2026-08-31T08:00:00.000Z'),
        purpose: 'STANDARD',
        productionOperations: [{ workOrderVersion: 2 }],
        productionProgressSteps: [],
      },
    ]);
    dbMock.productionWorkOrderProgress.findMany.mockResolvedValue([
      {
        id: 'progress-old',
        orderId: 'order-1',
        workOrderVersion: 1,
        stage: ProductionWorkOrderStage.PACKING,
        workOrderProgressQuantity: new Decimal(99),
        reportedAt: new Date('2026-08-30T08:00:00.000Z'),
        order: { orderNo: 'GD-260902-001' },
      },
      {
        id: 'progress-1',
        orderId: 'order-1',
        workOrderVersion: 2,
        stage: ProductionWorkOrderStage.PACKING,
        workOrderProgressQuantity: new Decimal(20),
        reportedAt: new Date('2026-09-01T08:00:00.000Z'),
        order: { orderNo: 'GD-260902-001' },
      },
    ]);
    dbMock.productionScanClaim.findMany.mockResolvedValue([
      {
        id: 'claim-v1',
        orderId: 'order-1',
        reporterId: 'worker-1',
        idempotencyKey: 'claim-version-1',
        workOrderVersion: 1,
        claimedAt: new Date('2026-08-30T08:00:00.000Z'),
      },
      {
        id: 'claim-v2',
        orderId: 'order-1',
        reporterId: 'worker-2',
        idempotencyKey: 'claim-version-2',
        workOrderVersion: 2,
        claimedAt: new Date('2026-09-01T08:00:00.000Z'),
      },
    ]);

    await expect(loadProductionAlertFacts({ orderLimit: 50 })).resolves.toEqual({
      progress: [
        {
          id: 'progress-1',
          orderId: 'order-1',
          orderNo: 'GD-260902-001',
          operationType: 'PACKING',
          completedQty: '20',
          reportedAt: new Date('2026-09-01T08:00:00.000Z'),
        },
      ],
      releasedOrders: [
        {
          orderId: 'order-1',
          orderNo: 'GD-260902-001',
          releaseKey: 'order-1:v2:2026-08-31T08:00:00.000Z',
          releasedAt: new Date('2026-08-31T08:00:00.000Z'),
        },
      ],
      claims: [
        {
          id: 'claim-v2',
          orderId: 'order-1',
          reporterId: 'worker-2',
          idempotencyKey: 'claim-version-2',
          claimedAt: new Date('2026-09-01T08:00:00.000Z'),
        },
      ],
      nextCursor: null,
    });
  });

  it('寄样单与当前代次没有待认领工序的工单不进入停滞候选，但进度事实照常读取', async () => {
    const scheduledAt = new Date('2026-08-31T08:00:00.000Z');
    const base = { scheduledAt, workOrderVersion: 2, purpose: 'STANDARD', productionOperations: [], productionProgressSteps: [] };
    dbMock.order.findMany.mockResolvedValue([
      { ...base, id: 'sample', orderNo: 'GD-S', purpose: 'SAMPLE_SHIPMENT' },
      { ...base, id: 'carried-done', orderNo: 'GD-C' },
      { ...base, id: 'old-only', orderNo: 'GD-O', productionOperations: [{ workOrderVersion: 1 }] },
      { ...base, id: 'progress-open', orderNo: 'GD-P', productionProgressSteps: [{ workOrderVersion: 2 }] },
      { ...base, id: 'sample-with-step', orderNo: 'GD-SS', purpose: 'SAMPLE_SHIPMENT', productionOperations: [{ workOrderVersion: 2 }] },
    ]);
    const facts = await loadProductionAlertFacts({ orderLimit: 50 });
    expect(facts.releasedOrders.map((row) => row.orderId)).toEqual(['progress-open']);
    const unfinished = { status: { in: ['PENDING', 'IN_PROGRESS'] } };
    expect(dbMock.order.findMany).toHaveBeenCalledWith(expect.objectContaining({
      select: expect.objectContaining({
        purpose: true,
        productionOperations: { where: unfinished, select: { workOrderVersion: true } },
        productionProgressSteps: { where: unfinished, select: { workOrderVersion: true } },
      }),
    }));
    expect(dbMock.productionWorkOrderProgress.findMany).toHaveBeenCalledWith(expect.objectContaining({
      where: { orderId: { in: ['sample', 'carried-done', 'old-only', 'progress-open', 'sample-with-step'] } },
    }));
  });

  it('用 scheduledAt + id 键集游标翻过已提醒的最旧页，不让后续工单饥饿', async () => {
    const scheduledAt = new Date('2026-08-31T08:00:00.000Z');
    dbMock.order.findMany
      .mockResolvedValueOnce([
        {
          id: 'order-1',
          orderNo: 'GD-260902-001',
          workOrderVersion: 1,
          scheduledAt,
          purpose: 'STANDARD',
          productionOperations: [{ workOrderVersion: 1 }],
          productionProgressSteps: [],
        },
        {
          id: 'order-2',
          orderNo: 'GD-260902-002',
          workOrderVersion: 1,
          scheduledAt,
          purpose: 'STANDARD',
          productionOperations: [{ workOrderVersion: 1 }],
          productionProgressSteps: [],
        },
      ])
      .mockResolvedValueOnce([
        {
          id: 'order-2',
          orderNo: 'GD-260902-002',
          workOrderVersion: 1,
          scheduledAt,
          purpose: 'STANDARD',
          productionOperations: [{ workOrderVersion: 1 }],
          productionProgressSteps: [],
        },
      ]);

    const firstPage = await loadProductionAlertFacts({ orderLimit: 1 });
    expect(firstPage.releasedOrders.map((row) => row.orderId)).toEqual([
      'order-1',
    ]);
    expect(firstPage.nextCursor).toEqual({
      scheduledAt,
      orderId: 'order-1',
    });

    const secondPage = await loadProductionAlertFacts({
      orderLimit: 1,
      cursor: firstPage.nextCursor!,
    });
    expect(secondPage.releasedOrders.map((row) => row.orderId)).toEqual([
      'order-2',
    ]);
    expect(secondPage.nextCursor).toBeNull();
    expect(dbMock.order.findMany).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({
        where: expect.objectContaining({
          OR: [
            { scheduledAt: { gt: scheduledAt } },
            { scheduledAt, id: { gt: 'order-1' } },
          ],
        }),
        orderBy: [{ scheduledAt: 'asc' }, { id: 'asc' }],
        take: 2,
      }),
    );
  });
});
