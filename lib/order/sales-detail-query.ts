import { foilColorLabel } from '@/lib/order/foil-colors';
import { paperDisplayLabel } from '@/lib/rules/paper-label';
import 'server-only';

import { canChangeOrderPackaging } from './editable-fields';

import Decimal from 'decimal.js';
import {
  DesignFileType,
  OrderChangeRequestStatus,
  OrderCustomerChargeStatus,
  OrderItemPricingRoute,
  OrderPricingStatus,
  OrderPackagingMode,
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
import { resolveOrderItemFoilSides } from './pricing-route';
import { externalPriceBusinessText } from '../price/external-price-display';

const CARRIER_LABELS: Readonly<Record<string, string>> = { ZTO: '中通', SF: '顺丰', OTHER: '其他快递' };

export type SalesOrderDetail = {
  id: string;
  purpose?: import('./purpose').OrderPurposeValue;
  orderNo: string;
  customName: string | null;
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
  workflowDecision?: { reason: string; note: string | null; affectedFigs: number[]; createdAt: string } | null;
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
    pack?: number | null;
    packagingEditable?: boolean;
    productId: string | null;
    pricingRoute: OrderItemPricingRoute;
    specification: string | null;
    paperType: string | null;
    paperWeightGsm: number | null;
    paper: string | null;
    frontFoilColors: string[];
    backFoilColors: string[];
    foilColors: string[];
    isDoubleSided: boolean;
    remark: string | null;
    details: Array<{ label: string; value: string }>;
    designs: Array<{
      id: string;
      fileName: string;
      fileType: DesignFileType;
      fileUrl: string;
      fileSize: string;
    }>;
  }>;
  packagingGroups: Array<{
    id: string;
    sequence: number;
    name: string | null;
    mode: OrderPackagingMode;
    actualBagCount: number;
    lines: Array<{
      itemSequence: number;
      itemName: string;
      unitsPerBag: number;
    }>;
  }>;
  canAddShipment?: boolean;
  shipments: Array<{
    id: string;
    sequence: number;
    status: ShipmentStatus;
    receiverName: string | null;
    receiverPhone: string | null;
    receiverAddress: string | null;
    expressCode: string | null;
    destinationProvince: string | null;
    canSplit?: boolean;
    trackingNo: string | null;
    carrier: string | null;
    shippedAt: string | null;
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
  purpose: true,
  orderNo: true,
  customName: true,
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
  settledAt: true,
  promisedDate: true,
  expressCode: true,
  packageRequirement: true,
  remark: true,
  receiverName: true,
  receiverPhone: true,
  receiverAddress: true,
  workflowDecisions: {
    orderBy: [{ createdAt: 'desc' }, { id: 'desc' }], take: 1,
    select: { toStatus: true, reasonCode: true, reasonNote: true, affectedFigs: true, createdAt: true },
  },
  items: {
    orderBy: { sequence: 'asc' },
    select: {
      id: true,
      sequence: true,
      name: true,
      quantity: true,
      productId: true,
      pricingRoute: true,
      specification: true,
      paperType: true,
      paperWeightGsm: true,
      craft: true,
      productStructure: true,
      actualWidthMm: true,
      actualHeightMm: true,
      artworkVersion: true,
      foilTechnique: true,
      hasLocalFoil: true,
      lamination: true,
      printColors: true,
      printColorsKnown: true,
      pack: true,
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
  packagingGroups: {
    orderBy: { sequence: 'asc' },
    select: {
      id: true,
      sequence: true,
      name: true,
      mode: true,
      actualBagCount: true,
      lines: {
        orderBy: { orderItem: { sequence: 'asc' } },
        select: {
          unitsPerBag: true,
          orderItem: { select: { sequence: true, name: true } },
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
      weightKg: true,
      registrationVersion: true,
      carrierName: true,
      carrierCode: true,
      shippedAt: true,
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
      shipment: { select: { sequence: true } },
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
      label: row.shipments.length > 1 && charge.shipment
        ? `地址 ${charge.shipment.sequence} · ${charge.description}`
        : charge.description,
      amount: charge.amount === null ? null : money(charge.amount),
      estimated: charge.status === OrderCustomerChargeStatus.ESTIMATED,
    });
  }

  return {
    id: row.id,
    purpose: row.purpose,
    orderNo: row.orderNo,
    customName: row.customName,
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
    workflowDecision: (() => {
      const decision = row.workflowDecisions?.[0];
      if (!decision || decision.toStatus !== row.status || ![OrderStatus.REJECTED, OrderStatus.ON_HOLD].some((status) => status === row.status)) return null;
      return { reason: decision.reasonCode === 'PAPER_OUT' ? '纸张库存不足' : decision.reasonCode === 'DESIGN_ERROR' ? '设计图有误' : '待工厂核价',
        note: decision.reasonNote,
        affectedFigs: Array.isArray(decision.affectedFigs) ? decision.affectedFigs.filter((value): value is number => typeof value === 'number' && Number.isSafeInteger(value) && value > 0) : [],
        createdAt: decision.createdAt.toISOString() };
    })(),
    feeLines,
    items: row.items.map((item) => ({
      id: item.id,
      sequence: item.sequence,
      name: item.name,
      quantity: item.quantity,
      pack: row.packagingGroups.flatMap((group) => group.lines)
        .find((line) => line.orderItem.sequence === item.sequence)?.unitsPerBag ?? item.pack,
      packagingEditable: canChangeOrderPackaging(row.status) && row.packagingGroups
        .flatMap((group) => group.lines).filter((line) => line.orderItem.sequence === item.sequence).length === 1,
      productId: item.productId,
      pricingRoute: item.pricingRoute,
      specification: item.specification,
      paperType: item.paperType,
      paperWeightGsm: item.paperWeightGsm,
      paper: formatPaper(item.paperType, item.paperWeightGsm),
      frontFoilColors: [...item.frontFoilColors],
      backFoilColors: [...item.backFoilColors],
      foilColors: [...item.foilColors],
      isDoubleSided: item.isDoubleSided,
      remark: item.remark,
      details: salesItemDetails(item, row.packagingGroups.length === 0),
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
    packagingGroups: row.packagingGroups.map((group) => ({
      id: group.id,
      sequence: group.sequence,
      name: group.name,
      mode: group.mode,
      actualBagCount: group.actualBagCount,
      lines: group.lines.map((line) => ({
        itemSequence: line.orderItem.sequence,
        itemName: line.orderItem.name,
        unitsPerBag: line.unitsPerBag,
      })),
    })),
    canAddShipment: !row.settledAt && row.settledFee === null && row.shipments.length < 10 && !row.shipments.some((shipment) => shipment.status === 'SHIPPED') && !row.changeRequests.some((request) => request.status === 'PENDING'),
    shipments: row.shipments.map((shipment) => ({
      id: shipment.id,
      sequence: shipment.sequence,
      status: shipment.status,
      receiverName: shipment.receiverName,
      receiverPhone: shipment.receiverPhone,
      receiverAddress: shipment.receiverAddress,
      expressCode: shipment.expressCode,
      destinationProvince: shipment.destinationProvince,
      canSplit: !shipment.trackingNo && shipment.weightKg === null && shipment.registrationVersion === 0,
      trackingNo: shipment.trackingNo,
      carrier: shipment.carrierName || CARRIER_LABELS[shipment.carrierCode ?? ''] || null,
      shippedAt: shipment.shippedAt?.toISOString() ?? null,
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

function formatPaper(rawType: string | null, weight: number | null): string | null {
  if (!rawType) return null;
  const type = paperDisplayLabel(rawType);
  if (weight && new RegExp(`(?:^|\\D)${weight}\\s*g\\b`, 'i').test(type)) return type;
  return weight ? `${type} ${weight}g` : type;
}

// Customer-visible, persisted configuration only. No catalog defaults, cost
// records, price-rule snapshots or production identifiers cross this boundary.
function salesItemDetails(item: SalesOrderDetailRecord['items'][number], legacyPackaging: boolean) {
  const details: SalesOrderDetail['items'][number]['details'] = [];
  const add = (label: string, value: string | null | undefined) => {
    if (value?.trim()) details.push({ label, value: externalPriceBusinessText(value) });
  };
  add('工艺类型', item.craft ? { PARTIAL: '局部烫金', FULL: '专版烫金', PRINT: '彩印' }[item.craft] : null);
  add('产品结构', { UNSPECIFIED: '', STANDARD_ENVELOPE: '普通封', WESTERN_ENVELOPE: '西封', TEN_THOUSAND_ENVELOPE: '万元封' }[item.productStructure]);
  add('规格', item.specification);
  if (item.actualWidthMm != null && item.actualHeightMm != null) {
    add('实际尺寸', `${item.actualWidthMm.toString()} × ${item.actualHeightMm.toString()} mm`);
  }
  add('纸张', formatPaper(item.paperType, item.paperWeightGsm));
  add('稿件版本', item.artworkVersion);
  add('烫金方式', { UNSPECIFIED: '', NONE: '不烫金', FLAT: '平烫', RELIEF: '浮雕', RAISED: '激凸' }[item.foilTechnique]);
  const foil = resolveOrderItemFoilSides(item);
  if (foil.frontFoilColors.length || foil.backFoilColors.length) {
    add('正面烫金', foil.frontFoilColors.map(foilColorLabel).join('、') || '不烫金');
    add('反面烫金', foil.backFoilColors.map(foilColorLabel).join('、') || '不烫金');
  }
  if (item.craft === 'PRINT' || item.pricingRoute === 'COLOR_PRINT') {
    add('彩印颜色', item.printColorsKnown ? (item.printColors.join('、') || '无') : '未记录');
    if (item.hasLocalFoil != null) add('局部烫金', item.hasLocalFoil ? '是' : '否');
  }
  if (item.lamination && (item.lamination !== 'NONE' || item.craft === 'PRINT' || item.pricingRoute === 'COLOR_PRINT')) {
    add('覆膜', { NONE: '不覆膜', MATTE: '覆哑膜', SOFT_TOUCH: '触感膜', NEW_GLOSS: '新光膜', LASER: '镭射膜' }[item.lamination]);
  }
  if (legacyPackaging && item.pack != null) add('每袋数量', `${item.pack} 个`);
  return details;
}

function money(value: { toString(): string }): string {
  return new Decimal(value.toString()).toFixed(2);
}
