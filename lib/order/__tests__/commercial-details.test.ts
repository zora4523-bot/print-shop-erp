vi.mock('server-only', () => ({}));
vi.mock('../production-readiness', () => ({ prepareOrderForProductionInTx: vi.fn(async () => ({ ready: false, status: 'SUBMITTED', issues: [] })) }));
vi.mock('@/lib/production-completion', () => ({ dispatchProductionCompletionNotification: vi.fn() }));
vi.mock('@/lib/production/preparation-notification', () => ({ dispatchPreparedProduction: vi.fn() }));
import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  OrderCustomerChargeStatus,
  OrderItemPricingRoute,
  OrderPricingStatus,
  OrderSettlementType,
  OrderStatus,
  Role,
} from '@/generated/prisma/enums';

const { dbMock, appendRevisionMock } = vi.hoisted(() => {
  const tx = {
    $executeRaw: vi.fn(),
    order: { findUnique: vi.fn(), update: vi.fn() },
    orderItem: { findFirst: vi.fn() },
    orderItemPlateDetail: {
      findFirst: vi.fn(),
      aggregate: vi.fn(),
      create: vi.fn(),
      update: vi.fn(),
    },
    customerChargeCategory: { findUnique: vi.fn() },
    orderCustomerCharge: {
      findFirst: vi.fn(),
      findUnique: vi.fn(),
      create: vi.fn(),
      update: vi.fn(),
      upsert: vi.fn(),
      aggregate: vi.fn(),
    },
    orderLog: { create: vi.fn() },
  };
  return {
    dbMock: {
      tx,
      $transaction: vi.fn(async (fn: (client: typeof tx) => unknown) => fn(tx)),
    },
    appendRevisionMock: vi.fn(),
  };
});

vi.mock('@/lib/db', () => ({ db: dbMock }));
vi.mock('@/lib/order/pricing-revision', () => ({
  appendOrderPricingRevisionInTx: appendRevisionMock,
}));

import {
  deleteOrderPlateDetail,
  OrderCommercialDetailsError,
  saveOrderManualCharge,
  saveOrderPlateDetail,
} from '@/lib/order/commercial-details';

const actor = { id: 'admin-1', role: Role.ADMIN };

function plateEligibleItem() {
  return {
    id: 'item-1',
    sequence: 1,
    name: '款式 A',
    specification: '大号封',
    pricingRoute: OrderItemPricingRoute.CUSTOM_SINGLE_FLAT_FOIL,
    frontFoilColors: ['哑金'],
    backFoilColors: [],
    foilColors: ['哑金'],
    isDoubleSided: false,
  };
}

function mutableOrder() {
  return {
    id: 'order-1',
    orderNo: 'O-1',
    status: OrderStatus.SUBMITTED,
    settlementType: OrderSettlementType.EXTERNAL_SALES,
    pricingStatus: OrderPricingStatus.ADMIN_CONFIRMED,
    priceRevision: 2,
    revision: 4,
    processingAmount: { toString: () => '100.00' },
    totalAmount: { toString: () => '120.00' },
    quotedFee: { toString: () => '120.00' },
    quotedPricingRevisionId: 'pricing-revision-2',
    confirmedFee: { toString: () => '120.00' },
    settledFee: null,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  dbMock.tx.order.findUnique.mockResolvedValue(mutableOrder());
  dbMock.tx.order.update.mockResolvedValue({ id: 'order-1' });
  dbMock.tx.orderLog.create.mockResolvedValue({ id: 'log-1' });
  dbMock.tx.customerChargeCategory.findUnique.mockResolvedValue({
    id: 'category-1',
    isActive: true,
  });
  dbMock.tx.orderCustomerCharge.findUnique.mockResolvedValue(null);
  dbMock.tx.orderCustomerCharge.aggregate.mockResolvedValue({
    _sum: { amount: { toString: () => '0.00' } },
  });
  appendRevisionMock.mockResolvedValue({
    pricingRevisionId: 'pricing-revision-3',
    priceRevision: 3,
    orderRevision: 5,
    snapshot: {},
  });
});

