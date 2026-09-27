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
      'customerRef',
      'customerParty',
      'customerPartyId',
    ]) {
      expect(serializedSelect).not.toContain(`"${forbidden}"`);
    }
  });

  it('never exposes the retired order customer to the sales detail page', async () => {
    // Over-rich record: even if an adapter returned the legacy columns, the DTO must drop them.
    dbMock.order.findFirst.mockResolvedValue({ ...detailRecord(), customerPartyId: 'party-1' });

    const result = await getSalesOrderDetailById(actor, 'order-1');

    expect(result).not.toBeNull();
    expect(result).not.toHaveProperty('customerRef');
    expect(result).not.toHaveProperty('customerPartyId');
    expect(JSON.stringify(result)).not.toContain('PO-20260827');
    expect(JSON.stringify(result)).not.toContain('party-1');
  });

  it('signs IMAGE files, suppresses CDR URLs and exposes the complete customer fee breakdown', async () => {
    dbMock.order.findFirst.mockResolvedValue(detailRecord());

    const result = await getSalesOrderDetailById(actor, 'order-1');
    expect(result?.packagingGroups).toEqual([{
      id: 'pack-1', sequence: 1, name: '礼盒混装', mode: 'MIXED_STYLE', actualBagCount: 200,
      lines: [{ itemSequence: 1, itemName: '款式甲', unitsPerBag: 5 }],
    }]);


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
        canWithdraw: true,
      }),
    ]);
    expect(result?.changeRequests[0]).not.toHaveProperty('baseWorkOrderVersion');
    expect(result?.changeRequests[0]).not.toHaveProperty('workOrderVersionAfter');
  });

  it('returns persisted customer configuration, carrier details and address-linked charges', async () => {
    const record = detailRecord();
    dbMock.order.findFirst.mockResolvedValue({
      ...record,
      items: [{ ...record.items[0], craft: 'PRINT', pricingRoute: 'COLOR_PRINT',
        productStructure: 'WESTERN_ENVELOPE', actualWidthMm: '91.25', actualHeightMm: '166.50',
        paperType: '触感纸 160g', paperWeightGsm: 160, artworkVersion: '客户确认V2',
        foilTechnique: 'RELIEF', frontFoilColors: ['红金', '哑金'], backFoilColors: ['黑金'],
        lamination: 'SOFT_TOUCH', printColors: ['青', '品红'], printColorsKnown: true, hasLocalFoil: true,
        plateGroupId: 'private-plate', pricingSnapshot: { private: 'private-rule' },
      }],
      shipments: [record.shipments[0], { ...record.shipments[0], id: 'shipment-2', sequence: 2,
        carrierCode: 'SF', carrierName: '顺丰速运', trackingNo: 'SF123', shippedAt: new Date('2026-09-12T03:00:00Z'),
      }],
      customerCharges: [{ ...record.customerCharges[0], shipment: { sequence: 2 } }],
    });
    const result = await getSalesOrderDetailById(actor, 'order-1');
    expect(result?.items[0]?.details).toEqual(expect.arrayContaining([
      { label: '实际尺寸', value: '91.25 × 166.50 mm' },
      { label: '正面烫金', value: '红金、哑金' }, { label: '反面烫金', value: '黑金' },
      { label: '纸张', value: '触感纸 160g' }, { label: '覆膜', value: '触感膜' },
      { label: '彩印颜色', value: '青、品红' }, { label: '稿件版本', value: '客户确认V2' },
    ]));
    expect(result?.shipments[1]).toMatchObject({ carrier: '顺丰速运', trackingNo: 'SF123', shippedAt: '2026-09-12T03:00:00.000Z' });
    expect(result?.feeLines.at(-1)?.label).toBe('地址 2 · 快递费');
    expect(JSON.stringify(result)).not.toContain('private-');
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
    packagingGroups: [{
      id: 'pack-1', sequence: 1, name: '礼盒混装', mode: 'MIXED_STYLE', actualBagCount: 200,
      lines: [{ unitsPerBag: 5, orderItem: { sequence: 1, name: '款式甲' } }],
      pricingSnapshot: { privateRule: 'must-not-leak' }, unitPrice: '0.2',
    }],
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

it('projects the current factory reason and affected figures, dropping actor and internal recovery evidence', async () => {
  dbMock.order.findFirst.mockResolvedValue({ ...detailRecord(), status: OrderStatus.REJECTED,
    workflowDecisions: [{ toStatus: OrderStatus.REJECTED, reasonCode: 'DESIGN_ERROR', reasonNote: '请修正文字', affectedFigs: [1], createdAt: new Date('2026-09-12T00:00:00Z'), actorId: 'private-actor', recoveryEvidence: 'private-evidence' }] });
  const result = await getSalesOrderDetailById(actor, 'order-1');
  expect(result?.workflowDecision).toEqual({ reason: '设计图有误', note: '请修正文字', affectedFigs: [1], createdAt: '2026-09-12T00:00:00.000Z' });
  expect(JSON.stringify(result)).not.toContain('private-');
  dbMock.order.findFirst.mockResolvedValue({ ...detailRecord(), status: OrderStatus.CONFIRMED,
    workflowDecisions: [{ toStatus: OrderStatus.REJECTED, reasonCode: 'DESIGN_ERROR' }] });
  expect((await getSalesOrderDetailById(actor, 'order-1'))?.workflowDecision).toBeNull();
});
