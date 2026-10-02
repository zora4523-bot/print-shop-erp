import { flushSync } from 'react-dom';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { page } from 'vitest/browser';
import '@/app/globals.css';

const action = vi.hoisted(() => vi.fn(async () => ({ ok: true, message: '已登记完成' })));
vi.mock('@/actions/production-dispatch', () => ({ registerProductionCompletionAction: action }));

const { WorkerQuickComplete } = await import('../WorkerQuickComplete');
const { CompletionRegistrationForm } = await import('../CompletionRegistrationForm');

let host: HTMLDivElement;
let root: Root;
beforeEach(() => {
  document.documentElement.lang = 'zh-CN';
  host = document.createElement('div');
  host.className = 'mx-auto max-w-xl p-4';
  document.body.append(host);
  root = createRoot(host);
  action.mockClear();
});
afterEach(() => {
  flushSync(() => root.unmount());
  host.remove();
});

const job = { id: 'job-1', revision: 3, plannedQty: '1000' };

describe('师傅一键完成', () => {
  it('按计划数量登记，不需要输入数量，确认前不提交', async () => {
    await page.viewport(375, 667);
    flushSync(() => root.render(<WorkerQuickComplete job={job} />));
    expect(host.querySelector('input[type="number"]')).toBeNull();
    await page.getByRole('button', { name: '完成生产' }).click();
    expect(action).not.toHaveBeenCalled();
    await page.getByRole('button', { name: '取消' }).click();
    await page.getByRole('button', { name: '完成生产' }).click();
    const confirm = page.getByRole('button', { name: '确认完成 1000 个' });
    const rect = confirm.element().getBoundingClientRect();
    expect(rect.height).toBeGreaterThanOrEqual(44);
    await confirm.click();
    await expect.poll(() => action.mock.calls.length).toBe(1);
    const form = (action.mock.calls[0] as unknown as [unknown, FormData])[1];
    expect(Object.fromEntries(form.entries())).toEqual({ jobId: 'job-1', revision: '3', quantity: '1000', mode: 'COMPLETE' });
    await expect.element(page.getByRole('status')).toHaveTextContent('已登记完成');
  });

  it('任务详情默认一键完成，数量不一致时展开上报走审批', async () => {
    await page.viewport(375, 667);
    flushSync(() => root.render(<CompletionRegistrationForm admin={false} today="2026-10-01" job={{ id: 'job-1', revision: 3, workerName: '王师傅', quantity: '1000', requestedQty: null, requestReason: null, status: 'PENDING' }} />));
    await expect.element(page.getByRole('button', { name: '完成生产' })).toBeVisible();
    await expect.element(page.getByLabelText('实际完成数量')).not.toBeVisible();
    await page.getByText('实际数量与计划不一致？上报数量').click();
    await expect.element(page.getByLabelText('实际完成数量')).toHaveValue(null);
    await page.getByLabelText('实际完成数量').fill('1000');
    await expect.element(page.getByRole('button', { name: '提交数量审批' })).toBeDisabled();
    await expect.element(page.getByText('数量与计划一致，请直接点完成生产')).toBeVisible();
    expect(action).not.toHaveBeenCalled();
    await page.getByLabelText('实际完成数量').fill('990');
    await page.getByLabelText('数量修改原因').fill('少了 10 个');
    await page.getByRole('button', { name: '提交数量审批' }).click();
    await expect.poll(() => action.mock.calls.length).toBe(1);
    const form = (action.mock.calls[0] as unknown as [unknown, FormData])[1];
    expect(Object.fromEntries(form.entries())).toMatchObject({ jobId: 'job-1', quantity: '990', reason: '少了 10 个', mode: 'COMPLETE' });
    expect(document.documentElement.scrollWidth).toBeLessThanOrEqual(375);
  });
});