describe('saveOrderManualCharge', () => {
  it('supports a signed approved adjustment and recalculates the order total', async () => {
    dbMock.tx.orderCustomerCharge.create.mockResolvedValue({ id: 'charge-1' });
    dbMock.tx.orderCustomerCharge.aggregate.mockResolvedValue({
      _sum: { amount: { toString: () => '-25.00' } },
    });

    const result = await saveOrderManualCharge(
      {
        orderId: 'order-1',
        chargeId: null,
        expectedPriceRevision: 2,
        categoryCode: 'APPROVED_ADJUSTMENT',
        description: '售后折让',
        amount: '-25.00',
        reason: '交期延误',
        approvalReference: '管理员审批单 AP-1',
      },
      actor,
      new Date('2026-08-26T10:00:00.000Z'),
    );

    expect(dbMock.tx.orderCustomerCharge.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          status: OrderCustomerChargeStatus.FINAL,
          amount: '-25.00',
          isAdjustment: true,
          approvalReference: '管理员审批单 AP-1',
          finalizedById: 'admin-1',
        }),
      }),
    );
    expect(dbMock.tx.order.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          totalAmount: '75.00',
          confirmedFee: '75.00',
          settledFee: null,
        }),
      }),
    );
    expect(appendRevisionMock).toHaveBeenCalledWith(
      dbMock.tx,
      expect.objectContaining({
        status: OrderPricingStatus.ADMIN_CONFIRMED,
        orderFeeSnapshot: {
          quotedFee: '120.00',
          confirmedFee: '75.00',
          settledFee: null,
        },
      }),
    );
    expect(result).toMatchObject({ priceRevision: 3, totalAmount: '75.00' });
  });

  it('refreshes and links the quoted fee while administrator confirmation is pending', async () => {
    dbMock.tx.order.findUnique.mockResolvedValue({
      ...mutableOrder(),
      pricingStatus: OrderPricingStatus.PENDING_ADMIN_CONFIRMATION,
    });
    dbMock.tx.orderCustomerCharge.create.mockResolvedValue({ id: 'charge-1' });
    dbMock.tx.orderCustomerCharge.aggregate.mockResolvedValue({
      _sum: { amount: { toString: () => '-25.00' } },
    });

    await saveOrderManualCharge(
      {
        orderId: 'order-1',
        chargeId: null,
        expectedPriceRevision: 2,
        categoryCode: 'APPROVED_ADJUSTMENT',
        description: '售后折让',
        amount: '-25.00',
        reason: '交期延误',
        approvalReference: '管理员审批单 AP-1',
      },
      actor,
      new Date('2026-08-26T10:00:00.000Z'),
    );

    expect(dbMock.tx.order.update).toHaveBeenNthCalledWith(1, {
      where: { id: 'order-1' },
      data: {
        totalAmount: '75.00',
        quotedFee: '75.00',
        confirmedFee: null,
        settledFee: null,
      },
      select: { id: true },
    });
    expect(appendRevisionMock).toHaveBeenCalledWith(
      dbMock.tx,
      expect.objectContaining({
        status: OrderPricingStatus.PENDING_ADMIN_CONFIRMATION,
        orderFeeSnapshot: {
          quotedFee: '75.00',
          confirmedFee: null,
          settledFee: null,
        },
      }),
    );
    expect(dbMock.tx.order.update).toHaveBeenNthCalledWith(2, {
      where: { id: 'order-1' },
      data: { quotedPricingRevisionId: 'pricing-revision-3' },
      select: { id: true },
    });
    expect(dbMock.tx.orderLog.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          changedFields: expect.objectContaining({
            quotedFee: { before: '120.00', after: '75.00' },
            quotedPricingRevisionId: {
              before: 'pricing-revision-2',
              after: 'pricing-revision-3',
            },
          }),
        }),
      }),
    );
  });

  it('rejects a negative sample fee at the domain boundary', async () => {
    await expect(
      saveOrderManualCharge(
        {
          orderId: 'order-1',
          chargeId: null,
          expectedPriceRevision: 2,
          categoryCode: 'SAMPLE_FEE',
          description: '打样',
          amount: '-1.00',
          reason: '测试',
          approvalReference: null,
        },
        actor,
      ),
    ).rejects.toThrow(new OrderCommercialDetailsError('收费金额不能为负数'));
  });
});

