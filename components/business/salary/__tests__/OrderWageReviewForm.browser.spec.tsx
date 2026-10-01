import type { ComponentProps } from 'react';
import { flushSync } from 'react-dom';
import Decimal from 'decimal.js';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, expect, it, vi } from 'vitest';
import { page } from 'vitest/browser';
import { formatMoney, formatMoneyDelta } from '@/lib/dashboard/format';
import '@/app/globals.css';

const { save } = vi.hoisted(() => ({ save: vi.fn().mockResolvedValue({ status: 'success', message: '已核定' }) }));
vi.mock('@/actions/order-wage-review', () => ({ reviewOrderWagesAction: save }));
import { OrderWageReviewForm } from '../OrderWageReviewForm';
let root: Root;
let host: HTMLDivElement;
afterEach(() => { root.unmount(); host.remove(); save.mockClear(); });

it.each(['12.50', '-8.00', '0.00'])('previews the actual residual adjustment %s without posting before confirmation', async (amount) => {
  const wage: ComponentProps<typeof OrderWageReviewForm>['wage'] = {
    id: 'operation-1', orderId: 'order-1', type: 'PARTIAL', revision: 'a'.repeat(64), reviewRequired: true,
    groups: [{ anchorId: 'report-1', reporterId: 'worker-1', name: '张师傅', date: '2026-10-01',
      amount, quantity: '0', voided: true, settled: false, editable: false, voidedAdjustmentDelta: new Decimal(amount).negated().toFixed(2) }],
  };
  host = document.createElement('div'); document.body.append(host); root = createRoot(host);
  flushSync(() => root.render(<OrderWageReviewForm wage={wage} />));
  expect(host.textContent).not.toContain('抵消已作废报工的人工调整');
  await expect.element(page.getByRole('textbox', { name: '张师傅 2026-10-01 核定提成' })).toHaveAttribute('readonly');
  await page.getByRole('textbox', { name: '核定原因' }).fill('核对原报工');
  await page.getByRole('button', { name: '核对提成' }).click();
  await expect.element(page.getByRole('heading', { name: '核定工单提成' })).toBeVisible();
  expect(host.textContent).toContain(`${formatMoney(amount)} → ${formatMoney(0)}（差额 ${formatMoneyDelta(-Number(amount))}）`);
  expect(host.textContent?.includes('抵消已作废报工的人工调整')).toBe(amount !== '0.00');
  expect(save).not.toHaveBeenCalled();
  await page.getByRole('button', { name: '返回修改' }).click();
  expect(save).not.toHaveBeenCalled();
  await page.getByRole('button', { name: '核对提成' }).click();
  await page.getByRole('button', { name: '保存核定' }).click();
  await expect.poll(() => save.mock.calls.length).toBe(1);
  // 服务端接收原金额作并发校验，依据已作废的报工冲正残余调整。
  expect((save.mock.calls[0]![1] as FormData).get('amount')).toBe(amount);
});

it('preserves the original and reversal day amounts when previewing an adjustment across days', async () => {
  const wage: ComponentProps<typeof OrderWageReviewForm>['wage'] = {
    id: 'operation-1', orderId: 'order-1', type: 'PARTIAL', revision: 'a'.repeat(64), reviewRequired: true,
    groups: [
      { anchorId: 'report-1', reporterId: 'worker-1', name: '张师傅', date: '2026-09-30', amount: '19.00', quantity: '1000', voided: true, settled: false, editable: false, voidedAdjustmentDelta: '5.00' },
      { anchorId: 'reversal-1', reporterId: 'worker-1', name: '张师傅', date: '2026-10-01', amount: '-24.00', quantity: '-1000', voided: true, settled: false, editable: false, voidedAdjustmentDelta: '0.00' },
    ],
  };
  host = document.createElement('div'); document.body.append(host); root = createRoot(host);
  flushSync(() => root.render(<OrderWageReviewForm wage={wage} />));
  await page.getByRole('textbox', { name: '核定原因' }).fill('核对跨日报工');
  await page.getByRole('button', { name: '核对提成' }).click();
  expect(host.textContent).toContain(`${formatMoney(19)} → ${formatMoney(24)}（差额 ${formatMoneyDelta(5)}）`);
  expect(host.textContent).toContain(`${formatMoney(-24)} → ${formatMoney(-24)}（差额 ${formatMoneyDelta(0)}）`);
  expect(host.textContent?.match(/抵消已作废报工的人工调整/g)).toHaveLength(1);
  await page.getByRole('button', { name: '保存核定' }).click();
  await expect.poll(() => save.mock.calls.length).toBe(1);
  expect((save.mock.calls[0]![1] as FormData).getAll('amount')).toEqual(['19.00', '-24.00']);
});
