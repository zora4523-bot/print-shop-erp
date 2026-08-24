import Decimal from 'decimal.js';
import {
  CsSalesEntryType,
  OrderBillingMode,
  OrderCustomerChargeStatus,
  OrderCostCategory,
  OrderKind,
  OrderSettlementType,
  OrderStatus,
  OutsourceStatus,
  Prisma,
  Role,
  ShipmentStatus,
  TaskStatus,
} from '../generated/prisma/client';
import { db } from './db';
import { nextOrderNumber } from './order/order-number';
import {
  transitionOrder,
  InvalidOrderTransitionError,
} from './order/status-machine';
import { transitionProductionTask } from './production/status-machine';
import type {
  CreateOrderInput,
  ShipOrderInput,
  UpdateEditableOrderInput,
  UpdateShippingOrderInput,
} from './auth/schemas';
import { getOrderScopeFilter } from './auth/order-scope';
import { orderCascadeLockKey } from './order/locks';
import {
  collectOutsourceCraftIds,
  findUndercoveredOutsourceItems,
  outsourceCoverageApplies,
} from './outsource/coverage';
import {
  FULL_EDITABLE_FIELDS,
  SHIPPING_EDITABLE_FIELDS,
  canEditOrderSfCollect,
  editableFieldsetForStatus,
} from './order/editable-fields';
import { dispatchNotification } from './notification/dispatch';
import { enqueueNotificationInTransaction } from './notification/transactional-outbox';
import type { EnqueueClient } from './background-jobs/repository';
import { backgroundJobsMode } from './background-jobs/mode';
import { formatMoneyPlain } from './dashboard/format';
import {
  assertCsOrderSalesLedgerReconciledInTx,
  CsSalesLedgerError,
  recordCsSalesEntryInTx,
} from './salary/cs-sales';
import { settlementTypeForOrderCreator } from './order/settlement';
import { quoteOrderItems } from './price/quote-service';
import {
  OrderCustomerChargeError,
  resolveExternalOrderChargesForCreation,
  resolveExternalOrderChargesForFinalization,
} from './price/order-charge-service';

export {
  listOrders,
  listOrdersPage,
  type OrderListRow,
} from './order/list-query';

export class OrderInvariantError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'OrderInvariantError';
  }
}

// Minimum TxClient surface the order module needs. Kept local so we don't
// import from lib/account.ts (different table surface).
type OrderTxClient = {
  $executeRaw: (strings: TemplateStringsArray, ...values: unknown[]) => Promise<unknown>;
  order: {
    create: (args: { data: unknown; select?: unknown }) => Promise<{
      id: string;
      orderNo: string;
      items: Array<{ id: string; sequence: number }>;
    }>;
    findFirst: (args: {
      where: unknown;
      orderBy?: unknown;
      select?: unknown;
    }) => Promise<{ orderNo: string } | null>;
  };
  craft: {
    findMany: (args: {
      where: unknown;
      select?: unknown;
    }) => Promise<Array<{ id: string }>>;
  };
  product: {
    findMany: (args: {
      where: unknown;
      select?: unknown;
    }) => Promise<Array<{ id: string; isActive: boolean }>>;
  };
  orderShipment: {
    create: (args: {
      data: unknown;
      select: { id: true };
    }) => Promise<{ id: string }>;
  };
  orderShipmentLine: {
    createMany: (args: { data: unknown[] }) => Promise<{ count: number }>;
  };
  orderCustomerCharge: {
    createMany: (args: { data: unknown[] }) => Promise<{ count: number }>;
  };
};

const DECIMAL_10_4_MAX = new Decimal('999999.9999');
const DECIMAL_12_2_MAX = new Decimal('9999999999.99');

function assertOrderQuantity(quantity: number, itemName: string): void {
  if (!Number.isSafeInteger(quantity) || quantity < 1 || quantity > 9_999_999) {
    throw new OrderInvariantError(
      `款式“${itemName}”数量必须是 1 至 9,999,999 的整数`,
    );
  }
}

function assertStorableMoney(
  value: string,
  itemName: string,
  label: string,
  max: Decimal,
  scale: number,
): Decimal {
  let amount: Decimal;
  try {
    amount = new Decimal(value);
  } catch {
    throw new OrderInvariantError(`款式“${itemName}”${label}格式非法`);
  }
  if (
    !amount.isFinite() ||
    amount.isNegative() ||
    amount.decimalPlaces() > scale ||
    amount.gt(max)
  ) {
    throw new OrderInvariantError(
      `款式“${itemName}”${label}超出系统允许范围`,
    );
  }
  return amount;
}

function assertStorableOrderTotal(value: string): void {
  let total: Decimal;
  try {
    total = new Decimal(value);
  } catch {
    throw new OrderInvariantError('工单总金额格式非法');
  }
  if (
    !total.isFinite() ||
    total.isNegative() ||
    total.decimalPlaces() > 2 ||
    total.gt(DECIMAL_12_2_MAX)
  ) {
    throw new OrderInvariantError(
      '工单总金额超过系统上限 9,999,999,999.99 元',
    );
  }
}

// Decimal(12,2) column — 12 total digits, 2 after the point. Quantity is
// an int and unitPrice is a string like '0.1234'. The multiplication must
// happen in Decimal.js to preserve precision (plain JS floats round).
function computeSubtotal(
  quantity: number,
  unitPrice: string | null,
  fixedFee: string | null | undefined,
): string {
  const price = new Decimal(unitPrice ?? '0');
  return price
    .times(quantity)
    .plus(new Decimal(fixedFee ?? '0'))
    .toFixed(2);
}

function sumTotals(subtotals: string[]): string {
  return subtotals
    .reduce((acc, s) => acc.plus(new Decimal(s)), new Decimal(0))
    .toFixed(2);
}

export type CreatedOrderSummary = {
  id: string;
  orderNo: string;
  itemIds: string[];
};

// Keep the library boundary compatible with callers that predate the
// multi-address form. The action schema always supplies an array, while
// direct domain callers may omit it and get the same single-address behavior.
type ShipmentChargeField =
  | 'destinationProvince'
  | 'quotedWeightKg'
  | 'shippingFee'
  | 'packingMaterialFee'
  | 'customerChargeOverrideReason';

type AdditionalShipmentCommand = Omit<
  CreateOrderInput['additionalShipments'][number],
  ShipmentChargeField
> &
  Partial<
    Pick<CreateOrderInput['additionalShipments'][number], ShipmentChargeField>
  >;

type CreateOrderCommand = Omit<
  CreateOrderInput,
  'additionalShipments' | ShipmentChargeField
> &
  Partial<Pick<CreateOrderInput, ShipmentChargeField>> & {
    additionalShipments?: AdditionalShipmentCommand[];
  };

type ShipOrderCommand = Omit<ShipOrderInput, 'shipments'> & {
  shipments: Array<
    Omit<
      ShipOrderInput['shipments'][number],
      | 'destinationProvince'
      | 'shippingFee'
      | 'packingMaterialFee'
      | 'customerChargeOverrideReason'
    > &
      Partial<
        Pick<
          ShipOrderInput['shipments'][number],
          | 'destinationProvince'
          | 'shippingFee'
          | 'packingMaterialFee'
          | 'customerChargeOverrideReason'
        >
      >
  >;
};

export type SfCollectChargeCorrection = {
  shipmentId: string;
  destinationProvince: string | null;
  weightKg: string | null;
  shippingFee: string | null;
  customerChargeOverrideReason: string | null;
};

