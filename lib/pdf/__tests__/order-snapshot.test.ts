import { describe, expect, it } from 'vitest';
import type { PrintOrder } from '../../order/print-types';
import { orderPdfSnapshotKey, orderPrintInstructionKey } from '../order-snapshot';
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

// 业主 2026-10-02「点打印即记已打印」：纸面生产指令变了才算不同的纸；随生产推进的进度、
// 纸上不印的字段都不算。
describe('print instruction identity', () => {
  const step = (scopeLabel = '生产师傅：张师傅', progress: Partial<PrintOrder['productionSteps'][number]> = {}) => ({
    id: 'step-1', source: 'OPERATION' as const, craftName: '烫金', scopeLabel, plannedQty: 1000,
    completedQty: 0, defectQty: 0, completedAt: null, ...progress,
  });
  function printed(overrides: Partial<PrintOrder> = {}, design = 'https://bucket/design/a.png?Signature=old&Expires=1&OSSAccessKeyId=a'): PrintOrder {
    return {
      id: 'order-1', orderNo: 'GD-1', workOrderVersion: 3, kind: 'NORMAL', isUrgent: false, isSfCollect: false,
      createdAt: new Date('2026-10-01'), status: 'RELEASED', hasPendingChange: false, orderQrSvg: '<svg>http://a</svg>',
      items: [{ id: 'item-1', sequence: 1, name: '款式一', quantity: 1000, remark: '内部备注',
        designs: [{ id: 'design-1', fileType: 'IMAGE', fileUrl: design }, { id: 'cdr-1', fileType: 'CDR', fileUrl: 'https://bucket/cdr/a.cdr' }] }],
      packagingGroups: [],
      shipments: [{ id: 'ship-1', sequence: 1, receiverName: '王女士', receiverPhone: '13800000000', receiverAddress: '深圳', trackingNo: null, lines: [] }],
      productionSteps: [step()],
      ...overrides,
    } as unknown as PrintOrder;
  }
  const key = (order: PrintOrder) => orderPrintInstructionKey(order, '工厂');

  it('ignores progress, status, pending-change tag, QR rendering, signing credentials and fields the paper does not show', () => {
    const base = key(printed());
    const sameItems = printed({}, 'https://bucket/design/a.png?Signature=new&Expires=2&OSSAccessKeyId=a').items;
    expect(key(printed({
      status: 'FOILING', hasPendingChange: true, orderQrSvg: '<svg>http://b</svg>',
      items: sameItems.map((item) => ({ ...item, remark: '改了内部备注', designs: item.designs.map((d) => d.fileType === 'CDR' ? { ...d, fileUrl: 'https://bucket/cdr/b.cdr' } : d) })),
      shipments: [{ id: 'ship-1', sequence: 1, receiverName: '王女士', receiverPhone: '13800000000', receiverAddress: '深圳', trackingNo: 'ZT123', lines: [] }],
      productionSteps: [step('生产师傅：张师傅', { completedQty: 600, defectQty: 3, completedAt: new Date('2026-10-02') })],
    }))).toBe(base);
  });

  it('changes when the printed instructions change', () => {
    const base = key(printed());
    expect(key(printed({ productionSteps: [step('生产师傅：李师傅')] }))).not.toBe(base);
    expect(key(printed({ productionSteps: [{ ...step(), plannedQty: 1200 }] }))).not.toBe(base);
    expect(key(printed({ workOrderVersion: 4 }))).not.toBe(base);
    expect(key(printed({}, 'https://bucket/design/b.png'))).not.toBe(base);
    expect(key(printed({ shipments: [{ id: 'ship-1', sequence: 1, receiverName: '王女士', receiverPhone: '13800000000', receiverAddress: '广州', trackingNo: null, lines: [] }] }))).not.toBe(base);
    expect(key(printed({ remark: '加急：先做第一款' }))).not.toBe(base);
    expect(orderPrintInstructionKey(printed(), '新工厂')).not.toBe(base);
  });
});