describe('order plate details', () => {
  it('appends a plate row and mirrors its calculated amount to customer charges', async () => {
    dbMock.tx.orderItem.findFirst.mockResolvedValue(plateEligibleItem());
    dbMock.tx.orderItemPlateDetail.aggregate.mockResolvedValue({
      _max: { sequence: 1 },
    });
    dbMock.tx.orderItemPlateDetail.create.mockResolvedValue({ id: 'plate-2' });
    dbMock.tx.orderCustomerCharge.upsert.mockResolvedValue({ id: 'charge-2' });
    dbMock.tx.orderCustomerCharge.aggregate.mockResolvedValue({
      _sum: { amount: { toString: () => '35.00' } },
    });

    const result = await saveOrderPlateDetail(
      {
        orderId: 'order-1',
        orderItemId: 'item-1',
        plateDetailId: null,
        expectedPriceRevision: 2,
        name: '烫金版',
        plateGroupId: 'PG-1',
        specification: '80 × 50 mm',
        quantity: 2,
        unitPrice: '17.50',
        remark: null,
      },
      actor,
      new Date('2026-08-26T10:00:00.000Z'),
    );

    expect(dbMock.tx.orderItemPlateDetail.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          sequence: 2,
          quantity: 2,
          unitPrice: '17.50',
          amount: '35.00',
        }),
      }),
    );
    expect(dbMock.tx.orderCustomerCharge.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        create: expect.objectContaining({
          businessKey: expect.stringMatching(/^PLATE_DETAIL:/),
          amount: '35.00',
          isAdjustment: false,
        }),
      }),
    );
    expect(result).toMatchObject({ priceRevision: 3, totalAmount: '135.00' });
    // 同一设计款的规格行共用款名，日志须带序号与规格才能指认是哪一行。
    expect(appendRevisionMock).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        remark: '第 1 款“款式 A”（大号封） · 烫金版 · 35.00 元',
      }),
    );
    expect(dbMock.tx.orderItem.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        select: expect.objectContaining({ sequence: true, specification: true }),
      }),
    );
  });

  it('waives the aggregate pending plate fee before structured plate rows become authoritative', async () => {
    dbMock.tx.orderItem.findFirst.mockResolvedValue(plateEligibleItem());
    dbMock.tx.orderItemPlateDetail.aggregate.mockResolvedValue({
      _max: { sequence: 0 },
    });
    dbMock.tx.orderItemPlateDetail.create.mockResolvedValue({ id: 'plate-1' });
    dbMock.tx.orderCustomerCharge.findUnique.mockResolvedValue({
      id: 'aggregate-plate',
      status: OrderCustomerChargeStatus.ESTIMATED,
      amount: { toString: () => '30.00' },
      pricingSnapshot: { source: 'ADMIN_SNAPSHOT_CONFIRMATION' },
    });
    dbMock.tx.orderCustomerCharge.update.mockResolvedValue({
      id: 'aggregate-plate',
    });
    dbMock.tx.orderCustomerCharge.upsert.mockResolvedValue({ id: 'charge-1' });

    await saveOrderPlateDetail(
      {
        orderId: 'order-1',
        orderItemId: 'item-1',
        plateDetailId: null,
        expectedPriceRevision: 2,
        name: '烫金版',
        plateGroupId: null,
        specification: null,
        quantity: 1,
        unitPrice: '35.00',
        remark: null,
      },
      actor,
      new Date('2026-08-26T10:00:00.000Z'),
    );

    expect(dbMock.tx.orderCustomerCharge.update).toHaveBeenCalledWith({
      where: { id: 'aggregate-plate' },
      data: expect.objectContaining({
        status: OrderCustomerChargeStatus.WAIVED,
        amount: '0.00',
        pricingSnapshot: expect.objectContaining({
          source: 'PLATE_DETAIL_BREAKDOWN_SUPERSEDES_AGGREGATE',
          previousAmount: '30.00',
          previousSnapshot: { source: 'ADMIN_SNAPSHOT_CONFIRMATION' },
        }),
      }),
      select: { id: true },
    });
    expect(dbMock.tx.orderCustomerCharge.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        create: expect.objectContaining({ amount: '35.00' }),
      }),
    );
  });

  it('soft-removes a plate row and waives its linked customer charge', async () => {
    dbMock.tx.orderItemPlateDetail.findFirst.mockResolvedValue({
      id: 'plate-1',
      name: '烫金版',
      amount: { toString: () => '35.00' },
    });
    dbMock.tx.orderItemPlateDetail.update.mockResolvedValue({ id: 'plate-1' });
    dbMock.tx.orderCustomerCharge.update.mockResolvedValue({ id: 'charge-1' });

    await deleteOrderPlateDetail(
      {
        orderId: 'order-1',
        orderItemId: 'item-1',
        plateDetailId: 'plate-1',
        expectedPriceRevision: 2,
        reason: '客户取消制版',
      },
      actor,
      new Date('2026-08-26T10:00:00.000Z'),
    );

    expect(dbMock.tx.orderItemPlateDetail.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          isActive: false,
          removedById: 'admin-1',
        }),
      }),
    );
    expect(dbMock.tx.orderCustomerCharge.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          status: OrderCustomerChargeStatus.WAIVED,
          amount: '0.00',
        }),
      }),
    );
  });

  it.each(['save', 'delete'] as const)(
    'rejects plate-detail %s while administrator pricing is pending',
    async (operation) => {
      dbMock.tx.order.findUnique.mockResolvedValue({
        ...mutableOrder(),
        pricingStatus: OrderPricingStatus.PENDING_ADMIN_CONFIRMATION,
      });

      const result =
        operation === 'save'
          ? saveOrderPlateDetail(
              {
                orderId: 'order-1',
                orderItemId: 'item-1',
                plateDetailId: null,
                expectedPriceRevision: 2,
                name: '烫金版',
                plateGroupId: null,
                specification: null,
                quantity: 1,
                unitPrice: '30.00',
                remark: null,
              },
              actor,
            )
          : deleteOrderPlateDetail(
              {
                orderId: 'order-1',
                orderItemId: 'item-1',
                plateDetailId: 'plate-1',
                expectedPriceRevision: 2,
                reason: '纠正错误明细',
              },
              actor,
            );

      await expect(result).rejects.toThrow(/工单价格复核中直接填写制烫金版费/u);
      expect(dbMock.tx.orderItemPlateDetail.create).not.toHaveBeenCalled();
      expect(dbMock.tx.orderItemPlateDetail.update).not.toHaveBeenCalled();
      expect(dbMock.tx.orderCustomerCharge.update).not.toHaveBeenCalled();
    },
  );

  it.each([
    {
      label: 'a non-foil item',
      item: {
        ...plateEligibleItem(),
        frontFoilColors: [],
        foilColors: [],
      },
      message: /没有烫金事实/u,
    },
    {
      label: 'a color-print item whose whole price includes plate cost',
      item: {
        ...plateEligibleItem(),
        pricingRoute: OrderItemPricingRoute.COLOR_PRINT,
      },
      message: /彩印烫金按含版费整款价/u,
    },
  ])('rejects an independent plate detail for $label', async ({ item, message }) => {
    dbMock.tx.orderItem.findFirst.mockResolvedValue(item);

    await expect(
      saveOrderPlateDetail(
        {
          orderId: 'order-1',
          orderItemId: 'item-1',
          plateDetailId: null,
          expectedPriceRevision: 2,
          name: '错误版费',
          plateGroupId: null,
          specification: null,
          quantity: 1,
          unitPrice: '30.00',
          remark: null,
        },
        actor,
      ),
    ).rejects.toThrow(message);
    expect(dbMock.tx.orderItemPlateDetail.create).not.toHaveBeenCalled();
    expect(dbMock.tx.orderCustomerCharge.upsert).not.toHaveBeenCalled();
  });
});

