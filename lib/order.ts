import { createOrderRequestFingerprint, matchesCreateOrderRequest } from './order/create-request-fingerprint';
import { hasRetiredPaperItem, RETIRED_PAPER_MESSAGE } from './rules/paper-availability';
import { finalizeSampleOrderInTx, SampleOrderError, SampleQuoteChangedError } from './order/sample-order';
import { createOrderSchema } from './auth/schemas';
import { isSampleOrder } from './order/purpose';
import { subtotalReconciles } from './order/subtotal-reconciliation';
import { salesCustomerScope } from './order/sales-customer-policy';
import { planOrderShipmentEdits, OrderShipmentEditError, type EditableShipment } from './order/edit-shipment-fields';
import { createHash } from 'node:crypto';
import Decimal from 'decimal.js';
import { calculateAdminCreatePrice, adminCreatePriceFactsKey, calculateAdminPackagingPrice, adminPackagingPriceFactsKey } from './order/admin-create-price';
import { buildTrustedAdminItemPricingSnapshot, buildTrustedAdminPackagingPricingSnapshot } from './order/admin-pricing-snapshot';
import {
  CsSalesEntryType,
  CustomerPriceBookPurpose,
  DesignFileType,
  OrderBillingMode,
  OrderChangeRequestStatus,
  OrderCraft,
  OrderCustomerChargeStatus,
  OrderCostCategory,
  OrderKind,
  OrderItemQuoteDisposition,
  OrderQuotedFeeCompleteness,
  OrderSettlementType,
  OrderStatus,
  OutsourceStatus,
  PartyType,
  Prisma,
  ProductionOperationStatus,
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
  externalSalesAssociationBlockReason,
  externalSalesAssociationSelect,
  type ExternalSalesAccountOption,
} from './order/external-sales-association';
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
import {
  assertCsOrderSalesLedgerReconciledInTx,
  CsSalesLedgerError,
  recordCsSalesEntryInTx,
  csSalesBasisAmountInTx,
} from './salary/cs-sales';
import { hasLogisticsChargeRows, LOGISTICS_CHARGE_CATEGORY_CODES, orderBillsLogistics, settlementBillsLogistics, settlementTypeForOrderCreator } from './order/settlement';
import {
  calculateCreateOrderQuoteFromCatalogInTx,
  CreateOrderQuoteError,
  type CatalogCreateOrderQuoteCalculation,
} from './order/create-order-quote-service';
import {
  OrderCustomerChargeError,
  resolveExternalOrderChargesForFinalization,
} from './price/order-charge-service';
import { deriveExternalOrderChargeShipments } from './price/external-order-charge-facts';
import {
  ORDER_PRICING_STATUS,
  type OrderPricingStatusValue,
} from './order/pricing-status';
import { appendOrderPricingRevisionInTx } from './order/pricing-revision';
import {
  FulfillmentPricingError,
  finalizeConfirmedFulfillmentChargesForShipmentInTx,
  hasFulfillmentPricingConfirmation,
  isFulfillmentPricingStatus,
  recordFulfillmentSfCollectChangeInTx,
  type FulfillmentPricingMutationGuard,
} from './order/fulfillment-pricing';
import {
  PendingPlateChargeError,
  quoteHasPendingPlateCharge,
  requireActivePlateCategoryIdInTx,
  upsertPendingPlateChargeInTx,
} from './order/pending-plate-charge';
import {
  LEGACY_STOCK_FOIL_CRAFT_CODE,
  STOCK_LOCAL_FOIL_CRAFT_CODE,
  deriveLegacyOrderItemFoilFacts,
  isNewOrderPricingRoute,
} from './order/pricing-route';
import {
  calculateCreateOrderBagCount,
  MAX_CREATE_ORDER_UNITS_PER_BAG,
  CREATE_ORDER_PACKAGING_LIMIT_MESSAGE,
} from './order/create-order-packaging';
import {
  ExternalOrderQuoteChangedError,
  ExternalOrderQuoteFinalizeError,
  finalizeExternalOrderQuoteInTx,
} from './order/submit-external-order';
import { prepareOrderForProductionInTx } from './order/production-readiness';
import { getSetting } from './settings';

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

export class OrderQuoteChangedError extends Error {
  constructor(
    readonly quoteToken: string,
    readonly quotedFee: string,
    readonly quotedFeeCompleteness: OrderQuotedFeeCompleteness,
    message: string,
  ) {
    super(message);
    this.name = 'OrderQuoteChangedError';
  }
}

const DECIMAL_10_4_MAX = new Decimal('999999.9999');
const DECIMAL_12_2_MAX = new Decimal('9999999999.99');
const ORDER_TOTAL_LIMIT_MESSAGE =
  '工单总金额超过系统上限 9,999,999,999.99 元';

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
    throw new OrderInvariantError(ORDER_TOTAL_LIMIT_MESSAGE);
  }
}

