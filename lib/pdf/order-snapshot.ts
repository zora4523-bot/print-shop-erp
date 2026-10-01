import { createHash } from 'node:crypto';
import type { PrintOrder } from '../order/print-types';

/** Signing timestamps rotate without changing the underlying design object. */
export function orderPdfSnapshotKey(order: PrintOrder, factoryName: string): string {
  const snapshot = {
    templateVersion: 7, // Header shows the external salesperson; empty flow section omitted (2026-09-27).
    order: {
      ...order,
      items: order.items.map((item) => ({
        ...item,
        designs: item.designs.map((design) => ({ ...design, fileUrl: stableDesignUrl(design.fileUrl) })),
      })),
    },
    factoryName,
  };
  return createHash('sha256').update(JSON.stringify(snapshot)).digest('hex');
}

/**
 * 纸面工单的生产指令摘要（业主 2026-10-02「点打印即记已打印」）。只取打印模板
 * （lib/order/print-layout.tsx）实际印在纸上、且不随生产推进变化的字段：工单抬头、交期与收货、
 * 款式规格与工艺、设计图、分袋、各收货地址、生产工序与负责师傅及计划数量。不含工单状态、
 * 待审批标记、完成 / 不良数量与日期（进度），也不含纸上不印的运单号、CDR 文件、款式备注、
 * 二维码图形（二维码内容由工单号与版本决定，已在摘要内）。打印页渲染时与记录时的摘要一致，
 * 纸上的生产指令才是当前内容。改模板显示的字段时须同步这里。
 */
export function orderPrintInstructionKey(order: PrintOrder, factoryName: string): string {
  const instructions = {
    orderNo: order.orderNo,
    workOrderVersion: order.workOrderVersion,
    simpleProduction: order.simpleProduction ?? false,
    customName: order.customName ?? null,
    kind: order.kind,
    sourceOrderNo: order.sourceOrderNo ?? null,
    isUrgent: order.isUrgent,
    isSfCollect: order.isSfCollect,
    promisedDate: order.promisedDate ?? null,
    externalSalesName: order.externalSalesName ?? null,
    receiverName: order.receiverName ?? null,
    receiverPhone: order.receiverPhone ?? null,
    receiverAddress: order.receiverAddress ?? null,
    expressCode: order.expressCode ?? null,
    packageRequirement: order.packageRequirement ?? null,
    remark: order.remark ?? null,
    submittedAt: order.submittedAt ?? null,
    createdAt: order.createdAt,
    items: order.items.map((item) => ({
      id: item.id, sequence: item.sequence, name: item.name, artworkVersion: item.artworkVersion ?? null,
      specification: item.specification ?? null, paperType: item.paperType ?? null, paperWeightGsm: item.paperWeightGsm ?? null,
      quantity: item.quantity, frontFoilColors: item.frontFoilColors, backFoilColors: item.backFoilColors,
      foilColors: item.foilColors, foilTechnique: item.foilTechnique, hasLocalFoil: item.hasLocalFoil,
      lamination: item.lamination, printColors: item.printColors, printColorsKnown: item.printColorsKnown,
      craftNames: item.craftNames,
      designs: item.designs.filter((design) => design.fileType === 'IMAGE')
        .map((design) => ({ id: design.id, fileUrl: stableDesignUrl(design.fileUrl) })),
    })),
    packagingGroups: order.packagingGroups.map((group) => ({
      id: group.id, sequence: group.sequence, mode: group.mode, actualBagCount: group.actualBagCount,
      lines: group.lines.map((line) => ({ orderItemId: line.orderItemId, unitsPerBag: line.unitsPerBag })),
    })),
    shipments: order.shipments.map((shipment) => ({
      id: shipment.id, sequence: shipment.sequence, receiverName: shipment.receiverName ?? null,
      receiverPhone: shipment.receiverPhone ?? null, receiverAddress: shipment.receiverAddress ?? null,
      expressCode: shipment.expressCode ?? null, carrierCode: shipment.carrierCode ?? null,
    })),
    productionSteps: order.productionSteps.map((step) => ({
      id: step.id, source: step.source, itemSequence: step.itemSequence ?? null, itemName: step.itemName ?? null,
      scopeLabel: step.scopeLabel ?? null, quantityUnit: step.quantityUnit ?? null, craftName: step.craftName,
      plannedQty: step.plannedQty,
    })),
  };
  return createHash('sha256').update(JSON.stringify({ templateVersion: 7, instructions, factoryName })).digest('hex');
}

function stableDesignUrl(value: string): string {
  try {
    const url = new URL(value);
    if (url.searchParams.has('Signature') && url.searchParams.has('OSSAccessKeyId')) {
      for (const key of ['Signature', 'Expires', 'OSSAccessKeyId', 'security-token']) url.searchParams.delete(key);
    }
    return url.toString();
  } catch { return value; }
}
