import 'server-only';

import Decimal from 'decimal.js';
import {
  DesignFileType,
  OrderChangeRequestStatus,
  OrderCustomerChargeStatus,
  OrderPricingStatus,
  OrderSettlementType,
  OrderStatus,
  Prisma,
  Role,
  ShipmentStatus,
} from '../../generated/prisma/client';
import { getOrderScopeFilter } from '../auth/order-scope';
import { db } from '../db';
import { signDesignReadUrl } from '../oss/read-url';
import { selectOrderCustomerFee } from './customer-fee';

export type SalesOrderDetail = {
  id: string;
  orderNo: string;
  customName: string | null;
  customerRef: string | null;
  status: OrderStatus;
  settlementType: OrderSettlementType;
  isUrgent: boolean;
  isSfCollect: boolean;
  revision: number;
  editVersion: number;
  workOrderVersion: number;
  priceRevision: number;
  pricingStatus: OrderPricingStatus;
  totalAmount: string;
  promisedDate: string | null;
  expressCode: string | null;
  packageRequirement: string | null;
  remark: string | null;
  receiver: {
    name: string | null;
    phone: string | null;
    address: string | null;
  };
  feeLines: Array<{
    id: string;
    label: string;
    amount: string | null;
    estimated: boolean;
  }>;
  items: Array<{
    id: string;
    sequence: number;
    name: string;
    quantity: number;
    specification: string | null;
    paper: string | null;
    frontFoilColors: string[];
    backFoilColors: string[];
    foilColors: string[];
    isDoubleSided: boolean;
    remark: string | null;
    designs: Array<{
      id: string;
      fileName: string;
      fileType: DesignFileType;
      fileUrl: string;
      fileSize: string;
    }>;
  }>;
  shipments: Array<{
    id: string;
    sequence: number;
    status: ShipmentStatus;
    receiverName: string | null;
    receiverPhone: string | null;
    receiverAddress: string | null;
    expressCode: string | null;
    destinationProvince: string | null;
    trackingNo: string | null;
    lines: Array<{
      id: string;
      itemSequence: number;
      itemName: string;
      quantity: number;
    }>;
  }>;
  changeRequests: Array<{
    id: string;
    type: 'MODIFY' | 'CANCEL';
    status: OrderChangeRequestStatus;
    baseRevision: number;
    baseWorkOrderVersion: number | null;
    workOrderVersionAfter: number | null;
    reason: string;
    reviewRemark: string | null;
    reviewedAt: string | null;
    createdAt: string;
    canWithdraw: boolean;
  }>;
};

// This is the complete SALES detail contract. Keep the select explicit: the
// legacy shared detail includes production tasks/workers, plate data, pricing
// snapshots, logs, outsource records and internal costs, none of which may
// cross the sales-facing RSC boundary.
export const salesOrderDetailSelect = {
  id: true,
  orderNo: true,
  customName: true,
  customerRef: true,
  status: true,
  settlementType: true,
  isUrgent: true,
  isSfCollect: true,
  revision: true,
  editVersion: true,
  workOrderVersion: true,
  priceRevision: true,
  pricingStatus: true,
  processingAmount: true,
  packagingAmount: true,
  totalAmount: true,
  quotedFee: true,
  confirmedFee: true,
  settledFee: true,
  promisedDate: true,
  expressCode: true,
  packageRequirement: true,
  remark: true,
  receiverName: true,
  receiverPhone: true,
  receiverAddress: true,
  items: {
    orderBy: { sequence: 'asc' },
    select: {
      id: true,
      sequence: true,
      name: true,
      quantity: true,
      specification: true,
      paperType: true,
      paperWeightGsm: true,
      frontFoilColors: true,
      backFoilColors: true,
      foilColors: true,
      isDoubleSided: true,
      remark: true,
      designs: {
        orderBy: [{ uploadedAt: 'asc' }, { id: 'asc' }],
        select: {
          id: true,
          fileName: true,
          fileType: true,
          fileUrl: true,
          fileSize: true,
        },
      },
    },
  },
  shipments: {
    orderBy: { sequence: 'asc' },
    select: {
      id: true,
      sequence: true,
      status: true,
      receiverName: true,
      receiverPhone: true,
      receiverAddress: true,
      expressCode: true,
      destinationProvince: true,
      trackingNo: true,
      lines: {
        orderBy: { orderItem: { sequence: 'asc' } },
        select: {
          id: true,
          quantity: true,
          orderItem: { select: { sequence: true, name: true } },
        },
      },
    },
  },
  customerCharges: {
    orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
    select: {
      id: true,
      description: true,
      amount: true,
      status: true,
    },
  },
  changeRequests: {
    orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
    take: 20,
    select: {
      id: true,
      type: true,
      requesterId: true,
      status: true,
      baseRevision: true,
      baseWorkOrderVersion: true,
      workOrderVersionAfter: true,
      reason: true,
      reviewRemark: true,
      reviewedAt: true,
      createdAt: true,
    },
  },
} as const satisfies Prisma.OrderSelect;