// The transaction path:
//   1. advisory-lock the per-day order-seq (inside nextOrderNumber)
//   2. verify every referenced Craft exists + is active
//   3. quote under the shared price-rule transaction lock
//   4. verify the optional productId (if any) exists + is active while locked
//   5. compute subtotals + totalAmount in Decimal.js
//   6. nested-create Order + items + initial OrderLog("CREATE") in one call
export async function createOrder(
  input: CreateOrderCommand,
  actor: { id: string; role: Role },
  now: Date = new Date(),
): Promise<CreatedOrderSummary> {
  const additionalShipments = input.additionalShipments ?? [];

  return db.$transaction(async (tx) => {
    const txClient = tx as unknown as OrderTxClient;

    // (1) allocate a fresh GD-YYMMDD-XXX (advisory lock inside).
    const orderNo = await nextOrderNumber(txClient, now);

    // (2) craft FK + activation check — surfaces a clean invariant error
    // instead of a Prisma FK error.
    const craftIds = [...new Set(input.items.flatMap((it) => it.crafts))];
    const foundCrafts = await txClient.craft.findMany({
      where: { id: { in: craftIds }, isActive: true },
      select: { id: true },
    });
    if (foundCrafts.length !== craftIds.length) {
      const missing = craftIds.filter((id) => !foundCrafts.some((c) => c.id === id));
      throw new OrderInvariantError(
        `工艺不存在或已停用：${missing.join(', ')}`,
      );
    }

    // (3) Quote first: quoteOrderItems acquires the transaction-scoped shared
    // price-rule lock before reading products/rules. PostgreSQL holds that lock
    // through commit, so the active-product validation below cannot race an
    // administrator's exclusive-lock deactivation. Do not acquire it again
    // here: one quote call is the single lock owner for this transaction.
    for (const item of input.items) {
      assertOrderQuantity(item.quantity, item.name);
    }
    const settlementType = settlementTypeForOrderCreator(actor.role);
    const quotes = await quoteOrderItems(
      input.items,
      settlementType,
      now,
      tx,
    );

    // (4) product FK check — one batch findMany over the distinct ids
    // (was per-item findUnique: a 10-item order paid up to 10 round
    // trips inside the tx). No productId → no query at all. Deliberately
    // NOT filtering isActive in the where: 不存在 and 已停用 are two
    // distinct messages, and the per-item loop keeps first-error order.
    const productIds = [
      ...new Set(
        input.items.flatMap((it) => (it.productId ? [it.productId] : [])),
      ),
    ];
    if (productIds.length > 0) {
      const foundProducts = await txClient.product.findMany({
        where: { id: { in: productIds } },
        select: { id: true, isActive: true },
      });
      const productById = new Map(foundProducts.map((p) => [p.id, p]));
      for (const item of input.items) {
        if (!item.productId) continue;
        const product = productById.get(item.productId);
        if (!product) {
          throw new OrderInvariantError(`产品不存在：${item.productId}`);
        }
        if (!product.isActive) {
          throw new OrderInvariantError(`产品已停用：${item.productId}`);
        }
      }
    }

    // (5) processing totals and per-shipment allocation facts.
    const itemsWithSubtotals = input.items.map((it, index) => {
      const quote = quotes[index]!;
      const hasManualPrice = it.unitPrice !== null || it.fixedFee != null;
      const unitPrice =
        !hasManualPrice && quote.complete
          ? quote.suggestedUnitPrice
          : (it.unitPrice ?? '0');
      const fixedFee =
        !hasManualPrice && quote.complete
          ? quote.suggestedFixedFee
          : (it.fixedFee ?? '0');
      if (unitPrice === null || fixedFee === null) {
        throw new OrderInvariantError(`款式“${it.name}”报价结果不完整`);
      }
      if (!quote.complete && !hasManualPrice) {
        const details = quote.errors.join('；');
        throw new OrderInvariantError(
          `款式“${it.name}”无法自动报价${details ? `：${details}` : ''}，请填写成交单价或一次性费用，并说明原因`,
        );
      }
      assertStorableMoney(
        unitPrice,
        it.name,
        '成交单价',
        DECIMAL_10_4_MAX,
        4,
      );
      assertStorableMoney(
        fixedFee,
        it.name,
        '一次性费用',
        DECIMAL_12_2_MAX,
        2,
      );
      const subtotal = computeSubtotal(it.quantity, unitPrice, fixedFee);
      assertStorableMoney(
        subtotal,
        it.name,
        '款式小计',
        DECIMAL_12_2_MAX,
        2,
      );
      // Decimal equality intentionally ignores textual scale ("1", "1.0",
      // and "1.0000" are the same price), while preserving the semantic split
      // between per-piece and one-time charges. Reallocating those components
      // is an audited manual override even when the resulting subtotal matches.
      const priceDiffersFromSuggestion =
        quote.complete &&
        (quote.suggestedUnitPrice === null ||
          quote.suggestedFixedFee === null ||
          quote.suggestedSubtotal === null ||
          !new Decimal(unitPrice).equals(quote.suggestedUnitPrice) ||
          !new Decimal(fixedFee).equals(quote.suggestedFixedFee) ||
          !new Decimal(subtotal).equals(quote.suggestedSubtotal));
      if (
        (!quote.complete || priceDiffersFromSuggestion) &&
        !it.priceOverrideReason
      ) {
        const reason = quote.complete
          ? '成交价与系统建议价不同'
          : `无法自动报价：${quote.errors.join('；')}`;
        throw new OrderInvariantError(
          `款式“${it.name}”${reason}，请填写人工改价说明`,
        );
      }
      return {
        ...it,
        unitPrice,
        fixedFee,
        subtotal,
        suggestedSubtotal: quote.suggestedSubtotal,
        pricingSnapshot: {
          ...quote.snapshot,
          quotedAt: now.toISOString(),
          actual: {
            unitPrice,
            fixedFee,
            subtotal,
            overrideReason: it.priceOverrideReason ?? null,
          },
        } satisfies Prisma.InputJsonObject,
      };
    });
    const processingAmount = sumTotals(
      itemsWithSubtotals.map((i) => i.subtotal),
    );
    assertStorableOrderTotal(processingAmount);

    const primaryQuantities = input.items.map((item, itemIndex) => {
      const extraQuantity = additionalShipments.reduce(
        (sum, shipment) => sum + (shipment.itemQuantities[itemIndex] ?? 0),
        0,
      );
      return item.quantity - extraQuantity;
    });
    const shipmentInputs = [
      {
        receiverName: input.receiverName,
        receiverPhone: input.receiverPhone,
        receiverAddress: input.receiverAddress,
        expressCode: input.expressCode,
        destinationProvince: input.destinationProvince ?? null,
        quotedWeightKg: input.quotedWeightKg ?? null,
        shippingFee: input.shippingFee ?? null,
        packingMaterialFee: input.packingMaterialFee ?? null,
        customerChargeOverrideReason:
          input.customerChargeOverrideReason ?? null,
        itemQuantities: primaryQuantities,
      },
      ...additionalShipments.map((shipment) => ({
        ...shipment,
        destinationProvince: shipment.destinationProvince ?? null,
        quotedWeightKg: shipment.quotedWeightKg ?? null,
        shippingFee: shipment.shippingFee ?? null,
        packingMaterialFee: shipment.packingMaterialFee ?? null,
        customerChargeOverrideReason:
          shipment.customerChargeOverrideReason ?? null,
      })),
    ];

    const suppliedCustomerChargeFacts = shipmentInputs.some(
      (shipment) =>
        shipment.destinationProvince != null ||
        shipment.quotedWeightKg != null ||
        shipment.shippingFee != null ||
        shipment.packingMaterialFee != null ||
        shipment.customerChargeOverrideReason != null,
    );
    if (
      settlementType !== OrderSettlementType.EXTERNAL_SALES &&
      suppliedCustomerChargeFacts
    ) {
      throw new OrderInvariantError(
        '快递费与打包耗材应收仅适用于外部销售结算工单',
      );
    }

    let resolvedCustomerCharges: Awaited<
      ReturnType<typeof resolveExternalOrderChargesForCreation>
    > | null = null;
    if (settlementType === OrderSettlementType.EXTERNAL_SALES) {
      try {
        resolvedCustomerCharges = await resolveExternalOrderChargesForCreation(
          tx,
          {
            isSfCollect: input.isSfCollect,
            shipments: shipmentInputs.map((shipment, index) => ({
              shipmentKey: String(index + 1),
              province: shipment.destinationProvince,
              billableWeightKg: shipment.quotedWeightKg,
              itemQuantity: shipment.itemQuantities.reduce(
                (sum, quantity) => sum + quantity,
                0,
              ),
              shippingFee: shipment.shippingFee,
              packingMaterialFee: shipment.packingMaterialFee,
              overrideReason: shipment.customerChargeOverrideReason,
            })),
          },
          now,
          // quoteOrderItems above already acquired the same transaction-level
          // snapshot lock. Avoid a redundant PostgreSQL round trip while
          // keeping standalone logistics finalization self-locking.
          { snapshotLockHeld: true },
        );
      } catch (error) {
        if (error instanceof OrderCustomerChargeError) {
          throw new OrderInvariantError(error.message);
        }
        throw error;
      }
    }
    const totalAmount = new Decimal(processingAmount)
      .plus(resolvedCustomerCharges?.totalAmount ?? 0)
      .toFixed(2);
    assertStorableOrderTotal(totalAmount);

    // (5) one nested write: Order + items + first OrderLog.
    const created = await txClient.order.create({
      data: {
        orderNo,
        submitterId: actor.id,
        submitterRole: actor.role,
        createdById: actor.id,
        status: OrderStatus.DRAFT,
        kind: OrderKind.NORMAL,
        billingMode: OrderBillingMode.CHARGE,
        settlementType,
        isUrgent: input.isUrgent,
        isSfCollect: input.isSfCollect,
        customName: input.customName ?? null,
        customerRef: input.customerRef,
        receiverName: input.receiverName,
        receiverPhone: input.receiverPhone,
        receiverAddress: input.receiverAddress,
        expressCode: input.expressCode,
        packageRequirement: input.packageRequirement,
        remark: input.remark,
        promisedDate: input.promisedDate ?? null,
        processingAmount,
        totalAmount,
        items: {
          create: itemsWithSubtotals.map((it, idx) => ({
            sequence: idx + 1,
            name: it.name,
            productId: it.productId ?? null,
            specification: it.specification ?? null,
            paperType: it.paperType ?? null,
            quantity: it.quantity,
            crafts: it.crafts,
            foilColors: it.foilColors,
            isDoubleSided: it.isDoubleSided,
            isDoubleColor: it.isDoubleColor,
            unitPrice: it.unitPrice ?? '0',
            fixedFee: it.fixedFee ?? '0',
            subtotal: it.subtotal,
            suggestedSubtotal: it.suggestedSubtotal,
            pricingSnapshot: it.pricingSnapshot,
            priceOverrideReason: it.priceOverrideReason ?? null,
            remark: it.remark ?? null,
          })),
        },
        logs: {
          create: [
            {
              operatorId: actor.id,
              action: 'CREATE',
              remark: `${input.isUrgent ? '创建急单' : '创建工单'}${
                additionalShipments.length > 0
                  ? `（${additionalShipments.length + 1} 个收货地址）`
                  : ''
              }`,
            },
          ],
        },
      },
      select: {
        id: true,
        orderNo: true,
        items: {
          select: { id: true, sequence: true },
          orderBy: { sequence: 'asc' },
        },
      },
    });

    const itemBySequence = new Map(
      created.items.map((item) => [item.sequence, item.id]),
    );
    const shipmentIdByKey = new Map<string, string>();
    for (const [shipmentIndex, shipment] of shipmentInputs.entries()) {
      const createdShipment = await txClient.orderShipment.create({
        data: {
          orderId: created.id,
          sequence: shipmentIndex + 1,
          receiverName: shipment.receiverName,
          receiverPhone: shipment.receiverPhone,
          receiverAddress: shipment.receiverAddress,
          expressCode: shipment.expressCode,
          carrierCode: input.isSfCollect ? 'SF' : 'ZTO',
          destinationProvince: shipment.destinationProvince,
          quotedWeightKg: shipment.quotedWeightKg,
          status: ShipmentStatus.PLANNED,
        },
        select: { id: true },
      });
      shipmentIdByKey.set(String(shipmentIndex + 1), createdShipment.id);
      const lines = shipment.itemQuantities.flatMap((quantity, itemIndex) => {
        if (quantity <= 0) return [];
        const orderItemId = itemBySequence.get(itemIndex + 1);
        if (!orderItemId) {
          throw new OrderInvariantError(
            `创建发货分配时找不到款式 ${itemIndex + 1}`,
          );
        }
        return [{ shipmentId: createdShipment.id, orderItemId, quantity }];
      });
      if (lines.length > 0) {
        await txClient.orderShipmentLine.createMany({ data: lines });
      }
    }

    if (resolvedCustomerCharges) {
      await txClient.orderCustomerCharge.createMany({
        data: resolvedCustomerCharges.charges.map((charge) => {
          const shipmentId = shipmentIdByKey.get(charge.shipmentKey);
          if (!shipmentId) {
            throw new OrderInvariantError(
              `创建对客收费时找不到发货地址 ${charge.shipmentKey}`,
            );
          }
          const finalized = charge.status === 'WAIVED';
          return {
            orderId: created.id,
            shipmentId,
            categoryId: charge.categoryId,
            priceBookId: charge.priceBookId,
            sourceRuleId: charge.sourceRuleId,
            businessKey: charge.businessKey,
            status: charge.status,
            description: charge.description,
            quantity: charge.quantity,
            unit: charge.unit,
            suggestedAmount: charge.suggestedAmount,
            amount: charge.amount,
            pricingSnapshot: charge.pricingSnapshot,
            overrideReason: charge.overrideReason,
            createdById: actor.id,
            finalizedById: finalized ? actor.id : null,
            finalizedAt: finalized ? now : null,
          };
        }),
      });
    }

    return {
      id: created.id,
      orderNo: created.orderNo,
      itemIds: created.items.map((item) => item.id),
    };
  });
}

