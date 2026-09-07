import type { Prisma } from '../../generated/prisma/client';
import { OrderCustomerChargeStatus } from '../../generated/prisma/enums';
import type { CreateOrderQuoteResult } from '../price/create-order/types';
import { CREATE_ORDER_PLATE_PRICING_POLICY } from '../price/create-order/order-quote';

export const PENDING_PLATE_BUSINESS_KEY =
  'ORDER:PLATE_MAKING_FEE:PENDING' as const;

export class PendingPlateChargeError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'PendingPlateChargeError';
  }
}

function pendingPlateEvidence(quote: CreateOrderQuoteResult): {
  line: CreateOrderQuoteResult['order']['lines'][number];
  reason: CreateOrderQuoteResult['pendingReasons'][number];
} | null {
  const plateLines = quote.order.lines.filter((line) => line.code === 'PLATE_FEE');
  const pendingReasons = quote.pendingReasons.filter(
    (reason) => reason.code === 'PLATE_AMOUNT_PENDING',
  );
  if (plateLines.length === 0) {
    if (pendingReasons.length > 0) {
      throw new PendingPlateChargeError(
        '纯引擎生成了制版费待核价原因，但没有对应制版费明细',
      );
    }
    return null;
  }

  const plateLine = plateLines[0];
  if (
    plateLines.length !== 1 ||
    pendingReasons.length !== 1 ||
    !plateLine ||
    plateLine.status !== 'PENDING_AMOUNT' ||
    plateLine.amount !== null ||
    plateLine.includedInKnownTotal ||
    plateLine.basis.pricingPolicy !== CREATE_ORDER_PLATE_PRICING_POLICY
  ) {
    throw new PendingPlateChargeError(
      '纯引擎未产生唯一的待核价制版费明细',
    );
  }
  return { line: plateLine, reason: pendingReasons[0]! };
}

export function quoteHasPendingPlateCharge(
  quote: CreateOrderQuoteResult,
): boolean {
  return pendingPlateEvidence(quote) !== null;
}

function quoteUsesPrintFoilAtomicBundleScope(
  quote: CreateOrderQuoteResult,
): boolean {
  return (
    quote.items.some((item) =>
      item.lines.some(
        (line) =>
          line.code === 'PRINT_FOIL_PER_ORDER' &&
          line.status === 'QUOTED' &&
          line.includedInKnownTotal &&
          line.basis.plateTreatment === 'INCLUDED_IN_ATOMIC_BUNDLE',
      ),
    ) ||
    quote.manualReasons.some(
      (reason) =>
        reason.code === 'PRINT_FOIL_PRICE_NOT_FOUND' ||
        reason.code === 'PRINT_FOIL_MANUAL_PRICE_INCLUDES_PLATE',
    )
  );
}

export async function requireActivePlateCategoryIdInTx(
  tx: Prisma.TransactionClient,
): Promise<string> {
  const category = await tx.customerChargeCategory.findUnique({
    where: { code: 'PLATE_MAKING_FEE' },
    select: { id: true, isActive: true },
  });
  if (!category?.isActive) {
    throw new PendingPlateChargeError(
      '制版费收费类目不存在或已停用，请联系管理员',
    );
  }
  return category.id;
}

/**
 * Persist the engine's one order-level plate charge without inventing a price.
 * The same shape is used by internal creation and external submit so factory
 * confirmation has one canonical PENDING_AMOUNT exit in both workflows.
 */
export async function upsertPendingPlateChargeInTx(args: {
  tx: Prisma.TransactionClient;
  orderId: string;
  actorId: string;
  categoryId: string;
  quote: CreateOrderQuoteResult;
  source:
    | 'EXTERNAL_SUBMIT_PENDING_PLATE'
    | 'INTERNAL_CREATE_PENDING_PLATE'
    | 'CHANGE_REQUEST_PENDING_PLATE';
}): Promise<void> {
  const evidence = pendingPlateEvidence(args.quote);
  if (!evidence) {
    throw new PendingPlateChargeError('纯引擎没有需要持久化的制版费明细');
  }
  const { line: plateLine, reason: pendingReason } = evidence;

  const chargeData = {
    shipmentId: null,
    categoryId: args.categoryId,
    priceBookId: null,
    sourceRuleId: null,
    status: OrderCustomerChargeStatus.PENDING_AMOUNT,
    description: plateLine.label,
    quantity: null,
    unit: null,
    unitPrice: null,
    suggestedAmount: null,
    amount: null,
    isAdjustment: false,
    pricingSnapshot: {
      schemaVersion: 2,
      engineVersion: 'CREATE_ORDER_PURE_V1',
      source: args.source,
      priceVersion: args.quote.priceVersion,
      pureLine: plateLine,
      pendingReason,
      actual: {
        amount: null,
        provisional: true,
        requiresAdminConfirmation: true,
      },
    } satisfies Prisma.InputJsonObject,
    overrideReason: null,
    approvalReference: null,
    finalizedById: null,
    finalizedAt: null,
  };
  await args.tx.orderCustomerCharge.upsert({
    where: {
      orderId_businessKey: {
        orderId: args.orderId,
        businessKey: PENDING_PLATE_BUSINESS_KEY,
      },
    },
    create: {
      orderId: args.orderId,
      businessKey: PENDING_PLATE_BUSINESS_KEY,
      createdById: args.actorId,
      ...chargeData,
    },
    update: chargeData,
  });
}

