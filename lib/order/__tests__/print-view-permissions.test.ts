import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  OrderStatus,
  PieceworkOperationType,
  ProductionOperationStatus,
  Role,
  TaskStatus,
} from '../../../generated/prisma/enums';

const { dbMock, buildQrSvgMock } = vi.hoisted(() => ({
  dbMock: {
    order: { findFirst: vi.fn() },
    craft: { findMany: vi.fn() },
  },
  buildQrSvgMock: vi.fn(),
}));

vi.mock('@/lib/db', () => ({ db: dbMock }));
vi.mock('../qr', () => ({ buildQrSvg: buildQrSvgMock }));

import { getOrderForPrint } from '../print-view';

beforeEach(() => {
  dbMock.order.findFirst.mockReset().mockResolvedValue(null);
  dbMock.craft.findMany.mockReset().mockResolvedValue([]);
  buildQrSvgMock.mockReset().mockImplementation(async (value: string) => (
    `<svg data-value="${value}"></svg>`
  ));
});

describe('getOrderForPrint permissions', () => {
  it('50款聚合工序只引用完整图号列表，DTO款式仍保留全部64字名称', async () => {
    const items = Array.from({ length: 50 }, (_, index) => ({
      id: `item-${index + 1}`,
      sequence: index + 1,
      name: `款${String(index + 1).padStart(2, '0')}${'长'.repeat(61)}`,
      quantity: 1,
      crafts: [],
      designs: [],
      tasks: [],
      frontFoilColors: ['金色'],
      backFoilColors: [],
    }));
    dbMock.order.findFirst.mockResolvedValue({
      id: 'fifty-styles',
      orderNo: 'GD-FIFTY',
      workOrderVersion: 3,
      createdAt: new Date('2026-09-08T00:00:00Z'),
      items,
      packagingGroups: [],
      shipments: [],
      productionProgressSteps: [],
      productionOperations: [{
        id: 'full-operation',
        workOrderVersion: 3,
        operationType: PieceworkOperationType.FULL,
        status: ProductionOperationStatus.PENDING,
        plannedQty: '50',
        sources: [...items].reverse().map((orderItem) => ({ orderItem })),
        reports: [],
      }],
    });

    const result = await getOrderForPrint(
      'fifty-styles', { id: 'admin-1', role: Role.ADMIN }, 'https://erp.example.com',
    );

    expect(result?.productionSteps).toHaveLength(1);
    expect(result?.productionSteps[0]?.scopeLabel).toBe(`图 ${items.map((item) => item.sequence).join('、')}`);
    expect(result?.productionSteps[0]?.scopeLabel?.length).toBeLessThan(160);
    expect(result?.items.map((item) => item.name)).toEqual(items.map((item) => item.name));
    expect(result?.items.every((item) => item.name.length === 64)).toBe(true);
  });

  it('does not expose production print or PDF data to SALES', async () => {
    await expect(
      getOrderForPrint(
        'sales-order',
        { id: 'sales-1', role: Role.SALES },
        'https://erp.example.com',
      ),
    ).resolves.toBeNull();

    expect(dbMock.order.findFirst).not.toHaveBeenCalled();
    expect(dbMock.craft.findMany).not.toHaveBeenCalled();
    expect(buildQrSvgMock).not.toHaveBeenCalled();
  });

  it('图稿与任务同时间戳时用 id 稳定次序，避免跨页漂移', async () => {
    await getOrderForPrint(
      'order-stable-sort',
      { id: 'admin-1', role: Role.ADMIN },
      'https://erp.example.com',
    );

    expect(dbMock.order.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        include: expect.objectContaining({
          items: expect.objectContaining({
            include: expect.objectContaining({
              designs: expect.objectContaining({
                orderBy: [{ uploadedAt: 'asc' }, { id: 'asc' }],
              }),
              tasks: expect.objectContaining({
                orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
              }),
            }),
          }),
        }),
      }),
    );
  });

  it('打印查询排除已取消的生产任务', async () => {
    await getOrderForPrint(
      'order-1',
      { id: 'admin-1', role: Role.ADMIN },
      'https://erp.example.com',
    );

    expect(dbMock.order.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        include: expect.objectContaining({
          items: expect.objectContaining({
            include: expect.objectContaining({
              designs: expect.objectContaining({
                orderBy: [{ uploadedAt: 'asc' }, { id: 'asc' }],
              }),
              tasks: expect.objectContaining({
                where: { status: { not: TaskStatus.CANCELLED } },
                orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
              }),
            }),
          }),
        }),
      }),
    );
  });

  it('hides a SUBMITTED scheduling draft from the assigned WORKER in print and PDF flows', async () => {
    await expect(
      getOrderForPrint(
        'scheduling-draft',
        { id: 'worker-1', role: Role.WORKER },
        'https://erp.example.com',
      ),
    ).resolves.toBeNull();

    expect(dbMock.order.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          id: 'scheduling-draft',
          status: { not: OrderStatus.SUBMITTED },
          items: {
            some: {
              tasks: { some: { workerId: 'worker-1' } },
            },
          },
        },
      }),
    );
    expect(dbMock.craft.findMany).not.toHaveBeenCalled();
  });

  it('将当前工单版本的新工序与进度写入打印 DTO，不混入旧任务', async () => {
    dbMock.craft.findMany.mockResolvedValue([
      { id: 'craft-color-foil', name: '彩印加烫' },
    ]);
    dbMock.order.findFirst.mockResolvedValue({
      id: 'order-1',
      orderNo: 'GD-260827-001',
      workOrderVersion: 3,
      customName: null,
      kind: 'NORMAL',
      sourceOrder: null,
      isUrgent: false,
      isSfCollect: false,
      promisedDate: null,
      customerParty: null,
      customerRef: '客户甲',
      receiverName: null,
      receiverPhone: null,
      receiverAddress: null,
      expressCode: null,
      packageRequirement: null,
      remark: null,
      submittedAt: null,
      createdAt: new Date('2026-08-27T00:00:00Z'),
      packagingGroups: [],
      shipments: [],
      productionOperations: [
        {
          id: 'packing/3',
          workOrderVersion: 3,
          operationType: PieceworkOperationType.PACKING,
          status: ProductionOperationStatus.PENDING,
          plannedQty: '25',
          sources: [{
            orderItem: null,
            packagingGroup: {
              sequence: 2,
              name: '混款装袋',
              lines: [{ orderItem: { sequence: 1 } }, { orderItem: { sequence: 2 } }],
            },
          }],
          reports: [],
        },
        {
          id: 'operation/old',
          workOrderVersion: 2,
          operationType: PieceworkOperationType.PARTIAL,
          status: ProductionOperationStatus.CANCELLED,
          plannedQty: '4000',
          sources: [],
          reports: [],
        },
        {
          id: 'operation/3',
          workOrderVersion: 3,
          carriedCompletedQty: '100',
          operationType: PieceworkOperationType.PARTIAL,
          status: ProductionOperationStatus.IN_PROGRESS,
          plannedQty: '4000',
          sources: [
            {
              orderItem: {
                sequence: 1,
                name: '彩印烫金款',
                frontFoilColors: ['哑金'],
                backFoilColors: ['红金'],
              },
            },
          ],
          reports: [
            {
              reportedCompletedQty: '800',
              defectQty: '2',
              reportedAt: new Date('2026-08-27T02:00:00Z'),
            },
          ],
        },
      ],
      productionProgressSteps: [
        {
          id: 'progress/3',
          workOrderVersion: 3,
          carriedCompletedQty: '50',
          craftName: '覆膜',
          status: ProductionOperationStatus.PENDING,
          plannedQty: '2000',
          orderItem: { sequence: 1, name: '彩印烫金款' },
          reports: [],
        },
      ],
      items: [
        {
          id: 'item-1',
          sequence: 1,
          name: '彩印烫金款',
          pricingRoute: 'COLOR_PRINT',
          artworkVersion: null,
          specification: '大号封',
          paperType: '珠光纸',
          paperWeightGsm: 160,
          quantity: 2_000,
          crafts: ['craft-color-foil'],
          frontFoilColors: ['哑金'],
          backFoilColors: ['红金'],
          foilColors: [],
          foilTechnique: 'RELIEF',
          hasLocalFoil: true,
          lamination: 'SOFT_TOUCH',
          printColors: ['C', 'M', 'Y', 'K'],
          printColorsKnown: true,
          isDoubleSided: true,
          isDoubleColor: true,
          remark: null,
          designs: [],
          tasks: [
            {
              id: 'task/1',
              craft: { name: '彩印加烫' },
              worker: { displayName: '李师傅' },
              plannedQty: 2_000,
              completedQty: 0,
              defectQty: 0,
              completedAt: null,
            },
          ],
        },
      ],
    });

    const result = await getOrderForPrint(
      'order-1',
      { id: 'admin-1', role: Role.ADMIN },
      'https://erp.example.com/',
    );

    expect(result?.items[0]).toEqual(
      expect.objectContaining({
        frontFoilColors: ['哑金'],
        backFoilColors: ['红金'],
        foilTechnique: 'RELIEF',
        hasLocalFoil: true,
        lamination: 'SOFT_TOUCH',
        printColors: ['C', 'M', 'Y', 'K'],
        printColorsKnown: true,
        craftNames: ['彩印加烫'],
      }),
    );
    expect(result?.items[0]?.tasks).toEqual([]);
    expect(result?.productionSteps).toEqual([
      expect.objectContaining({
        id: 'packing/3',
        source: 'OPERATION',
        craftName: '打包',
        scopeLabel: '包装组 2 · 混款装袋 · 图 1、2',
        quantityUnit: '袋',
        plannedQty: 25,
      }),
      expect.objectContaining({
        id: 'operation/3',
        source: 'OPERATION',
        craftName: '局部烫金',
        itemSequence: 1,
        itemName: '彩印烫金款',
        scopeLabel: null,
        plannedQty: 2_000,
        completedQty: 900,
        defectQty: 2,
        quantityUnit: '个',
      }),
      expect.objectContaining({
        id: 'progress/3',
        source: 'PROGRESS',
        craftName: '覆膜',
        plannedQty: 2_000,
      }),
    ]);
    expect(buildQrSvgMock).toHaveBeenCalledWith(
      'https://erp.example.com/wo/GD-260827-001?v=3',
      95,
      { errorCorrectionLevel: 'Q' },
    );
    expect(buildQrSvgMock).toHaveBeenCalledTimes(1);
  });
});