// ─────────────────────────────────────────────────────────────────────
// Status transitions
// ─────────────────────────────────────────────────────────────────────

// Minimal tx surface for status-transition operations (no craft / product
// cross-table work, unlike create).
type StatusTxClient = {
  $executeRaw: (
    strings: TemplateStringsArray,
    ...values: unknown[]
  ) => Promise<unknown>;
  order: {
    findUnique: (args: {
      where: { id: string };
      select?: unknown;
    }) => Promise<{ id: string; status: OrderStatus; submitterId: string } | null>;
    update: (args: { where: { id: string }; data: unknown; select?: unknown }) => Promise<{
      id: string;
      status: OrderStatus;
    }>;
  };
  orderLog: {
    create: (args: { data: unknown }) => Promise<unknown>;
  };
};

// Minimal tx surface for the cancelOrder → ProductionTask cascade
// (A1, DECISIONS 2026-07-09). Runs on the SAME tx as the order
// transition, so the task reads/writes participate in the same
// advisory lock + rollback boundary — no half-cancel possible.
type CascadeTxClient = {
  productionTask: {
    findMany: (args: {
      where: unknown;
      select?: unknown;
    }) => Promise<Array<{ id: string; status: TaskStatus }>>;
    update: (args: {
      where: { id: string };
      data: unknown;
      select?: unknown;
    }) => Promise<unknown>;
  };
  outsourceOrder: {
    findMany: (args: {
      where: unknown;
      select?: unknown;
    }) => Promise<Array<{ id: string }>>;
  };
  orderShipment: {
    findMany: (args: {
      where: { orderId: string };
      select: { id: true; sequence: true };
      orderBy: { sequence: 'asc' };
    }) => Promise<Array<{ id: string; sequence: number }>>;
    update: (args: {
      where: { id: string };
      data: unknown;
      select: { id: true };
    }) => Promise<{ id: string }>;
  };
  orderLog: {
    create: (args: { data: unknown }) => Promise<unknown>;
  };
};

// Per-order advisory lock for status-transition writes. We share the
// SAME namespace as production.ts orderCascadeLockKey
// (`print-shop-erp:order-cascade:<id>`) so worker reportTask's
// auto-cascade can't race a manual ship/cancel/submit on the same
// order — both paths touch Order.status .

type TransitionOptions = {
  remark: string | null;
  // Optional authz guard that runs AFTER we've fetched the row (so it
  // can see submitterId / status) but BEFORE the status-machine check.
  // Throw OrderInvariantError to reject.
  authz?: (order: { submitterId: string; status: OrderStatus }) => void;
  now?: Date;
  // Optional extra columns to set on the Order in the same update.
  // Used by shipOrder to stamp `trackingNo` alongside the status
  // transition. Each call site is responsible for keeping the keys
  // valid Prisma update fields.
  extraData?: Record<string, unknown>;
  // Optional cascade to related rows, run INSIDE the same tx + advisory
  // lock, AFTER the Order row + OrderLog are written. Throwing here
  // rolls the whole transition back (so a block condition leaves no
  // half-cancel). Used by cancelOrder to void PENDING ProductionTasks.
  cascade?: (tx: CascadeTxClient, orderId: string) => Promise<void>;
  // Durable notification/outbox work that must commit atomically with the
  // status transition. Inline dev/test callers return false and dispatch only
  // after this transaction commits.
  afterTransition?: (
    tx: Prisma.TransactionClient,
    orderId: string,
  ) => Promise<void>;
};