export type PendingPlateChargeWaiverPlan = {
  existing: {
    id: string;
    status: OrderCustomerChargeStatus;
    amount: { toString(): string } | null;
    pricingSnapshot: Prisma.JsonValue | null;
  } | null;
  reason: string;
};

/**
 * Resolve and validate a plate-fee waiver without mutating the order. Change
 * approval uses this preflight before it writes any item, packaging, shipment,
 * or charge row, so a malformed quote cannot fail only after partial work.
 */
export async function preparePendingPlateChargeWaiverInTx(args: {
  tx: Prisma.TransactionClient;
  orderId: string;
  quote: CreateOrderQuoteResult;
}): Promise<PendingPlateChargeWaiverPlan> {
  if (quoteHasPendingPlateCharge(args.quote)) {
    throw new PendingPlateChargeError(
      '仍有独立制版费待核价的工单不能豁免订单级制版费',
    );
  }
  const reason = quoteUsesPrintFoilAtomicBundleScope(args.quote)
    ? '制版费已包含在不可拆彩印烫金原子套餐，不再另收'
    : '改单后已无烫金事实，制版费不再适用';
  const existing = await args.tx.orderCustomerCharge.findUnique({
    where: {
      orderId_businessKey: {
        orderId: args.orderId,
        businessKey: PENDING_PLATE_BUSINESS_KEY,
      },
    },
    select: {
      id: true,
      status: true,
      amount: true,
      pricingSnapshot: true,
    },
  });
  return { existing, reason };
}

export async function applyPendingPlateChargeWaiverInTx(args: {
  tx: Prisma.TransactionClient;
  actorId: string;
  now: Date;
  quote: CreateOrderQuoteResult;
  plan: PendingPlateChargeWaiverPlan;
}): Promise<void> {
  const { existing, reason } = args.plan;
  if (!existing || existing.status === OrderCustomerChargeStatus.WAIVED) return;

  await args.tx.orderCustomerCharge.update({
    where: { id: existing.id },
    data: {
      status: OrderCustomerChargeStatus.WAIVED,
      amount: '0.00',
      suggestedAmount: null,
      pricingSnapshot: {
        schemaVersion: 2,
        engineVersion: 'CREATE_ORDER_PURE_V1',
        source: 'CHANGE_REQUEST_PLATE_NOT_APPLICABLE',
        priceVersion: args.quote.priceVersion,
        waivedAt: args.now.toISOString(),
        reason,
        previousStatus: existing.status,
        previousAmount: existing.amount?.toString() ?? null,
        ...(existing.pricingSnapshot === null
          ? {}
          : { previousSnapshot: existing.pricingSnapshot }),
        actual: {
          amount: '0.00',
          provisional: false,
          requiresAdminConfirmation: false,
        },
      } satisfies Prisma.InputJsonObject,
      overrideReason: reason,
      finalizedById: args.actorId,
      finalizedAt: args.now,
    },
    select: { id: true },
  });
}

export async function waivePendingPlateChargeWhenNotApplicableInTx(args: {
  tx: Prisma.TransactionClient;
  orderId: string;
  actorId: string;
  now: Date;
  quote: CreateOrderQuoteResult;
}): Promise<void> {
  const plan = await preparePendingPlateChargeWaiverInTx(args);
  await applyPendingPlateChargeWaiverInTx({
    tx: args.tx,
    actorId: args.actorId,
    now: args.now,
    quote: args.quote,
    plan,
  });
}