type SalesOrderDetailRecord = Prisma.OrderGetPayload<{
  select: typeof salesOrderDetailSelect;
}>;

export async function getSalesOrderDetailById(
  actor: { id: string; role: Role },
  id: string,
): Promise<SalesOrderDetail | null> {
  if (actor.role !== Role.SALES) {
    throw new Error('销售工单操作页只接受 SALES 角色');
  }
  const normalizedId = id.trim();
  if (!normalizedId || normalizedId.length > 128) return null;

  const row = await db.order.findFirst({
    where: {
      AND: [getOrderScopeFilter(actor), { id: normalizedId }],
    },
    select: salesOrderDetailSelect,
  });
  return row ? mapSalesOrderDetail(row, actor.id) : null;
}

function mapSalesOrderDetail(
  row: SalesOrderDetailRecord,
  viewerId: string,
): SalesOrderDetail {
  const pendingPrice =
    row.pricingStatus === OrderPricingStatus.PENDING_ADMIN_CONFIRMATION;
  const feeLines: SalesOrderDetail['feeLines'] = [];
  const processing = new Decimal(row.processingAmount.toString()).minus(
    row.packagingAmount.toString(),
  );
  if (!processing.isZero()) {
    feeLines.push({
      id: 'processing',
      label: '款式加工费',
      amount: processing.toFixed(2),
      estimated: pendingPrice,
    });
  }
  const packaging = new Decimal(row.packagingAmount.toString());
  if (!packaging.isZero()) {
    feeLines.push({
      id: 'packaging',
      label: '入袋加工费',
      amount: packaging.toFixed(2),
      estimated: pendingPrice,
    });
  }
  for (const charge of row.customerCharges) {
    feeLines.push({
      id: charge.id,
      label: charge.description,
      amount: charge.amount === null ? null : money(charge.amount),
      estimated: charge.status === OrderCustomerChargeStatus.ESTIMATED,
    });
  }

  return {
    id: row.id,
    orderNo: row.orderNo,
    customName: row.customName,
    customerRef: row.customerRef,
    status: row.status,
    settlementType: row.settlementType,
    isUrgent: row.isUrgent,
    isSfCollect: row.isSfCollect,
    revision: row.revision,
    editVersion: row.editVersion,
    workOrderVersion: row.workOrderVersion,
    priceRevision: row.priceRevision,
    pricingStatus: row.pricingStatus,
    totalAmount: selectOrderCustomerFee(row).amount,
    promisedDate: row.promisedDate?.toISOString().slice(0, 10) ?? null,
    expressCode: row.expressCode,
    packageRequirement: row.packageRequirement,
    remark: row.remark,
    receiver: {
      name: row.receiverName,
      phone: row.receiverPhone,
      address: row.receiverAddress,
    },
    feeLines,
    items: row.items.map((item) => ({
      id: item.id,
      sequence: item.sequence,
      name: item.name,
      quantity: item.quantity,
      specification: item.specification,
      paper: formatPaper(item.paperType, item.paperWeightGsm),
      frontFoilColors: [...item.frontFoilColors],
      backFoilColors: [...item.backFoilColors],
      foilColors: [...item.foilColors],
      isDoubleSided: item.isDoubleSided,
      remark: item.remark,
      designs: item.designs.map((design) => ({
        id: design.id,
        fileName: design.fileName,
        fileType: design.fileType,
        fileUrl:
          design.fileType === DesignFileType.IMAGE
            ? signDesignReadUrl(design.fileUrl)
            : '',
        fileSize: design.fileSize.toString(),
      })),
    })),
    shipments: row.shipments.map((shipment) => ({
      id: shipment.id,
      sequence: shipment.sequence,
      status: shipment.status,
      receiverName: shipment.receiverName,
      receiverPhone: shipment.receiverPhone,
      receiverAddress: shipment.receiverAddress,
      expressCode: shipment.expressCode,
      destinationProvince: shipment.destinationProvince,
      trackingNo: shipment.trackingNo,
      lines: shipment.lines.map((line) => ({
        id: line.id,
        itemSequence: line.orderItem.sequence,
        itemName: line.orderItem.name,
        quantity: line.quantity,
      })),
    })),
    changeRequests: row.changeRequests.map((request) => ({
      id: request.id,
      type: request.type,
      status: request.status,
      baseRevision: request.baseRevision,
      baseWorkOrderVersion: request.baseWorkOrderVersion,
      workOrderVersionAfter: request.workOrderVersionAfter,
      reason: request.reason,
      reviewRemark: request.reviewRemark,
      reviewedAt: request.reviewedAt?.toISOString() ?? null,
      createdAt: request.createdAt.toISOString(),
      canWithdraw:
        request.status === OrderChangeRequestStatus.PENDING &&
        request.requesterId === viewerId,
    })),
  };
}

function formatPaper(type: string | null, weight: number | null): string | null {
  if (!type) return null;
  return weight ? `${type} ${weight}g` : type;
}

function money(value: { toString(): string }): string {
  return new Decimal(value.toString()).toFixed(2);
}
