import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { PrintOrder } from '../print-types';

const m = vi.hoisted(() => ({ transaction: vi.fn(), order: vi.fn(), setting: vi.fn(), record: vi.fn() }));
vi.mock('../../db', () => ({ db: { $transaction: m.transaction } }));
vi.mock('../print-view', () => ({ getOrderForPrint: m.order }));
vi.mock('../../settings', () => ({ getSetting: m.setting }));
vi.mock('../print-jobs', () => ({ recordRenderedPrintInTx: m.record }));

import { orderPrintInstructionKey } from '../../pdf/order-snapshot';
import { newPrintPageAttempt, recordPrintPage } from '../print-record';

const admin = { id: 'admin-1', role: 'ADMIN' as const };
function printed(worker: string, completedQty = 0): PrintOrder {
  return {
    id: 'order-1', workOrderVersion: 3, status: 'RELEASED', hasPendingChange: false, orderQrSvg: '<svg/>',
    items: [{ id: 'item-1', designs: [] }],
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
    expect(m.order).toHaveBeenCalledWith('order-1', admin, 'https://erp.example');
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
