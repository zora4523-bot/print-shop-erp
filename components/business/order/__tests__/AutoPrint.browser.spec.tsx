import { flushSync } from 'react-dom';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { page } from 'vitest/browser';
import type { OrderPrintRecordResult } from '@/actions/order-print-record.types';
import { AutoPrint } from '../AutoPrint';

let host: HTMLDivElement;
let root: Root;
let print: ReturnType<typeof vi.spyOn>;
let close: ReturnType<typeof vi.spyOn>;

// 打印页已就绪：AutoPrint 不再重新准备文档，直接按就绪信号弹出打印对话框。
beforeEach(() => {
  host = document.createElement('div');
  host.className = 'work-order-document';
  host.dataset.printPrepared = 'true';
  document.body.append(host);
  document.documentElement.dataset.printReady = 'true';
  document.documentElement.dataset.printPagination = 'ready';
  root = createRoot(host);
  print = vi.spyOn(window, 'print').mockImplementation(() => undefined);
  close = vi.spyOn(window, 'close').mockImplementation(() => undefined);
});

afterEach(() => {
  flushSync(() => root.unmount());
  host.remove();
  delete document.documentElement.dataset.printReady;
  delete document.documentElement.dataset.printPagination;
  vi.restoreAllMocks();
});

function mount(props: Omit<Parameters<typeof AutoPrint>[0], 'orderId'>) {
  flushSync(() => root.render(<AutoPrint orderId="order-1" {...props} />));
}

const marked: OrderPrintRecordResult = { status: 'success', outcome: 'MARKED' };

// 业主 2026-10-02：点「打印」即记已打印——打印对话框关闭后记录本页内容；记录成功才关页，
// 失败留在本页说明原因并可只重试记录。
describe('AutoPrint print recording', () => {
  it('records after the print dialog closes and closes the tab only after the record succeeds', async () => {
    let settle!: (result: OrderPrintRecordResult) => void;
    const recordPrinted = vi.fn(() => new Promise<OrderPrintRecordResult>((done) => { settle = done; }));
    mount({ enabled: true, recordPrinted });
    await expect.poll(() => print.mock.calls.length).toBe(1);
    window.dispatchEvent(new Event('afterprint'));
    window.dispatchEvent(new Event('afterprint'));
    expect(recordPrinted).toHaveBeenCalledOnce();
    await expect.poll(() => document.querySelector('[role="status"]')?.textContent).toBe('正在记为已打印…');
    expect(close).not.toHaveBeenCalled();
    // 记录成功后通知同一浏览器里打开着的工单列表 / 详情刷新。
    const channel = new BroadcastChannel('order-print-recorded');
    const announced = new Promise<unknown>((done) => { channel.onmessage = (event) => done(event.data); });
    settle(marked);
    await expect.poll(() => close.mock.calls.length).toBe(1);
    await expect(announced).resolves.toEqual({ orderIds: ['order-1'] });
    channel.close();
    expect(document.querySelector('[role="alert"]')).toBeNull();
  });

  it('treats an earlier record of the same content as done', async () => {
    const recordPrinted = vi.fn(async (): Promise<OrderPrintRecordResult> => ({ status: 'success', outcome: 'ALREADY_PRINTED' }));
    mount({ enabled: true, recordPrinted });
    await expect.poll(() => print.mock.calls.length).toBe(1);
    window.dispatchEvent(new Event('afterprint'));
    await expect.poll(() => close.mock.calls.length).toBe(1);
  });

  for (const failure of ['action error', 'network error'] as const) {
    it(`${failure}: keeps the page open and retries only the record`, async () => {
      const recordPrinted = vi.fn<() => Promise<OrderPrintRecordResult>>();
      if (failure === 'action error') recordPrinted.mockResolvedValueOnce({ status: 'error', message: '打印任务已变化' });
      else recordPrinted.mockRejectedValueOnce(new Error('offline'));
      recordPrinted.mockResolvedValue(marked);
      mount({ enabled: true, recordPrinted });
      await expect.poll(() => print.mock.calls.length).toBe(1);
      window.dispatchEvent(new Event('afterprint'));
      const alert = page.getByRole('alert');
      await expect.element(alert).toHaveTextContent(failure === 'action error' ? '打印记录未保存：打印任务已变化' : '打印记录未保存，请检查网络后重试。');
      expect(close).not.toHaveBeenCalled();
      await alert.getByRole('button', { name: '重试记录', exact: true }).click();
      await expect.poll(() => close.mock.calls.length).toBe(1);
      expect(recordPrinted).toHaveBeenCalledTimes(2);
      expect(print).toHaveBeenCalledOnce();
    });
  }

  for (const outcome of ['STALE', 'NOT_PRINTABLE'] as const) {
    it(`${outcome}: explains that this print was not recorded and offers no retry`, async () => {
      const recordPrinted = vi.fn(async (): Promise<OrderPrintRecordResult> => ({ status: 'success', outcome }));
      mount({ enabled: true, recordPrinted });
      await expect.poll(() => print.mock.calls.length).toBe(1);
      window.dispatchEvent(new Event('afterprint'));
      const alert = page.getByRole('alert');
      await expect.element(alert).toHaveTextContent('没有记为已打印');
      await expect.element(alert.getByRole('button')).not.toBeInTheDocument();
      expect(close).not.toHaveBeenCalled();
    });
  }

  it('does not record a print dialog it did not open', async () => {
    document.documentElement.dataset.printPagination = 'overflow';
    const recordPrinted = vi.fn(async () => marked);
    mount({ enabled: true, recordPrinted });
    await expect.poll(() => document.querySelector('[role="alert"]')).not.toBeNull();
    window.dispatchEvent(new Event('afterprint'));
    expect(print).not.toHaveBeenCalled();
    expect(recordPrinted).not.toHaveBeenCalled();
  });

  it('never prints or records when auto-print is off (server PDF rendering)', async () => {
    const recordPrinted = vi.fn(async () => marked);
    mount({ enabled: false, recordPrinted });
    await new Promise((done) => setTimeout(done, 50));
    window.dispatchEvent(new Event('afterprint'));
    expect(print).not.toHaveBeenCalled();
    expect(recordPrinted).not.toHaveBeenCalled();
    expect(close).not.toHaveBeenCalled();
  });
});
