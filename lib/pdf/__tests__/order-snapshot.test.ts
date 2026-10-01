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

// 业主 2026-10-02「点打印即记已打印」：纸面生产指令变了才算不同的纸，随生产推进的进度不算。
describe('print instruction identity', () => {
  function printed(overrides: Partial<PrintOrder> = {}): PrintOrder {
    return {
      ...fixture('https://bucket/design/a.png?Signature=old&Expires=1&OSSAccessKeyId=a'),
      status: 'RELEASED', hasPendingChange: false, orderQrSvg: '<svg>http://a</svg>',
      productionSteps: [{ id: 'step-1', source: 'OPERATION', craftName: '烫金', scopeLabel: '生产师傅：张师傅', plannedQty: 1000, completedQty: 0, defectQty: 0, completedAt: null }],
      ...overrides,
    } as PrintOrder;
  }
  const key = (order: PrintOrder) => orderPrintInstructionKey(order, '工厂');

  it('ignores production progress, status, pending-change tag, QR rendering and signing credentials', () => {
    const base = key(printed());
    expect(key(printed({
      status: 'FOILING', hasPendingChange: true, orderQrSvg: '<svg>http://b</svg>',
      items: fixture('https://bucket/design/a.png?Signature=new&Expires=2&OSSAccessKeyId=a').items,
      productionSteps: [{ id: 'step-1', source: 'OPERATION', craftName: '烫金', scopeLabel: '生产师傅：张师傅', plannedQty: 1000, completedQty: 600, defectQty: 3, completedAt: new Date('2026-10-02') }],
    }))).toBe(base);
  });

  it('changes when the paper instructions change', () => {
    const base = key(printed());
    expect(key(printed({ productionSteps: [{ id: 'step-1', source: 'OPERATION', craftName: '烫金', scopeLabel: '生产师傅：李师傅', plannedQty: 1000, completedQty: 0, defectQty: 0, completedAt: null }] }))).not.toBe(base);
    expect(key(printed({ productionSteps: [{ id: 'step-1', source: 'OPERATION', craftName: '烫金', scopeLabel: '生产师傅：张师傅', plannedQty: 1200, completedQty: 0, defectQty: 0, completedAt: null }] }))).not.toBe(base);
    expect(key(printed({ workOrderVersion: 4 }))).not.toBe(base);
    expect(key(printed({ items: fixture('https://bucket/design/b.png').items }))).not.toBe(base);
    expect(orderPrintInstructionKey(printed(), '新工厂')).not.toBe(base);
  });
});
