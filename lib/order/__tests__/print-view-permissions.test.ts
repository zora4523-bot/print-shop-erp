import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  OrderSettlementType,
  OrderStatus,
  PieceworkOperationType,
  ProductionOperationStatus,
  Role,
  WorkerType,
  MachineType,
} from '../../../generated/prisma/enums';

const { dbMock, buildQrSvgMock } = vi.hoisted(() => ({
  dbMock: {
    order: { findFirst: vi.fn() },
    user: { findUnique: vi.fn() },
    craft: { findMany: vi.fn() },
  },
  buildQrSvgMock: vi.fn(),
}));

vi.mock('@/lib/db', () => ({ db: dbMock }));
vi.mock('../qr', () => ({ buildQrSvg: buildQrSvgMock }));

import { getOrderForPrint } from '../print-view';

beforeEach(() => {
  dbMock.order.findFirst.mockReset().mockResolvedValue(null);
  dbMock.user.findUnique.mockReset().mockResolvedValue({ role: Role.ADMIN, isActive: true, workerType: null, machineType: null });
  dbMock.craft.findMany.mockReset().mockResolvedValue([]);
  buildQrSvgMock.mockReset().mockImplementation(async (value: string) => (
    `<svg data-value="${value}"></svg>`
  ));
});

describe('getOrderForPrint permissions', () => {
  it('打印抬头取外部销售；免费重做由管理员发起，取原单的外部销售', async () => {
    const baseOrder = {
      id: 'rework-1', orderNo: 'GD-REWORK', workOrderVersion: 1, status: OrderStatus.CONFIRMED,
      changeRequests: [], createdAt: new Date('2026-09-27T00:00:00Z'), items: [],
      packagingGroups: [], shipments: [], productionProgressSteps: [], productionOperations: [],
    };
    dbMock.order.findFirst.mockResolvedValue({
      ...baseOrder,
      kind: 'REWORK',
      settlementType: OrderSettlementType.NO_CHARGE,
      submitter: { displayName: '管理员甲' },
      sourceOrder: { orderNo: 'GD-SOURCE', submitter: { displayName: '外销乙' } },
    });
    const rework = await getOrderForPrint('rework-1', { id: 'admin-1', role: Role.ADMIN }, 'https://erp.example.com');
    expect(rework?.externalSalesName).toBe('外销乙');
    expect(rework?.sourceOrderNo).toBe('GD-SOURCE');

    dbMock.order.findFirst.mockResolvedValue({
      ...baseOrder,
      kind: 'NORMAL',
      settlementType: OrderSettlementType.EXTERNAL_SALES,
      submitter: { displayName: '  ' },
      sourceOrder: null,
    });
    const blank = await getOrderForPrint('rework-1', { id: 'admin-1', role: Role.ADMIN }, 'https://erp.example.com');
    expect(blank?.externalSalesName).toBeNull();

    const query = dbMock.order.findFirst.mock.calls[0]?.[0];
    expect(query.include.submitter).toEqual({ select: { displayName: true } });
    expect(query.include.sourceOrder).toEqual({ select: { orderNo: true, submitter: { select: { displayName: true } } } });
    expect(query.include).not.toHaveProperty('customerParty');
  });

  it('50款聚合工序只引用完整图号列表，DTO款式仍保留全部64字名称', async () => {
    const items = Array.from({ length: 50 }, (_, index) => ({
      id: `item-${index + 1}`,
      sequence: index + 1,
      name: `款${String(index + 1).padStart(2, '0')}${'长'.repeat(61)}`,
      quantity: 1,
      crafts: [],
      designs: [],
      frontFoilColors: ['金色'],
      backFoilColors: [],
    }));
    dbMock.order.findFirst.mockResolvedValue({
      id: 'fifty-styles',
      orderNo: 'GD-FIFTY',
      workOrderVersion: 3,
      status: OrderStatus.RELEASED,
      changeRequests: [],
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

  it('图稿与当前工序按时间和 id 稳定排序，查询不再读取旧任务', async () => {
    await getOrderForPrint('order-stable-sort', { id: 'admin-1', role: Role.ADMIN }, 'https://erp.example.com');
    const query = dbMock.order.findFirst.mock.calls[0]?.[0];
    expect(query.include.items.include).toEqual({ designs: { orderBy: [{ uploadedAt: 'asc' }, { id: 'asc' }] } });
    for (const key of ['productionOperations', 'productionProgressSteps']) {
      expect(query.include[key]).toEqual(expect.objectContaining({
        where: { status: { not: ProductionOperationStatus.CANCELLED } },
        orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
      }));
    }
    expect(query.include.changeRequests).toEqual({ where: { status: 'PENDING' }, take: 1, select: { id: true } });
  });

  it('师傅不可读取尚未下发的 SUBMITTED 草稿，不再依赖旧任务分配', async () => {
    dbMock.user.findUnique.mockResolvedValue({ role: Role.WORKER, isActive: true, workerType: WorkerType.MACHINE, machineType: MachineType.HAND_PRESS });
    await expect(getOrderForPrint('scheduling-draft', { id: 'worker-1', role: Role.WORKER }, 'https://erp.example.com')).resolves.toBeNull();
    expect(dbMock.order.findFirst).toHaveBeenCalledWith({
      where: { id: 'scheduling-draft', status: { not: OrderStatus.SUBMITTED } },
      select: { workOrderVersion: true },
    });
    expect(dbMock.craft.findMany).not.toHaveBeenCalled();
    expect(buildQrSvgMock).not.toHaveBeenCalled();
  });

  it('将当前工单版本的新工序与进度写入打印 DTO，不混入旧任务', async () => {
    dbMock.craft.findMany.mockResolvedValue([
      { id: 'craft-color-foil', name: '彩印加烫' },
    ]);
    dbMock.order.findFirst.mockResolvedValue({
      id: 'order-1',
      orderNo: 'GD-260827-001',
      workOrderVersion: 3,
      status: OrderStatus.RELEASED,
      changeRequests: [],
      customName: null,
      kind: 'NORMAL',
      sourceOrder: null,
      isUrgent: false,
      isSfCollect: false,
      promisedDate: null,
      settlementType: OrderSettlementType.EXTERNAL_SALES,
      submitter: { displayName: ' 外销甲 ' },
      // 原“客户”不再进入打印 DTO。
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
          id: 'operation/cancelled-current',
          workOrderVersion: 3,
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
          id: 'progress/old', workOrderVersion: 2,
          craftName: '旧版工序', status: ProductionOperationStatus.PENDING,
          plannedQty: '9999', orderItem: { sequence: 1, name: '彩印烫金款' }, reports: [],
        },
        {
          id: 'progress/cancelled', workOrderVersion: 3,
          craftName: '已取消工序', status: ProductionOperationStatus.CANCELLED,
          plannedQty: '9999', orderItem: { sequence: 1, name: '彩印烫金款' }, reports: [],
        },
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
    expect(result?.items[0]).not.toHaveProperty('tasks');
    expect(result?.externalSalesName).toBe('外销甲');
    expect(result).not.toHaveProperty('customerName');
    expect(result?.status).toBe(OrderStatus.RELEASED);
    expect(result?.hasPendingChange).toBe(false);
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

  it('当前工序为空时保留空集合，真实待审申请独立于工单名称', async () => {
    dbMock.order.findFirst.mockResolvedValue({
      id: 'order-1', orderNo: 'GD-1', workOrderVersion: 2, status: OrderStatus.RELEASED,
      customName: '测试 · 局部烫金', changeRequests: [{ id: 'pending-1' }],
      createdAt: new Date('2026-09-10'), packagingGroups: [], shipments: [],
      productionOperations: [], productionProgressSteps: [],
      items: [{
        id: 'item-1', sequence: 1, name: '款式', quantity: 1000,
        crafts: [], designs: [], tasks: [{ id: 'legacy', worker: { displayName: '旧师傅' } }],
      }],
    });
    const result = await getOrderForPrint('order-1', { id: 'admin-1', role: Role.ADMIN }, 'https://erp.example.com');
    expect(result?.productionSteps).toEqual([]);
    expect(result?.items[0]).not.toHaveProperty('tasks');
    expect(result?.status).toBe(OrderStatus.RELEASED);
    expect(result?.hasPendingChange).toBe(true);
  });

});

it('resolves relative artwork URLs for standalone PDF rendering', async () => {
  dbMock.order.findFirst.mockResolvedValue({
    id: 'relative-art', orderNo: 'GD-RELATIVE', workOrderVersion: 1,
    status: OrderStatus.RELEASED, changeRequests: [], createdAt: new Date('2026-09-13'),
    items: [{ id: 'item', sequence: 1, name: '图稿', quantity: 1, crafts: [],
      frontFoilColors: [], backFoilColors: [],
      designs: [{ id: 'art', fileType: 'IMAGE', fileUrl: '/favicon.ico' }] }],
    packagingGroups: [], shipments: [], productionProgressSteps: [], productionOperations: [],
  });
  const order = await getOrderForPrint('relative-art', { id: 'admin', role: Role.ADMIN }, 'https://erp.example.com');
  expect(order?.items[0].designs[0].fileUrl).toBe('https://erp.example.com/favicon.ico');
});
