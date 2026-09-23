import type { ComponentProps } from 'react';
import { flushSync } from 'react-dom';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { page } from 'vitest/browser';
import '@/app/globals.css';
const mocks = vi.hoisted(() => ({ operation: vi.fn(), progress: vi.fn() }));
vi.mock('@/actions/production-operations', () => ({ reportProductionOperationAction: mocks.operation, reportProductionProgressAction: mocks.progress }));
vi.mock('next/link', () => ({ __esModule: true, default: ({ prefetch, ...props }: ComponentProps<'a'> & { prefetch?: boolean }) => { void prefetch; return <a {...props} />; } }));
import { OperationReportForm, ProgressReportForm } from '../OperationReportForm';
let host: HTMLDivElement; let root: Root;
beforeEach(() => {
  vi.resetAllMocks();
  mocks.operation.mockResolvedValue({ status: 'success', reportId: 'r1', amount: '12.00', idempotentReplay: false });
  mocks.progress.mockResolvedValue({ status: 'success', reportId: 'r2', idempotentReplay: false });
  host = document.createElement('div'); host.className = 'worker-viewport p-4'; document.body.append(host); root = createRoot(host);
});
afterEach(() => { flushSync(() => root.unmount()); host.remove(); });
it.each(['operation', 'progress'] as const)('%s keeps the batch on refresh and exposes an explicit next batch', async kind => {
  const mount = (batch: number) => flushSync(() => root.render(kind === 'operation'
    ? <OperationReportForm key={batch} operationId="op-1" payrollRevision={0} rateKey="rate" idempotencyKey={`batch:${batch}`} remainingQty="1000" workOrderProgressRemainingQty="1000" />
    : <ProgressReportForm key={batch} progressStepId="op-1" idempotencyKey={`batch:${batch}`} remainingQty="1000" />));
  mount(0);
  await expect.element(page.getByRole('link', { name: '再报一批' })).toHaveAttribute('href', '/worker/tasks/op-1?reportBatch=1');
  await page.getByRole('spinbutton', { name: '本次合格完成数' }).fill('100');
  if (kind === 'operation') await page.getByRole('spinbutton', { name: '本次工单件数进度' }).fill('100');
  await page.getByRole('button', { name: '提交扫码报工' }).click();
  await expect.element(page.getByRole('heading', { name: '核对本次报工' })).toBeVisible();
  expect(mocks[kind]).not.toHaveBeenCalled();
  await page.getByRole('button', { name: '确认报工' }).click();
  await vi.waitFor(() => expect(mocks[kind]).toHaveBeenCalledTimes(1));
  expect((mocks[kind].mock.calls[0][2] as FormData).get('idempotencyKey')).toBe('batch:0');
  mount(0);
  expect(host.querySelector<HTMLInputElement>('[name="idempotencyKey"]')!.value).toBe('batch:0');
  mount(1);
  expect(host.querySelector<HTMLInputElement>('[name="idempotencyKey"]')!.value).toBe('batch:1');
  await expect.element(page.getByRole('link', { name: '再报一批' })).toHaveAttribute('href', '/worker/tasks/op-1?reportBatch=2');
});
// 同一批次同量重提被服务端识别为重复时，不能再显示“已记录本次报工”，要告诉师傅
// 这批已经记过、没有重复计入，以及新的一批怎么报（审计 M-2）。
it.each(['operation', 'progress'] as const)('%s tells the worker a repeated batch was not counted again', async kind => {
  mocks.operation.mockResolvedValue({ status: 'success', reportId: 'r1', amount: '12.00', idempotentReplay: true });
  mocks.progress.mockResolvedValue({ status: 'success', reportId: 'r2', idempotentReplay: true });
  flushSync(() => root.render(kind === 'operation'
    ? <OperationReportForm operationId="op-1" payrollRevision={0} rateKey="rate" idempotencyKey="batch:0" remainingQty="1000" workOrderProgressRemainingQty="1000" />
    : <ProgressReportForm progressStepId="op-1" idempotencyKey="batch:0" remainingQty="1000" />));
  await page.getByRole('spinbutton', { name: '本次合格完成数' }).fill('100');
  if (kind === 'operation') await page.getByRole('spinbutton', { name: '本次工单件数进度' }).fill('100');
  await page.getByRole('button', { name: '提交扫码报工' }).click();
  await page.getByRole('button', { name: '确认报工' }).click();
  const status = page.getByRole('status');
  await expect.element(status).toHaveTextContent('这一批已经记录过，本次没有重复计入。如果是新的一批，请点“再报一批”后重新填写。');
  await expect.element(status).not.toHaveTextContent('已记录本次');
  await expect.element(page.getByRole('link', { name: '再报一批' })).toHaveAttribute('href', '/worker/tasks/op-1?reportBatch=1');
});
