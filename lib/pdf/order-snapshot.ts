import { createHash } from 'node:crypto';
import type { PrintOrder } from '../order/print-types';

/** Signing timestamps rotate without changing the underlying design object. */
export function orderPdfSnapshotKey(order: PrintOrder, factoryName: string): string {
  // 修订号不是打印内容（任何保存都会改它），不进摘要，已有 PDF 缓存与批量打印任务键保持不变。
  const { revision: _revision, ...content } = order;
  void _revision;
  const snapshot = {
    templateVersion: 7, // Header shows the external salesperson; empty flow section omitted (2026-09-27).
    order: {
      ...content,
      items: order.items.map((item) => ({
        ...item,
        designs: item.designs.map((design) => ({ ...design, fileUrl: stableDesignUrl(design.fileUrl) })),
      })),
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
