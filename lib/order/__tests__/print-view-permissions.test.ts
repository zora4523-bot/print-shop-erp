import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  OrderStatus,
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

  it('将彩印烫金事实和每个任务的绝对 URL 二维码写入打印 DTO', async () => {
    dbMock.craft.findMany.mockResolvedValue([
      { id: 'craft-color-foil', name: '彩印加烫' },
    ]);
    dbMock.order.findFirst.mockResolvedValue({
      id: 'order-1',
      orderNo: 'GD-260827-001',
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
    expect(result?.items[0]?.tasks[0]?.taskQrSvg).toContain(
      'https://erp.example.com/worker/tasks/task%2F1',
    );
    expect(buildQrSvgMock).toHaveBeenCalledWith(
      'https://erp.example.com/wo/GD-260827-001',
      95,
      { errorCorrectionLevel: 'Q' },
    );
    expect(buildQrSvgMock).toHaveBeenCalledWith(
      'https://erp.example.com/worker/tasks/task%2F1',
      55,
      { errorCorrectionLevel: 'Q' },
    );
  });
});
