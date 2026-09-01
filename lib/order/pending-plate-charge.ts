import type { Prisma } from '../../generated/prisma/client';
import { OrderCustomerChargeStatus } from '../../generated/prisma/enums';
import type { CreateOrderQuoteResult } from '../price/create-order/types';

export const PENDING_PLATE_BUSINESS_KEY =
  'ORDER:PLATE_MAKING_FEE:PENDING' as const;

export class PendingPlateChargeError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'PendingPlateChargeError';
  }
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
  const plateLines = args.quote.order.lines.filter(
    (line) => line.code === 'PLATE_FEE',
  );
  const plateLine = plateLines[0];
  if (
    plateLines.length !== 1 ||
    !plateLine ||
    plateLine.status !== 'PENDING_AMOUNT' ||
    plateLine.amount !== null ||
    plateLine.includedInKnownTotal
  ) {
    throw new PendingPlateChargeError(
      '纯引擎未产生唯一的待核价制版费明细',
    );
  }
  const pendingReason = args.quote.pendingReasons.find(
    (reason) => reason.code === 'PLATE_AMOUNT_PENDING',
  );
  if (!pendingReason) {
    throw new PendingPlateChargeError('纯引擎缺少制版费待核价原因');
  }

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
