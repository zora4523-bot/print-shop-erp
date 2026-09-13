import { describe, expect, it } from 'vitest';
import type { PrintOrder } from '../../order/print-types';
import { orderPdfSnapshotKey } from '../order-snapshot';
function fixture(url: string): PrintOrder {
  // Minimal projection exercises hashing, not the renderer's DTO contract.
  return { id: 'order-1', workOrderVersion: 3, items: [{ id: 'item-1', designs: [{ id: 'design-1', fileUrl: url }] }] } as PrintOrder;
}
describe('PDF snapshot identity', () => {
  it('ignores only rotating OSS signing credentials', () => {
    expect(orderPdfSnapshotKey(fixture('https://bucket/design/a.png?Signature=old&Expires=1&OSSAccessKeyId=a'), '工厂'))
      .toBe(orderPdfSnapshotKey(fixture('https://bucket/design/a.png?Signature=new&Expires=2&OSSAccessKeyId=a'), '工厂'));
  });
  it('retains image identity, transformations, version and factory changes', () => {
    const first = orderPdfSnapshotKey(fixture('https://bucket/design/a.png?width=80'), '工厂');
    for (const url of ['https://bucket/design/b.png?width=80', 'https://bucket/design/a.png?width=90']) {
      expect(orderPdfSnapshotKey(fixture(url), '工厂')).not.toBe(first);
    }
    expect(orderPdfSnapshotKey(fixture('https://bucket/design/a.png?width=80'), '新工厂')).not.toBe(first);
    expect(orderPdfSnapshotKey({ ...fixture('https://bucket/design/a.png?width=80'), workOrderVersion: 4 }, '工厂')).not.toBe(first);
  });
});