async function transitionWithLog(
  orderId: string,
  target: OrderStatus,
  actor: { id: string; role: Role },
  opts: TransitionOptions,
): Promise<{ id: string; status: OrderStatus }> {
  const now = opts.now ?? new Date();
  return db.$transaction(async (tx) => {
    const txClient = tx as unknown as StatusTxClient;
    // Per-order advisory lock: serialize ALL transitions on this
    // order. Without this, two concurrent ship calls each read
    // status=COMPLETED, both pass the status-machine check, both
    // updates succeed — second silently overwrites trackingNo and
    // doubles the OrderLog row . Same key as
    // worker-cascade so a manual transition can't interleave with
    // a sibling task report's auto-cascade either.
    await txClient.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${orderCascadeLockKey(
      orderId,
    )}))`;

    const target_order = await txClient.order.findUnique({
      where: { id: orderId },
      select: { id: true, status: true, submitterId: true },
    });
    if (!target_order) throw new OrderInvariantError('工单不存在');

    if (opts.authz) opts.authz(target_order);

    // status-machine.ts throws InvalidOrderTransitionError on bad moves —
    // we let it propagate (action layer maps to a generic error result).
    transitionOrder(target_order.status, target);

    // Cascade to related rows BEFORE writing the Order row, so a block
    // condition (cancelOrder → an in-flight ProductionTask) throws before
    // anything is written — no half-cancel, in the DB or under test.
    if (opts.cascade) {
      await opts.cascade(tx as unknown as CascadeTxClient, orderId);
    }

    const updated = await txClient.order.update({
      where: { id: orderId },
      data: {
        status: target,
        submittedAt: target === OrderStatus.SUBMITTED ? now : undefined,
        shippedAt: target === OrderStatus.SHIPPED ? now : undefined,
        finishedAt: target === OrderStatus.FINISHED ? now : undefined,
        // trackingNo flows through opts.extraData below if provided
        // (ship action sets it; other transitions don't touch it).
        ...(opts.extraData ?? {}),
      },
      select: { id: true, status: true },
    });

    await txClient.orderLog.create({
      data: {
        orderId,
        operatorId: actor.id,
        action: 'STATUS_CHANGE',
        changedFields: {
          status: { before: target_order.status, after: target },
        },
        remark: opts.remark,
      },
    });

    await opts.afterTransition?.(tx, orderId);

    return updated;
  });
}

export async function submitOrder(
  orderId: string,
  actor: { id: string; role: Role },
  now: Date = new Date(),
): Promise<{ id: string; status: OrderStatus }> {
  let notificationsQueued = false;
  const result = await transitionWithLog(orderId, OrderStatus.SUBMITTED, actor, {
    remark: '提交工单',
    now,
    authz: (order) => {
      // 'order:create' permission lets SALES / CS create AND submit — but
      // only for their own rows. ADMIN keeps the global override.
      const globalOverride = actor.role === Role.ADMIN;
      if (!globalOverride && order.submitterId !== actor.id) {
        throw new OrderInvariantError('只能提交自己创建的工单');
      }
    },
    cascade: async (tx, lockedOrderId) => {
      const prismaTx = tx as unknown as Prisma.TransactionClient;
      const submittedOrder = await prismaTx.order.findUnique({
        where: { id: lockedOrderId },
        select: {
          submitterId: true,
          submitterRole: true,
          billingMode: true,
          settlementType: true,
          totalAmount: true,
          revision: true,
        },
      });
      if (
        submittedOrder?.settlementType === OrderSettlementType.INTERNAL_SALES &&
        submittedOrder.billingMode === OrderBillingMode.CHARGE
      ) {
        try {
          await recordCsSalesEntryInTx(prismaTx, {
            eventKey: `order:${lockedOrderId}:revision:${submittedOrder.revision}:submit`,
            csUserId: submittedOrder.submitterId,
            orderId: lockedOrderId,
            orderRevision: submittedOrder.revision,
            type: CsSalesEntryType.ORDER_SUBMITTED,
            amount: submittedOrder.totalAmount,
            occurredAt: now,
            remark: '客服工单提交计入销售额',
          });
        } catch (error) {
          if (error instanceof CsSalesLedgerError) {
            throw new OrderInvariantError(error.message);
          }
          throw error;
        }
      }
    },
    afterTransition: async (tx, lockedOrderId) => {
      if (backgroundJobsMode() !== 'durable') return;
      const payload = await tx.order.findUniqueOrThrow({
        where: { id: lockedOrderId },
        select: {
          id: true,
          orderNo: true,
          customerRef: true,
          totalAmount: true,
          isUrgent: true,
          submitter: { select: { displayName: true } },
        },
      });
      const totalAmount = formatMoneyPlain(
        payload.totalAmount as unknown as Decimal.Value,
      );
      notificationsQueued = await enqueueNotificationInTransaction(
        tx as unknown as EnqueueClient,
        'ORDER_SUBMITTED',
        {
          orderId: payload.id,
          orderNo: payload.orderNo,
          submitterName: payload.submitter.displayName,
          customerRef: payload.customerRef,
          totalAmount,
          urgentMark: payload.isUrgent ? '🚨 急单' : '',
        },
        { dedupeKey: `notification:ORDER_SUBMITTED:${payload.id}` },
      );
      if (payload.isUrgent) {
        const urgentQueued = await enqueueNotificationInTransaction(
          tx as unknown as EnqueueClient,
          'URGENT_ORDER',
          {
            orderId: payload.id,
            orderNo: payload.orderNo,
            submitterName: payload.submitter.displayName,
            customerRef: payload.customerRef,
          },
          { dedupeKey: `notification:URGENT_ORDER:${payload.id}` },
        );
        notificationsQueued = notificationsQueued && urgentQueued;
      }
    },
  });

  // Slice C wire ─ ORDER_SUBMITTED + URGENT_ORDER（tx 已 commit）。
  // 生产只 await 快速入库，webhook 由 LIGHT worker 重试；dev/test
  // 降级到 Next `after()`。详见 lib/notification/dispatch.ts。
  const payload = notificationsQueued ? null : await db.order.findUnique({
    where: { id: orderId },
    select: {
      id: true,
      orderNo: true,
      customerRef: true,
      totalAmount: true,
      isUrgent: true,
      submitter: { select: { displayName: true } },
    },
  });
  if (payload) {
    // formatMoneyPlain：千分位 + 2 位小数，**不带 `¥ ` 前缀**。模板里
    // 的 `金额：¥{totalAmount}` 自带 ¥ —— 再加会变成 `¥¥ 5,000.00`。
    const totalAmount = formatMoneyPlain(
      payload.totalAmount as unknown as Decimal.Value,
    );
    const urgentMark = payload.isUrgent ? '🚨 急单' : '';
    await dispatchNotification(
      'ORDER_SUBMITTED',
      {
        orderId: payload.id,
        orderNo: payload.orderNo,
        submitterName: payload.submitter.displayName,
        customerRef: payload.customerRef,
        totalAmount,
        urgentMark,
      },
      { dedupeKey: `notification:ORDER_SUBMITTED:${payload.id}` },
    );
    // SPEC §8.1：急单提交 → 排产群+管理员群（独立 rule，独立事件）。
    // 不是&ldquo;替代&rdquo; ORDER_SUBMITTED——两条都触发，管理员群从 URGENT_ORDER
    // 看到，排产群从 ORDER_SUBMITTED 看到。
    if (payload.isUrgent) {
      await dispatchNotification(
        'URGENT_ORDER',
        {
          orderId: payload.id,
          orderNo: payload.orderNo,
          submitterName: payload.submitter.displayName,
          customerRef: payload.customerRef,
        },
        { dedupeKey: `notification:URGENT_ORDER:${payload.id}` },
      );
    }
  }

  return result;
}

export async function cancelOrder(
  orderId: string,
  actor: { id: string; role: Role },
  reason: string,
  now: Date = new Date(),
): Promise<{ id: string; status: OrderStatus }> {
  const normalizedReason = reason.trim();
  if (!normalizedReason) {
    throw new OrderInvariantError('取消原因必填');
  }
  if (normalizedReason.length > 500) {
    throw new OrderInvariantError('取消原因过长（最多 500 个字符）');
  }
  // The action-layer `requirePermission('order:cancel')` is ADMIN-only, so
  // there's no additional ownership guard to run here.
  return transitionWithLog(orderId, OrderStatus.CANCELLED, actor, {
    remark: `取消：${normalizedReason}`,
    now,
    // A1 (owner ruling, DECISIONS 2026-07-09): cancelling an order must
    // dispose of its ProductionTasks in the SAME tx — otherwise cancelled
    // orders leave live tasks the worker can still begin/report on and
    // get paid for.
    cascade: async (tx, id) => {
      const tasks = await tx.productionTask.findMany({
        where: { orderItem: { orderId: id } },
        select: { id: true, status: true },
      });

      // Block if ANY task is already in-flight or finished. We refuse to
      // silently reverse piecework/payroll — the operator must handle the
      // production records first. This covers 已开工(IN_PROGRESS) /
      // 已报工·已完成·已产生计件金额·已结算(COMPLETED).
      const hasInFlight = tasks.some(
        (t) =>
          t.status === TaskStatus.IN_PROGRESS ||
          t.status === TaskStatus.COMPLETED,
      );
      if (hasInFlight) {
        throw new OrderInvariantError(
          '该工单存在已开工/已报工任务，不能直接取消，请先处理生产记录',
        );
      }

      // A1-A2 (owner ruling, DECISIONS 2026-07-09): if any linked
      // outsource order is still in flight (SENT / IN_PROGRESS), block
      // the cancel. We deliberately do NOT auto-cancel these —
      // supplier fulfillment / cost / manual confirmation is involved;
      // the operator must handle the outsource order first. RECEIVED /
      // CANCELLED outsource orders don't block. There is no
      // draft/未发送 OutsourceStatus (they default to SENT on create),
      // so there is nothing safe to cascade here — block only.
      const liveOutsource = await tx.outsourceOrder.findMany({
        where: {
          orderId: id,
          status: {
            in: [OutsourceStatus.SENT, OutsourceStatus.IN_PROGRESS],
          },
        },
        select: { id: true },
      });
      if (liveOutsource.length > 0) {
        throw new OrderInvariantError(
          '该工单存在已发送或进行中的外协单，请先处理外协单后再取消工单。',
        );
      }

      // Only 未开工 (PENDING) tasks are safe to void. Already-CANCELLED
      // tasks are left as-is (idempotent re-cancel / partial history).
      const pending = tasks.filter((t) => t.status === TaskStatus.PENDING);
      for (const t of pending) {
        // Route through the status machine so PENDING → CANCELLED stays
        // the single source of transition truth (CLAUDE.md §4.5).
        transitionProductionTask(t.status, TaskStatus.CANCELLED);
        await tx.productionTask.update({
          where: { id: t.id },
          data: { status: TaskStatus.CANCELLED },
          select: { id: true },
        });
      }
      if (pending.length > 0) {
        await tx.orderLog.create({
          data: {
            orderId: id,
            operatorId: actor.id,
            action: 'STATUS_CHANGE',
            changedFields: {
              cancelledTasks: { before: pending.length, after: 0 },
            },
            remark: `随工单取消 ${pending.length} 个未开工任务`,
          },
        });
      }
      const prismaTx = tx as unknown as Prisma.TransactionClient;
      const cancelledOrder = await prismaTx.order.findUnique({
        where: { id },
        select: {
          submitterId: true,
          submitterRole: true,
          billingMode: true,
          settlementType: true,
          status: true,
          totalAmount: true,
          revision: true,
        },
      });
      if (
        cancelledOrder?.settlementType === OrderSettlementType.INTERNAL_SALES &&
        cancelledOrder.billingMode === OrderBillingMode.CHARGE &&
        // A DRAFT has never emitted ORDER_SUBMITTED, so there is no positive
        // sales event to reverse. Using the pre-transition status here avoids
        // creating a phantom negative balance when an abandoned draft is
        // cancelled.
        cancelledOrder.status !== OrderStatus.DRAFT
      ) {
        try {
          await assertCsOrderSalesLedgerReconciledInTx(
            prismaTx,
            id,
            cancelledOrder.totalAmount,
          );
          await recordCsSalesEntryInTx(prismaTx, {
            eventKey: `order:${id}:revision:${cancelledOrder.revision}:cancel`,
            csUserId: cancelledOrder.submitterId,
            orderId: id,
            orderRevision: cancelledOrder.revision,
            type: CsSalesEntryType.ORDER_CANCELLED,
            amount: new Decimal(cancelledOrder.totalAmount).negated(),
            occurredAt: now,
            remark: `取消工单：${normalizedReason}`,
          });
        } catch (error) {
          if (error instanceof CsSalesLedgerError) {
            throw new OrderInvariantError(error.message);
          }
          throw error;
        }
      }
    },
  });
}

// COMPLETED → SHIPPED. Permission `order:ship` (ADMIN) is
// enforced at the action layer. Optional trackingNo lands on the same
// Order row via the transition's extraData so the audit OrderLog and
// the trackingNo write are atomic.
export async function shipOrder(
  orderId: string,
  actor: { id: string; role: Role },
  trackingInput: string | null | ShipOrderCommand,
  now: Date = new Date(),
): Promise<{ id: string; status: OrderStatus }> {
  const requestedShipments =
    typeof trackingInput === 'object' && trackingInput !== null
      ? trackingInput.shipments.map((shipment) => ({
          shipmentId: shipment.shipmentId.trim(),
          trackingNo: shipment.trackingNo?.trim() || null,
          weightKg: shipment.weightKg,
          destinationProvince: shipment.destinationProvince,
          shippingFee: shipment.shippingFee,
          packingMaterialFee: shipment.packingMaterialFee,
          customerChargeOverrideReason: shipment.customerChargeOverrideReason,
        }))
      : [];
  const legacyTrackingInput =
    typeof trackingInput === 'object' && trackingInput !== null
      ? trackingInput.trackingNo
      : trackingInput;
  // Treat both null AND whitespace-only as &ldquo;no tracking number&rdquo;:
  // `'   '.trim()` is `''`, not null, so a naive `?? null` would
  // happily write an empty string to Order.trackingNo.
  const trimmed = legacyTrackingInput?.trim() ?? '';
  const tracking = trimmed.length > 0 ? trimmed : null;
  const primaryTracking =
    requestedShipments.length > 0
      ? requestedShipments[0]?.trackingNo ?? null
      : tracking;
  let notificationQueued = false;
  const result = await transitionWithLog(
    orderId,
    OrderStatus.SHIPPED,
    actor,
    {
      remark:
        requestedShipments.length > 1
          ? `多地址发货：${requestedShipments.length} 个地址`
          : primaryTracking
            ? `发货：${primaryTracking}`
            : '标记发货',
      now,
      extraData:
        primaryTracking !== null ? { trackingNo: primaryTracking } : undefined,
      cascade: async (tx, id) => {
        const liveOutsource = await tx.outsourceOrder.findMany({
          where: {
            orderId: id,
            status: {
              in: [OutsourceStatus.SENT, OutsourceStatus.IN_PROGRESS],
            },
          },
          select: { id: true },
        });
        if (liveOutsource.length > 0) {
          throw new OrderInvariantError(
            '该工单仍有已发送或进行中的外协单，收货或取消后才能发货',
          );
        }
        if (requestedShipments.length > 0) {
          const prismaTx = tx as unknown as Prisma.TransactionClient;
          const storedShipments = await prismaTx.orderShipment.findMany({
            where: { orderId: id },
            select: {
              id: true,
              sequence: true,
              destinationProvince: true,
              quotedWeightKg: true,
              lines: { select: { quantity: true } },
            },
            orderBy: { sequence: 'asc' },
          });
          const requestedIds = requestedShipments.map(
            (shipment) => shipment.shipmentId,
          );
          if (new Set(requestedIds).size !== requestedIds.length) {
            throw new OrderInvariantError('发货地址重复，请刷新页面后重试');
          }
          if (
            storedShipments.length !== requestedShipments.length ||
            storedShipments.some(
              (shipment, index) =>
                requestedIds[index] !== shipment.id,
            )
          ) {
            throw new OrderInvariantError(
              '发货地址已变化，请刷新工单后重新填写运单号',
            );
          }
          const trackingByShipmentId = new Map(
            requestedShipments.map((shipment) => [
              shipment.shipmentId,
              shipment.trackingNo,
            ]),
          );
          const weightByShipmentId = new Map(
            requestedShipments.map((shipment) => [
              shipment.shipmentId,
              shipment.weightKg,
            ]),
          );
          const requestByShipmentId = new Map(
            requestedShipments.map((shipment) => [
              shipment.shipmentId,
              shipment,
            ]),
          );
          const chargeOrder = await prismaTx.order.findUnique({
            where: { id },
            select: {
              settlementType: true,
              isSfCollect: true,
              processingAmount: true,
              customerCharges: {
                select: {
                  id: true,
                  businessKey: true,
                  amount: true,
                  priceBookId: true,
                  category: { select: { code: true } },
                },
              },
            },
          });
          if (!chargeOrder) {
            throw new OrderInvariantError('工单不存在');
          }
          if (
            chargeOrder.settlementType === OrderSettlementType.EXTERNAL_SALES
          ) {
            const standardCustomerCharges =
              chargeOrder.customerCharges.filter((charge) =>
                ['SHIPPING_FEE', 'PACKING_MATERIAL'].includes(
                  String(charge.category.code),
                ),
              );
            const expectedChargeCount = storedShipments.length * 2;
            if (standardCustomerCharges.length !== expectedChargeCount) {
              throw new OrderInvariantError(
                '外部销售工单的快递/耗材收费明细不完整，暂不能发货',
              );
            }
            const priceBookIds = [
              ...new Set(
                standardCustomerCharges.flatMap((charge) =>
                  charge.priceBookId ? [charge.priceBookId] : [],
                ),
              ),
            ];
            if (priceBookIds.length !== 1) {
              throw new OrderInvariantError(
                '快递/耗材收费未绑定唯一价目簿，暂不能发货',
              );
            }
            if (
              !chargeOrder.isSfCollect &&
              storedShipments.some(
                (shipment) =>
                  !requestByShipmentId.get(shipment.id)?.weightKg,
              )
            ) {
              throw new OrderInvariantError(
                '外部销售工单发货前必须填写每个地址的承运商最终计费重量',
              );
            }
            let finalizedCharges: Awaited<
              ReturnType<typeof resolveExternalOrderChargesForFinalization>
            >;
            try {
              finalizedCharges =
                await resolveExternalOrderChargesForFinalization(
                  prismaTx,
                  {
                    isSfCollect: chargeOrder.isSfCollect,
                    shipments: storedShipments.map((shipment) => {
                      const requested = requestByShipmentId.get(shipment.id);
                      if (!requested) {
                        throw new OrderInvariantError(
                          `找不到地址 ${shipment.sequence} 的发货收费信息`,
                        );
                      }
                      return {
                        shipmentKey: String(shipment.sequence),
                        province:
                          requested.destinationProvince ??
                          shipment.destinationProvince,
                        billableWeightKg: chargeOrder.isSfCollect
                          ? null
                          : requested.weightKg ?? null,
                        itemQuantity: shipment.lines.reduce(
                          (sum, line) => sum + line.quantity,
                          0,
                        ),
                        shippingFee: requested.shippingFee ?? null,
                        packingMaterialFee:
                          requested.packingMaterialFee ?? null,
                        overrideReason:
                          requested.customerChargeOverrideReason ?? null,
                      };
                    }),
                  },
                  priceBookIds[0]!,
                  now,
                );
            } catch (error) {
              if (error instanceof OrderCustomerChargeError) {
                throw new OrderInvariantError(error.message);
              }
              throw error;
            }

            const existingByBusinessKey = new Map(
              standardCustomerCharges.map((charge) => [
                String(charge.businessKey),
                charge,
              ]),
            );
            for (const charge of finalizedCharges.charges) {
              const existing = existingByBusinessKey.get(charge.businessKey);
              if (!existing) {
                throw new OrderInvariantError(
                  `找不到收费明细 ${charge.businessKey}，暂不能发货`,
                );
              }
              await prismaTx.orderCustomerCharge.update({
                where: { id: existing.id },
                data: {
                  categoryId: charge.categoryId,
                  sourceRuleId: charge.sourceRuleId,
                  status:
                    charge.status === OrderCustomerChargeStatus.WAIVED
                      ? OrderCustomerChargeStatus.WAIVED
                      : OrderCustomerChargeStatus.FINAL,
                  description: charge.description,
                  quantity: charge.quantity,
                  unit: charge.unit,
                  suggestedAmount: charge.suggestedAmount,
                  amount: charge.amount,
                  pricingSnapshot: charge.pricingSnapshot,
                  overrideReason: charge.overrideReason,
                  finalizedById: actor.id,
                  finalizedAt: now,
                },
              });
            }
            const receivableTotal = new Decimal(
              chargeOrder.processingAmount,
            )
              .plus(finalizedCharges.totalAmount)
              .plus(
                chargeOrder.customerCharges
                  .filter(
                    (charge) =>
                      !['SHIPPING_FEE', 'PACKING_MATERIAL'].includes(
                        String(charge.category.code),
                      ),
                  )
                  .reduce(
                    (sum, charge) => sum.plus(charge.amount),
                    new Decimal(0),
                  ),
              )
              .toFixed(2);
            assertStorableOrderTotal(receivableTotal);
            await prismaTx.order.update({
              where: { id },
              data: { totalAmount: receivableTotal },
            });
          }
          for (const shipment of storedShipments) {
            const requested = requestByShipmentId.get(shipment.id);
            await prismaTx.orderShipment.update({
              where: { id: shipment.id },
              data: {
                trackingNo: trackingByShipmentId.get(shipment.id) ?? null,
                ...(weightByShipmentId.get(shipment.id) !== undefined
                  ? {
                      weightKg: weightByShipmentId.get(shipment.id) ?? null,
                    }
                  : {}),
                ...(requested?.destinationProvince !== undefined
                  ? {
                      destinationProvince:
                        requested.destinationProvince ??
                        shipment.destinationProvince,
                    }
                  : {}),
                status: ShipmentStatus.SHIPPED,
                shippedAt: now,
              },
              select: { id: true },
            });
          }
        }
      },
      afterTransition: async (tx, id) => {
        if (backgroundJobsMode() !== 'durable') return;
        const order = await tx.order.findUniqueOrThrow({
          where: { id },
          select: { id: true, orderNo: true },
        });
        notificationQueued = await enqueueNotificationInTransaction(
          tx as unknown as EnqueueClient,
          'ORDER_SHIPPED',
          {
            orderId: order.id,
            orderNo: order.orderNo,
            trackingNo: primaryTracking ?? '未填',
          },
          { dedupeKey: `notification:ORDER_SHIPPED:${order.id}` },
        );
      },
    },
  );

  // Slice C wire ─ ORDER_SHIPPED（tx 已 commit；生产入持久化队列）。
  // **关键 null 映射**：events.ts:ORDER_SHIPPED.trackingNo 必填 string，
  // 如果传入 null/undefined，renderTemplate 会把 `{trackingNo}` 留成
  // raw 字面量流到群消息（HANDOFF round 102 Slice C TODO）。这里映射
  // null → '未填'。
  const payload = notificationQueued ? null : await db.order.findUnique({
    where: { id: orderId },
    select: { id: true, orderNo: true },
  });
  if (payload) {
    await dispatchNotification(
      'ORDER_SHIPPED',
      {
        orderId: payload.id,
        orderNo: payload.orderNo,
        trackingNo: primaryTracking ?? '未填',
      },
      { dedupeKey: `notification:ORDER_SHIPPED:${payload.id}` },
    );
  }

  return result;
}

// SHIPPED → FINISHED (terminal). The ledger close — used after delivery
// is acknowledged so the order leaves the active workspace. Same
// `order:ship` permission gate at the action layer (ADMIN);
// no separate `order:finish` permission since today there's no business
// rule that distinguishes the two transitions' authority.
export async function finishOrder(
  orderId: string,
  actor: { id: string; role: Role },
  now: Date = new Date(),
): Promise<{ id: string; status: OrderStatus }> {
  return transitionWithLog(orderId, OrderStatus.FINISHED, actor, {
    remark: '确认完工',
    now,
    cascade: async (tx, id) => {
      const prismaTx = tx as unknown as Prisma.TransactionClient;
      const order = await prismaTx.order.findUnique({
        where: { id },
        select: {
          settlementType: true,
          _count: { select: { shipments: true } },
          customerCharges: {
            where: {
              category: {
                code: { in: ['SHIPPING_FEE', 'PACKING_MATERIAL'] },
              },
            },
            select: { status: true },
          },
        },
      });
      if (!order) throw new OrderInvariantError('工单不存在');
      if (order.settlementType !== OrderSettlementType.EXTERNAL_SALES) return;
      if (
        order.customerCharges.length !== order._count.shipments * 2 ||
        order.customerCharges.some(
          (charge) =>
            charge.status === OrderCustomerChargeStatus.ESTIMATED,
        )
      ) {
        throw new OrderInvariantError(
          '快递费与打包耗材费尚未全部确认，暂不能完结工单',
        );
      }
    },
  });
}

// ─────────────────────────────────────────────────────────────────────
// Order edit (E-lean: top-level fields only, SPEC §3.6)
// ─────────────────────────────────────────────────────────────────────
//
// Tx surface for the edit path. Kept separate from create/transition so
// the types don't drift when those grow new needs.
type EditTxClient = {
  $executeRaw: (strings: TemplateStringsArray, ...values: unknown[]) => Promise<unknown>;
  order: {
    findFirst: (args: {
      where: unknown;
      select?: unknown;
    }) => Promise<
      | {
          id: string;
          status: OrderStatus;
          submitterId: string;
          settlementType: OrderSettlementType;
          processingAmount: Decimal.Value;
          totalAmount: Decimal.Value;
          customName: string | null;
          customerRef: string | null;
          receiverName: string | null;
          receiverPhone: string | null;
          receiverAddress: string | null;
          expressCode: string | null;
          packageRequirement: string | null;
          remark: string | null;
          promisedDate: Date | null;
          isUrgent: boolean;
          isSfCollect: boolean;
        }
      | null
    >;
    update: (args: {
      where: { id: string };
      data: unknown;
      select?: unknown;
    }) => Promise<{ id: string; status: OrderStatus }>;
  };
  orderShipment: {
    updateMany: (args: {
      where: { orderId: string; sequence: number };
      data: {
        receiverName?: string | null;
        receiverPhone?: string | null;
        receiverAddress?: string | null;
        expressCode?: string | null;
      };
    }) => Promise<{ count: number }>;
  };
  orderLog: {
    create: (args: { data: unknown }) => Promise<unknown>;
  };
  orderCostEntry: {
    aggregate: (args: {
      where: { orderId: string; category: OrderCostCategory };
      _sum: { amount: true };
    }) => Promise<{ _sum: { amount: Decimal.Value | null } }>;
  };
};

type EditableOrderFieldValue = string | boolean | Date | null;

type EditableOrderSnapshot = {
  customName: string | null;
  customerRef: string | null;
  receiverName: string | null;
  receiverPhone: string | null;
  receiverAddress: string | null;
  expressCode: string | null;
  packageRequirement: string | null;
  remark: string | null;
  promisedDate: Date | null;
  isUrgent: boolean;
  isSfCollect: boolean;
};

async function assertNoShippingCostBeforeSfCollect(
  txClient: EditTxClient,
  orderId: string,
): Promise<void> {
  const shippingCost = await txClient.orderCostEntry.aggregate({
    where: { orderId, category: OrderCostCategory.SHIPPING },
    _sum: { amount: true },
  });
  const netShippingCost = new Decimal(shippingCost._sum.amount ?? 0);
  if (!netShippingCost.isZero()) {
    throw new OrderInvariantError(
      '工单已有物流成本流水，需保持非到付并由财务核对',
    );
  }
}

// Zod `optionalTrimmedText` collapses blank → undefined in the parsed
// output; normalize that to explicit null so diffing and persistence
// treat "user cleared the field" the same as the DB's null state.
function normalizeEditableValue(raw: unknown): EditableOrderFieldValue {
  if (raw === undefined || raw === '') return null;
  if (raw instanceof Date) return raw;
  if (typeof raw === 'boolean' || typeof raw === 'string') return raw;
  return null;
}

// Date 用时间戳比较（=== 对两个等值 Date 恒为 false，会把"没改"误判成
// 改动，刷出多余的 OrderLog）。
function editableValueEquals(
  a: EditableOrderFieldValue,
  b: EditableOrderFieldValue,
): boolean {
  if (a instanceof Date || b instanceof Date) {
    return (
      a instanceof Date && b instanceof Date && a.getTime() === b.getTime()
    );
  }
  return a === b;
}

// Shallow-pick only the fields that are editable at this status. Anything
// else in `input` is silently dropped; the action layer has already
// rejected unknown keys via Zod, so this is a second defense, not a
// silent filter of user-supplied data.
function pickEditableFields(
  input: Record<string, unknown>,
  allowed: readonly string[],
): Record<string, EditableOrderFieldValue> {
  const out: Record<string, EditableOrderFieldValue> = {};
  for (const key of allowed) {
    if (!(key in input)) continue;
    out[key] = normalizeEditableValue(input[key]);
  }
  return out;
}

function diffEditableFields(
  before: EditableOrderSnapshot,
  next: Record<string, EditableOrderFieldValue>,
): Record<string, { before: EditableOrderFieldValue; after: EditableOrderFieldValue }> {
  const changes: Record<
    string,
    { before: EditableOrderFieldValue; after: EditableOrderFieldValue }
  > = {};
  for (const [key, after] of Object.entries(next)) {
    const prev = (before as unknown as Record<string, EditableOrderFieldValue>)[key] ?? null;
    if (!editableValueEquals(prev, after)) {
      changes[key] = { before: prev, after };
    }
  }
  return changes;
}

export type UpdateOrderResult = {
  id: string;
  status: OrderStatus;
  changed: boolean;
  changedFields: string[];
};

export async function updateOrderFields(
  orderId: string,
  input: UpdateEditableOrderInput | UpdateShippingOrderInput,
  actor: { id: string; role: Role },
): Promise<UpdateOrderResult> {
  return db.$transaction(async (tx) => {
    const txClient = tx as unknown as EditTxClient;
    await txClient.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${orderCascadeLockKey(
      orderId,
    )}))`;

    const order = await txClient.order.findFirst({
      // Scope filter + id gives us "can this actor see this order?" in
      // a single query — action-layer ownership on top of role scope.
      where: { id: orderId, ...getOrderScopeFilter(actor) },
      select: {
        id: true,
        status: true,
        submitterId: true,
        settlementType: true,
        processingAmount: true,
        totalAmount: true,
        customName: true,
        customerRef: true,
        receiverName: true,
        receiverPhone: true,
        receiverAddress: true,
        expressCode: true,
        packageRequirement: true,
        remark: true,
        promisedDate: true,
        isUrgent: true,
        isSfCollect: true,
      },
    });
    if (!order) throw new OrderInvariantError('工单不存在或无权访问');

    // SALES / CUSTOMER_SERVICE can only edit their own orders. ADMIN /
    // ADMIN have a global override so they can correct field data for
    // anyone. Same pattern as submitOrder's ownership guard.
    const globalOverride = actor.role === Role.ADMIN;
    if (!globalOverride && order.submitterId !== actor.id) {
      throw new OrderInvariantError('只能修改自己创建的工单');
    }

    const fieldset = editableFieldsetForStatus(order.status);
    if (fieldset === 'NONE') {
      throw new OrderInvariantError('当前状态不可编辑');
    }
    const allowed =
      fieldset === 'FULL' ? FULL_EDITABLE_FIELDS : SHIPPING_EDITABLE_FIELDS;

    const nextFields = pickEditableFields(
      input as unknown as Record<string, unknown>,
      allowed,
    );
    const changes = diffEditableFields(order, nextFields);

    // No-op edit — skip the UPDATE and the log entry. Keeps the
    // OrderLog feed clean for users who open the edit form and save
    // without changing anything.
    if (Object.keys(changes).length === 0) {
      return {
        id: order.id,
        status: order.status,
        changed: false,
        changedFields: [],
      };
    }

    if (changes.isSfCollect?.after === true) {
      await assertNoShippingCostBeforeSfCollect(txClient, orderId);
    }

    const updated = await txClient.order.update({
      where: { id: orderId },
      data: nextFields,
      select: { id: true, status: true },
    });

    const primaryShipmentChanges = Object.fromEntries(
      ['receiverName', 'receiverPhone', 'receiverAddress', 'expressCode']
        .filter((field) => field in changes)
        .map((field) => [field, nextFields[field] as string | null]),
    );
    if (Object.keys(primaryShipmentChanges).length > 0) {
      await txClient.orderShipment.updateMany({
        where: { orderId, sequence: 1 },
        data: primaryShipmentChanges,
      });
    }

    await txClient.orderLog.create({
      data: {
        orderId,
        operatorId: actor.id,
        action: 'UPDATE',
        changedFields: changes,
      },
    });

    return {
      id: updated.id,
      status: updated.status,
      changed: true,
      changedFields: Object.keys(changes),
    };
  });
}