function rethrowCreateOrderQuoteError(error: unknown): never {
  if (!(error instanceof CreateOrderQuoteError)) throw error;
  if (error.message.includes('整单已知金额合计超过可保存上限')) {
    throw new OrderInvariantError(ORDER_TOTAL_LIMIT_MESSAGE);
  }
  throw new OrderInvariantError(error.message);
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

function assertExternalSalesPackagingCoverage(
  settlementType: OrderSettlementType,
  itemCount: number,
  packagingGroups: readonly {
    itemUnitsPerBag: readonly number[];
  }[],
): void {
  if (settlementType !== OrderSettlementType.EXTERNAL_SALES) return;

  if (packagingGroups.length === 0) {
    throw new OrderInvariantError(
      '外部销售工单必须为每个款式设置一个包装组',
    );
  }

  const membershipCountByItem = Array.from(
    { length: itemCount },
    () => 0,
  );
  for (const [groupIndex, group] of packagingGroups.entries()) {
    const hasItem = group.itemUnitsPerBag.some(
      (unitsPerBag, itemIndex) =>
        itemIndex < itemCount && unitsPerBag > 0,
    );
    if (!hasItem) {
      throw new OrderInvariantError(
        `包装组 ${groupIndex + 1} 未包含任何款式`,
      );
    }
    group.itemUnitsPerBag.forEach((unitsPerBag, itemIndex) => {
      if (itemIndex < itemCount && unitsPerBag > 0) {
        membershipCountByItem[itemIndex] += 1;
      }
    });
  }

  membershipCountByItem.forEach((membershipCount, itemIndex) => {
    if (membershipCount === 0) {
      throw new OrderInvariantError(
        `款式 ${itemIndex + 1} 未加入包装组，无法计算入袋费`,
      );
    }
    if (membershipCount > 1) {
      throw new OrderInvariantError(
        `款式 ${itemIndex + 1} 同时属于多个包装组，不能重复计算入袋费`,
      );
    }
  });
}

function canonicalCraftForPricingRoute(
  route: CreateOrderInput['items'][number]['pricingRoute'],
): OrderCraft | null {
  switch (route) {
    case 'STOCK_BLANK':
      return OrderCraft.PARTIAL;
    case 'CUSTOM_SINGLE_FLAT_FOIL':
      return OrderCraft.FULL;
    case 'COLOR_PRINT':
      return OrderCraft.PRINT;
    case 'MANUAL_QUOTE':
      return null;
  }
}

export type CreatedOrderSummary = {
  id: string;
  orderNo: string;
  itemIds: string[];
  pricingStatus: OrderPricingStatusValue;
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

type CreateOrderItemCommand = Omit<
  CreateOrderInput['items'][number],
  'frontFoilColors' | 'backFoilColors'
> &
  Partial<
    Pick<
      CreateOrderInput['items'][number],
      'frontFoilColors' | 'backFoilColors'
    >
  >;

type CreateOrderCommand = Omit<
  CreateOrderInput,
  | 'items'
  | 'additionalShipments'
  | 'packagingGroups'
  | 'customerPartyId'
  | ShipmentChargeField
> &
  Partial<Pick<CreateOrderInput, ShipmentChargeField | 'customerPartyId'>> & {
    items: CreateOrderItemCommand[];
    additionalShipments?: AdditionalShipmentCommand[];
    packagingGroups?: CreateOrderInput['packagingGroups'];
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

function normalizeShipOrderInput(
  trackingInput: string | null | ShipOrderCommand,
) {
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
  // Treat both null AND whitespace-only as “no tracking number”. A blank
  // tracking number must never be persisted as an empty string.
  const trimmed = legacyTrackingInput?.trim() ?? '';
  const tracking = trimmed.length > 0 ? trimmed : null;
  const primaryTracking =
    requestedShipments.length > 0
      ? requestedShipments[0]?.trackingNo ?? null
      : tracking;

  const command =
    typeof trackingInput === 'object' && trackingInput !== null
      ? {
          expectedRevision: trackingInput.expectedRevision,
          expectedEditVersion: trackingInput.expectedEditVersion,
          expectedWorkOrderVersion: trackingInput.expectedWorkOrderVersion,
          expectedPriceRevision: trackingInput.expectedPriceRevision,
          idempotencyKey: trackingInput.idempotencyKey.trim(),
        }
      : null;

  return { requestedShipments, primaryTracking, command };
}

type ShipOrderCommandGuard = {
  expectedRevision: number;
  expectedEditVersion: number;
  expectedWorkOrderVersion: number;
  expectedPriceRevision: number;
  idempotencyKey: string;
  fingerprint: string;
};

function assertValidShipOrderCommand(
  command: Omit<ShipOrderCommandGuard, 'fingerprint'>,
): void {
  if (
    !Number.isSafeInteger(command.expectedRevision) ||
    command.expectedRevision < 0
  ) {
    throw new OrderInvariantError('工单修订号格式非法，请刷新后重试');
  }
  if (
    !Number.isSafeInteger(command.expectedEditVersion) ||
    command.expectedEditVersion < 0
  ) {
    throw new OrderInvariantError('工单编辑版本格式非法，请刷新后重试');
  }
  if (
    !Number.isSafeInteger(command.expectedWorkOrderVersion) ||
    command.expectedWorkOrderVersion < 1
  ) {
    throw new OrderInvariantError('纸质工单版本格式非法，请刷新后重试');
  }
  if (
    !Number.isSafeInteger(command.expectedPriceRevision) ||
    command.expectedPriceRevision < 0
  ) {
    throw new OrderInvariantError('价格版本格式非法，请刷新后重试');
  }
  if (
    !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu.test(
      command.idempotencyKey,
    )
  ) {
    throw new OrderInvariantError('发货请求标识格式非法，请刷新后重试');
  }
}

function shipOrderFingerprint(input: {
  orderId: string;
  command: Omit<ShipOrderCommandGuard, 'fingerprint'>;
  primaryTracking: string | null;
  requestedShipments: ReturnType<
    typeof normalizeShipOrderInput
  >['requestedShipments'];
}): string {
  return createHash('sha256')
    .update(
      JSON.stringify({
        orderId: input.orderId,
        expectedRevision: input.command.expectedRevision,
        expectedEditVersion: input.command.expectedEditVersion,
        expectedWorkOrderVersion: input.command.expectedWorkOrderVersion,
        expectedPriceRevision: input.command.expectedPriceRevision,
        trackingNo: input.primaryTracking,
        shipments: input.requestedShipments.map((shipment) => ({
          shipmentId: shipment.shipmentId,
          trackingNo: shipment.trackingNo,
          weightKg: shipment.weightKg ?? null,
          destinationProvince: shipment.destinationProvince ?? null,
          shippingFee: shipment.shippingFee ?? null,
          packingMaterialFee: shipment.packingMaterialFee ?? null,
          customerChargeOverrideReason:
            shipment.customerChargeOverrideReason ?? null,
        })),
      }),
    )
    .digest('hex');
}

export type SfCollectChargeCorrection = {
  shipmentId: string;
  destinationProvince: string | null;
  weightKg: string | null;
  shippingFee: string | null;
  customerChargeOverrideReason: string | null;
};

async function assertCreateOrderProductsInTx(
  txClient: Prisma.TransactionClient,
  items: readonly { productId?: string | null }[],
): Promise<void> {
  // Batch lookup preserves per-item first-error order, including the
  // distinction between a missing product and a disabled product.
  const productIds = [
    ...new Set(
      items.flatMap((it) => (it.productId ? [it.productId] : [])),
    ),
  ];
  if (productIds.length > 0) {
    const foundProducts = await txClient.product.findMany({
      where: { id: { in: productIds } },
      select: { id: true, isActive: true },
    });
    const productById = new Map(foundProducts.map((p) => [p.id, p]));
    for (const item of items) {
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
}

// The transaction path:
//   1. advisory-lock the per-day order-seq (inside nextOrderNumber)
//   2. verify every referenced Craft exists + is active
//   3. quote under the shared price-rule transaction lock
//   4. verify the optional productId (if any) exists + is active while locked
//   5. compute subtotals + totalAmount in Decimal.js
//   6. nested-create Order + items + initial OrderLog("CREATE") in one call
async function resolveCreationCraftsInTx(
  txClient: Prisma.TransactionClient,
  input: CreateOrderCommand,
) {
  // (2) craft FK + activation check — surfaces a clean invariant error
  // instead of a Prisma FK error.
  const craftIds = [...new Set(input.items.flatMap((it) => it.crafts))];
  const foundCrafts = await txClient.craft.findMany({
    where: { id: { in: craftIds } },
    select: { id: true, code: true, isActive: true },
  });
  if (foundCrafts.length !== craftIds.length) {
    const missing = craftIds.filter((id) => !foundCrafts.some((c) => c.id === id));
    throw new OrderInvariantError(
      `工艺不存在：${missing.join(', ')}`,
    );
  }

  const craftById = new Map(foundCrafts.map((craft) => [craft.id, craft]));
  for (const item of input.items) {
    const unavailable = item.crafts.filter((craftId) => {
      const craft = craftById.get(craftId);
      if (!craft || craft.isActive) return false;
      return !(
        item.pricingRoute === 'STOCK_BLANK' &&
        craft.code === LEGACY_STOCK_FOIL_CRAFT_CODE
      );
    });
    if (unavailable.length > 0) {
      throw new OrderInvariantError(
        `工艺已停用：${unavailable.join(', ')}`,
      );
    }
  }

  const hasStockLocalFoilItem = input.items.some(
    (item) => item.pricingRoute === 'STOCK_BLANK',
  );
  let canonicalStockLocalFoilCraft = foundCrafts.find(
    (craft) =>
      craft.code === STOCK_LOCAL_FOIL_CRAFT_CODE && craft.isActive,
  );
  if (hasStockLocalFoilItem && !canonicalStockLocalFoilCraft) {
    const canonicalCrafts = await txClient.craft.findMany({
      where: {
        code: STOCK_LOCAL_FOIL_CRAFT_CODE,
        isActive: true,
      },
      select: { id: true, code: true, isActive: true },
    });
    canonicalStockLocalFoilCraft = canonicalCrafts[0];
  }
  if (hasStockLocalFoilItem && !canonicalStockLocalFoilCraft) {
    throw new OrderInvariantError(
      '当前没有启用的“局部烫金”工艺，无法创建通版现货工单',
    );
  }
  const craftCodeById = new Map(
    foundCrafts.map((craft) => [craft.id, craft.code]),
  );
  return { canonicalStockLocalFoilCraft, craftCodeById };
}

async function findOrderBySubmissionId(tx: Pick<Prisma.TransactionClient, 'order'>, clientSubmissionId: string) {
  return tx.order.findUnique({
    where: { clientSubmissionId },
    select: {
      id: true, orderNo: true, submitterId: true, createdById: true, pricingStatus: true,
      logs: { where: { action: 'CREATE' }, orderBy: { createdAt: 'asc' }, take: 1, select: { changedFields: true } },
      items: { select: { id: true }, orderBy: { sequence: 'asc' } },
    },
  });
}

export async function createOrder(
  input: CreateOrderCommand,
  actor: { id: string; role: Role },
  now: Date = new Date(),
): Promise<CreatedOrderSummary> {
  const requestFingerprint = createOrderRequestFingerprint(input);
  const special = isSampleOrder(input.purpose);
  const sampleShipment = input.purpose === 'SAMPLE_SHIPMENT';
  if (special) {
    const parsed = createOrderSchema.safeParse(input);
    if (!parsed.success) throw new OrderInvariantError(parsed.error.issues.map((issue) => issue.message).join('；'));
  }
  const additionalShipments = input.additionalShipments ?? [];
  const hasAdminPrices = validateAdminCreatePrices(input, actor.role, additionalShipments);

  const packagingGroupInputs = input.packagingGroups ?? [];
  const externalSalesUserId = input.externalSalesUserId?.trim() || null;
  if (externalSalesUserId && actor.role !== Role.ADMIN) {
    throw new OrderInvariantError('只有管理员可以关联外部销售');
  }
  const submitterId = externalSalesUserId ?? actor.id;
  const settlementType = externalSalesUserId
    ? OrderSettlementType.EXTERNAL_SALES
    : settlementTypeForOrderCreator(actor.role);
  for (const item of input.items) {
    if (
      item.pack != null &&
      (!Number.isSafeInteger(item.pack) ||
        item.pack < 1 ||
        item.pack > MAX_CREATE_ORDER_UNITS_PER_BAG)
    ) {
      throw new OrderInvariantError(CREATE_ORDER_PACKAGING_LIMIT_MESSAGE);
    }
  }
  // New-business gate only; see hasRetiredPaperItem for why the shared quote
  // adapter must not do this.
  if (hasRetiredPaperItem(input.items)) {
    throw new OrderInvariantError(RETIRED_PAPER_MESSAGE);
  }
  const isExternalSalesDraft =
    settlementType === OrderSettlementType.EXTERNAL_SALES || special;
  if (!input.receiverAddress?.trim()) {
    throw new OrderInvariantError('请填写收货地址');
  }
  const missingAdditionalAddress = additionalShipments.findIndex(
    (shipment) => !shipment.receiverAddress?.trim(),
  );
  if (missingAdditionalAddress >= 0) {
    throw new OrderInvariantError(
      `请填写额外地址 ${missingAdditionalAddress + 1} 的收货地址`,
    );
  }
  if (!sampleShipment) assertExternalSalesPackagingCoverage(
    settlementType,
    input.items.length,
    packagingGroupInputs,
  );
  const resolvedItemFigs = input.items.map(
    (item, index) => item.fig ?? index + 1,
  );
  if (new Set(resolvedItemFigs).size !== resolvedItemFigs.length) {
    throw new OrderInvariantError('款式编号不能重复');
  }
  const minimumNextItemFig = Math.max(...resolvedItemFigs) + 1;
  if (
    input.nextItemFig !== undefined &&
    input.nextItemFig < minimumNextItemFig
  ) {
    throw new OrderInvariantError('下一款式编号不能复用已分配编号');
  }
  const nextItemFig = input.nextItemFig ?? minimumNextItemFig;

  const createOnce = () => db.$transaction(async (tx) => {
    // Keep the real generated transaction type here. A hand-written
    // `data: unknown` facade previously hid schema/client drift from
    // TypeScript and allowed an obsolete Prisma runtime to reach production
    // code before failing on the first nested write.
    const txClient = tx;
    if (hasAdminPrices) {
      const administrator = await txClient.user.findUnique({ where: { id: actor.id }, select: { role: true, isActive: true } });
      if (!administrator?.isActive || administrator.role !== Role.ADMIN) throw new OrderInvariantError('当前账号不能修改工单价格');
    }

    if (input.clientSubmissionId) {
      const existing = await findOrderBySubmissionId(txClient, input.clientSubmissionId);
      if (existing) {
        if (
          existing.createdById !== actor.id ||
          existing.submitterId !== submitterId
        ) {
          throw new OrderInvariantError('提交标识已被其他账号使用');
        }
        if (!matchesCreateOrderRequest(existing.logs?.[0]?.changedFields, requestFingerprint)) {
          throw new OrderInvariantError(`工单 ${existing.orderNo} 已保存，本次填写与原记录不一致或无法核对。请从工单列表打开核对后修改。`);
        }
        return {
          id: existing.id,
          orderNo: existing.orderNo,
          itemIds: existing.items.map((item) => item.id),
          pricingStatus: existing.pricingStatus,
        };
      }
    }

    if (externalSalesUserId) {
      await txClient.$executeRaw`SELECT id FROM "User" WHERE id = ${externalSalesUserId} FOR SHARE`;
      const target = await txClient.user.findUnique({
        where: { id: externalSalesUserId },
        select: { role: true, isActive: true },
      });
      if (!target || !target.isActive || target.role !== Role.SALES) {
        throw new OrderInvariantError('所选账号不存在、已停用或不是外部销售，请重新选择');
      }
    }

    // (1) allocate a fresh GD-YYMMDD-XXX (advisory lock inside).
    const orderNo = await nextOrderNumber(txClient, now);

    const { canonicalStockLocalFoilCraft, craftCodeById } =
      await resolveCreationCraftsInTx(txClient, input);
    const items = input.items.map((item) => {
      const foilFacts = deriveLegacyOrderItemFoilFacts(item);
      if (item.pricingRoute !== 'STOCK_BLANK') {
        return { ...item, ...foilFacts };
      }
      const normalizedCraftIds = item.crafts.filter(
        (craftId) =>
          craftCodeById.get(craftId) !== LEGACY_STOCK_FOIL_CRAFT_CODE,
      );
      normalizedCraftIds.push(canonicalStockLocalFoilCraft!.id);
      return {
        ...item,
        ...foilFacts,
        crafts: [...new Set(normalizedCraftIds)],
      };
    });
    const packagingGroups = packagingGroupInputs.map((group, index) => {
      const count = calculateCreateOrderBagCount({
        mode: group.mode,
        itemQuantities: items.map((item) => item.quantity),
        itemUnitsPerBag: group.itemUnitsPerBag,
        shipmentQuantities: [items.map((item, itemIndex) => item.quantity - additionalShipments.reduce((sum, shipment) => sum + (shipment.itemQuantities[itemIndex] ?? 0), 0)), ...additionalShipments.map((shipment) => shipment.itemQuantities)],
      });
      if (!count.complete) {
        throw new OrderInvariantError(
          `包装组 ${index + 1}：${count.errors.join('；')}`,
        );
      }
      return { ...group, actualBagCount: count.bagCount };
    });

    // External sales create only a production-facts DRAFT. Their browser quote
    // is a review aid, not a financial write: the submit finalizer re-quotes
    // persisted facts, locks price versions and creates revision 1 atomically.
    // Internal settlement keeps its existing create-time quote behavior.
    for (const item of items) {
      assertOrderQuantity(item.quantity, item.name);
    }
    const customerPartyId =
      actor.role === Role.ADMIN ? null : input.customerPartyId ?? null;
    if (customerPartyId) {
      const customer = await txClient.party.findUnique({
        where: { id: customerPartyId },
        select: { id: true, type: true, isActive: true },
      });
      if (actor.role === Role.SALES && !await txClient.party.findFirst({ where: { id: customerPartyId, ...salesCustomerScope(actor.id) }, select: { id: true } })) {
        throw new OrderInvariantError('只能选择自己关联的客户');
      }
      if (!customer || !customer.isActive) {
        throw new OrderInvariantError('所选客户不存在或已停用');
      }
      if (
        customer.type !== PartyType.CUSTOMER &&
        customer.type !== PartyType.BOTH
      ) {
        throw new OrderInvariantError('所选往来单位不是客户');
      }
    }
    let internalQuote: CatalogCreateOrderQuoteCalculation | null = null;
    if (!isExternalSalesDraft) {
      try {
        const itemKeys = items.map((_, index) => String(index + 1));
        const primaryQuantities = items.map((item, itemIndex) => {
          const extraQuantity = additionalShipments.reduce(
            (sum, shipment) =>
              sum + (shipment.itemQuantities[itemIndex] ?? 0),
            0,
          );
          return item.quantity - extraQuantity;
        });
        internalQuote = await calculateCreateOrderQuoteFromCatalogInTx(tx, {
          now,
          includeOrderCharges: false,
          facts: {
            items: items.map((item, index) => {
              if (!isNewOrderPricingRoute(item.pricingRoute)) {
                throw new OrderInvariantError(
                  `款式“${item.name}”必须选择有效计价路线`,
                );
              }
              return {
                ...item,
                pricingRoute: item.pricingRoute,
                itemKey: itemKeys[index]!,
                fig: resolvedItemFigs[index]!,
                productId: item.productId ?? null,
                specification: item.specification ?? null,
                actualWidthMm: item.actualWidthMm ?? null,
                actualHeightMm: item.actualHeightMm ?? null,
                paperType: item.paperType ?? null,
                paperWeightGsm: item.paperWeightGsm ?? null,
                frontFoilColors: item.frontFoilColors,
                backFoilColors: item.backFoilColors,
                manualQuoteReason: item.manualQuoteReason ?? null,
              };
            }),
            packagingGroups: packagingGroups.map((group, groupIndex) => ({
              groupKey: String(groupIndex + 1),
              mode: group.mode,
              actualBagCount: group.actualBagCount,
              items: group.itemUnitsPerBag.flatMap(
                (unitsPerBag, itemIndex) =>
                  unitsPerBag > 0 && itemKeys[itemIndex]
                    ? [
                        {
                          itemKey: itemKeys[itemIndex]!,
                          unitsPerBag,
                        },
                      ]
                    : [],
              ),
            })),
            isSfCollect: false,
            shipments: [
              {
                shipmentKey: '1',
                province: input.destinationProvince ?? null,
                itemQuantities: Object.fromEntries(
                  itemKeys.map((itemKey, index) => [
                    itemKey,
                    primaryQuantities[index] ?? 0,
                  ]),
                ),
              },
              ...additionalShipments.map((shipment, shipmentIndex) => ({
                shipmentKey: String(shipmentIndex + 2),
                province: shipment.destinationProvince ?? null,
                itemQuantities: Object.fromEntries(
                  itemKeys.map((itemKey, index) => [
                    itemKey,
                    shipment.itemQuantities[index] ?? 0,
                  ]),
                ),
              })),
            ],
          },
        });
      } catch (error) {
        rethrowCreateOrderQuoteError(error);
      }
    }

    // (4) product FK check — one batch findMany over the distinct ids
    // (was per-item findUnique: a 10-item order paid up to 10 round
    // trips inside the tx). No productId → no query at all. Deliberately
    // NOT filtering isActive in the where: 不存在 and 已停用 are two
    // distinct messages, and the per-item loop keeps first-error order.
    await assertCreateOrderProductsInTx(txClient, items);

    // (5) processing totals and per-shipment allocation facts.
    const automaticItems = items.map((it, index) => {
      if (isExternalSalesDraft) {
        return {
          ...it,
          priceOverrideReason: null,
          unitPrice: '0',
          fixedFee: '0',
          subtotal: '0.00',
          suggestedSubtotal: null,
          quoteDisposition: null,
          quotedAmount: null,
          requiresAdminConfirmation: true,
          pricingSnapshot: null,
        };
      }

      const quote = internalQuote!.quote.items[index];
      const presentation = internalQuote!.processing.items[index];
      if (!quote || !presentation || quote.itemKey !== String(index + 1)) {
        throw new OrderInvariantError(
          `款式“${it.name}”的纯引擎结果与建单事实不一致`,
        );
      }
      if (quote.status === 'MANUAL_PRICING_REQUIRED' || (it.adminPrice && quote.status !== 'QUOTED')) {
        return {
          ...it,
          manualQuoteReason: it.manualQuoteReason?.trim() || null,
          priceOverrideReason: null,
          unitPrice: '0',
          fixedFee: '0',
          subtotal: '0.00',
          suggestedSubtotal: null,
          quoteDisposition:
            OrderItemQuoteDisposition.MANUAL_PRICING_REQUIRED,
          quotedAmount: null,
          requiresAdminConfirmation: true,
          pricingSnapshot: {
            ...presentation.snapshot,
            // Compatibility fence for OrderItem_suggested_snapshot_consistent.
            // The pure-engine schemaVersion remains unchanged; `version` is
            // the legacy persistence envelope expected by the database.
            version: 1,
            source: 'INTERNAL_CREATE_MANUAL_REQUIRED',
            quotedAt: now.toISOString(),
            actual: {
              amount: null,
              overrideReason: null,
              provisional: true,
            },
          } satisfies Prisma.InputJsonObject,
        };
      }

      if (
        quote.status !== 'QUOTED' ||
        !presentation.complete ||
        presentation.suggestedUnitPrice === null ||
        presentation.suggestedFixedFee === null ||
        presentation.suggestedSubtotal === null
      ) {
        const details = [...quote.errors, ...presentation.errors].join('；');
        throw new OrderInvariantError(
          `款式“${it.name}”无法生成可保存的自动报价${details ? `：${details}` : ''}`,
        );
      }
      const unitPrice = presentation.suggestedUnitPrice;
      const fixedFee = presentation.suggestedFixedFee;
      const subtotal = presentation.suggestedSubtotal;
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
      assertStorableMoney(
        subtotal,
        it.name,
        '款式小计',
        DECIMAL_12_2_MAX,
        2,
      );
      if (
        !subtotalReconciles(computeSubtotal(it.quantity, unitPrice, fixedFee),
          subtotal,
        )
      ) {
        throw new OrderInvariantError(
          `款式“${it.name}”纯引擎分项与小计不一致`,
        );
      }
      return {
        ...it,
        priceOverrideReason: null,
        unitPrice,
        fixedFee,
        subtotal,
        suggestedSubtotal: subtotal,
        quoteDisposition: OrderItemQuoteDisposition.PRICED,
        quotedAmount: subtotal,
        requiresAdminConfirmation: false,
        pricingSnapshot: {
          ...presentation.snapshot,
          version: 1,
          source: 'INTERNAL_CREATE_AUTO',
          quotedAt: now.toISOString(),
          actual: {
            unitPrice,
            fixedFee,
            subtotal,
            overrideReason: null,
            provisional: false,
          },
        } satisfies Prisma.InputJsonObject,
      };
    });
    const itemsWithSubtotals = automaticItems.map(applyAdminCreateItemPrice);
    const adminPriceDelta = itemsWithSubtotals.reduce((sum, item, index) =>
      sum.plus(item.subtotal).minus(automaticItems[index].subtotal), new Decimal(0));
    const itemProcessingAmount = sumTotals(
      itemsWithSubtotals.map((i) => i.subtotal),
    );
    if (
      !isExternalSalesDraft &&
      (internalQuote!.quote.packagingGroups.length !== packagingGroups.length ||
        internalQuote!.processing.packaging.groups.length !==
          packagingGroups.length)
    ) {
      throw new OrderInvariantError('纯引擎包装组结果与建单事实不一致');
    }
    const automaticPackagingGroups = packagingGroups.map((group, index) => {
      if (isExternalSalesDraft) return {
        ...group,
        unitPrice: '0.0000',
        subtotal: '0.00',
        suggestedSubtotal: null,
        complete: false,
        pricingSnapshot: null,
      };
      const quote = internalQuote!.quote.packagingGroups[index];
      const presentation = internalQuote!.processing.packaging.groups[index];
      if (!quote || !presentation || quote.groupKey !== String(index + 1)) {
        throw new OrderInvariantError(
          `包装组 ${index + 1} 的纯引擎结果与建单事实不一致`,
        );
      }
      if (
        quote.status === 'QUOTED' &&
        presentation.complete &&
        presentation.suggestedUnitPrice !== null &&
        presentation.suggestedSubtotal !== null
      ) {
        return {
          ...group,
          unitPrice: presentation.suggestedUnitPrice,
          subtotal: presentation.suggestedSubtotal,
          suggestedSubtotal: presentation.suggestedSubtotal,
          complete: true,
          pricingSnapshot: {
            ...presentation.snapshot,
            source: 'INTERNAL_CREATE_AUTO',
            quotedAt: now.toISOString(),
            actual: {
              unitPrice: presentation.suggestedUnitPrice,
              subtotal: presentation.suggestedSubtotal,
              overrideReason: null,
              provisional: false,
            },
          } satisfies Prisma.InputJsonObject,
        };
      }
      if (quote.status === 'EXCLUDED_MANUAL' || group.adminPrice) {
        return {
          ...group,
          unitPrice: '0.0000',
          subtotal: '0.00',
          suggestedSubtotal: null,
          complete: false,
          pricingSnapshot: {
            ...presentation.snapshot,
            source: 'INTERNAL_CREATE_MANUAL_REQUIRED',
            quotedAt: now.toISOString(),
            actual: {
              amount: null,
              overrideReason: null,
              provisional: true,
            },
          } satisfies Prisma.InputJsonObject,
        };
      }
      throw new OrderInvariantError(
        `包装组 ${index + 1} 无法生成可保存的入袋报价${presentation.errors.length > 0 ? `：${presentation.errors.join('；')}` : ''}`,
      );
    });
    const packagingGroupsWithPrices = automaticPackagingGroups.map((group): Omit<typeof group, 'pricingSnapshot'> & { pricingSnapshot: Prisma.InputJsonObject | null; priceOverrideReason: string | null } => {
      if (!group.adminPrice) return { ...group, priceOverrideReason: null };
      try { return { ...group, ...calculateAdminPackagingPrice(group.adminPrice, group.actualBagCount), complete: true }; }
      catch (error) { throw new OrderInvariantError(error instanceof Error ? error.message : '包装价格无效'); }
    });
    const adminPackagingDelta = packagingGroupsWithPrices.reduce((sum, group, index) => sum.plus(group.subtotal).minus(automaticPackagingGroups[index].subtotal), new Decimal(0));
    const packagingAmount = sumTotals(
      packagingGroupsWithPrices.map((group) => group.subtotal),
    );
    const processingAmount = new Decimal(itemProcessingAmount)
      .plus(packagingAmount)
      .toFixed(2);
    assertStorableOrderTotal(processingAmount);
    if (
      !isExternalSalesDraft &&
      !new Decimal(processingAmount).minus(adminPriceDelta).minus(adminPackagingDelta).equals(internalQuote!.quote.knownTotal)
    ) {
      throw new OrderInvariantError('建单持久化合计与纯引擎已知合计不一致');
    }

    const primaryQuantities = items.map((item, itemIndex) => {
      const extraQuantity = additionalShipments.reduce(
        (sum, shipment) => sum + (shipment.itemQuantities[itemIndex] ?? 0),
        0,
      );
      return item.quantity - extraQuantity;
    });
    let shipmentInputs = [
      {
        receiverName: input.receiverName,
        receiverPhone: input.receiverPhone,
        receiverAddress: input.receiverAddress,
        expressCode: input.expressCode,
        destinationProvince: input.destinationProvince ?? null,
        // External sales create orders from a browser and cannot establish a
        // carrier billable weight. The browser value is discarded here; only
        // validated item/allocation facts are kept for the submit finalizer's
        // server-owned weight policy. Non-external callers keep their shape.
        quotedWeightKg:
          settlementType === OrderSettlementType.EXTERNAL_SALES
            ? null
            : input.quotedWeightKg ?? null,
        shippingFee:
          settlementType === OrderSettlementType.EXTERNAL_SALES
            ? null
            : input.shippingFee ?? null,
        packingMaterialFee:
          settlementType === OrderSettlementType.EXTERNAL_SALES
            ? null
            : input.packingMaterialFee ?? null,
        customerChargeOverrideReason:
          settlementType === OrderSettlementType.EXTERNAL_SALES
            ? null
            : input.customerChargeOverrideReason ?? null,
        itemQuantities: primaryQuantities,
      },
      ...additionalShipments.map((shipment) => ({
        ...shipment,
        destinationProvince: shipment.destinationProvince ?? null,
        quotedWeightKg:
          settlementType === OrderSettlementType.EXTERNAL_SALES
            ? null
            : shipment.quotedWeightKg ?? null,
        shippingFee:
          settlementType === OrderSettlementType.EXTERNAL_SALES
            ? null
            : shipment.shippingFee ?? null,
        packingMaterialFee:
          settlementType === OrderSettlementType.EXTERNAL_SALES
            ? null
            : shipment.packingMaterialFee ?? null,
        customerChargeOverrideReason:
          settlementType === OrderSettlementType.EXTERNAL_SALES
            ? null
            : shipment.customerChargeOverrideReason ?? null,
      })),
    ];

    const externalChargeShipments =
      settlementType === OrderSettlementType.EXTERNAL_SALES
        ? deriveExternalOrderChargeShipments({
            isSfCollect: input.isSfCollect,
            items: items.map((item, index) => ({
              itemKey: String(index + 1),
              quantity: item.quantity,
              paperWeightGsm: item.paperWeightGsm,
              paperType: item.paperType,
              productStructure: item.productStructure,
            })),
            shipments: shipmentInputs.map((shipment, index) => ({
              shipmentKey: String(index + 1),
              province: shipment.destinationProvince,
              billableWeightKg: shipment.quotedWeightKg,
              itemQuantities: shipment.itemQuantities,
            })),
          })
        : null;
    if (externalChargeShipments) {
      shipmentInputs = shipmentInputs.map((shipment, index) => ({
        ...shipment,
        quotedWeightKg:
          externalChargeShipments[index]?.billableWeightKg ?? null,
      }));
    }

    const suppliedCustomerChargeFacts = shipmentInputs.some(
      (shipment) =>
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

    // No customer charge is materialized for an external DRAFT. The submit
    // finalizer prices these persisted shipment/item facts under one snapshot.
    const totalAmount = processingAmount;
    assertStorableOrderTotal(totalAmount);
    const requiresAdminPricing =
      isExternalSalesDraft ||
      itemsWithSubtotals.some((item) => item.requiresAdminConfirmation) ||
      packagingGroupsWithPrices.some((group) => !group.complete) ||
      Boolean(internalQuote && quoteHasPendingPlateCharge(internalQuote.quote));
    const pricingStatus = requiresAdminPricing
      ? ORDER_PRICING_STATUS.PENDING_ADMIN_CONFIRMATION
      : hasAdminPrices ? ORDER_PRICING_STATUS.ADMIN_CONFIRMED : ORDER_PRICING_STATUS.AUTO_CONFIRMED;
    let internalPlateCategoryId: string | null = null;
    const internalHasPendingPlate =
      !isExternalSalesDraft &&
      quoteHasPendingPlateCharge(internalQuote!.quote);
    if (internalHasPendingPlate) {
      try {
        internalPlateCategoryId = await requireActivePlateCategoryIdInTx(tx);
      } catch (error) {
        if (error instanceof PendingPlateChargeError) {
          throw new OrderInvariantError(error.message);
        }
        throw error;
      }
    }

    // (5) one nested write: Order + items + first OrderLog.
    const created = await txClient.order.create({
      data: {
        orderNo,
        submitterId,
        submitterRole: externalSalesUserId ? Role.SALES : actor.role,
        createdById: actor.id,
        customerPartyId,
        status: OrderStatus.DRAFT,
        purpose: input.purpose ?? 'STANDARD',
        pricingMode: input.purpose === 'PROOF' ? 'MANUAL_TOTAL' : 'ITEMIZED',
        samplePackagingRuleCode: sampleShipment ? input.samplePackagingRuleCode ?? null : null,
        kind: OrderKind.NORMAL,
        billingMode: OrderBillingMode.CHARGE,
        settlementType,
        clientSubmissionId: input.clientSubmissionId ?? null,
        nextItemFig,
        isUrgent: input.isUrgent,
        isSfCollect: input.isSfCollect,
        customName: input.customName ?? null,
        customerRef: actor.role === Role.ADMIN ? null : input.customerRef,
        receiverName: input.receiverName,
        receiverPhone: input.receiverPhone,
        receiverAddress: input.receiverAddress,
        expressCode: input.expressCode,
        packageRequirement: input.packageRequirement,
        remark: input.remark,
        promisedDate: input.promisedDate ?? null,
        packagingAmount,
        processingAmount,
        totalAmount,
        pricingStatus,
        priceRevision: isExternalSalesDraft ? 0 : 1,
        pricingConfirmedAt: requiresAdminPricing ? null : now,
        pricingConfirmedById: hasAdminPrices && !requiresAdminPricing ? actor.id : null,
        items: {
          create: itemsWithSubtotals.map((it, idx) => ({
            sequence: idx + 1,
            fig: resolvedItemFigs[idx],
            designGroupKey: it.designGroupKey ?? null,
            name: it.name,
            productId: it.productId ?? null,
            pricingRoute: it.pricingRoute,
            craft: canonicalCraftForPricingRoute(it.pricingRoute),
            productStructure: it.productStructure,
            artworkVersion: it.artworkVersion ?? null,
            plateGroupId: it.plateGroupId ?? null,
            pricingGroup: it.pricingGroup ?? null,
            manualQuoteReason: it.manualQuoteReason ?? null,
            specification: it.specification ?? null,
            actualWidthMm: it.actualWidthMm,
            actualHeightMm: it.actualHeightMm,
            paperType: it.paperType ?? null,
            paperWeightGsm: it.paperWeightGsm,
            quantity: it.quantity,
            pack:
              it.pack ??
              packagingGroupsWithPrices.find(
                (group) => (group.itemUnitsPerBag[idx] ?? 0) > 0,
              )?.itemUnitsPerBag[idx] ??
              null,
            crafts: it.crafts,
            frontFoilColors: it.frontFoilColors,
            backFoilColors: it.backFoilColors,
            foilColors: it.foilColors,
            foilTechnique: it.foilTechnique,
            hasLocalFoil: it.hasLocalFoil,
            lamination: it.lamination,
            printColors: it.printColors,
            printColorsKnown: true,
            isDoubleSided: it.isDoubleSided,
            isDoubleColor: it.isDoubleColor,
            unitPrice: it.unitPrice ?? '0',
            fixedFee: it.fixedFee ?? '0',
            subtotal: it.subtotal,
            quoteDisposition: it.quoteDisposition,
            quotedAmount: it.quotedAmount,
            suggestedSubtotal: it.suggestedSubtotal,
            ...(it.pricingSnapshot === null
              ? {}
              : { pricingSnapshot: it.pricingSnapshot }),
            priceOverrideReason: it.priceOverrideReason ?? null,
            remark: it.remark ?? null,
          })),
        },
        logs: {
          create: [
            {
              operatorId: actor.id,
              action: 'CREATE',
              changedFields: { createRequest: { version: 1, fingerprint: requestFingerprint } },
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

    await confirmCreatedAdminItemPricesInTx(txClient, created.id, itemsWithSubtotals, actor.id, now);

    if (internalHasPendingPlate) {
      try {
        await upsertPendingPlateChargeInTx({
          tx,
          orderId: created.id,
          actorId: actor.id,
          categoryId: internalPlateCategoryId!,
          quote: internalQuote!.quote,
          source: 'INTERNAL_CREATE_PENDING_PLATE',
        });
      } catch (error) {
        if (error instanceof PendingPlateChargeError) {
          throw new OrderInvariantError(error.message);
        }
        throw error;
      }
    }

    const itemBySequence = new Map(
      created.items.map((item) => [item.sequence, item.id]),
    );
    for (const [groupIndex, group] of packagingGroupsWithPrices.entries()) {
      const createdGroup = await txClient.orderPackagingGroup.create({
        data: {
          orderId: created.id,
          sequence: groupIndex + 1,
          name: group.name ?? null,
          mode: group.mode,
          actualBagCount: group.actualBagCount,
          unitPrice: group.unitPrice,
          subtotal: group.subtotal,
          suggestedSubtotal: group.suggestedSubtotal,
          ...(group.pricingSnapshot === null
            ? {}
            : { pricingSnapshot: group.pricingSnapshot }),
          priceOverrideReason: group.priceOverrideReason,
        },
        select: { id: true },
      });
      const lines = group.itemUnitsPerBag.flatMap((unitsPerBag, itemIndex) => {
        if (unitsPerBag <= 0) return [];
        const orderItemId = itemBySequence.get(itemIndex + 1);
        if (!orderItemId) {
          throw new OrderInvariantError(
            `创建包装组时找不到款式 ${itemIndex + 1}`,
          );
        }
        return [{
          orderId: created.id,
          packagingGroupId: createdGroup.id,
          orderItemId,
          unitsPerBag,
        }];
      });
      if (lines.length > 0) {
        await txClient.orderPackagingGroupLine.createMany({ data: lines });
      }
      if (group.adminPrice) {
        const stored = await txClient.orderPackagingGroup.findUniqueOrThrow({ where: { id: createdGroup.id }, include: { lines: true } });
        const pricingSnapshot = buildTrustedAdminPackagingPricingSnapshot({ previous: group.pricingSnapshot, now, actorId: actor.id, previousPriceRevision: 0, group: stored });
        await txClient.orderPackagingGroup.update({ where: { id: stored.id }, data: { pricingSnapshot } });
        group.pricingSnapshot = pricingSnapshot;
      }
    }

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

    if (!isExternalSalesDraft) {
      await txClient.orderPricingRevision.create({
        data: {
          orderId: created.id,
          revision: 1,
          status: pricingStatus,
          source: hasAdminPrices ? 'ORDER_CREATED_ADMIN' : requiresAdminPricing
            ? 'ORDER_CREATED_PROVISIONAL'
            : 'ORDER_CREATED_AUTO',
          createdById: actor.id,
          createdAt: now,
          priceVersionLocks: {
            create: [
              {
                purpose: CustomerPriceBookPurpose.PROCESSING,
                priceBookId: internalQuote!.quote.priceVersion.processing.id,
                priceBookVersion:
                  internalQuote!.quote.priceVersion.processing.version,
                sourceSha256:
                  internalQuote!.quote.priceVersion.processing.sourceSha256,
                createdAt: now,
              },
              {
                purpose: CustomerPriceBookPurpose.LOGISTICS,
                priceBookId: internalQuote!.quote.priceVersion.logistics.id,
                priceBookVersion:
                  internalQuote!.quote.priceVersion.logistics.version,
                sourceSha256:
                  internalQuote!.quote.priceVersion.logistics.sourceSha256,
                createdAt: now,
              },
            ],
          },
          snapshot: {
            version: 2,
            engineVersion: 'CREATE_ORDER_PURE_V1',
            priceVersion: internalQuote!.quote.priceVersion,
            engineStatus: internalQuote!.quote.status,
            knownTotal: processingAmount,
            automaticKnownTotal: internalQuote!.quote.knownTotal,
            manualReasons: internalQuote!.quote.manualReasons,
            pendingReasons: internalQuote!.quote.pendingReasons,
            source: hasAdminPrices ? 'ORDER_CREATED_ADMIN' : requiresAdminPricing
              ? 'ORDER_CREATED_PROVISIONAL'
              : 'ORDER_CREATED_AUTO',
            pricedAt: now.toISOString(),
            order: {
              id: created.id,
              orderNo: created.orderNo,
              settlementType,
              pricingStatus,
              priceRevision: 1,
              packagingAmount,
              processingAmount,
              totalAmount,
            },
            items: itemsWithSubtotals.map((item, index) => ({
              id: created.items[index]?.id ?? null,
              sequence: index + 1,
              fig: resolvedItemFigs[index],
              name: item.name,
              pricingRoute: item.pricingRoute,
              craft: canonicalCraftForPricingRoute(item.pricingRoute),
              pack:
                item.pack ??
                packagingGroupsWithPrices.find(
                  (group) => (group.itemUnitsPerBag[index] ?? 0) > 0,
                )?.itemUnitsPerBag[index] ??
                null,
              manualQuoteReason: item.manualQuoteReason ?? null,
              quantity: item.quantity,
              unitPrice: item.unitPrice,
              fixedFee: item.fixedFee,
              subtotal: item.subtotal,
              quoteDisposition: item.quoteDisposition,
              suggestedSubtotal: item.suggestedSubtotal,
              priceOverrideReason: item.priceOverrideReason ?? null,
              requiresAdminConfirmation: item.requiresAdminConfirmation,
              pricingSnapshot: item.pricingSnapshot,
            })),
            packagingGroups: packagingGroupsWithPrices.map((group, index) => ({
              sequence: index + 1,
              name: group.name ?? null,
              mode: group.mode,
              actualBagCount: group.actualBagCount,
              itemUnitsPerBag: [...group.itemUnitsPerBag],
              unitPrice: group.unitPrice,
              subtotal: group.subtotal,
              suggestedSubtotal: group.suggestedSubtotal,
              priceOverrideReason: group.priceOverrideReason,
              requiresAdminConfirmation: !group.complete,
              pricingSnapshot: group.pricingSnapshot,
            })),
            customerCharges: [],
          },
        },
      });
    }

    return {
      id: created.id,
      orderNo: created.orderNo,
      itemIds: created.items.map((item) => item.id),
      pricingStatus,
    };
  }, {
    maxWait: 10_000,
    timeout: 30_000,
  });

  try {
    return await createOnce();
  } catch (error) {
    if (
      input.clientSubmissionId &&
      error instanceof Prisma.PrismaClientKnownRequestError &&
      error.code === 'P2002'
    ) {
      const existing = await findOrderBySubmissionId(db, input.clientSubmissionId);
      if (existing?.createdById === actor.id && existing.submitterId === submitterId) {
        if (!matchesCreateOrderRequest(existing.logs?.[0]?.changedFields, requestFingerprint)) {
          throw new OrderInvariantError(`工单 ${existing.orderNo} 已保存，本次填写与原记录不一致或无法核对。请从工单列表打开核对后修改。`);
        }
        return {
          id: existing.id,
          orderNo: existing.orderNo,
          itemIds: existing.items.map((item) => item.id),
          pricingStatus: existing.pricingStatus,
        };
      }
    }
    throw error;
  }
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
    }) => Promise<
      | {
          id: string;
          status: OrderStatus;
          purpose?: string;
          submitterId: string;
          receiverAddress: string | null;
          receiverPhone: string | null;
          settlementType: OrderSettlementType;
          pricingStatus: string;
          revision: number;
          editVersion: number;
          workOrderVersion: number;
          priceRevision: number;
        }
      | null
    >;
    update: (args: { where: { id: string }; data: unknown; select?: unknown }) => Promise<{
      id: string;
      status: OrderStatus;
    }>;
  };
  orderLog: {
    findFirst: (args: {
      where: unknown;
      select: { changedFields: true };
    }) => Promise<{ changedFields: Prisma.JsonValue | null } | null>;
    create: (args: { data: unknown }) => Promise<unknown>;
  };
};

// Minimal tx surface for cancelOrder's production cascade. The new operation
// ledger is authoritative when present; ProductionTask remains a read/write
// compatibility path only for orders created before the operation cutover.
type CascadeTxClient = {
  productionOperation: {
    findMany: (args: {
      where: { orderId: string };
      select: unknown;
    }) => Promise<
      Array<{
        id: string;
        status: ProductionOperationStatus;
        _count: { reports: number };
      }>
    >;
    updateMany: (args: {
      where: unknown;
      data: { status: ProductionOperationStatus };
    }) => Promise<{ count: number }>;
  };
  productionProgressStep: {
    findMany: (args: {
      where: { orderId: string };
      select: unknown;
    }) => Promise<
      Array<{
        id: string;
        status: ProductionOperationStatus;
        _count: { reports: number };
      }>
    >;
    updateMany: (args: {
      where: unknown;
      data: { status: ProductionOperationStatus };
    }) => Promise<{ count: number }>;
  };
  productionTask: {
    findMany: (args: {
      where: unknown;
      select?: unknown;
    }) => Promise<
      Array<{ id: string; status: TaskStatus; isSelfClaimable: boolean }>
    >;
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

// Per-order advisory lock for status-transition writes. We share the same
// namespace as operation reporting (`print-shop-erp:order-cascade:<id>`) so
// scanner reports cannot race a manual ship/cancel/submit on Order.status.

type TransitionOptions = {
  remark: string | null;
  // Optional authz guard that runs AFTER we've fetched the row (so it
  // can see submitterId / status) but BEFORE the status-machine check.
  // Throw OrderInvariantError to reject.
  authz?: (order: {
    revision: number;
    editVersion: number;
    submitterId: string;
    status: OrderStatus;
    receiverAddress: string | null;
    receiverPhone: string | null;
    settlementType: OrderSettlementType;
  }) => void;
  now?: Date;
  // Optional extra columns to set on the Order in the same update.
  // Used by shipOrder to stamp `trackingNo` alongside the status
  // transition. Each call site is responsible for keeping the keys
  // valid Prisma update fields.
  extraData?: Record<string, unknown>;
  // Version and request identity captured by a client-side command snapshot.
  // The lookup runs under the same per-order lock as the transition: an
  // acknowledged-response loss can replay the exact command, while reusing a
  // key for altered content fails closed before any status or shipment write.
  commandGuard?: ShipOrderCommandGuard;
  // Optional cascade to related rows, run INSIDE the same tx + advisory
  // lock, AFTER the Order row + OrderLog are written. Throwing here
  // rolls the whole transition back (so a block condition leaves no
  // half-cancel). Used by cancelOrder to void PENDING ProductionTasks.
  cascade?: (
    tx: CascadeTxClient,
    orderId: string,
    order: {
      purpose?: string;
      settlementType: OrderSettlementType;
      pricingStatus: string;
      workOrderVersion: number;
      priceRevision: number;
    },
  ) => Promise<void>;
  // Durable notification/outbox work that must commit atomically with the
  // status transition. Inline dev/test callers return false and dispatch only
  // after this transaction commits.
  afterTransition?: (
    tx: Prisma.TransactionClient,
    orderId: string,
    order: {
      status: OrderStatus;
      settlementType: OrderSettlementType;
      pricingStatus: string;
      priceRevision: number;
    },
  ) => Promise<{ status: OrderStatus } | void>;
};

type TransitionTarget =
  | OrderStatus
  | ((order: { settlementType: OrderSettlementType }) => OrderStatus);

async function transitionWithLog(
  orderId: string,
  target: TransitionTarget,
  actor: { id: string; role: Role },
  opts: TransitionOptions,
  transaction?: Prisma.TransactionClient,
): Promise<{ id: string; status: OrderStatus; idempotentReplay?: boolean }> {
  const now = opts.now ?? new Date();
  const work = async (tx: Prisma.TransactionClient) => {
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
      select: {
        id: true,
        status: true,
        submitterId: true,
        receiverAddress: true,
        receiverPhone: true,
        settlementType: true,
        pricingStatus: true,
        purpose: true,
        revision: true,
        editVersion: true,
        workOrderVersion: true,
        priceRevision: true,
      },
    });
    if (!target_order) throw new OrderInvariantError('工单不存在');

    if (opts.commandGuard) {
      const guard = opts.commandGuard;
      const replay = await txClient.orderLog.findFirst({
        where: {
          orderId,
          action: 'STATUS_CHANGE',
          changedFields: {
            path: ['shipRequest', 'after', 'idempotencyKey'],
            equals: guard.idempotencyKey,
          },
        },
        select: { changedFields: true },
      });
      if (replay) {
        const changedFields = replay.changedFields;
        const shipRequest =
          changedFields &&
          typeof changedFields === 'object' &&
          !Array.isArray(changedFields) &&
          'shipRequest' in changedFields &&
          changedFields.shipRequest &&
          typeof changedFields.shipRequest === 'object' &&
          !Array.isArray(changedFields.shipRequest)
            ? changedFields.shipRequest
            : null;
        const after =
          shipRequest &&
          'after' in shipRequest &&
          shipRequest.after &&
          typeof shipRequest.after === 'object' &&
          !Array.isArray(shipRequest.after)
            ? shipRequest.after
            : null;
        if (!after || after.fingerprint !== guard.fingerprint) {
          throw new OrderInvariantError(
            '同一发货请求标识已用于不同内容，请刷新页面后重新提交',
          );
        }
        return {
          id: target_order.id,
          status: target_order.status,
          idempotentReplay: true,
        };
      }
      if (
        target_order.revision !== guard.expectedRevision ||
        target_order.editVersion !== guard.expectedEditVersion ||
        target_order.workOrderVersion !== guard.expectedWorkOrderVersion ||
        target_order.priceRevision !== guard.expectedPriceRevision
      ) {
        throw new OrderInvariantError(
          '工单、纸质工单或价格版本已变化，请刷新后重新发货',
        );
      }
    }

    const resolvedTarget =
      typeof target === 'function' ? target(target_order) : target;

    // status-machine.ts throws InvalidOrderTransitionError on bad moves —
    // we let it propagate (action layer maps to a generic error result).
    transitionOrder(target_order.status, resolvedTarget);
    if (opts.authz) opts.authz(target_order);
    if (
      (resolvedTarget === OrderStatus.SHIPPED ||
        resolvedTarget === OrderStatus.FINISHED) &&
      target_order.pricingStatus ===
        ORDER_PRICING_STATUS.PENDING_ADMIN_CONFIRMATION
    ) {
      throw new OrderInvariantError(
        '工单价格待管理员确认，不能发货或完工',
      );
    }

    // Cascade to related rows BEFORE writing the Order row, so a block
    // condition (cancelOrder → an in-flight ProductionTask) throws before
    // anything is written — no half-cancel, in the DB or under test.
    if (opts.cascade) {
      await opts.cascade(tx as unknown as CascadeTxClient, orderId, target_order);
    }

    const updated = await txClient.order.update({
      where: { id: orderId },
      data: {
        status: resolvedTarget,
        submittedAt:
          resolvedTarget === OrderStatus.SUBMITTED ||
          resolvedTarget === OrderStatus.PENDING_FACTORY
            ? now
            : undefined,
        shippedAt: resolvedTarget === OrderStatus.SHIPPED ? now : undefined,
        finishedAt: resolvedTarget === OrderStatus.FINISHED ? now : undefined,
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
          status: { before: target_order.status, after: resolvedTarget },
          ...(opts.commandGuard
            ? {
                shipRequest: {
                  before: null,
                  after: {
                    idempotencyKey: opts.commandGuard.idempotencyKey,
                    fingerprint: opts.commandGuard.fingerprint,
                    expectedRevision: opts.commandGuard.expectedRevision,
                    expectedEditVersion:
                      opts.commandGuard.expectedEditVersion,
                    expectedWorkOrderVersion:
                      opts.commandGuard.expectedWorkOrderVersion,
                    expectedPriceRevision:
                      opts.commandGuard.expectedPriceRevision,
                  },
                },
              }
            : {}),
        },
        remark: opts.remark,
      },
    });

    const afterTransitionResult = await opts.afterTransition?.(
      tx,
      orderId,
      target_order,
    );

    return afterTransitionResult
      ? { ...updated, status: afterTransitionResult.status }
      : updated;
  };
  return transaction ? work(transaction) : db.$transaction(work);
}

/** Runs the shared submit-time quote finalizer and maps its errors to the order domain. */
async function finalizeSubmittedOrderQuoteInTx(
  tx: Prisma.TransactionClient,
  orderId: string,
  actorId: string,
  now: Date,
  expectedQuoteToken: string | null,
) {
  try {
    return await finalizeExternalOrderQuoteInTx(tx, orderId, actorId, now, expectedQuoteToken);
  } catch (error) {
    if (error instanceof ExternalOrderQuoteChangedError) {
      throw new OrderQuoteChangedError(
        error.quoteToken,
        error.quotedFee,
        error.quotedFeeCompleteness,
        error.message,
      );
    }
    if (error instanceof ExternalOrderQuoteFinalizeError) {
      throw new OrderInvariantError(error.message);
    }
    throw error;
  }
}

export async function submitOrder(
  orderId: string,
  actor: { id: string; role: Role },
  now: Date = new Date(),
  expectedQuoteToken: string | null = null,
): Promise<{
  id: string;
  status: OrderStatus;
  quotedFee: string | null;
  quotedFeeCompleteness: OrderQuotedFeeCompleteness | null;
}> {
  // 设置读失败不能拦截提交；退回原有“发送”行为，后续投递
  // 仍由 durable outbox 记录失败并重试。
  const submittedNotificationEnabled = await getSetting(
    'notify_order_submitted_enabled',
  )
    .then((setting) => setting.enabled)
    .catch(() => true);
  const sampleFinalized: { current: { quotedFee: string; quotedFeeCompleteness: OrderQuotedFeeCompleteness } | null } = { current: null };
  let submissionNotificationKey = orderId;
  let submittedNotificationQueued = !submittedNotificationEnabled;
  let urgentNotificationQueued = false;
  const finalizedExternalQuote: {
    current: Awaited<
      ReturnType<typeof finalizeExternalOrderQuoteInTx>
    > | null;
  } = { current: null };
  const result = await transitionWithLog(
    orderId,
    (order) =>
      order.settlementType === OrderSettlementType.EXTERNAL_SALES
        ? OrderStatus.PENDING_FACTORY
        : OrderStatus.SUBMITTED,
    actor,
    {
      remark: '提交工单',
      now,
      authz: (order) => {
        if (order.status === OrderStatus.REJECTED) submissionNotificationKey = `${orderId}:correction:${order.revision}`;
        // 'order:create' permission lets SALES / CS create AND submit — but
        // only for their own rows. ADMIN keeps the global override.
        const globalOverride = actor.role === Role.ADMIN;
        if (!globalOverride && order.submitterId !== actor.id) {
          throw new OrderInvariantError('只能提交自己创建的工单');
        }
        if (!order.receiverAddress?.trim()) {
          throw new OrderInvariantError(
            '工单缺少收货地址，请先补全收货地址再提交',
          );
        }
        if (order.settlementType === OrderSettlementType.EXTERNAL_SALES) {
          if (!order.receiverPhone?.trim()) {
            throw new OrderInvariantError(
              '工单缺少收货人手机号，请先补全再提交',
            );
          }
        }
      },
      cascade: async (tx, lockedOrderId, lockedOrder) => {
        const prismaTx = tx as unknown as Prisma.TransactionClient;
        if (await prismaTx.orderChangeRequest.findFirst({ where: { orderId: lockedOrderId, status: 'PENDING' }, select: { id: true } })) throw new OrderInvariantError('请先撤回或处理当前申请，再提交工单');
        if (isSampleOrder(lockedOrder.purpose)) {
          try { sampleFinalized.current = await finalizeSampleOrderInTx(prismaTx, lockedOrderId, actor.id, now, expectedQuoteToken); }
          catch (error) {
            if (error instanceof SampleQuoteChangedError) throw new OrderQuoteChangedError(error.quote.quoteToken, error.quote.knownTotal, error.quote.total === null ? OrderQuotedFeeCompleteness.EXCLUDES_MANUAL_ITEMS : OrderQuotedFeeCompleteness.COMPLETE, error.message);
            if (error instanceof SampleOrderError) throw new OrderInvariantError(error.message);
            throw error;
          }
        } else if (
          lockedOrder.settlementType === OrderSettlementType.EXTERNAL_SALES
        ) {
          const itemWithoutImage = await prismaTx.orderItem.findFirst({
            where: {
              orderId: lockedOrderId,
              designs: { none: { fileType: DesignFileType.IMAGE } },
            },
            orderBy: { sequence: 'asc' },
            select: { sequence: true },
          });
          if (itemWithoutImage) {
            throw new OrderInvariantError(
              `第 ${itemWithoutImage.sequence} 款缺少设计图片，请上传后再提交`,
            );
          }
          finalizedExternalQuote.current = await finalizeSubmittedOrderQuoteInTx(
            prismaTx, lockedOrderId, actor.id, now, expectedQuoteToken,
          );
        } else {
          // Internal drafts saved before the retirement are new business on
          // first submit. External drafts are checked in
          // assertSelectedPapersAvailable, sample drafts in finalizeSampleOrderInTx.
          const items = await prismaTx.orderItem.findMany({
            where: { orderId: lockedOrderId },
            select: { paperType: true, paperWeightGsm: true },
          });
          if (hasRetiredPaperItem(items ?? [])) {
            throw new OrderInvariantError(RETIRED_PAPER_MESSAGE);
          }
          // Since 2026-09-18 internal and factory-direct orders price their
          // delivery from the same published logistics book as external
          // sales; the shared finalizer materializes the charges at submit.
          if (settlementBillsLogistics(lockedOrder.settlementType)) {
            finalizedExternalQuote.current = await finalizeSubmittedOrderQuoteInTx(
              prismaTx, lockedOrderId, actor.id, now, expectedQuoteToken,
            );
          }
        }

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
          submittedOrder?.settlementType ===
            OrderSettlementType.INTERNAL_SALES &&
          submittedOrder.billingMode === OrderBillingMode.CHARGE
        ) {
          try {
            await recordCsSalesEntryInTx(prismaTx, {
              eventKey: `order:${lockedOrderId}:revision:${submittedOrder.revision}:submit`,
              csUserId: submittedOrder.submitterId,
              orderId: lockedOrderId,
              orderRevision: submittedOrder.revision,
              type: CsSalesEntryType.ORDER_SUBMITTED,
              // 客服业绩不含代收物流（快递费 / 打包耗材），见 cs-sales.ts。
              amount: await csSalesBasisAmountInTx(prismaTx, lockedOrderId, submittedOrder.totalAmount),
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
      afterTransition: async (tx, lockedOrderId, previousOrder) => {
        const currentPricing = await tx.order.findUnique({
          where: { id: lockedOrderId },
          select: {
            billingMode: true,
            pricingStatus: true,
          },
        });
        if (!currentPricing) throw new OrderInvariantError('工单不存在');
        const prepared = previousOrder.status === OrderStatus.REJECTED
          ? { status: OrderStatus.PENDING_FACTORY, ready: false }
          : await prepareOrderForProductionInTx(tx, lockedOrderId, actor, now);
        if (backgroundJobsMode() !== 'durable') {
          return { status: prepared.status };
        }
        const payload = await tx.order.findUniqueOrThrow({
          where: { id: lockedOrderId },
          select: {
            id: true,
            orderNo: true,
            customerRef: true,
            isUrgent: true,
            submitter: { select: { displayName: true } },
          },
        });
        if (submittedNotificationEnabled) {
          submittedNotificationQueued = await enqueueNotificationInTransaction(
            tx as unknown as EnqueueClient,
            'ORDER_SUBMITTED',
            {
              orderId: payload.id,
              orderNo: payload.orderNo,
              submitterName: payload.submitter.displayName,
              customerRef: payload.customerRef,
              urgentMark: payload.isUrgent ? '🚨 急单' : '',
              summary: prepared.ready ? '新工单已提交，待下发生产' : '新工单已提交，待处理资料或费用',
              deepLink: `/orders#wo=${encodeURIComponent(payload.orderNo)}`,
            },
            { dedupeKey: `notification:ORDER_SUBMITTED:${submissionNotificationKey}` },
          );
        }
        if (payload.isUrgent) {
          urgentNotificationQueued = await enqueueNotificationInTransaction(
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
        } else {
          urgentNotificationQueued = true;
        }
        return { status: prepared.status };
      },
    },
  );

  // Notification wire ─ ORDER_SUBMITTED + URGENT_ORDER（tx 已 commit）。
  // 生产只 await 快速入库，webhook 由 LIGHT worker 重试；dev/test
  // 降级到 Next `after()`。详见 lib/notification/dispatch.ts。
  const payload =
    submittedNotificationQueued && urgentNotificationQueued
      ? null
      : await db.order.findUnique({
    where: { id: orderId },
    select: {
      id: true,
      orderNo: true,
      customerRef: true,
      isUrgent: true,
      submitter: { select: { displayName: true } },
    },
        });
  if (payload) {
    const urgentMark = payload.isUrgent ? '🚨 急单' : '';
    if (submittedNotificationEnabled && !submittedNotificationQueued) {
      await dispatchNotification(
        'ORDER_SUBMITTED',
        {
          orderId: payload.id,
          orderNo: payload.orderNo,
          submitterName: payload.submitter.displayName,
          customerRef: payload.customerRef,
          urgentMark,
          summary: result.status === OrderStatus.CONFIRMED ? '新工单已提交，待下发生产' : '新工单已提交，待处理资料或费用',
          deepLink: `/orders#wo=${encodeURIComponent(payload.orderNo)}`,
        },
        { dedupeKey: `notification:ORDER_SUBMITTED:${submissionNotificationKey}` },
      );
    }
    // SPEC §8.1：急单提交 → 排产群+管理员群（独立 rule，独立事件）。
    // 不是&ldquo;替代&rdquo; ORDER_SUBMITTED——两条都触发，管理员群从 URGENT_ORDER
    // 看到，排产群从 ORDER_SUBMITTED 看到。
    if (payload.isUrgent && !urgentNotificationQueued) {
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

  return {
    ...result,
    quotedFee: finalizedExternalQuote.current?.quotedFee ?? sampleFinalized.current?.quotedFee ?? null,
    quotedFeeCompleteness:
      finalizedExternalQuote.current?.quotedFeeCompleteness ?? sampleFinalized.current?.quotedFeeCompleteness ?? null,
  };
}

export async function cancelOrder(
  orderId: string,
  actor: { id: string; role: Role },
  reason: string,
  now: Date = new Date(),
  expectedEditVersion?: number,
): Promise<{ id: string; status: OrderStatus }> {
  const normalizedReason = reason.trim();
  if (!normalizedReason) {
    throw new OrderInvariantError('取消原因必填');
  }
  if (normalizedReason.length > 500) {
    throw new OrderInvariantError('取消原因过长（最多 500 个字符）');
  }
  // Ownership and version are checked under the order lock, independently of UI permissions.
  return transitionWithLog(orderId, OrderStatus.CANCELLED, actor, {
    remark: `取消：${normalizedReason}`,
    now,
    // Direct cancellation is only the withdrawal path for an order that has
    // not entered the confirmed production contract. Once confirmed, every
    // cancellation must be an OrderChangeRequest so producedQty, settlement
    // and the administrator decision are written atomically and auditable.
    authz: (order) => {
      if (actor.role !== Role.ADMIN && (actor.role !== Role.SALES || order.submitterId !== actor.id)) throw new OrderInvariantError('只能取消自己创建的工单');
      if (actor.role === Role.SALES && (!Number.isSafeInteger(expectedEditVersion) || expectedEditVersion !== order.editVersion)) throw new OrderInvariantError('工单已更新，请刷新后重新取消');
      if (
        order.status !== OrderStatus.DRAFT &&
        order.status !== OrderStatus.PENDING_FACTORY &&
        order.status !== OrderStatus.REJECTED
      ) {
        throw new OrderInvariantError(
          '已确认或已生产工单不能直接取消，请提交取消申请由管理员裁决',
        );
      }
    },
    // Cancelling must close unstarted production in the SAME transaction.
    // Once any report exists we refuse to erase payroll facts; an operator
    // must handle those records explicitly before cancelling the order.
    cascade: async (tx, id) => {
      const pending = await (tx as unknown as Prisma.TransactionClient).orderChangeRequest.findFirst({ where: { orderId: id, status: 'PENDING' }, select: { id: true } });
      if (pending) throw new OrderInvariantError('请先撤回或处理当前申请，再取消工单');
      const operations = await tx.productionOperation.findMany({
        where: { orderId: id },
        select: {
          id: true,
          status: true,
          _count: { select: { reports: true } },
        },
      });
      const progressSteps = await tx.productionProgressStep.findMany({
        where: { orderId: id },
        select: {
          id: true,
          status: true,
          _count: { select: { reports: true } },
        },
      });
      if (operations.length === 0 && progressSteps.length > 0) {
        throw new OrderInvariantError(
          '工单存在孤立的无计件进度步骤，生产 ledger 不完整，拒绝取消',
        );
      }
      const hasReportedOperation = operations.some(
        (operation) =>
          operation._count.reports > 0 ||
          operation.status === ProductionOperationStatus.IN_PROGRESS ||
          operation.status === ProductionOperationStatus.COMPLETED,
      );
      if (hasReportedOperation) {
        throw new OrderInvariantError(
          '该工单存在已报工的生产工序，不能直接取消，请先处理生产记录',
        );
      }
      const hasReportedProgress = progressSteps.some(
        (step) =>
          step._count.reports > 0 ||
          step.status === ProductionOperationStatus.IN_PROGRESS ||
          step.status === ProductionOperationStatus.COMPLETED,
      );
      if (hasReportedProgress) {
        throw new OrderInvariantError(
          '该工单存在已报工的无计件进度，不能直接取消，请先处理生产记录',
        );
      }
      if (
        operations.length > 0 &&
        operations.some(
          (operation) =>
            operation.status !== ProductionOperationStatus.PENDING,
        )
      ) {
        throw new OrderInvariantError(
          '该工单存在非待处理的生产工序，只能整单取消全部待处理工序',
        );
      }
      if (
        operations.length > 0 &&
        progressSteps.some(
          (step) => step.status !== ProductionOperationStatus.PENDING,
        )
      ) {
        throw new OrderInvariantError(
          '该工单存在非待处理的无计件进度，只能整单取消全部待处理步骤',
        );
      }

      const legacyTasks =
        operations.length === 0
          ? await tx.productionTask.findMany({
              where: { orderItem: { orderId: id } },
              select: { id: true, status: true, isSelfClaimable: true },
            })
          : [];
      const hasInFlightLegacyTask = legacyTasks.some(
        (task) =>
          task.status === TaskStatus.IN_PROGRESS ||
          task.status === TaskStatus.COMPLETED,
      );
      if (hasInFlightLegacyTask) {
        throw new OrderInvariantError(
          '该历史工单存在已开工/已报工任务，不能直接取消，请先处理生产记录',
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

      if (operations.length > 0) {
        const pendingOperationCount = operations.length;
        const pendingProgressCount = progressSteps.length;
        if (pendingOperationCount > 0) {
          await tx.productionOperation.updateMany({
            where: {
              orderId: id,
              status: ProductionOperationStatus.PENDING,
            },
            data: { status: ProductionOperationStatus.CANCELLED },
          });
          await tx.orderLog.create({
            data: {
              orderId: id,
              operatorId: actor.id,
              action: 'STATUS_CHANGE',
              changedFields: {
                cancelledOperations: {
                  before: pendingOperationCount,
                  after: 0,
                },
              },
              remark: `随工单取消 ${pendingOperationCount} 个未报工工序`,
            },
          });
        }
        if (pendingProgressCount > 0) {
          await tx.productionProgressStep.updateMany({
            where: {
              orderId: id,
              status: ProductionOperationStatus.PENDING,
            },
            data: { status: ProductionOperationStatus.CANCELLED },
          });
          await tx.orderLog.create({
            data: {
              orderId: id,
              operatorId: actor.id,
              action: 'STATUS_CHANGE',
              changedFields: {
                cancelledProgressSteps: {
                  before: pendingProgressCount,
                  after: 0,
                },
              },
              remark: `随工单取消 ${pendingProgressCount} 个未报工无计件进度步骤`,
            },
          });
        }
      } else {
        // Historical orders have no ProductionOperation rows. Preserve their
        // prior cancellation behavior without using tasks for new orders.
        const pendingLegacyTasks = legacyTasks.filter(
          (task) => task.status === TaskStatus.PENDING,
        );
        for (const task of pendingLegacyTasks) {
          transitionProductionTask(task.status, TaskStatus.CANCELLED);
          await tx.productionTask.update({
            where: { id: task.id },
            data: {
              status: TaskStatus.CANCELLED,
              isSelfClaimable: false,
              ...(task.isSelfClaimable
                ? {
                    selfClaimOpenedAt: null,
                    selfClaimedAt: null,
                    claimMachineTypes: [],
                  }
                : {}),
            },
            select: { id: true },
          });
        }
        if (pendingLegacyTasks.length > 0) {
          await tx.orderLog.create({
            data: {
              orderId: id,
              operatorId: actor.id,
              action: 'STATUS_CHANGE',
              changedFields: {
                cancelledLegacyTasks: {
                  before: pendingLegacyTasks.length,
                  after: 0,
                },
              },
              remark: `随历史工单取消 ${pendingLegacyTasks.length} 个未开工任务`,
            },
          });
        }
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
          const salesBasis = await csSalesBasisAmountInTx(prismaTx, id, cancelledOrder.totalAmount);
          await assertCsOrderSalesLedgerReconciledInTx(prismaTx, id, salesBasis);
          await recordCsSalesEntryInTx(prismaTx, {
            eventKey: `order:${id}:revision:${cancelledOrder.revision}:cancel`,
            csUserId: cancelledOrder.submitterId,
            orderId: id,
            orderRevision: cancelledOrder.revision,
            type: CsSalesEntryType.ORDER_CANCELLED,
            amount: new Decimal(salesBasis).negated(),
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

type RequestedShipOrderShipment = ReturnType<
  typeof normalizeShipOrderInput
>['requestedShipments'][number];

type StoredShipOrderShipment = {
  id: string;
  sequence: number;
  shippedAt?: Date | null;
  destinationProvince: string | null;
  weightKg: Prisma.Decimal | null;
  lines: Array<{ quantity: number }>;
};

export async function assertShipOrderReadinessInTx(
  tx: Prisma.TransactionClient,
  input: {
    orderId: string;
    workOrderVersion: number;
    settlementType: OrderSettlementType;
    isVersionedCommand: boolean;
    hasSubmittedShipmentDetails: boolean;
  },
): Promise<StoredShipOrderShipment[]> {
  const storedShipments = await tx.orderShipment.findMany({
    where: { orderId: input.orderId },
    select: {
      id: true,
      sequence: true,
      shippedAt: true,
      destinationProvince: true,
      weightKg: true,
      lines: { select: { quantity: true } },
    },
    orderBy: { sequence: 'asc' },
  });
  if (storedShipments.length === 0) {
    throw new OrderInvariantError('工单没有发货地址，暂不能发货');
  }
  if (input.isVersionedCommand && !input.hasSubmittedShipmentDetails) {
    throw new OrderInvariantError(
      '发货请求缺少地址明细，请刷新页面后重新提交',
    );
  }
  // Orders whose delivery is billed through logistics rows (external sales,
  // and internal orders submitted since 2026-09-18) confirm every address's
  // shipping and packing charges at ship time.
  const logisticsRows =
    input.settlementType === OrderSettlementType.EXTERNAL_SALES
      ? [{ id: 'external' }]
      : await tx.orderCustomerCharge.findMany({
          where: { orderId: input.orderId, category: { code: { in: [...LOGISTICS_CHARGE_CATEGORY_CODES] } }, priceBookId: { not: null } },
          select: { id: true },
          take: 1,
        });
  if (
    settlementBillsLogistics(input.settlementType) &&
    (logisticsRows?.length ?? 0) > 0 &&
    !input.hasSubmittedShipmentDetails
  ) {
    throw new OrderInvariantError(
      '发货前必须逐地址确认快递费与打包耗材费',
    );
  }

  const pendingChange = await tx.orderChangeRequest.findFirst({
    where: {
      orderId: input.orderId,
      status: OrderChangeRequestStatus.PENDING,
    },
    select: { id: true },
  });
  if (pendingChange) {
    throw new OrderInvariantError('工单存在待裁决变更申请，暂不能发货');
  }

  // W2 production facts are version-isolated. Keep these reads serial:
  // Prisma's pg adapter does not support concurrent queries on one
  // transaction client. When no current operation exists, fall back to
  // the pre-cutover ProductionTask ledger, matching the admin read model.
  const currentOperations = await tx.productionOperation.findMany({
    where: {
      orderId: input.orderId,
      workOrderVersion: input.workOrderVersion,
    },
    select: { status: true },
  });
  const currentProgressSteps = await tx.productionProgressStep.findMany({
    where: {
      orderId: input.orderId,
      workOrderVersion: input.workOrderVersion,
    },
    select: { status: true },
  });
  const legacyTasks =
    currentOperations.length === 0
      ? await tx.productionTask.findMany({
          where: { orderItem: { orderId: input.orderId } },
          select: { status: true },
        })
      : [];
  const productionUnits =
    currentOperations.length > 0
      ? [...currentOperations, ...currentProgressSteps]
      : [...currentProgressSteps, ...legacyTasks];
  const incompleteProductionStatuses = new Set<string>([
    ProductionOperationStatus.PENDING,
    ProductionOperationStatus.IN_PROGRESS,
    TaskStatus.PENDING,
    TaskStatus.IN_PROGRESS,
  ]);
  if (
    productionUnits.some((unit) =>
      incompleteProductionStatuses.has(unit.status),
    )
  ) {
    throw new OrderInvariantError(
      '工单仍有未完成的生产工序，全部完工后才能发货',
    );
  }

  const liveOutsource = await tx.outsourceOrder.findMany({
    where: {
      orderId: input.orderId,
      status: { in: [OutsourceStatus.SENT, OutsourceStatus.IN_PROGRESS] },
    },
    select: { id: true },
  });
  if (liveOutsource.length > 0) {
    throw new OrderInvariantError(
      '该工单仍有已发送或进行中的外协单，收货或取消后才能发货',
    );
  }
  return storedShipments;
}

async function finalizeExternalShipmentChargesInTx(
  tx: Prisma.TransactionClient,
  input: {
    orderId: string;
    actorId: string;
    now: Date;
    storedShipments: readonly StoredShipOrderShipment[];
    requestByShipmentId: ReadonlyMap<string, RequestedShipOrderShipment>;
    trustedWeightByShipmentId: ReadonlyMap<string, string | null>;
  },
): Promise<void> {
  const chargeOrder = await tx.order.findUnique({
    where: { id: input.orderId },
    select: {
      settlementType: true,
      purpose: true,
      samplePackagingRuleCode: true,
      isSfCollect: true,
      processingAmount: true,
      customerCharges: {
        select: {
          id: true,
          businessKey: true,
          amount: true,
          priceBookId: true,
          pricingSnapshot: true,
          category: { select: { code: true } },
        },
      },
    },
  });
  if (!chargeOrder) throw new OrderInvariantError('工单不存在');
  const standardCustomerCharges = (chargeOrder.customerCharges ?? []).filter((charge) =>
    ['SHIPPING_FEE', 'PACKING_MATERIAL'].includes(String(charge.category.code)),
  );
  if (!orderBillsLogistics({
    settlementType: chargeOrder.settlementType,
    purpose: chargeOrder.purpose,
    hasLogisticsRows: hasLogisticsChargeRows(standardCustomerCharges),
  })) {
    return;
  }
  const expectedChargeCount = input.storedShipments.length * 2;
  if (standardCustomerCharges.length !== expectedChargeCount) {
    throw new OrderInvariantError(
      '快递/耗材收费明细不完整，暂不能发货',
    );
  }
  if (standardCustomerCharges.some((charge) => hasFulfillmentPricingConfirmation(charge.pricingSnapshot))) {
    if (!chargeOrder.isSfCollect && input.storedShipments.some((shipment) => !input.trustedWeightByShipmentId.get(shipment.id))) {
      throw new OrderInvariantError('发货前必须填写每个地址的承运商最终计费重量');
    }
    try {
      await finalizeConfirmedFulfillmentChargesForShipmentInTx(tx, {
        orderId: input.orderId, actorId: input.actorId, now: input.now,
        shipments: input.storedShipments.map((shipment) => {
          const requested = input.requestByShipmentId.get(shipment.id);
          if (!requested) throw new OrderInvariantError(`找不到地址 ${shipment.sequence} 的发货收费信息`);
          return {
            shipmentId: shipment.id,
            destinationProvince: requested.destinationProvince ?? shipment.destinationProvince,
            weightKg: input.trustedWeightByShipmentId.get(shipment.id) ?? null,
            shippingFee: requested.shippingFee,
            packingMaterialFee: requested.packingMaterialFee,
          };
        }),
      });
      return;
    } catch (error) {
      if (error instanceof FulfillmentPricingError) throw new OrderInvariantError(error.message);
      throw error;
    }
  }
  const priceBookIds = [
    ...new Set(
      standardCustomerCharges.flatMap((charge) =>
        charge.priceBookId ? [charge.priceBookId] : [],
      ),
    ),
  ];
  if (priceBookIds.length !== 1) {
    throw new OrderInvariantError('快递/耗材收费未绑定唯一价目簿，暂不能发货');
  }
  if (
    !chargeOrder.isSfCollect &&
    input.storedShipments.some(
      (shipment) => !input.trustedWeightByShipmentId.get(shipment.id),
    )
  ) {
    throw new OrderInvariantError(
      '发货前必须填写每个地址的承运商最终计费重量',
    );
  }

  let finalizedCharges: Awaited<
    ReturnType<typeof resolveExternalOrderChargesForFinalization>
  >;
  try {
    finalizedCharges = await resolveExternalOrderChargesForFinalization(
      tx,
      {
        isSfCollect: chargeOrder.isSfCollect,
        samplePackaging: chargeOrder.purpose === 'SAMPLE_SHIPMENT' ? { ruleCode: chargeOrder.samplePackagingRuleCode } : undefined,
        shipments: input.storedShipments.map((shipment) => {
          const requested = input.requestByShipmentId.get(shipment.id);
          if (!requested) {
            throw new OrderInvariantError(
              `找不到地址 ${shipment.sequence} 的发货收费信息`,
            );
          }
          return {
            shipmentKey: String(shipment.sequence),
            province:
              requested.destinationProvince ?? shipment.destinationProvince,
            billableWeightKg: chargeOrder.isSfCollect
              ? null
              : input.trustedWeightByShipmentId.get(shipment.id) ?? null,
            itemQuantity: shipment.lines.reduce(
              (sum, line) => sum + line.quantity,
              0,
            ),
            shippingFee: requested.shippingFee ?? null,
            packingMaterialFee: requested.packingMaterialFee ?? null,
            overrideReason: requested.customerChargeOverrideReason ?? null,
          };
        }),
      },
      priceBookIds[0]!,
      input.now,
    );
  } catch (error) {
    if (error instanceof OrderCustomerChargeError) {
      throw new OrderInvariantError(error.message);
    }
    throw error;
  }

  const existingByBusinessKey = new Map(
    standardCustomerCharges.map((charge) => [String(charge.businessKey), charge]),
  );
  for (const charge of finalizedCharges.charges) {
    const existing = existingByBusinessKey.get(charge.businessKey);
    if (!existing) {
      throw new OrderInvariantError(
        `找不到收费明细 ${charge.businessKey}，暂不能发货`,
      );
    }
    await tx.orderCustomerCharge.update({
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
        finalizedById: input.actorId,
        finalizedAt: input.now,
      },
    });
  }
  const receivableTotal = new Decimal(chargeOrder.processingAmount)
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
          (sum, charge) =>
            charge.amount === null ? sum : sum.plus(charge.amount),
          new Decimal(0),
        ),
    )
    .toFixed(2);
  assertStorableOrderTotal(receivableTotal);
  await tx.order.update({
    where: { id: input.orderId },
    // Shipment finalization replaces provisional logistics with
    // carrier/administrator-confirmed facts. It is still a pricing
    // confirmation, not the financial settlement event: the later explicit
    // SHIPPED -> SETTLED command is the sole v2 writer of settledFee/settledAt.
    data: { totalAmount: receivableTotal, confirmedFee: receivableTotal },
  });
}

async function applyShipOrderShipmentFactsInTx(
  tx: Prisma.TransactionClient,
  input: {
    orderId: string;
    actorId: string;
    now: Date;
    storedShipments: readonly StoredShipOrderShipment[];
    requestedShipments: readonly RequestedShipOrderShipment[];
  },
): Promise<void> {
  const requestedIds = input.requestedShipments.map(
    (shipment) => shipment.shipmentId,
  );
  if (new Set(requestedIds).size !== requestedIds.length) {
    throw new OrderInvariantError('发货地址重复，请刷新页面后重试');
  }
  if (
    input.storedShipments.length !== input.requestedShipments.length ||
    input.storedShipments.some(
      (shipment, index) => requestedIds[index] !== shipment.id,
    )
  ) {
    throw new OrderInvariantError('发货地址已变化，请刷新工单后重新填写运单号');
  }
  const trackingByShipmentId = new Map(
    input.requestedShipments.map((shipment) => [
      shipment.shipmentId,
      shipment.trackingNo,
    ]),
  );
  const requestByShipmentId = new Map(
    input.requestedShipments.map((shipment) => [shipment.shipmentId, shipment]),
  );
  // A positive weight submitted through this administrator-owned fulfilment
  // command replaces the stored carrier fact. Omitted/null values (including
  // the hidden empty field used by SF collect) preserve the trusted weight.
  const trustedWeightByShipmentId = new Map(
    input.storedShipments.map((shipment) => {
      const submitted = requestByShipmentId.get(shipment.id)?.weightKg;
      return [shipment.id, submitted ?? shipment.weightKg?.toString() ?? null];
    }),
  );

  await finalizeExternalShipmentChargesInTx(tx, {
    orderId: input.orderId,
    actorId: input.actorId,
    now: input.now,
    storedShipments: input.storedShipments,
    requestByShipmentId,
    trustedWeightByShipmentId,
  });
  for (const shipment of input.storedShipments) {
    const requested = requestByShipmentId.get(shipment.id);
    const submittedWeight = requested?.weightKg;
    await tx.orderShipment.update({
      where: { id: shipment.id },
      data: {
        trackingNo: trackingByShipmentId.get(shipment.id) ?? null,
        ...(submittedWeight != null ? { weightKg: submittedWeight } : {}),
        ...(requested?.destinationProvince !== undefined
          ? {
              destinationProvince:
                requested.destinationProvince ?? shipment.destinationProvince,
            }
          : {}),
        status: ShipmentStatus.SHIPPED,
        shippedAt: shipment.shippedAt ?? input.now,
      },
      select: { id: true },
    });
  }
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
  transaction?: Prisma.TransactionClient,
): Promise<{ id: string; status: OrderStatus; idempotentReplay: boolean }> {
  const { requestedShipments, primaryTracking, command } =
    normalizeShipOrderInput(trackingInput);
  let commandGuard: ShipOrderCommandGuard | undefined;
  if (command) {
    assertValidShipOrderCommand(command);
    commandGuard = {
      ...command,
      fingerprint: shipOrderFingerprint({
        orderId,
        command,
        primaryTracking,
        requestedShipments,
      }),
    };
  }
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
      commandGuard,
      cascade: async (tx, id, pricingOrder) => {
        const prismaTx = tx as unknown as Prisma.TransactionClient;
        const storedShipments = await assertShipOrderReadinessInTx(prismaTx, {
          orderId: id,
          workOrderVersion: pricingOrder.workOrderVersion,
          settlementType: pricingOrder.settlementType,
          isVersionedCommand: Boolean(command),
          hasSubmittedShipmentDetails: requestedShipments.length > 0,
        });
        if (requestedShipments.length > 0) {
          await applyShipOrderShipmentFactsInTx(prismaTx, {
            orderId: id,
            actorId: actor.id,
            now,
            storedShipments,
            requestedShipments,
          });
        }
      },
      afterTransition: async (tx, id, pricingOrder) => {
        const logisticsRows = pricingOrder.settlementType === OrderSettlementType.EXTERNAL_SALES
          ? [{ id: 'external' }]
          : await (tx as unknown as Prisma.TransactionClient).orderCustomerCharge.findMany({
              where: { orderId: id, category: { code: { in: [...LOGISTICS_CHARGE_CATEGORY_CODES] } }, priceBookId: { not: null } },
              select: { id: true },
              take: 1,
            });
        if (
          settlementBillsLogistics(pricingOrder.settlementType) &&
          (logisticsRows?.length ?? 0) > 0 &&
          requestedShipments.length > 0
        ) {
          await appendOrderPricingRevisionInTx(tx, {
            orderId: id,
            status: ORDER_PRICING_STATUS.ADMIN_CONFIRMED,
            source: 'SHIPMENT_CHARGES_FINALIZED',
            actorId: actor.id,
            now,
            expectedPriceRevision: pricingOrder.priceRevision,
            incrementOrderRevision: true,
            remark: '发货时按实际物流事实终审对客收费',
          });
        }
        if (backgroundJobsMode() !== 'durable' && !transaction) return;
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
    transaction,
  );

  if (transaction) return { ...result, idempotentReplay: Boolean(result.idempotentReplay) };

  if (result.idempotentReplay) {
    return { ...result, idempotentReplay: true };
  }

  // Notification wire ─ ORDER_SHIPPED（tx 已 commit；生产入持久化队列）。
  // **关键 null 映射**：events.ts:ORDER_SHIPPED.trackingNo 必填 string，
  // 如果传入 null/undefined，renderTemplate 会把 `{trackingNo}` 留成
  // raw 字面量流到群消息。这里映射
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

  return { ...result, idempotentReplay: false };
}

// Compatibility export only. The old SHIPPED → FINISHED writer bypassed
// settlement v2 (settledFee/settledAt and the global cutoff lock), so both
// direct domain callers and the Server Action now fail closed.
export async function finishOrder(
  _orderId: string,
  _actor: { id: string; role: Role },
  _now: Date = new Date(),
): Promise<never> {
  void _orderId;
  void _actor;
  void _now;
  throw new OrderInvariantError(
    '旧版完结入口已停用，请使用管理端“结算”操作',
  );
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
          purpose?: string;
          samplePackagingRuleCode?: string | null;
          status: OrderStatus;
          submitterId: string;
          settlementType: OrderSettlementType;
          pricingStatus: string;
          priceRevision: number;
          revision: number;
          processingAmount: Decimal.Value;
          totalAmount: Decimal.Value;
          customName: string | null;
          customerRef: string | null;
          customerPartyId: string | null;
          shipments: EditableShipment[];
          changeRequests: { id: string }[];
          customerCharges?: { id: string }[];
          receiverName: string | null;
          receiverPhone: string | null;
          receiverAddress: string | null;
          expressCode: string | null;
          packageRequirement: string | null;
          remark: string | null;
          promisedDate: Date | null;
          isUrgent: boolean;
          isSfCollect: boolean;
          editVersion: number;
        }
      | null
    >;
    update: (args: {
      where: { id: string };
      data: unknown;
      select?: unknown;
    }) => Promise<{ id: string; status: OrderStatus }>;
    updateMany: (args: {
      where: { id: string; editVersion: number };
      data: unknown;
    }) => Promise<{ count: number }>;
  };
  orderShipment: {
    updateMany: (args: {
      where: { orderId: string; sequence: number; id?: string };
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
  customerPartyId: string | null;
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

// Blank optional fields mean an explicit clear. Undefined fields are omitted
// by pickEditableFields so partial updates preserve the saved value.
// receiverAddress is checked separately and never reaches persistence as null.
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
// else in `input` is silently dropped. The action extracts the canonical
// FULL_EDITABLE_FIELDS tuple before Zod parsing; this remains a second
// defense for direct domain callers.
function pickEditableFields(
  input: Record<string, unknown>,
  allowed: readonly string[],
): Record<string, EditableOrderFieldValue> {
  const out: Record<string, EditableOrderFieldValue> = {};
  for (const key of allowed) {
    if (!(key in input) || input[key] === undefined) continue;
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

const STALE_ORDER_EDIT_MESSAGE = '工单已被其他人修改，请刷新页面后再编辑';
const INVALID_ORDER_EDIT_TOKEN_MESSAGE = '编辑页面已过期，请刷新后重试';

type OrderEditCommand =
  | {
      kind: 'full-form';
      input: UpdateEditableOrderInput | UpdateShippingOrderInput;
    }
  | { kind: 'urgent-only'; isUrgent: boolean };

async function updateOrderEditableFields(
  orderId: string,
  command: OrderEditCommand,
  actor: { id: string; role: Role },
  transaction?: Prisma.TransactionClient,
): Promise<UpdateOrderResult> {
  if (![Role.ADMIN, Role.SALES, Role.CUSTOMER_SERVICE].some((role) => role === actor.role)) {
    throw new OrderInvariantError('无权编辑工单');
  }
  const work = async (tx: Prisma.TransactionClient): Promise<UpdateOrderResult> => {
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
        purpose: true,
        submitterId: true,
        settlementType: true,
        // Only orders that already carry logistics rows need the province
        // re-checked when the address changes outside the full editor.
        customerCharges: {
          where: { category: { code: { in: [...LOGISTICS_CHARGE_CATEGORY_CODES] } }, priceBookId: { not: null } },
          select: { id: true },
        },
        processingAmount: true,
        totalAmount: true,
        customName: true,
        customerRef: true,
        customerPartyId: true,
        isSfCollect: true,
        changeRequests: { where: { status: 'PENDING' }, select: { id: true } },
        shipments: { select: { id: true, sequence: true, status: true, receiverName: true, receiverPhone: true, receiverAddress: true, expressCode: true, destinationProvince: true } },
        receiverName: true,
        receiverPhone: true,
        receiverAddress: true,
        expressCode: true,
        packageRequirement: true,
        remark: true,
        promisedDate: true,
        isUrgent: true,
        editVersion: true,
      },
    });
    if (!order) throw new OrderInvariantError('工单不存在或无权访问');

    // SALES / CUSTOMER_SERVICE can only edit their own orders. ADMIN
    // has a global override so they can correct field data for
    // anyone. Same pattern as submitOrder's ownership guard.
    const globalOverride = actor.role === Role.ADMIN;
    if (!globalOverride && order.submitterId !== actor.id) {
      throw new OrderInvariantError('只能修改自己创建的工单');
    }

    if (order.changeRequests?.length) {
      throw new OrderInvariantError('工单存在待审批申请，请处理后再编辑');
    }
    const fieldset = editableFieldsetForStatus(order.status);
    if (fieldset === 'NONE') {
      throw new OrderInvariantError('当前状态不可编辑');
    }
    const allowed =
      fieldset === 'FULL' ? FULL_EDITABLE_FIELDS : SHIPPING_EDITABLE_FIELDS;

    if (command.kind === 'full-form') {
      const { expectedEditVersion } = command.input;
      if (!Number.isSafeInteger(expectedEditVersion) || expectedEditVersion < 0) {
        throw new OrderInvariantError(INVALID_ORDER_EDIT_TOKEN_MESSAGE);
      }
      // Reject a stale snapshot before calculating or writing any dependent
      // Shipment / OrderLog state. The conditional UPDATE below repeats this
      // guard to close the read-to-write race with writers that do not take
      // our advisory lock.
      if (order.editVersion !== expectedEditVersion) {
        throw new OrderInvariantError(STALE_ORDER_EDIT_MESSAGE);
      }
    }

    const nextFields = pickEditableFields(
      command.kind === 'full-form'
        ? (command.input as unknown as Record<string, unknown>)
        : { isUrgent: command.isUrgent },
      allowed,
    );
    let externalSalesChange: { before: ExternalSalesAccountOption; after: ExternalSalesAccountOption } | undefined;
    if (command.kind === 'full-form' && 'externalSalesUserId' in command.input) {
      if (actor.role !== Role.ADMIN) {
        throw new OrderInvariantError('只有管理员可以更换关联外部销售');
      }
      const targetId = command.input.externalSalesUserId;
      if (typeof targetId !== 'string' || !targetId.trim() || targetId.trim().length > 64) {
        throw new OrderInvariantError('请选择关联外部销售账号');
      }
      if (targetId.trim() !== order.submitterId) {
        // Serialize against writers outside the cascade lock before checking
        // financial relationships. The final editVersion CAS still applies.
        await tx.$executeRaw`SELECT id FROM "Order" WHERE id = ${orderId} FOR UPDATE`;
        const associationOrder = await tx.order.findUnique({
          where: { id: orderId },
          select: externalSalesAssociationSelect,
        });
        if (!associationOrder) throw new OrderInvariantError('工单不存在或无权访问');
        const reason = externalSalesAssociationBlockReason(associationOrder);
        if (reason) throw new OrderInvariantError(reason);
        // Prevent deactivation / role changes between validation and commit.
        await tx.$executeRaw`SELECT id FROM "User" WHERE id = ${targetId.trim()} FOR SHARE`;
        const target = await tx.user.findUnique({
          where: { id: targetId.trim() },
          select: { id: true, role: true, isActive: true, displayName: true, username: true },
        });
        if (!target || !target.isActive || target.role !== Role.SALES) {
          throw new OrderInvariantError('所选账号不存在、已停用或不是外部销售，请重新选择');
        }
        // Ownership and future billing share submitterId. Preserve the creator,
        // role snapshot, settlement direction, customer data and all prices.
        nextFields.submitterId = target.id;
        externalSalesChange = {
          before: associationOrder.submitter,
          after: { id: target.id, displayName: target.displayName, username: target.username },
        };
      }
    }
    if (
      'customName' in nextFields &&
      order.settlementType === OrderSettlementType.EXTERNAL_SALES
    ) {
      if (
        typeof nextFields.customName !== 'string' ||
        !nextFields.customName.trim()
      ) {
        throw new OrderInvariantError('外部销售工单必须填写工单名称');
      }
      nextFields.customName = nextFields.customName.trim();
    }
    if ('receiverAddress' in nextFields) {
      const receiverAddress = nextFields.receiverAddress;
      if (typeof receiverAddress !== 'string' || !receiverAddress.trim()) {
        throw new OrderInvariantError('请填写收货地址');
      }
      // Action 层会经过 Zod trim；领域层也做同样归一化，
      // 避免测试/脚本等直接调用者把首尾空格持久化。
      nextFields.receiverAddress = receiverAddress.trim();
    }
    if ('customerPartyId' in nextFields && nextFields.customerPartyId !== (order.customerPartyId ?? null)) {
      const customerId = nextFields.customerPartyId;
      if (typeof customerId === 'string') {
        const customer = await tx.party.findUnique({
          where: { id: customerId },
          select: { id: true, isActive: true, type: true },
        });
        if (actor.role === Role.SALES && !await tx.party.findFirst({ where: { id: customerId, ...salesCustomerScope(actor.id) }, select: { id: true } })) {
          throw new OrderInvariantError('只能选择自己关联的客户');
        }
        if (!customer || !customer.isActive ||
          (customer.type !== PartyType.CUSTOMER && customer.type !== PartyType.BOTH)) {
          throw new OrderInvariantError('所选客户不存在、已停用或不是客户，请重新选择');
        }
      }
    }
    const shipmentInput = command.kind === 'full-form' && 'shipments' in command.input ? command.input.shipments : undefined;
    let shipmentEdits: ReturnType<typeof planOrderShipmentEdits> = [];
    if (shipmentInput) {
      try {
        shipmentEdits = planOrderShipmentEdits(
          order.shipments, shipmentInput, order.isSfCollect,
          order.settlementType === OrderSettlementType.EXTERNAL_SALES,
        );
      } catch (error) {
        if (error instanceof OrderShipmentEditError) throw new OrderInvariantError(error.message);
        throw error;
      }
      const primary = shipmentInput.find((row) => order.shipments.find((shipment) => shipment.id === row.id)?.sequence === 1);
      if (primary) {
        for (const key of ['receiverName', 'receiverPhone', 'receiverAddress', 'expressCode'] as const) {
          nextFields[key] = primary[key]?.trim() || null;
        }
      }
    } else if ('receiverAddress' in nextFields && nextFields.receiverAddress !== order.receiverAddress && !order.isSfCollect &&
      orderBillsLogistics({ settlementType: order.settlementType, purpose: order.purpose, hasLogisticsRows: (order.customerCharges?.length ?? 0) > 0 })) {
      throw new OrderInvariantError('请从完整编辑页核对配送省份后修改收货地址');
    }
    const changes = diffEditableFields(order, nextFields);
    const primaryShipmentChanges = Object.fromEntries(
      ['receiverName', 'receiverPhone', 'receiverAddress', 'expressCode']
        .filter((field) => field in changes)
        .map((field) => [field, nextFields[field] as string | null]),
    );
    if (!shipmentInput && Object.keys(primaryShipmentChanges).length > 0) {
      if (order.shipments?.some((shipment) => shipment.sequence === 1 && shipment.status === 'SHIPPED')) {
        throw new OrderInvariantError('主配送记录已发货，不能修改收货信息');
      }
      if (order.settlementType === OrderSettlementType.EXTERNAL_SALES) {
        const name = 'receiverName' in nextFields ? nextFields.receiverName : order.receiverName;
        const phone = 'receiverPhone' in nextFields ? nextFields.receiverPhone : order.receiverPhone;
        if (!name || !phone) throw new OrderInvariantError('请填写收件人和收货电话');
      }
    }

    // No-op edit — skip the UPDATE and the log entry. Keeps the
    // OrderLog feed clean for users who open the edit form and save
    // without changing anything.
    if (Object.keys(changes).length === 0 && shipmentEdits.length === 0) {
      return {
        id: order.id,
        status: order.status,
        changed: false,
        changedFields: [],
      };
    }

    let updated: { id: string; status: OrderStatus };
    if (command.kind === 'full-form') {
      const persisted = await txClient.order.updateMany({
        where: {
          id: orderId,
          editVersion: command.input.expectedEditVersion,
        },
        data: { ...nextFields, ...(shipmentEdits.length ? { updatedAt: new Date() } : {}) },
      });
      if (persisted.count !== 1) {
        throw new OrderInvariantError(STALE_ORDER_EDIT_MESSAGE);
      }
      updated = { id: order.id, status: order.status };
    } else {
      // The one-click urgent command is serialized by the advisory lock and
      // can write only isUrgent. It intentionally has no general-purpose
      // optional version-token escape hatch for full-form edits.
      updated = await txClient.order.update({
        where: { id: orderId },
        data: nextFields,
        select: { id: true, status: true },
      });
    }

    if (!shipmentInput && Object.keys(primaryShipmentChanges).length > 0) {
      const synchronized = await txClient.orderShipment.updateMany({
        where: { orderId, sequence: 1 },
        data: primaryShipmentChanges,
      });
      if (synchronized.count !== 1) {
        throw new OrderInvariantError(
          '工单缺少主发货记录，无法同步收货信息，请联系管理员修复',
        );
      }
    }

    for (const edit of shipmentEdits) {
      const updatedShipment = await txClient.orderShipment.updateMany({
        where: { orderId, id: edit.id, sequence: edit.sequence },
        data: edit.data,
      });
      if (updatedShipment.count !== 1) {
        throw new OrderInvariantError('配送记录已变化，请刷新页面后重试');
      }
    }
    await txClient.orderLog.create({
      data: {
        orderId,
        operatorId: actor.id,
        action: 'UPDATE',
        changedFields: { ...changes, ...(externalSalesChange ? { submitterId: externalSalesChange } : {}), ...(shipmentEdits.length ? { shipments: shipmentEdits.map((edit) => ({ sequence: edit.sequence, before: edit.before, after: edit.data })) } : {}) },
      },
    });

    return {
      id: updated.id,
      status: updated.status,
      changed: true,
      changedFields: [...Object.keys(changes), ...(shipmentEdits.length ? ['shipments'] : [])],
    };
  };
  return transaction ? work(transaction) : db.$transaction(work);
}

export async function updateOrderFields(
  orderId: string,
  input: UpdateEditableOrderInput | UpdateShippingOrderInput,
  actor: { id: string; role: Role },
  transaction?: Prisma.TransactionClient,
): Promise<UpdateOrderResult> {
  return updateOrderEditableFields(
    orderId,
    { kind: 'full-form', input },
    actor,
    transaction,
  );
}

// Quick one-click 急单 flip. Callable only while the order is in
// DRAFT / SUBMITTED (isUrgent is not in the SHIPPING_ONLY set). Its command
// shape accepts only the target boolean while sharing scope / OrderLog rules.
export async function setOrderUrgent(
  orderId: string,
  isUrgent: boolean,
  actor: { id: string; role: Role },
): Promise<UpdateOrderResult> {
  return updateOrderEditableFields(
    orderId,
    { kind: 'urgent-only', isUrgent },
    actor,
  );
}

type SfCollectPricingRevision = Awaited<
  ReturnType<typeof appendOrderPricingRevisionInTx>
>;

async function recordSfCollectOrderLog(
  txClient: EditTxClient,
  input: {
    orderId: string;
    actorId: string;
    isSfCollect: boolean;
    previous: {
      isSfCollect: boolean;
      totalAmount: Decimal.Value;
      pricingStatus: string;
      priceRevision: number;
      revision: number;
    };
    nextTotalAmount: string;
    corrections: readonly SfCollectChargeCorrection[];
    pricingRevision: SfCollectPricingRevision | null;
  },
): Promise<void> {
  await txClient.orderLog.create({
    data: {
      orderId: input.orderId,
      operatorId: input.actorId,
      action: 'UPDATE',
      changedFields: {
        isSfCollect: {
          before: input.previous.isSfCollect,
          after: input.isSfCollect,
        },
        ...(new Decimal(input.previous.totalAmount).equals(input.nextTotalAmount)
          ? {}
          : {
              totalAmount: {
                before: new Decimal(input.previous.totalAmount).toFixed(2),
                after: input.nextTotalAmount,
              },
            }),
        ...(input.corrections.length > 0
          ? {
              shipmentChargeCorrections: {
                before: null,
                after: input.corrections.map((correction) => ({
                  shipmentId: correction.shipmentId,
                  destinationProvince: correction.destinationProvince,
                  weightKg: correction.weightKg,
                  shippingFee: correction.shippingFee,
                  overrideReason: correction.customerChargeOverrideReason,
                })),
              },
            }
          : {}),
        ...(input.pricingRevision
          ? {
              pricingStatus: {
                before: input.previous.pricingStatus,
                after: ORDER_PRICING_STATUS.PENDING_ADMIN_CONFIRMATION,
              },
              priceRevision: {
                before: input.previous.priceRevision,
                after: input.pricingRevision.priceRevision,
              },
              revision: {
                before: input.previous.revision,
                after: input.pricingRevision.orderRevision,
              },
            }
          : {}),
      },
      remark: input.isSfCollect
        ? '标记顺丰到付（自行预约）'
        : '取消顺丰到付',
    },
  });
}

// The caller must hold the order cascade lock and authorize corrections before
// reading this context; all reads remain on that caller's transaction.
async function readSfCollectChargeContextInTx(
  prismaTx: Prisma.TransactionClient,
  orderId: string,
  orderStatus: OrderStatus,
  isSfCollect: boolean,
  trustedCorrections: readonly SfCollectChargeCorrection[],
) {
  const chargeContext = await prismaTx.order.findUnique({
    where: { id: orderId },
    select: {
      items: {
        orderBy: { sequence: 'asc' },
        select: {
          id: true,
          quantity: true,
          paperWeightGsm: true,
          paperType: true,
          productStructure: true,
        },
      },
      shipments: {
        orderBy: { sequence: 'asc' },
        select: {
          id: true,
          sequence: true,
          status: true,
          destinationProvince: true,
          weightKg: true,
          lines: { select: { orderItemId: true, quantity: true } },
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
    trustedCorrections.map((correction) => [
      correction.shipmentId,
      correction,
    ]),
  );
  if (correctionByShipmentId.size !== trustedCorrections.length) {
    throw new OrderInvariantError('顺丰到付更正包含重复的发货地址');
  }
  if (
    trustedCorrections.some(
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
    orderStatus === OrderStatus.SHIPPED &&
    (trustedCorrections.length !== chargeContext.shipments.length ||
      chargeContext.shipments.some(
        (shipment) => !correctionByShipmentId.has(shipment.id),
      ))
  ) {
    throw new OrderInvariantError(
      '已发货工单取消顺丰到付时，必须补齐每个地址的计费信息',
    );
  }

  return { chargeContext, standardCharges, priceBookIds,
    chargeByShipmentAndCategory, correctionByShipmentId };
}

// 顺丰到付是可后补的履约标识。外部销售工单切换时必须同步免收/恢复
// 对客快递费并重算 totalAmount；打包耗材费始终保留。独立事务仍保留
// 权限、所有权、串行化和完整修改日志。
export async function setOrderSfCollect(
  orderId: string,
  isSfCollect: boolean,
  actor: { id: string; role: Role },
  corrections: readonly SfCollectChargeCorrection[] = [],
  fulfillmentGuard?: FulfillmentPricingMutationGuard,
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
        purpose: true,
        samplePackagingRuleCode: true,
        status: true,
        submitterId: true,
        settlementType: true,
        pricingStatus: true,
        priceRevision: true,
        revision: true,
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
        changeRequests: { where: { status: OrderChangeRequestStatus.PENDING }, select: { id: true } },
      },
    });
    if (!order) throw new OrderInvariantError('工单不存在或无权访问');
    if (order.purpose === 'PROOF') throw new OrderInvariantError('打样配送费用已包含在整单总价中');
    // Internal orders submitted since 2026-09-18 carry logistics rows and
    // switch 顺丰到付 exactly like external sales (waive shipping, keep packing).
    const logisticsRows = await (tx as unknown as Prisma.TransactionClient).orderCustomerCharge.findMany({
      where: { orderId, category: { code: { in: [...LOGISTICS_CHARGE_CATEGORY_CODES] } }, priceBookId: { not: null } },
      select: { id: true },
      take: 1,
    });
    const billsLogistics = orderBillsLogistics({
      settlementType: order.settlementType,
      purpose: order.purpose,
      hasLogisticsRows: (logisticsRows?.length ?? 0) > 0,
    });
    if (order.changeRequests?.length) {
      throw new OrderInvariantError('工单有待审批申请，请先处理申请再修改配送方式');
    }

    const globalOverride = actor.role === Role.ADMIN;
    if (!globalOverride && order.submitterId !== actor.id) {
      throw new OrderInvariantError('只能修改自己创建的工单');
    }
    if (!canEditOrderSfCollect(order.status)) {
      throw new OrderInvariantError('已完成或已取消的工单不能修改顺丰到付标识');
    }
    if (
      billsLogistics &&
      order.status === OrderStatus.SHIPPED &&
      actor.role !== Role.ADMIN
    ) {
      throw new OrderInvariantError(
        '外部销售工单发货后的顺丰到付更正只能由管理员处理',
      );
    }
    if (
      billsLogistics &&
      isFulfillmentPricingStatus(order.status)
    ) {
      if (!fulfillmentGuard) {
        throw new OrderInvariantError('履约更正缺少订单版本，请刷新后重新提交');
      }
      try {
        return await recordFulfillmentSfCollectChangeInTx(
          tx,
          { orderId, isSfCollect, ...fulfillmentGuard },
          actor,
        );
      } catch (error) {
        if (error instanceof FulfillmentPricingError) {
          throw new OrderInvariantError(error.message);
        }
        throw error;
      }
    }
    if (order.isSfCollect === isSfCollect) {
      return {
        id: order.id,
        status: order.status,
        changed: false,
        changedFields: [],
      };
    }
    const changedAt = new Date();
    // Sales may toggle the fulfilment mode on their own order, but shipment
    // corrections are administrator-owned fulfilment facts. Dropping the
    // entire payload also prevents an untrusted request from clearing a weight
    // that an administrator has already recorded.
    const trustedCorrections = actor.role === Role.ADMIN ? corrections : [];

    if (isSfCollect) {
      await assertNoShippingCostBeforeSfCollect(txClient, orderId);
    }

    let nextTotalAmount = new Decimal(order.totalAmount).toFixed(2);
    let nextQuotedFeeCompleteness: OrderQuotedFeeCompleteness | null = null;
    if (billsLogistics) {
      const prismaTx = tx as unknown as Prisma.TransactionClient;
      const chargeChangedAt = changedAt;
      const { chargeContext, standardCharges, priceBookIds,
        chargeByShipmentAndCategory, correctionByShipmentId } =
        await readSfCollectChargeContextInTx(
          prismaTx, orderId, order.status, isSfCollect, trustedCorrections,
        );

      let repriced: Awaited<
        ReturnType<typeof resolveExternalOrderChargesForFinalization>
      >;
      try {
        const shipmentChargeFacts = deriveExternalOrderChargeShipments({
          isSfCollect,
          items: chargeContext.items.map((item) => ({
            itemKey: item.id,
            quantity: item.quantity,
            paperWeightGsm: item.paperWeightGsm,
            paperType: item.paperType,
            productStructure: item.productStructure,
          })),
          shipments: chargeContext.shipments.map((shipment) => {
            const correction = correctionByShipmentId.get(shipment.id);
            return {
              shipmentKey: String(shipment.sequence),
              province:
                correction?.destinationProvince ??
                shipment.destinationProvince,
              // Browser quote fields are deliberately absent. An explicit
              // administrator correction wins over the persisted actual;
              // otherwise the shared calculator estimates from item facts.
              billableWeightKg: isSfCollect
                ? null
                : correction?.weightKg ??
                  shipment.weightKg?.toString() ??
                  null,
              itemQuantities: chargeContext.items.map((item) =>
                shipment.lines.reduce(
                  (sum, line) =>
                    line.orderItemId === item.id
                      ? sum + line.quantity
                      : sum,
                  0,
                ),
              ),
            };
          }),
        });
        const shipmentBySequence = new Map(
          chargeContext.shipments.map((shipment) => [
            String(shipment.sequence),
            shipment,
          ]),
        );
        repriced = await resolveExternalOrderChargesForFinalization(
          prismaTx,
          {
            isSfCollect,
            samplePackaging: order.purpose === 'SAMPLE_SHIPMENT' ? { ruleCode: order.samplePackagingRuleCode ?? null } : undefined,
            shipments: shipmentChargeFacts.map((fact) => {
              const shipment = shipmentBySequence.get(fact.shipmentKey);
              if (!shipment) {
                throw new OrderInvariantError(
                  '物流计价事实与工单发货地址不一致',
                );
              }
              const packing = chargeByShipmentAndCategory.get(
                `${shipment.id}:PACKING_MATERIAL`,
              );
              const correction = correctionByShipmentId.get(shipment.id);
              return {
                ...fact,
                shippingFee: isSfCollect
                  ? '0.00'
                  : correction?.shippingFee ?? null,
                packingMaterialFee: packing?.amount?.toString() ?? null,
                overrideReason: isSfCollect
                  ? packing?.overrideReason ?? null
                  : correction?.customerChargeOverrideReason ??
                    (shipment.status !== ShipmentStatus.SHIPPED
                      ? '取消顺丰到付，快递费待发货时确认'
                      : packing?.overrideReason ?? null),
              };
            }),
          },
          priceBookIds[0]!,
          chargeChangedAt,
          {
            allowPending:
              !isSfCollect && order.status !== OrderStatus.SHIPPED,
          },
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
        for (const correction of trustedCorrections) {
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
          (sum, charge) =>
            charge.amount === null ? sum : sum.plus(charge.amount),
          new Decimal(0),
        );
      if (isSfCollect) {
        const retainedNonShippingCharges = chargeContext.customerCharges
          .filter(
            (charge) => String(charge.category.code) !== 'SHIPPING_FEE',
          )
          .reduce(
            (sum, charge) =>
              charge.amount === null ? sum : sum.plus(charge.amount),
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
      nextQuotedFeeCompleteness = repriced.requiresAdminConfirmation
        ? OrderQuotedFeeCompleteness.EXCLUDES_MANUAL_ITEMS
        : OrderQuotedFeeCompleteness.COMPLETE;
    }

    const updated = await txClient.order.update({
      where: { id: orderId },
      data: {
        isSfCollect,
        totalAmount: nextTotalAmount,
        ...(billsLogistics
          ? {
              confirmedFee: null,
              settledFee: null,
            }
          : {}),
      },
      select: { id: true, status: true },
    });
    const pricingRevision =
      billsLogistics
        ? await appendOrderPricingRevisionInTx(
            tx as unknown as Prisma.TransactionClient,
            {
              orderId,
              status: ORDER_PRICING_STATUS.PENDING_ADMIN_CONFIRMATION,
              source: 'SF_COLLECT_CHANGED_PENDING',
              actorId: actor.id,
              now: changedAt,
              expectedPriceRevision: order.priceRevision,
              incrementOrderRevision: true,
              orderFeeSnapshot: {
                quotedFee: nextTotalAmount,
                confirmedFee: null,
                settledFee: null,
              },
              remark: isSfCollect
                ? '顺丰到付变更后待管理员重新确认终价'
                : '取消顺丰到付后待管理员重新确认终价',
              metadata: { isSfCollect },
            },
          )
        : null;
    if (pricingRevision) {
      // The quote's amount, completeness and revision reference form one
      // database invariant. Legacy orders may have all three fields null;
      // write the whole tuple only after its immutable revision exists.
      await txClient.order.update({
        where: { id: orderId },
        data: {
          quotedFee: nextTotalAmount,
          quotedFeeCompleteness:
            nextQuotedFeeCompleteness ??
            OrderQuotedFeeCompleteness.EXCLUDES_MANUAL_ITEMS,
          quotedPricingRevisionId: pricingRevision.pricingRevisionId,
        },
        select: { id: true, status: true },
      });
    }
    await recordSfCollectOrderLog(txClient, {
      orderId,
      actorId: actor.id,
      isSfCollect,
      previous: order,
      nextTotalAmount,
      corrections: trustedCorrections,
      pricingRevision,
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
            packagingAmount: true,
            totalAmount: true,
            pricingStatus: true,
            priceRevision: true,
            pricingConfirmedAt: true,
            pricingConfirmedById: true,
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
                manualQuoteReason: true,
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
          ...(isWorkerView
            ? {}
            : {
                plateDetails: {
                  orderBy: { sequence: 'asc' as const },
                },
              }),
        },
      },
      packagingGroups: {
        orderBy: { sequence: 'asc' },
        select: {
          id: true,
          sequence: true,
          name: true,
          mode: true,
          actualBagCount: true,
          ...(isWorkerView
            ? {}
            : {
                unitPrice: true,
                subtotal: true,
                suggestedSubtotal: true,
                pricingSnapshot: true,
                priceOverrideReason: true,
              }),
          lines: {
            orderBy: { orderItem: { sequence: 'asc' } },
            select: {
              id: true,
              unitsPerBag: true,
              orderItem: {
                select: { id: true, sequence: true, name: true },
              },
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
          labels: { select: { id: true, createdAt: true }, orderBy: [{ createdAt: 'desc' }, { id: 'desc' }] },
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
            pricingConfirmedBy: {
              select: { id: true, displayName: true },
            },
            pricingRevisions: {
              orderBy: { revision: 'desc' as const },
              take: 5,
              select: {
                id: true,
                revision: true,
                status: true,
                source: true,
                createdAt: true,
                createdBy: { select: { id: true, displayName: true } },
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
          createdBy: { select: { id: true, displayName: true } },
          finalizedBy: { select: { id: true, displayName: true } },
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
    pricingRevisions: isWorkerView ? [] : order.pricingRevisions,
    pricingConfirmedBy: isWorkerView ? null : order.pricingConfirmedBy,
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

async function confirmCreatedAdminItemPricesInTx(
  tx: Prisma.TransactionClient,
  orderId: string,
  submittedItems: Array<{
    adminPrice?: unknown;
    pricingSnapshot: Prisma.InputJsonObject | null;
  }>,
  actorId: string,
  now: Date,
) {
  if (!submittedItems.some((item) => item.adminPrice)) return;

  const stored = await tx.orderItem.findMany({
    where: { orderId: orderId },
    orderBy: { sequence: 'asc' },
  });
  for (const item of stored) {
    const submitted = submittedItems[item.sequence - 1];
    if (!submitted.adminPrice) continue;
    const pricingSnapshot = buildTrustedAdminItemPricingSnapshot({
      previous: submitted.pricingSnapshot,
      now,
      actorId: actorId,
      previousPriceRevision: 0,
      item,
    });
    await tx.orderItem.update({
      where: { id: item.id },
      data: { pricingSnapshot },
    });
    submitted.pricingSnapshot = pricingSnapshot;
  }
}

function validateAdminCreatePrices(
  input: CreateOrderCommand,
  role: Role,
  additionalShipments: AdditionalShipmentCommand[],
): boolean {
  const hasAdminPrices =
    input.items.some((item) => item.adminPrice !== undefined) ||
    (input.packagingGroups ?? []).some(
      (group) => group.adminPrice !== undefined,
    );
  if (hasAdminPrices && role !== Role.ADMIN) {
    throw new OrderInvariantError('只有管理员可以在建单时定价');
  }
  for (const item of input.items) {
    if (
      item.adminPrice &&
      item.adminPrice.factsKey !== adminCreatePriceFactsKey(item)
    ) {
      throw new OrderInvariantError('款式条件已变化，请重新确认人工价格');
    }
  }
  for (const group of input.packagingGroups ?? []) {
    if (
      group.adminPrice &&
      group.adminPrice.factsKey !==
        adminPackagingPriceFactsKey(
          group,
          input.items.map((item) => item.quantity),
          additionalShipments.map((shipment) => shipment.itemQuantities),
        )
    )
      throw new OrderInvariantError('包装条件已变化，请重新确认包装价格');
    if (group.mode === 'UNPACKED' && group.adminPrice)
      throw new OrderInvariantError('不包装的费用固定为 0，无需人工定价');
  }
  return hasAdminPrices;
}

function applyAdminCreateItemPrice<
  T extends {
    adminPrice?: CreateOrderInput['items'][number]['adminPrice'];
    pricingSnapshot: Prisma.InputJsonObject | null;
  },
>(
  item: T,
): Omit<T, 'pricingSnapshot' | 'priceOverrideReason'> & {
  pricingSnapshot: Prisma.InputJsonObject | null;
  priceOverrideReason: string | null;
} {
  if (!item.adminPrice) return { ...item, priceOverrideReason: null };
  let price: ReturnType<typeof calculateAdminCreatePrice>;
  try {
    price = calculateAdminCreatePrice(item.adminPrice);
  } catch (error) {
    throw new OrderInvariantError(
      error instanceof Error ? error.message : '人工价格无效',
    );
  }
  return {
    ...item,
    ...price,
    quotedAmount: price.subtotal,
    pricingSnapshot: item.pricingSnapshot ?? {
      version: 1,
      complete: false,
      suggestedSubtotal: null,
    },
    quoteDisposition: OrderItemQuoteDisposition.PRICED,
    requiresAdminConfirmation: false,
  };
}
