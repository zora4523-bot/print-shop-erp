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
 * 纸面工单的生产指令摘要（业主 2026-10-02「点打印即记已打印」）。与 PDF 快照同源，但不含随生产
 * 推进变化的进度——工单状态、待审批标记、各工序完成 / 不良数量与完成日期——也不含按访问地址
 * 渲染的二维码图形（二维码内容由工单号与版本决定，已在摘要内）。打印页渲染时与记录时的摘要一致，
 * 纸上的生产指令（款式、规格、生产师傅、包装、收货等）才是当前内容。
 */
export function orderPrintInstructionKey(order: PrintOrder, factoryName: string): string {
  const { status, hasPendingChange, orderQrSvg, productionSteps, ...instructions } = order;
  void status; void hasPendingChange; void orderQrSvg;
  const snapshot = {
    templateVersion: 7,
    order: {
      ...instructions,
      items: instructions.items.map((item) => ({
        ...item,
        designs: item.designs.map((design) => ({ ...design, fileUrl: stableDesignUrl(design.fileUrl) })),
      })),
      productionSteps: productionSteps.map(({ completedQty, defectQty, completedAt, ...step }) => {
        void completedQty; void defectQty; void completedAt;
        return step;
      }),
    },
    factoryName,
  };
  return createHash('sha256').update(JSON.stringify(snapshot)).digest('hex');
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
