import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { PrintOrder } from '../print-types';

const m = vi.hoisted(() => ({
  transaction: vi.fn(), order: vi.fn(), setting: vi.fn(), record: vi.fn(), findUnique: vi.fn(),
  PrintJobError: class extends Error {
    constructor(public readonly code: string, message: string) { super(message); }
  },
}));
vi.mock('../../db', () => ({ db: { $transaction: m.transaction } }));
vi.mock('../print-view', () => ({ getOrderForPrint: m.order }));
vi.mock('../../settings', () => ({ getSetting: m.setting }));
vi.mock('../print-jobs', () => ({ recordRenderedPrintInTx: m.record, OrderPrintJobError: m.PrintJobError }));

import { orderPdfSnapshotKey, orderPrintInstructionKey } from '../../pdf/order-snapshot';
import { newPrintPageAttempt, recordPdfDownload, recordPrintPage } from '../print-record';

const admin = { id: 'admin-1', role: 'ADMIN' as const };
function printed(worker: string, completedQty = 0): PrintOrder {
  return {
    id: 'order-1', orderNo: 'GD-1', workOrderVersion: 3, status: 'RELEASED', hasPendingChange: false, orderQrSvg: '<svg/>',
    items: [{ id: 'item-1', designs: [] }], packagingGroups: [], shipments: [],
    productionSteps: [{ id: 'step-1', source: 'OPERATION', craftName: '烫金', scopeLabel: `生产师傅：${worker}`, plannedQty: 1000, completedQty, defectQty: 0, completedAt: null }],
  } as unknown as PrintOrder;
}

beforeEach(() => {
  vi.resetAllMocks();
  m.transaction.mockImplementation(async (callback: (tx: unknown) => unknown) => callback('tx'));
  m.setting.mockResolvedValue({ name: '工厂' });
  m.record.mockImplementation(async (_tx: unknown, _attempt: unknown, _actor: unknown, contentIsCurrent: () => Promise<boolean>) =>
    (await contentIsCurrent()) ? 'MARKED' : 'STALE');
});

// 业主 2026-10-02「点打印即记已打印」：打印页带着本页生产指令摘要与一次性尝试标识，记录时锁内重新比较。
describe('print page recording', () => {
  it('binds the rendered instructions and a fresh attempt per render', () => {
    const first = newPrintPageAttempt(printed('张师傅'), '工厂');
    const second = newPrintPageAttempt(printed('张师傅'), '工厂');
    expect(first).toMatchObject({ orderId: 'order-1', workOrderVersion: 3, contentKey: orderPrintInstructionKey(printed('张师傅'), '工厂') });
    expect(first.attemptKey).toMatch(/^print-page:[0-9a-f-]{36}$/);
    expect(second.attemptKey).not.toBe(first.attemptKey);
  });

  it('records when only production progress moved since the page was opened', async () => {
    const attempt = newPrintPageAttempt(printed('张师傅'), '工厂');
    m.order.mockResolvedValue(printed('张师傅', 600));
    await expect(recordPrintPage(attempt, admin, 'https://erp.example')).resolves.toBe('MARKED');
    // 与加锁同一事务连接读取。
    expect(m.order).toHaveBeenCalledWith('order-1', admin, 'https://erp.example', 'tx');
    expect(m.setting).toHaveBeenCalledWith('factory_name', 'tx');
    expect(m.record).toHaveBeenCalledWith('tx', attempt, admin, expect.any(Function));
  });

  it.each([
    ['the production worker changed', printed('李师傅')],
    ['the order is no longer printable for this account', null],
  ])('does not record when %s', async (_label, current) => {
    m.order.mockResolvedValue(current);
    await expect(recordPrintPage(newPrintPageAttempt(printed('张师傅'), '工厂'), admin, 'https://erp.example')).resolves.toBe('STALE');
  });
});

/**
 * 业主 2026-10-22「下载 PDF 也记已打印」：浏览器取得文件后回调，比的是文件本身那份完整快照
 * （与下载接口同一标准），不是打印页的生产指令摘要——PDF 印出整份内容，进度变化也会让文件不同。
 */
describe('pdf download recording', () => {
  const tx = { order: { findUnique: m.findUnique } };
  const snapshot = (order: PrintOrder) => orderPdfSnapshotKey(order, '工厂');

  beforeEach(() => {
    m.transaction.mockImplementation(async (callback: (client: unknown) => unknown) => callback(tx));
    m.findUnique.mockResolvedValue({ workOrderVersion: 3 });
  });

  it('records the downloaded file against the current version read inside the lock', async () => {
    const file = printed('张师傅');
    m.order.mockResolvedValue(file);
    await expect(recordPdfDownload(
      { orderId: 'order-1', contentKey: snapshot(file), attemptId: '11111111-2222-4333-8444-555555555555' },
      admin,
      'https://erp.example',
    )).resolves.toBe('MARKED');
    expect(m.record).toHaveBeenCalledWith(
      tx,
      { orderId: 'order-1', workOrderVersion: 3, attemptKey: 'pdf-download:11111111-2222-4333-8444-555555555555' },
      admin,
      expect.any(Function),
    );
    // 与加锁同一事务连接读取，不另占连接池。
    expect(m.order).toHaveBeenCalledWith('order-1', admin, 'https://erp.example', tx);
    expect(m.setting).toHaveBeenCalledWith('factory_name', tx);
  });

  it('reuses one attempt so retrying a download only replays that attempt', async () => {
    const file = printed('张师傅');
    m.order.mockResolvedValue(file);
    const attempt = { orderId: 'order-1', contentKey: snapshot(file), attemptId: '11111111-2222-4333-8444-555555555555' };
    await recordPdfDownload(attempt, admin, 'https://erp.example');
    await recordPdfDownload(attempt, admin, 'https://erp.example');
    const keys = m.record.mock.calls.map((call) => (call[1] as { attemptKey: string }).attemptKey);
    expect(new Set(keys).size).toBe(1);
  });

  it.each([
    ['production progress moved after the file was fetched', printed('张师傅', 600)],
    ['the production worker changed', printed('李师傅')],
    ['the order is no longer readable for this account', null],
  ])('does not record when %s', async (_label, current) => {
    m.order.mockResolvedValue(current);
    await expect(recordPdfDownload(
      { orderId: 'order-1', contentKey: snapshot(printed('张师傅')), attemptId: '11111111-2222-4333-8444-555555555555' },
      admin,
      'https://erp.example',
    )).resolves.toBe('STALE');
  });

  it('refuses when the order disappeared before the record landed', async () => {
    m.findUnique.mockResolvedValue(null);
    await expect(recordPdfDownload(
      { orderId: 'order-1', contentKey: 'a'.repeat(64), attemptId: '11111111-2222-4333-8444-555555555555' },
      admin,
      'https://erp.example',
    )).rejects.toThrow('工单不存在');
    expect(m.record).not.toHaveBeenCalled();
  });
});