it('rejects commercial amount mutations after settlement', async () => {
  dbMock.tx.order.findUnique.mockResolvedValue({
    ...mutableOrder(),
    status: OrderStatus.SETTLED,
  });

  await expect(
    saveOrderManualCharge(
      {
        orderId: 'order-1',
        chargeId: null,
        expectedPriceRevision: 2,
        categoryCode: 'SAMPLE_FEE',
        description: '打样费',
        amount: '10.00',
        reason: '已结算后不应写入',
        approvalReference: null,
      },
      actor,
    ),
  ).rejects.toThrow(/已结算/u);
  expect(dbMock.tx.orderCustomerCharge.create).not.toHaveBeenCalled();
  expect(dbMock.tx.order.update).not.toHaveBeenCalled();
});


it('protects already-settled fees even when an old order has a mutable status', async () => {
  dbMock.tx.order.findUnique.mockResolvedValue({ ...mutableOrder(), settledFee: { toString: () => '118.00' } });
  await expect(saveOrderManualCharge({ orderId: 'order-1', chargeId: null, expectedPriceRevision: 2, categoryCode: 'APPROVED_ADJUSTMENT', description: '优惠', amount: '-1', reason: '优惠', approvalReference: '管理员确认' }, actor)).rejects.toThrow('已结算');
  expect(dbMock.tx.orderCustomerCharge.create).not.toHaveBeenCalled();
});
