import Decimal from 'decimal.js';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  OrderBillingMode,
  OrderCustomerChargeStatus,
  OrderItemQuoteDisposition,
  OrderPricingStatus,
  OrderStatus,
  OrderWorkflowAction,
  OrderWorkflowReasonCode,
  Role,
} from '../../../generated/prisma/enums';

const {
  dbMock,
  tx,
  databaseClockNowMock,
  activateMock,
  createPrintMock,
  prepareProductionMock,
  enqueueNotificationMock,
  dispatchNotificationMock,
  completionMock,
  completionDispatchMock,
} = vi.hoisted(() => {
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
      prepareProductionMock: vi.fn(),
      enqueueNotificationMock: vi.fn(),
      dispatchNotificationMock: vi.fn(),
      completionMock: vi.fn(),
      completionDispatchMock: vi.fn(),
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
vi.mock('@/lib/order/production-readiness', () => ({ prepareOrderForProductionInTx: prepareProductionMock }));
vi.mock('@/lib/notification/transactional-outbox', () => ({
  enqueueNotificationInTransaction: enqueueNotificationMock,
}));
vi.mock('@/lib/notification/dispatch', () => ({
  dispatchNotification: dispatchNotificationMock,
}));
vi.mock('@/lib/production-completion', () => ({
  maybeCompleteProductionOrder: completionMock,
  dispatchProductionCompletionNotification: completionDispatchMock,
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
import {
  buildTrustedAdminChargePricingSnapshot,
  buildTrustedAdminItemPricingSnapshot,
  buildTrustedAdminPackagingPricingSnapshot,
} from '../admin-pricing-snapshot';

const admin = { id: 'admin-1', role: Role.ADMIN };
const sales = { id: 'sales-1', role: Role.SALES };
const settledAt = new Date('2026-09-02T03:04:05.000Z');
const factoryQuoteToken = `create-order-quote-v2:${'a'.repeat(64)}`;

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
    items: [
      {
        fig: 1,
        quantity: 1_000,
        quoteDisposition: OrderItemQuoteDisposition.PRICED,
        manualQuoteReason: null,
        pricingSnapshot: {
          status: 'QUOTED',
          actual: { requiresAdminConfirmation: false },
        },
      },
    ],
    packagingGroups: [],
    customerCharges: [],
    _count: { changeRequests: 0 },
    ...overrides,
  };
}

function trustedManualItem() {
  const item = {
    id: 'item-manual',
    orderId: 'order-1',
    fig: 1,
    productId: null,
    pricingRoute: 'CUSTOM_SINGLE_FLAT_FOIL',
    craft: null,
    productStructure: 'STANDARD_ENVELOPE',
    plateGroupId: null,
    pricingGroup: 'MID',
    manualQuoteReason: '特殊工艺人工核价',
    specification: '中号封',
    actualWidthMm: null,
    actualHeightMm: null,
    paperType: '珠光纸',
    paperWeightGsm: 160,
    quantity: 1_000,
    pack: null,
    crafts: ['craft-foil'],
    frontFoilColors: ['哑金'],
    backFoilColors: [],
    foilColors: ['哑金'],
    foilTechnique: 'FLAT',
    hasLocalFoil: true,
    lamination: 'NONE',
    printColors: [],
    printColorsKnown: true,
    isDoubleSided: false,
    isDoubleColor: false,
    unitPrice: new Decimal('0.1000'),
    fixedFee: new Decimal('0.00'),
    subtotal: new Decimal('100.00'),
    priceOverrideReason: '特殊工艺人工核价',
    quoteDisposition: OrderItemQuoteDisposition.MANUAL_PRICING_REQUIRED,
  };
  return {
    ...item,
    pricingSnapshot: buildTrustedAdminItemPricingSnapshot({
      previous: null,
      now: settledAt,
      actorId: admin.id,
      previousPriceRevision: 3,
      item,
    }),
  };
}

function trustedManualPackaging() {
  const group = {
    id: 'group-manual',
    orderId: 'order-1',
    mode: 'SINGLE_STYLE',
    actualBagCount: 100,
    unitPrice: new Decimal('0.1050'),
    subtotal: new Decimal('10.50'),
    priceOverrideReason: '人工确认入袋费',
    lines: [{ orderItemId: 'item-manual', unitsPerBag: 10 }],
  };
  return {
    ...group,
    pricingSnapshot: buildTrustedAdminPackagingPricingSnapshot({
      previous: null,
      now: settledAt,
      actorId: admin.id,
      previousPriceRevision: 3,
      group,
    }),
  };
}

function trustedManualCharge() {
  const charge = {
    orderId: 'order-1',
    businessKey: 'SHIPMENT:1:SHIPPING_FEE',
    shipmentId: 'shipment-1',
    status: OrderCustomerChargeStatus.ESTIMATED,
    priceBookId: 'logistics-v2',
    sourceRuleId: 'shipping-rule-1',
    quantity: new Decimal('2.000'),
    unit: 'kg',
    unitPrice: new Decimal('9.0000'),
    suggestedAmount: new Decimal('18.00'),
    amount: new Decimal('18.00'),
    isAdjustment: false,
    approvalReference: null,
    overrideReason: null,
    category: { code: 'SHIPPING_FEE' },
  };
  return {
    ...charge,
    pricingSnapshot: buildTrustedAdminChargePricingSnapshot({
      previous: null,
      now: settledAt,
      actorId: admin.id,
      previousPriceRevision: 3,
      charge: { ...charge, categoryCode: charge.category.code },
    }),
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
    operationIds: ['operation-1'],
    operationsCreated: 1,
    progressStepIds: ['progress-step-1'],
    progressStepsCreated: 1,
    idempotentReplay: false,
  });
  createPrintMock.mockResolvedValue({
    jobId: 'print-1',
    idempotentReplay: false,
  });
  prepareProductionMock.mockResolvedValue({
    ready: true, status: OrderStatus.CONFIRMED, issues: [],
    confirmedFee: '128.50',
    pricingRevisionId: 'pricing-confirmed-1',
    versions: null,
  });
  enqueueNotificationMock.mockResolvedValue(true);
  dispatchNotificationMock.mockResolvedValue(undefined);
  completionMock.mockResolvedValue({
    completed: false,
    blockedBy: 'INTERNAL_TASKS',
    uncoveredItems: [],
  });
  completionDispatchMock.mockResolvedValue(undefined);
});

describe('admin order workflow', () => {
  it('rejects non-admin actors before opening a transaction', async () => {
    await expect(
      confirmFactoryOrder(
        {
          orderId: 'order-1',
          expectedRevision: 4,
          expectedWorkOrderVersion: 2,
          expectedQuoteToken: factoryQuoteToken,
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
          expectedQuoteToken: factoryQuoteToken,
        },
        admin,
      ),
    ).resolves.toEqual({
      orderId: 'order-1',
      status: OrderStatus.CONFIRMED,
      confirmedFee: '128.50',
    });
    expect(prepareProductionMock).toHaveBeenCalledWith(tx, 'order-1', admin, settledAt);
    expect(activateMock).not.toHaveBeenCalled();
    expect(createPrintMock).not.toHaveBeenCalled();
  });

  it('prepares an old pending order and releases it in the same transaction', async () => {
    tx.order.findUnique.mockReset()
      .mockResolvedValueOnce(order())
      .mockResolvedValue(order({ status: OrderStatus.CONFIRMED, confirmedFee: new Decimal('128.50') }));
    await expect(releaseFactoryOrder({ orderId: 'order-1', expectedRevision: 4,
      expectedWorkOrderVersion: 2, printIdempotencyKey: 'release-pending-order-1' }, admin))
      .resolves.toMatchObject({ status: OrderStatus.RELEASED, printJobId: 'print-1' });
    expect(prepareProductionMock).toHaveBeenCalledWith(tx, 'order-1', admin, settledAt);
    expect(activateMock).toHaveBeenCalledOnce();
    expect(createPrintMock).toHaveBeenCalledOnce();
    expect(dbMock.$transaction).toHaveBeenCalledOnce();
  });

  it('does not release or print a pending order whose saved facts fail validation', async () => {
    prepareProductionMock.mockResolvedValueOnce({ ready: false, status: OrderStatus.PENDING_FACTORY, issues: ['费用明细不一致'] });
    await expect(releaseFactoryOrder({ orderId: 'order-1', expectedRevision: 4,
      expectedWorkOrderVersion: 2, printIdempotencyKey: 'release-blocked-order-1' }, admin))
      .rejects.toMatchObject({ code: 'PREFLIGHT_FAILED', message: '费用明细不一致' });
    expect(activateMock).not.toHaveBeenCalled();
    expect(createPrintMock).not.toHaveBeenCalled();
  });

  it('checks the submitted revision before preparing or releasing an old pending order', async () => {
    await expect(releaseFactoryOrder({ orderId: 'order-1', expectedRevision: 3,
      expectedWorkOrderVersion: 2, printIdempotencyKey: 'release-stale-order-1' }, admin))
      .rejects.toMatchObject({ code: 'STALE_VERSION' });
    expect(prepareProductionMock).not.toHaveBeenCalled();
    expect(activateMock).not.toHaveBeenCalled();
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
          expectedQuoteToken: factoryQuoteToken,
        },
        admin,
      ),
    ).rejects.toBeInstanceOf(AdminOrderWorkflowError);
    expect(tx.order.update).not.toHaveBeenCalled();
  });

  it('rejects a drifted confirmed status while a customer charge is still pending', async () => {
    tx.order.findUnique.mockResolvedValueOnce(
      order({
        pricingStatus: OrderPricingStatus.ADMIN_CONFIRMED,
        confirmedFee: new Decimal('128.50'),
        customerCharges: [
          {
            status: OrderCustomerChargeStatus.PENDING_AMOUNT,
            amount: null,
            pricingSnapshot: {
              status: 'PENDING_AMOUNT',
              actual: { requiresAdminConfirmation: true },
            },
          },
        ],
      }),
    );

    await expect(
      confirmFactoryOrder(
        {
          orderId: 'order-1',
          expectedRevision: 4,
          expectedWorkOrderVersion: 2,
          expectedQuoteToken: factoryQuoteToken,
        },
        admin,
      ),
    ).rejects.toMatchObject({ code: 'PREFLIGHT_FAILED' });
    expect(prepareProductionMock).not.toHaveBeenCalled();
    expect(tx.order.update).not.toHaveBeenCalled();
  });

  it('rejects unresolved item or packaging pricing even if the top-level status drifted', async () => {
    for (const unresolved of [
      {
        items: [
          {
            fig: 1,
            quantity: 1_000,
            quoteDisposition:
              OrderItemQuoteDisposition.MANUAL_PRICING_REQUIRED,
            manualQuoteReason: '特殊工艺未配置价格',
            pricingSnapshot: {
              status: 'MANUAL_PRICING_REQUIRED',
              actual: { requiresAdminConfirmation: true },
            },
          },
        ],
      },
      {
        packagingGroups: [
          {
            pricingSnapshot: {
              status: 'PENDING_AMOUNT',
              complete: false,
              actual: { requiresAdminConfirmation: true },
            },
          },
        ],
      },
    ]) {
      vi.clearAllMocks();
      tx.$executeRaw.mockResolvedValue(0);
      tx.order.findUnique.mockResolvedValueOnce(
        order({
          ...unresolved,
          pricingStatus: OrderPricingStatus.ADMIN_CONFIRMED,
          confirmedFee: new Decimal('128.50'),
        }),
      );

      await expect(
        confirmFactoryOrder(
          {
            orderId: 'order-1',
            expectedRevision: 4,
            expectedWorkOrderVersion: 2,
            expectedQuoteToken: factoryQuoteToken,
          },
          admin,
        ),
      ).rejects.toMatchObject({ code: 'PREFLIGHT_FAILED' });
      expect(prepareProductionMock).not.toHaveBeenCalled();
      expect(tx.order.update).not.toHaveBeenCalled();
    }
  });

  it('rejects every explicit unresolved detail signal instead of trusting a non-null placeholder amount', async () => {
    for (const unresolved of [
      {
        items: [
          {
            fig: 1,
            quantity: 1_000,
            quoteDisposition: OrderItemQuoteDisposition.PRICED,
            manualQuoteReason: '仍需管理员核价',
            pricingSnapshot: {
              status: 'QUOTED',
              actual: { requiresAdminConfirmation: false },
            },
          },
        ],
      },
      {
        packagingGroups: [
          {
            pricingSnapshot: {
              status: 'EXCLUDED_MANUAL',
              actual: { amount: '0.00' },
            },
          },
        ],
      },
      {
        customerCharges: [
          {
            status: OrderCustomerChargeStatus.ESTIMATED,
            amount: new Decimal('0.00'),
            pricingSnapshot: {
              status: 'MANUAL_PRICING_REQUIRED',
              actual: { requiresAdminConfirmation: true },
            },
          },
        ],
      },
      {
        customerCharges: [
          {
            status: OrderCustomerChargeStatus.WAIVED,
            amount: new Decimal('12.00'),
            pricingSnapshot: null,
          },
        ],
      },
      {
        items: [
          {
            fig: 1,
            quantity: 1_000,
            quoteDisposition: OrderItemQuoteDisposition.PRICED,
            manualQuoteReason: null,
            pricingSnapshot: { status: 'ADMIN_CONFIRMED' },
          },
        ],
      },
      {
        packagingGroups: [
          { pricingSnapshot: { source: 'ADMIN_SNAPSHOT_CONFIRMATION' } },
        ],
      },
      {
        customerCharges: [
          {
            orderId: 'order-1',
            businessKey: 'SHIPMENT:1:SHIPPING_FEE',
            shipmentId: 'shipment-1',
            status: OrderCustomerChargeStatus.ESTIMATED,
            amount: new Decimal('18.00'),
            overrideReason: null,
            category: { code: 'SHIPPING_FEE' },
            pricingSnapshot: { status: 'ADMIN_CONFIRMED' },
          },
        ],
      },
    ]) {
      vi.clearAllMocks();
      tx.$executeRaw.mockResolvedValue(0);
      tx.order.findUnique.mockResolvedValueOnce(
        order({
          ...unresolved,
          pricingStatus: OrderPricingStatus.ADMIN_CONFIRMED,
          confirmedFee: new Decimal('128.50'),
        }),
      );

      await expect(
        confirmFactoryOrder(
          {
            orderId: 'order-1',
            expectedRevision: 4,
            expectedWorkOrderVersion: 2,
            expectedQuoteToken: factoryQuoteToken,
          },
          admin,
        ),
      ).rejects.toMatchObject({ code: 'PREFLIGHT_FAILED' });
      expect(prepareProductionMock).not.toHaveBeenCalled();
      expect(tx.order.update).not.toHaveBeenCalled();
    }
  });

  it('accepts manually-priced details only with trusted admin confirmation snapshots', async () => {
    tx.order.findUnique.mockResolvedValueOnce(
      order({
        pricingStatus: OrderPricingStatus.ADMIN_CONFIRMED,
        confirmedFee: new Decimal('128.50'),
        items: [trustedManualItem()],
        packagingGroups: [trustedManualPackaging()],
        customerCharges: [trustedManualCharge()],
      }),
    );

    await expect(
      confirmFactoryOrder(
        {
          orderId: 'order-1',
          expectedRevision: 4,
          expectedWorkOrderVersion: 2,
          expectedQuoteToken: factoryQuoteToken,
        },
        admin,
      ),
    ).resolves.toMatchObject({ status: OrderStatus.CONFIRMED });
    expect(prepareProductionMock).toHaveBeenCalledTimes(1);
  });

  it.each([
    {
      label: '款式小计',
      details: {
        items: [
          {
            fig: 1,
            quantity: 1_000,
            unitPrice: new Decimal('0.1000'),
            fixedFee: new Decimal('0.00'),
            subtotal: new Decimal('101.00'),
            priceOverrideReason: '特殊工艺人工核价',
            quoteDisposition:
              OrderItemQuoteDisposition.MANUAL_PRICING_REQUIRED,
            manualQuoteReason: '特殊工艺人工核价',
            pricingSnapshot: {
              source: 'ADMIN_SNAPSHOT_CONFIRMATION',
              status: 'ADMIN_CONFIRMED',
              previousPriceRevision: 3,
              actual: {
                quantity: 1_000,
                unitPrice: '0.1000',
                fixedFee: '0.00',
                subtotal: '100.00',
                overrideReason: '特殊工艺人工核价',
                provisional: false,
                requiresAdminConfirmation: false,
                automatic: false,
              },
              confirmation: {
                actorId: admin.id,
                confirmedAt: settledAt.toISOString(),
                reason: '特殊工艺人工核价',
              },
            },
          },
        ],
      },
    },
    {
      label: '包装袋数',
      details: {
        packagingGroups: [
          {
            actualBagCount: 101,
            unitPrice: new Decimal('0.1000'),
            subtotal: new Decimal('10.00'),
            priceOverrideReason: '人工确认入袋费',
            pricingSnapshot: {
              source: 'ADMIN_SNAPSHOT_CONFIRMATION',
              status: 'ADMIN_CONFIRMED',
              previousPriceRevision: 3,
              actual: {
                actualBagCount: 100,
                unitPrice: '0.1000',
                subtotal: '10.00',
                overrideReason: '人工确认入袋费',
                provisional: false,
                requiresAdminConfirmation: false,
                automatic: false,
              },
              confirmation: {
                actorId: admin.id,
                confirmedAt: settledAt.toISOString(),
                reason: '人工确认入袋费',
              },
            },
          },
        ],
      },
    },
  ])('管理员快照与实时$label不一致时在任何写入前失败关闭', async ({
    details,
  }) => {
    tx.order.findUnique.mockResolvedValueOnce(
      order({
        ...details,
        pricingStatus: OrderPricingStatus.ADMIN_CONFIRMED,
        confirmedFee: new Decimal('128.50'),
      }),
    );

    await expect(
      confirmFactoryOrder(
        {
          orderId: 'order-1',
          expectedRevision: 4,
          expectedWorkOrderVersion: 2,
          expectedQuoteToken: factoryQuoteToken,
        },
        admin,
      ),
    ).rejects.toMatchObject({ code: 'PREFLIGHT_FAILED' });
    expect(prepareProductionMock).not.toHaveBeenCalled();
    expect(tx.order.update).not.toHaveBeenCalled();
    expect(tx.orderLog.create).not.toHaveBeenCalled();
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

  it('rechecks pending changes under the lock before rejecting', async () => {
    tx.order.findUnique.mockResolvedValueOnce(
      order({ _count: { changeRequests: 1 } }),
    );

    await expect(
      rejectFactoryOrder(
        {
          orderId: 'order-1',
          reasonCode: OrderWorkflowReasonCode.DESIGN_ERROR,
          reasonNote: '图稿待修正',
          affectedFigs: [1],
          idempotencyKey: 'reject-pending-change',
        },
        admin,
      ),
    ).rejects.toMatchObject({ code: 'PREFLIGHT_FAILED' });
    expect(tx.orderWorkflowDecision.create).not.toHaveBeenCalled();
    expect(tx.order.update).not.toHaveBeenCalled();
  });

  it('allows factory hold during review without invalidating the proposal', async () => {
    tx.order.findUnique.mockResolvedValueOnce(
      order({
        status: OrderStatus.CONFIRMED,
        confirmedFee: new Decimal('128.50'),
        _count: { changeRequests: 1 },
      }),
    );

    await expect(
      holdFactoryOrder(
        {
          orderId: 'order-1',
          reasonCode: OrderWorkflowReasonCode.PRICE_PENDING,
          reasonNote: '等待核价',
          affectedFigs: [],
          idempotencyKey: 'hold-pending-change',
        },
        admin,
      ),
    ).resolves.toMatchObject({ status: OrderStatus.ON_HOLD });
    expect(tx.orderWorkflowDecision.create).toHaveBeenCalledTimes(1);
    expect(tx.order.update).toHaveBeenCalledWith(expect.objectContaining({ data: { status: OrderStatus.ON_HOLD } }));
  });

  it('allows verified resume during review without invalidating the proposal', async () => {
    tx.order.findUnique.mockResolvedValueOnce(
      order({
        status: OrderStatus.ON_HOLD,
        _count: { changeRequests: 1 },
      }),
    );

    tx.orderWorkflowDecision.findFirst.mockResolvedValueOnce({ fromStatus: OrderStatus.CONFIRMED });
    await expect(
      resumeFactoryOrder(
        {
          orderId: 'order-1',
          recoveryEvidence: { proof: '问题已复核' },
          idempotencyKey: 'resume-pending-change',
        },
        admin,
      ),
    ).resolves.toMatchObject({ status: OrderStatus.CONFIRMED });
    expect(tx.orderWorkflowDecision.findFirst).toHaveBeenCalledTimes(1);
    expect(tx.order.update).toHaveBeenCalledWith(expect.objectContaining({ data: { status: OrderStatus.CONFIRMED } }));
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
    expect(completionMock).toHaveBeenCalledWith(
      tx,
      'order-1',
      'admin-1',
      settledAt,
    );
  });

  it('rechecks production completion after commit when outsource closes during hold', async () => {
    tx.order.findUnique.mockResolvedValueOnce(
      order({ status: OrderStatus.ON_HOLD }),
    );
    tx.orderWorkflowDecision.findFirst.mockResolvedValueOnce({
      fromStatus: OrderStatus.PACKING,
    });
    const notification = {
      payload: {
        orderId: 'order-1',
        orderNo: 'GD-260902-001',
        workOrderVersion: 2,
        customerRef: null,
      },
      dedupeKey: 'notification:ORDER_COMPLETED:order-1:v2',
      queued: false,
    };
    completionMock.mockResolvedValueOnce({
      completed: true,
      orderStatus: OrderStatus.PACKING,
      blockedBy: null,
      uncoveredItems: [],
      notification,
    });
    dbMock.$transaction.mockImplementationOnce(async (callback) => {
      const result = await callback(tx);
      expect(completionDispatchMock).not.toHaveBeenCalled();
      return result;
    });

    await resumeFactoryOrder(
      {
        orderId: 'order-1',
        recoveryEvidence: { proof: '外协已回货并复核' },
        idempotencyKey: 'resume-after-outsource-v2',
      },
      admin,
    );

    expect(completionDispatchMock).toHaveBeenCalledExactlyOnceWith(notification);
  });

  it('persists PACKING as the actual resume result when readiness closes from RELEASED', async () => {
    tx.order.findUnique.mockResolvedValueOnce(
      order({ status: OrderStatus.ON_HOLD }),
    );
    tx.orderWorkflowDecision.findFirst.mockResolvedValueOnce({
      fromStatus: OrderStatus.RELEASED,
    });
    completionMock.mockResolvedValueOnce({
      completed: true,
      orderStatus: OrderStatus.PACKING,
      blockedBy: null,
      uncoveredItems: [],
    });

    await expect(
      resumeFactoryOrder(
        {
          orderId: 'order-1',
          recoveryEvidence: { proof: '停工期间外协已回货并复核' },
          idempotencyKey: 'resume-ready-order-1-v2',
        },
        admin,
      ),
    ).resolves.toEqual({
      orderId: 'order-1',
      status: OrderStatus.PACKING,
      idempotentReplay: false,
    });
    expect(tx.orderWorkflowDecision.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        fromStatus: OrderStatus.ON_HOLD,
        toStatus: OrderStatus.PACKING,
        action: OrderWorkflowAction.RESUME,
        idempotencyKey: 'resume-ready-order-1-v2',
      }),
    });
  });

  it('releases independently without creating or replaying a print job', async () => {
    tx.order.findUnique.mockResolvedValueOnce(order({ status: OrderStatus.CONFIRMED, confirmedFee: new Decimal('128.50') }));
    const result = await releaseFactoryOrder({ orderId: 'order-1', expectedRevision: 4,
      expectedWorkOrderVersion: 2, printIdempotencyKey: 'release-only-order-1-v2', createPrint: false }, admin);
    expect(activateMock).toHaveBeenCalledWith(tx, 'order-1', admin, undefined, { targetStatus: OrderStatus.RELEASED });
    expect(createPrintMock).not.toHaveBeenCalled();
    expect(tx.orderPrintJob.findUnique).not.toHaveBeenCalled();
    expect(result).toMatchObject({ status: OrderStatus.RELEASED, printJobId: null });
  });

  it('releases production before creating the initial versioned print request', async () => {
    tx.order.findUnique.mockResolvedValueOnce(
      order({
        status: OrderStatus.CONFIRMED,
        confirmedFee: new Decimal('128.50'),
      }),
    );
    activateMock.mockResolvedValueOnce({
      orderId: 'order-1',
      orderStatus: OrderStatus.RELEASED,
      operationIds: ['operation-1', 'operation-2'],
      operationsCreated: 0,
      progressStepIds: ['progress-step-1'],
      progressStepsCreated: 0,
      idempotentReplay: true,
    });
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
    expect(enqueueNotificationMock).toHaveBeenCalledExactlyOnceWith(
      tx,
      'ORDER_SCHEDULED',
      {
        orderId: 'order-1',
        orderNo: 'GD-260902-001',
        taskCount: 3,
      },
      { dedupeKey: 'notification:ORDER_SCHEDULED:order-1' },
    );
    expect(createPrintMock.mock.invocationCallOrder[0]).toBeLessThan(
      enqueueNotificationMock.mock.invocationCallOrder[0]!,
    );
    expect(dispatchNotificationMock).not.toHaveBeenCalled();
  });

  it('dispatches ORDER_SCHEDULED after the transaction in inline mode', async () => {
    tx.order.findUnique.mockResolvedValueOnce(
      order({
        status: OrderStatus.CONFIRMED,
        confirmedFee: new Decimal('128.50'),
      }),
    );
    enqueueNotificationMock.mockResolvedValueOnce(false);

    await releaseFactoryOrder(
      {
        orderId: 'order-1',
        expectedRevision: 4,
        expectedWorkOrderVersion: 2,
        printIdempotencyKey: 'release-print-inline-v2',
      },
      admin,
    );

    expect(dispatchNotificationMock).toHaveBeenCalledExactlyOnceWith(
      'ORDER_SCHEDULED',
      {
        orderId: 'order-1',
        orderNo: 'GD-260902-001',
        taskCount: 2,
      },
      { dedupeKey: 'notification:ORDER_SCHEDULED:order-1' },
    );
    expect(enqueueNotificationMock.mock.invocationCallOrder[0]).toBeLessThan(
      dispatchNotificationMock.mock.invocationCallOrder[0]!,
    );
  });

  it('does not emit ORDER_SCHEDULED without a CONFIRMED to RELEASED transition', async () => {
    tx.order.findUnique.mockResolvedValueOnce(
      order({
        status: OrderStatus.RELEASED,
        confirmedFee: new Decimal('128.50'),
      }),
    );

    await releaseFactoryOrder(
      {
        orderId: 'order-1',
        expectedRevision: 4,
        expectedWorkOrderVersion: 2,
        printIdempotencyKey: 'released-print-recovery-v2',
      },
      admin,
    );

    expect(activateMock).not.toHaveBeenCalled();
    expect(enqueueNotificationMock).not.toHaveBeenCalled();
    expect(dispatchNotificationMock).not.toHaveBeenCalled();
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
    expect(enqueueNotificationMock).not.toHaveBeenCalled();
    expect(dispatchNotificationMock).not.toHaveBeenCalled();
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
