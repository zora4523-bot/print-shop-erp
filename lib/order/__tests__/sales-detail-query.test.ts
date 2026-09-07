import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  DesignFileType,
  OrderChangeRequestStatus,
  OrderCustomerChargeStatus,
  OrderPricingStatus,
  OrderSettlementType,
  OrderStatus,
  Role,
  ShipmentStatus,
} from '../../../generated/prisma/client';

const { dbMock, signDesignReadUrlMock } = vi.hoisted(() => ({
  dbMock: {
    order: {
      findFirst: vi.fn(),
    },
  },
  signDesignReadUrlMock: vi.fn((url: string) => `signed:${url}`),
}));

vi.mock('@/lib/db', () => ({ db: dbMock }));
vi.mock('server-only', () => ({}));
vi.mock('@/lib/oss/read-url', () => ({
  signDesignReadUrl: signDesignReadUrlMock,
}));

import { getSalesOrderDetailById } from '../sales-detail-query';

const actor = { id: 'sales-1', role: Role.SALES };

beforeEach(() => {
  dbMock.order.findFirst.mockReset().mockResolvedValue(null);
  signDesignReadUrlMock.mockClear();
});

describe('sales order detail query boundary', () => {
  it('rejects non-sales actors before reading the database', async () => {
    await expect(
      getSalesOrderDetailById(
        { id: 'admin-1', role: Role.ADMIN },
        'order-1',
      ),
    ).rejects.toThrow('销售工单操作页只接受 SALES 角色');

    expect(dbMock.order.findFirst).not.toHaveBeenCalled();
  });

  it('keeps the lookup owner-scoped and selects no internal production or cost data', async () => {
    await getSalesOrderDetailById(actor, ' order-1 ');

    expect(dbMock.order.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          AND: [{ submitterId: 'sales-1' }, { id: 'order-1' }],
        },
      }),
    );

    const select = dbMock.order.findFirst.mock.calls[0]![0].select;
    expect(select.workOrderVersion).toBe(true);
    expect(select.editVersion).toBe(true);
    expect(select.priceRevision).toBe(true);
    const serializedSelect = JSON.stringify(select);
    for (const forbidden of [
      'tasks',
      'worker',
      'workers',
      'logs',
      'plate',
      'plateDetails',
      'pricingSnapshot',
      'cost',
      'costEntries',
      'outsource',
      'outsourceOrders',
    ]) {
      expect(serializedSelect).not.toContain(`"${forbidden}"`);
    }
  });

  it('signs IMAGE files, suppresses CDR URLs and exposes the complete customer fee breakdown', async () => {
    dbMock.order.findFirst.mockResolvedValue(detailRecord());

    const result = await getSalesOrderDetailById(actor, 'order-1');

    expect(result?.feeLines).toEqual([
      {
        id: 'processing',
        label: '款式加工费',
        amount: '90.00',
        estimated: true,
      },
      {
        id: 'packaging',
        label: '入袋加工费',
        amount: '10.00',
        estimated: true,
      },
      {
        id: 'charge-shipping',
        label: '快递费',
        amount: '41.30',
        estimated: true,
      },
      {
        id: 'charge-plate',
        label: '制烫金版费',
        amount: null,
        estimated: false,
      },
    ]);
    expect(result?.workOrderVersion).toBe(3);
    expect(result?.editVersion).toBe(2);
    expect(result?.priceRevision).toBe(5);
    expect(result?.items[0]?.designs).toEqual([
      {
        id: 'design-image',
        fileName: '设计图.png',
        fileType: DesignFileType.IMAGE,
        fileUrl: 'signed:https://files.example.test/design.png',
        fileSize: '2048',
      },
      {
        id: 'design-cdr',
        fileName: '源文件.cdr',
        fileType: DesignFileType.CDR,
        fileUrl: '',
        fileSize: '4096',
      },
    ]);
    expect(signDesignReadUrlMock).toHaveBeenCalledTimes(1);
    expect(signDesignReadUrlMock).toHaveBeenCalledWith(
      'https://files.example.test/design.png',
    );
    expect(result?.changeRequests).toEqual([
      expect.objectContaining({
        id: 'change-1',
        type: 'MODIFY',
        baseWorkOrderVersion: 2,
        workOrderVersionAfter: null,
        canWithdraw: true,
      }),
    ]);
  });
});

function detailRecord() {
  return {
    id: 'order-1',
    orderNo: 'GD-260827-001',
    customName: '福明礼品袋',
    customerRef: 'PO-20260827',
    status: OrderStatus.SUBMITTED,
    settlementType: OrderSettlementType.EXTERNAL_SALES,
    isUrgent: false,
    isSfCollect: false,
    revision: 1,
    editVersion: 2,
    workOrderVersion: 3,
    priceRevision: 5,
    pricingStatus: OrderPricingStatus.PENDING_ADMIN_CONFIRMATION,
    processingAmount: '100.00',
    packagingAmount: '10.00',
    totalAmount: '141.30',
    promisedDate: new Date('2026-08-31T00:00:00Z'),
    expressCode: 'ZTO',
    packageRequirement: '每款独立入袋',
    remark: '客户周一要货',
    receiverName: '张三',
    receiverPhone: '13800000000',
    receiverAddress: '上海市浦东新区',
    items: [
      {
        id: 'item-1',
        sequence: 1,
        name: '红包 A 款',
        quantity: 2000,
        specification: '90×170mm',
        paperType: '触感纸',
        paperWeightGsm: 120,
        frontFoilColors: ['哑金'],
        backFoilColors: [],
        foilColors: ['哑金'],
        isDoubleSided: false,
        remark: null,
        designs: [
          {
            id: 'design-image',
            fileName: '设计图.png',
            fileType: DesignFileType.IMAGE,
            fileUrl: 'https://files.example.test/design.png',
            fileSize: BigInt(2048),
          },
          {
            id: 'design-cdr',
            fileName: '源文件.cdr',
            fileType: DesignFileType.CDR,
            fileUrl: 'https://files.example.test/source.cdr',
            fileSize: BigInt(4096),
          },
        ],
      },
    ],
    shipments: [
      {
        id: 'shipment-1',
        sequence: 1,
        status: ShipmentStatus.PLANNED,
        receiverName: '张三',
        receiverPhone: '13800000000',
        receiverAddress: '上海市浦东新区',
        expressCode: 'ZTO',
        destinationProvince: '上海',
        trackingNo: null,
        lines: [
          {
            id: 'shipment-line-1',
            quantity: 2000,
            orderItem: { sequence: 1, name: '红包 A 款' },
          },
        ],
      },
    ],
    customerCharges: [
      {
        id: 'charge-shipping',
        description: '快递费',
        amount: '41.30',
        status: OrderCustomerChargeStatus.ESTIMATED,
      },
      {
        id: 'charge-plate',
        description: '制烫金版费',
        amount: null,
        status: OrderCustomerChargeStatus.PENDING_AMOUNT,
      },
    ],
    changeRequests: [
      {
        id: 'change-1',
        type: 'MODIFY',
        requesterId: 'sales-1',
        status: OrderChangeRequestStatus.PENDING,
        baseRevision: 1,
        baseWorkOrderVersion: 2,
        workOrderVersionAfter: null,
        reason: '客户申请改数量',
        reviewRemark: null,
        reviewedAt: null,
        createdAt: new Date('2026-08-27T08:00:00Z'),
      },
    ],
  };
}
