import { createHash } from 'node:crypto';
import type { PrintOrder } from '../order/print-types';

/** Signing timestamps rotate without changing the underlying design object. */
export function orderPdfSnapshotKey(order: PrintOrder, factoryName: string): string {
  const snapshot = {
    templateVersion: 8, // Long specification/design strings wrap within A4; invalidate v7 PDFs (2026-10-02).
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

function stableDesignUrl(value: string): string {
  try {
    const url = new URL(value);
    if (url.searchParams.has('Signature') && url.searchParams.has('OSSAccessKeyId')) {
      for (const key of ['Signature', 'Expires', 'OSSAccessKeyId', 'security-token']) url.searchParams.delete(key);
    }
    return url.toString();
  } catch { return value; }
}