// Quick one-click 急单 flip. Callable only while the order is in
// DRAFT / SUBMITTED (isUrgent is not in the SHIPPING_ONLY set); delegates
// to updateOrderFields so the same scope / OrderLog guarantees apply.
export async function setOrderUrgent(
  orderId: string,
  isUrgent: boolean,
  actor: { id: string; role: Role },
): Promise<UpdateOrderResult> {
  return updateOrderFields(orderId, { isUrgent } as UpdateEditableOrderInput, actor);
}

// 顺丰到付是可后补的履约标识。外部销售工单切换时必须同步免收/恢复
// 对客快递费并重算 totalAmount；打包耗材费始终保留。独立事务仍保留
// 权限、所有权、串行化和完整修改日志。
export async function setOrderSfCollect(
  orderId: string,
  isSfCollect: boolean,
  actor: { id: string; role: Role },
  corrections: readonly SfCollectChargeCorrection[] = [],
): Promise<UpdateOrderResult> {
  return db.$transaction(async (tx) => {
    const txClient = tx as unknown as EditTxClient;
    await txClient.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${orderCascadeLockKey(
      orderId,
    )}))`;

    const order = await txClient.order.findFirst({
      where: { id: orderId, ...getOrderScopeFilter(actor) },
      select: {
        id: true,
        status: true,
        submitterId: true,
        settlementType: true,
        processingAmount: true,
        totalAmount: true,
        customName: true,
        customerRef: true,
        receiverName: true,
        receiverPhone: true,
        receiverAddress: true,
        expressCode: true,
        packageRequirement: true,
        remark: true,
        promisedDate: true,
        isUrgent: true,
        isSfCollect: true,
      },
    });
    if (!order) throw new OrderInvariantError('工单不存在或无权访问');

    const globalOverride = actor.role === Role.ADMIN;
    if (!globalOverride && order.submitterId !== actor.id) {
      throw new OrderInvariantError('只能修改自己创建的工单');
    }
    if (!canEditOrderSfCollect(order.status)) {
      throw new OrderInvariantError('已完成或已取消的工单不能修改顺丰到付标识');
    }
    if (
      order.settlementType === OrderSettlementType.EXTERNAL_SALES &&
      order.status === OrderStatus.SHIPPED &&
      actor.role !== Role.ADMIN
    ) {
      throw new OrderInvariantError(
        '外部销售工单发货后的顺丰到付更正只能由管理员处理',
      );
    }
    if (order.isSfCollect === isSfCollect) {
      return {
        id: order.id,
        status: order.status,
        changed: false,
        changedFields: [],
      };
    }

    if (isSfCollect) {
      await assertNoShippingCostBeforeSfCollect(txClient, orderId);
    }

    let nextTotalAmount = new Decimal(order.totalAmount).toFixed(2);
    if (order.settlementType === OrderSettlementType.EXTERNAL_SALES) {
      const prismaTx = tx as unknown as Prisma.TransactionClient;
      const chargeChangedAt = new Date();
      const chargeContext = await prismaTx.order.findUnique({
        where: { id: orderId },
        select: {
          shipments: {
            orderBy: { sequence: 'asc' },
            select: {
              id: true,
              sequence: true,
              status: true,
              destinationProvince: true,
              quotedWeightKg: true,
              weightKg: true,
              lines: { select: { quantity: true } },
            },
          },
          customerCharges: {
            select: {
              id: true,
              businessKey: true,
              amount: true,
              overrideReason: true,
              priceBookId: true,
              shipmentId: true,
              category: { select: { code: true } },
            },
          },
        },
      });
      if (!chargeContext) throw new OrderInvariantError('工单不存在');
      const standardCharges = chargeContext.customerCharges.filter((charge) =>
        ['SHIPPING_FEE', 'PACKING_MATERIAL'].includes(
          String(charge.category.code),
        ),
      );
      if (standardCharges.length !== chargeContext.shipments.length * 2) {
        throw new OrderInvariantError(
          '快递/耗材收费明细不完整，无法切换顺丰到付标识',
        );
      }

      const priceBookIds = [
        ...new Set(
          standardCharges.flatMap((charge) =>
            charge.priceBookId ? [charge.priceBookId] : [],
          ),
        ),
      ];
      if (priceBookIds.length !== 1) {
        throw new OrderInvariantError(
          '快递/耗材收费未绑定唯一价目簿，无法切换顺丰到付标识',
        );
      }
      const chargeByShipmentAndCategory = new Map(
        standardCharges.map((charge) => [
          `${charge.shipmentId}:${String(charge.category.code)}`,
          charge,
        ]),
      );
      const correctionByShipmentId = new Map(
        corrections.map((correction) => [correction.shipmentId, correction]),
      );
      if (correctionByShipmentId.size !== corrections.length) {
        throw new OrderInvariantError('顺丰到付更正包含重复的发货地址');
      }
      if (
        corrections.some(
          (correction) =>
            !chargeContext.shipments.some(
              (shipment) => shipment.id === correction.shipmentId,
            ),
        )
      ) {
        throw new OrderInvariantError('顺丰到付更正包含不属于该工单的发货地址');
      }
      if (
        !isSfCollect &&
        order.status === OrderStatus.SHIPPED &&
        (corrections.length !== chargeContext.shipments.length ||
          chargeContext.shipments.some(
            (shipment) => !correctionByShipmentId.has(shipment.id),
          ))
      ) {
        throw new OrderInvariantError(
          '已发货工单取消顺丰到付时，必须补齐每个地址的计费信息',
        );
      }

      let repriced: Awaited<
        ReturnType<typeof resolveExternalOrderChargesForFinalization>
      >;
      try {
        repriced = await resolveExternalOrderChargesForFinalization(
          prismaTx,
          {
            isSfCollect,
            shipments: chargeContext.shipments.map((shipment) => {
              const packing = chargeByShipmentAndCategory.get(
                `${shipment.id}:PACKING_MATERIAL`,
              );
              const correction = correctionByShipmentId.get(shipment.id);
              const storedWeight =
                shipment.weightKg?.toString() ??
                (shipment.status === ShipmentStatus.SHIPPED
                  ? null
                  : shipment.quotedWeightKg?.toString() ?? null);
              const billableWeightKg = correction?.weightKg ?? storedWeight;
              const allowProvisionalManual =
                !isSfCollect &&
                shipment.status !== ShipmentStatus.SHIPPED &&
                !billableWeightKg;
              return {
                shipmentKey: String(shipment.sequence),
                province:
                  correction?.destinationProvince ??
                  shipment.destinationProvince,
                billableWeightKg: isSfCollect ? null : billableWeightKg,
                itemQuantity: shipment.lines.reduce(
                  (sum, line) => sum + line.quantity,
                  0,
                ),
                shippingFee: isSfCollect
                  ? '0.00'
                  : correction?.shippingFee ??
                    (allowProvisionalManual ? '0.00' : null),
                packingMaterialFee: packing?.amount.toString() ?? null,
                overrideReason: isSfCollect
                  ? packing?.overrideReason ?? null
                  : correction?.customerChargeOverrideReason ??
                    (allowProvisionalManual
                      ? '取消顺丰到付，快递费待发货时确认'
                      : packing?.overrideReason ?? null),
              };
            }),
          },
          priceBookIds[0]!,
          chargeChangedAt,
        );
      } catch (error) {
        if (error instanceof OrderCustomerChargeError) {
          throw new OrderInvariantError(error.message);
        }
        throw error;
      }

      const existingByBusinessKey = new Map(
        standardCharges.map((charge) => [
          String(charge.businessKey),
          charge,
        ]),
      );
      const finalized = order.status === OrderStatus.SHIPPED;
      for (const charge of repriced.charges) {
        if (isSfCollect && charge.categoryCode !== 'SHIPPING_FEE') continue;
        const existing = existingByBusinessKey.get(charge.businessKey);
        if (!existing) {
          throw new OrderInvariantError(
            `找不到收费明细 ${charge.businessKey}，无法切换顺丰到付标识`,
          );
        }
        await prismaTx.orderCustomerCharge.update({
          where: { id: existing.id },
          data: {
            categoryId: charge.categoryId,
            sourceRuleId: charge.sourceRuleId,
            status: isSfCollect
              ? OrderCustomerChargeStatus.WAIVED
              : finalized
                ? OrderCustomerChargeStatus.FINAL
                : OrderCustomerChargeStatus.ESTIMATED,
            description: charge.description,
            quantity: charge.quantity,
            unit: charge.unit,
            suggestedAmount: charge.suggestedAmount,
            amount: charge.amount,
            pricingSnapshot: charge.pricingSnapshot,
            overrideReason: charge.overrideReason,
            finalizedById: isSfCollect || finalized ? actor.id : null,
            finalizedAt: isSfCollect || finalized ? chargeChangedAt : null,
          },
        });
      }

      await prismaTx.orderShipment.updateMany({
        where: { orderId },
        data: { carrierCode: isSfCollect ? 'SF' : 'ZTO' },
      });
      if (!isSfCollect) {
        for (const correction of corrections) {
          await prismaTx.orderShipment.update({
            where: { id: correction.shipmentId },
            data: {
              destinationProvince: correction.destinationProvince,
              weightKg: correction.weightKg,
            },
            select: { id: true },
          });
        }
      }

      const otherCustomerCharges = chargeContext.customerCharges
        .filter(
          (charge) =>
            !['SHIPPING_FEE', 'PACKING_MATERIAL'].includes(
              String(charge.category.code),
            ),
        )
        .reduce(
          (sum, charge) => sum.plus(charge.amount),
          new Decimal(0),
        );
      if (isSfCollect) {
        const retainedNonShippingCharges = chargeContext.customerCharges
          .filter(
            (charge) => String(charge.category.code) !== 'SHIPPING_FEE',
          )
          .reduce(
            (sum, charge) => sum.plus(charge.amount),
            new Decimal(0),
          );
        nextTotalAmount = new Decimal(order.processingAmount)
          .plus(retainedNonShippingCharges)
          .toFixed(2);
      } else {
        nextTotalAmount = new Decimal(order.processingAmount)
          .plus(repriced.totalAmount)
          .plus(otherCustomerCharges)
          .toFixed(2);
      }
      assertStorableOrderTotal(nextTotalAmount);
    }

    const updated = await txClient.order.update({
      where: { id: orderId },
      data: { isSfCollect, totalAmount: nextTotalAmount },
      select: { id: true, status: true },
    });
    await txClient.orderLog.create({
      data: {
        orderId,
        operatorId: actor.id,
        action: 'UPDATE',
        changedFields: {
          isSfCollect: { before: order.isSfCollect, after: isSfCollect },
          ...(new Decimal(order.totalAmount).equals(nextTotalAmount)
            ? {}
            : {
                totalAmount: {
                  before: new Decimal(order.totalAmount).toFixed(2),
                  after: nextTotalAmount,
                },
              }),
          ...(corrections.length > 0
            ? {
                shipmentChargeCorrections: {
                  before: null,
                  after: corrections.map((correction) => ({
                    shipmentId: correction.shipmentId,
                    destinationProvince: correction.destinationProvince,
                    weightKg: correction.weightKg,
                    shippingFee: correction.shippingFee,
                    overrideReason:
                      correction.customerChargeOverrideReason,
                  })),
                },
              }
            : {}),
        },
        remark: isSfCollect
          ? '标记顺丰到付（自行预约）'
          : '取消顺丰到付',
      },
    });

    return {
      id: updated.id,
      status: updated.status,
      changed: true,
      changedFields: [
        'isSfCollect',
        ...(new Decimal(order.totalAmount).equals(nextTotalAmount)
          ? []
          : ['totalAmount']),
        ...(corrections.length > 0 ? ['shipmentChargeCorrections'] : []),
      ],
    };
  });
}

export async function getOrderDetail(id: string, user: { id: string; role: Role }) {
  const isWorkerView = user.role === Role.WORKER;
  const isAdminView = user.role === Role.ADMIN;
  const order = await db.order.findFirst({
    where: {
      id,
      // Same scope filter as listOrders — fetching by id respects the
      // role-based visibility rather than erroring inconsistently.
      ...getOrderScopeFilter(user),
    },
    ...(isWorkerView
      ? {
          omit: {
            settlementType: true,
            processingAmount: true,
            totalAmount: true,
          },
        }
      : {}),
    include: {
      items: {
        orderBy: { sequence: 'asc' },
        ...(isWorkerView
          ? {
              omit: {
                unitPrice: true,
                fixedFee: true,
                subtotal: true,
                suggestedPrice: true,
                suggestedSubtotal: true,
                pricingSnapshot: true,
                priceOverrideReason: true,
              },
            }
          : {}),
        include: {
          designs: true,
          tasks: {
            select: {
              id: true,
              status: true,
              craft: { select: { id: true, name: true } },
              worker: { select: { id: true, displayName: true } },
            },
          },
          product: {
            select: {
              id: true,
              name: true,
              categoryNodeId: true,
              categoryNode: { select: { id: true, name: true } },
            },
          },
        },
      },
      logs: isWorkerView
        ? {
            orderBy: { createdAt: 'desc' as const },
            take: 20,
            select: {
              id: true,
              action: true,
              createdAt: true,
              operator: { select: { displayName: true, role: true } },
            },
          }
        : {
            orderBy: { createdAt: 'desc' as const },
            take: 20,
            include: {
              operator: { select: { displayName: true, role: true } },
            },
          },
      outsourceOrders: {
        // 逐款式数量快照供「暂不能完工」横幅与完工闸口共用。
        select: {
          id: true,
          status: true,
          orderItemIds: true,
          itemSnapshots: {
            select: { orderItemId: true, quantity: true },
          },
        },
        orderBy: { createdAt: 'desc' },
      },
      shipments: {
        orderBy: { sequence: 'asc' },
        include: {
          lines: {
            orderBy: { orderItem: { sequence: 'asc' } },
            include: {
              orderItem: { select: { id: true, sequence: true, name: true } },
            },
          },
        },
      },
      sourceOrder: {
        select: { id: true, orderNo: true, customName: true, status: true },
      },
      reworkOrders: {
        orderBy: { createdAt: 'desc' },
        select: { id: true, orderNo: true, customName: true, status: true },
      },
      submitter: {
        select: { id: true, displayName: true, username: true, role: true },
      },
      ...(isWorkerView
        ? {}
        : {
            changeRequests: {
              orderBy: { createdAt: 'desc' as const },
              take: 20,
              include: {
                requester: { select: { displayName: true, role: true } },
                reviewedBy: { select: { displayName: true } },
              },
            },
          }),
      ...(isAdminView
        ? {
            costEntries: {
              orderBy: { createdAt: 'asc' as const },
              include: {
                createdBy: { select: { displayName: true } },
              },
            },
          }
        : {}),
    },
  });
  if (!order) return null;

  // Keep the commercial charge query entirely outside the worker branch.
  // Besides making the no-leak boundary explicit, this avoids Prisma's
  // conditional-include type collapsing nested relations to scalar fields.
  const customerCharges = isWorkerView
    ? []
    : await db.orderCustomerCharge.findMany({
        where: { orderId: order.id },
        orderBy: { createdAt: 'asc' },
        include: {
          category: { select: { code: true, name: true } },
          shipment: { select: { id: true, sequence: true } },
          priceBook: { select: { code: true, name: true, version: true } },
        },
      });

  // OrderItem.crafts stores stable Craft IDs rather than display names.
  // Resolve the distinct IDs once for the whole order, then project names
  // back in each item's original order. Do not filter by isActive: historical
  // orders must keep the name of a craft that was disabled after creation.
  const craftIds = [
    ...new Set(order.items.flatMap((item) => item.crafts)),
  ];
  const craftNameById = new Map<string, string>();
  // 复用同一条字典查询算出「哪些款式还没被外协单覆盖」——完工闸口
  // （lib/production-completion.ts）用同一个纯函数 + 同一个前置谓词判定，
  // 页面提示和实际能否完工不会打架。这里不新增任何查询。
  let uncoveredOutsourceItems: Array<{
    id: string;
    sequence: number;
    name: string;
  }> = [];
  if (craftIds.length > 0) {
    const crafts = await db.craft.findMany({
      where: { id: { in: craftIds } },
      select: { id: true, name: true, isOutsource: true },
    });
    for (const craft of crafts) {
      craftNameById.set(craft.id, craft.name);
    }
    // ⚠️ 覆盖计算必须和闸口同一个前置条件（outsourceCoverageApplies）；
    //    craft 名称解析**不能**一起挪进这个 if，否则 craftNames 会全部
    //    退化成「已删除工艺」。
    if (outsourceCoverageApplies(order)) {
      uncoveredOutsourceItems = findUndercoveredOutsourceItems(
        order.items.map((item) => ({
          id: item.id,
          sequence: item.sequence,
          name: item.name,
          quantity: item.quantity,
          crafts: item.crafts,
        })),
        collectOutsourceCraftIds(crafts),
        order.outsourceOrders.filter(
          (row) => row.status !== OutsourceStatus.CANCELLED,
        ),
      )
        // 只投出横幅要用的三个字段：crafts 留在返回值里会让这个对外形状
        // 白白多背一个数组，且与闸口 uncoveredItems 的形状不一致。
        .map((item) => ({
          id: item.id,
          sequence: item.sequence,
          name: item.name,
        }));
    }
  }

  return {
    ...order,
    // WORKER deliberately does not query the commercial review relation.
    // Preserve a stable page shape without reintroducing any row data.
    changeRequests: isWorkerView ? [] : order.changeRequests,
    customerCharges,
    uncoveredOutsourceItems,
    items: order.items.map((item) => ({
      ...item,
      craftNames: item.crafts.map(
        (craftId) => craftNameById.get(craftId) ?? '已删除工艺',
      ),
    })),
  };
}

// Re-export for action-layer error mapping.
export { InvalidOrderTransitionError };
