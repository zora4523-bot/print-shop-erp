import { flushSync } from 'react-dom';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
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

function mount(props: Parameters<typeof AutoPrint>[0]) {
  flushSync(() => root.render(<AutoPrint {...props} />));
}

// 业主 2026-10-02：点「打印」即记已打印——打印对话框关闭后记录本版本，再关页。
describe('AutoPrint print recording', () => {
  it('records after the print dialog closes and closes the tab only after the record settles', async () => {
    let settle!: () => void;
    const recordPrinted = vi.fn(() => new Promise<void>((done) => { settle = done; }));
    mount({ enabled: true, recordPrinted });
    await expect.poll(() => print.mock.calls.length).toBe(1);
    window.dispatchEvent(new Event('afterprint'));
    expect(recordPrinted).toHaveBeenCalledOnce();
    expect(close).not.toHaveBeenCalled();
    settle();
    await expect.poll(() => close.mock.calls.length).toBeGreaterThan(0);
  });

  it('still closes the tab when recording fails', async () => {
    const recordPrinted = vi.fn(() => Promise.reject(new Error('offline')));
    mount({ enabled: true, recordPrinted });
    await expect.poll(() => print.mock.calls.length).toBe(1);
    window.dispatchEvent(new Event('afterprint'));
    await expect.poll(() => close.mock.calls.length).toBe(1);
  });

  it('does not record a print dialog it did not open', async () => {
    document.documentElement.dataset.printPagination = 'overflow';
    const recordPrinted = vi.fn(() => Promise.resolve());
    mount({ enabled: true, recordPrinted });
    await expect.poll(() => document.querySelector('[role="alert"]')).not.toBeNull();
    window.dispatchEvent(new Event('afterprint'));
    expect(print).not.toHaveBeenCalled();
    expect(recordPrinted).not.toHaveBeenCalled();
  });

  it('never prints or records when auto-print is off (server PDF rendering)', async () => {
    const recordPrinted = vi.fn(() => Promise.resolve());
    mount({ enabled: false, recordPrinted });
    await new Promise((done) => setTimeout(done, 50));
    window.dispatchEvent(new Event('afterprint'));
    expect(print).not.toHaveBeenCalled();
    expect(recordPrinted).not.toHaveBeenCalled();
    expect(close).not.toHaveBeenCalled();
  });
});
