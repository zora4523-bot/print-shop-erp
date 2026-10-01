import { flushSync } from 'react-dom';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { page } from 'vitest/browser';
import '@/app/globals.css';

const mocks = vi.hoisted(() => ({ correct: vi.fn() }));
vi.mock('@/actions/settled-order-correction', () => ({ correctSettledOrderAction: mocks.correct }));

import { correctedSettledFee, SettledOrderCorrectionForm } from '../SettledOrderCorrectionForm';

const props = { orderId: 'order-1', orderRevision: 7, settledFee: '199.80', minimumSettledFee: '150.00', inDraftBill: true };
let host: HTMLDivElement; let root: Root;
beforeEach(() => {
  vi.resetAllMocks();
  host = document.createElement('div');
  host.className = 'admin-viewport bg-background p-4 text-foreground';
  document.body.append(host);
  root = createRoot(host);
});
afterEach(() => { flushSync(() => root.unmount()); host.remove(); });
function render(value = props) { flushSync(() => root.render(<SettledOrderCorrectionForm {...value} />)); }
async function open() {
  const summary = host.querySelector('summary')!;
  expect(summary.textContent).toContain('结算更正');
  await page.elementLocator(summary).click();
}

it('computes the corrected amount and refuses zero, malformed input and results below the processing fee', () => {
  expect(correctedSettledFee('199.80', '-20', '150.00')?.toFixed(2)).toBe('179.80');
  expect(correctedSettledFee('199.80', '15.5', '150.00')?.toFixed(2)).toBe('215.30');
  expect(correctedSettledFee('199.80', '-49.80', '150.00')?.toFixed(2)).toBe('150.00');
  expect(correctedSettledFee('199.80', '-49.81', '150.00')).toBeNull();
  expect(correctedSettledFee('199.80', '0', '150.00')).toBeNull();
  expect(correctedSettledFee('199.80', '1.234', '150.00')).toBeNull();
  expect(correctedSettledFee('199.80', 'abc', '150.00')).toBeNull();
});

it('keeps the action disabled with a reason until a valid amount is entered', async () => {
  render(); await open();
  await expect.element(page.getByRole('button', { name: '更正结算金额' })).toBeDisabled();
  await page.getByRole('textbox').fill('-60');
  await expect.element(page.getByRole('button', { name: '更正结算金额' })).toBeDisabled();
  await page.getByRole('textbox').fill('-20');
  await expect.element(page.getByRole('button', { name: '更正结算金额' })).toBeEnabled();
});

it('shows before → after, requires a reason, and sends the signed amount with a stable request key', async () => {
  mocks.correct.mockResolvedValue({ status: 'success', settledFee: '179.80', message: '已更正，结算金额 179.80 元，草稿账单已按新金额更新' });
  render(); await open();
  await page.getByRole('textbox').fill('-20');
  await page.getByRole('button', { name: '更正结算金额' }).click();
  const dialog = page.getByRole('alertdialog', { name: '更正结算金额' });
  await expect.element(dialog.getByRole('definition')).toHaveTextContent(/199\.80.*→.*179\.80/);
  await expect.element(dialog).toHaveTextContent(/另记一行「结算更正」-¥\s?20\.00，原收费明细不变/);
  await expect.element(dialog).toHaveTextContent('本单所在的草稿月账单按新金额更新');
  await expect.element(dialog.getByRole('button', { name: '更正结算金额' })).toBeDisabled();
  await dialog.getByRole('textbox', { name: '更正原因' }).fill('运费多收');
  await dialog.getByRole('button', { name: '更正结算金额' }).click();
  await vi.waitFor(() => expect(mocks.correct).toHaveBeenCalledTimes(1));
  expect(mocks.correct.mock.calls[0][0]).toEqual({
    orderId: 'order-1', expectedRevision: 7, amount: '-20', reason: '运费多收', idempotencyKey: expect.any(String),
  });
  await expect.element(page.getByRole('status')).toHaveTextContent('草稿账单已按新金额更新');
});

it('announces a server refusal as an alert and keeps the typed amount', async () => {
  mocks.correct.mockResolvedValue({ status: 'error', message: '本单所在月账单已确认，请在账单里录入抵扣或补收' });
  render({ ...props, inDraftBill: false }); await open();
  await page.getByRole('textbox').fill('5');
  await page.getByRole('button', { name: '更正结算金额' }).click();
  const dialog = page.getByRole('alertdialog');
  await expect.element(dialog).toHaveTextContent('生成月账单时按更正后金额入账');
  await dialog.getByRole('textbox', { name: '更正原因' }).fill('少收包装费');
  await dialog.getByRole('button', { name: '更正结算金额' }).click();
  await expect.element(page.getByRole('alert')).toHaveTextContent('请在账单里录入抵扣或补收');
  await expect.element(page.getByRole('textbox')).toHaveValue('5');
});
