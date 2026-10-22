import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fetchOrderPdf } from '../order-pdf-download';

/**
 * 业主 2026-10-22：工单页在页内取 PDF，它替代的是此前那段跑在 HTML 兜底页里的轮询脚本。
 * 这里覆盖它独有的分支：排队续查、服务未就绪的慢重试、续查地址白名单、文件名解析、
 * 等待预算用尽与中止。纯函数 + fetch，node 环境即可，不需要浏览器。
 */
const PDF_URL = '/api/orders/order-1/pdf';

function pdfResponse(headers: Record<string, string> = {}) {
  return new Response(new Blob(['%PDF-1.7'], { type: 'application/pdf' }), {
    status: 200,
    headers: { 'content-type': 'application/pdf', ...headers },
  });
}

function statusResponse(status: number, body: Record<string, unknown>) {
  return Response.json(body, { status });
}

let fetchMock: ReturnType<typeof vi.fn>;

beforeEach(() => {
  vi.useFakeTimers();
  fetchMock = vi.fn();
  vi.stubGlobal('fetch', fetchMock);
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

/** 轮询之间有真实等待，用假定时器推进。 */
async function run(signal = new AbortController().signal) {
  const promise = fetchOrderPdf('order-1', signal);
  await vi.runAllTimersAsync();
  return promise;
}

describe('fetching a single order PDF in page', () => {
  it('asks for JSON so queue states come back as data, not the fallback HTML page', async () => {
    fetchMock.mockResolvedValue(pdfResponse());
    await run();
    expect(fetchMock).toHaveBeenCalledWith(PDF_URL, expect.objectContaining({
      cache: 'no-store',
      headers: { Accept: 'application/json' },
    }));
  });

  it('returns the content key and the server-provided file name', async () => {
    fetchMock.mockResolvedValue(pdfResponse({
      'x-print-content-key': 'a'.repeat(64),
      'content-disposition': `attachment; filename="GD-001.pdf"; filename*=UTF-8''${encodeURIComponent('工单-GD-001.pdf')}`,
    }));
    const result = await run();
    expect(result).toMatchObject({ ok: true, contentKey: 'a'.repeat(64), fileName: '工单-GD-001.pdf' });
  });

  it('follows the queue through to the finished file without touching the page', async () => {
    fetchMock
      .mockResolvedValueOnce(statusResponse(202, { state: 'pending', retryUrl: `${PDF_URL}?jobId=job-1` }))
      .mockResolvedValueOnce(statusResponse(202, { state: 'pending', retryUrl: `${PDF_URL}?jobId=job-1` }))
      .mockResolvedValueOnce(pdfResponse({ 'x-print-content-key': 'b'.repeat(64) }));
    const result = await run();
    expect(result).toMatchObject({ ok: true, contentKey: 'b'.repeat(64) });
    expect(fetchMock).toHaveBeenCalledTimes(3);
    // 续查必须沿用服务端给的 jobId，否则重试会另起一个生成任务。
    expect(fetchMock.mock.calls[2]![0]).toBe(`${PDF_URL}?jobId=job-1`);
  });

  it.each([
    ['PDF_WORKER_UNAVAILABLE'],
    ['PDF_QUEUE_DELAYED'],
  ])('keeps waiting on the original job when the service reports %s', async (code) => {
    fetchMock
      .mockResolvedValueOnce(statusResponse(503, { state: 'failed', code, retryUrl: `${PDF_URL}?jobId=job-9` }))
      .mockResolvedValueOnce(pdfResponse());
    await expect(run()).resolves.toMatchObject({ ok: true });
    expect(fetchMock.mock.calls[1]![0]).toBe(`${PDF_URL}?jobId=job-9`);
  });

  it('refuses a follow-up url that points away from the download endpoint', async () => {
    fetchMock
      .mockResolvedValueOnce(statusResponse(202, { state: 'pending', retryUrl: 'https://evil.example/steal' }))
      .mockResolvedValue(pdfResponse());
    const result = await run();
    expect(result).toMatchObject({ ok: false });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('gives up once the waiting budget is spent instead of polling forever', async () => {
    fetchMock.mockResolvedValue(statusResponse(202, { state: 'pending', retryUrl: `${PDF_URL}?jobId=job-1` }));
    const result = await run();
    expect(result).toMatchObject({ ok: false, message: expect.stringContaining('已停止等待') });
    // 120 秒预算、每轮 2 秒，不会无限轮询。
    expect(fetchMock.mock.calls.length).toBeLessThan(70);
  });

  it('surfaces the server message and error code for a real failure', async () => {
    fetchMock.mockResolvedValue(statusResponse(500, { state: 'failed', message: '内容超出打印页面', code: 'PDF_LAYOUT_OVERFLOW' }));
    await expect(run()).resolves.toMatchObject({
      ok: false,
      message: '内容超出打印页面（错误码：PDF_LAYOUT_OVERFLOW）',
    });
  });

  it('tells the admin to sign in again rather than retrying a revoked session', async () => {
    fetchMock.mockResolvedValue(statusResponse(401, { error: '未登录或登录状态已失效，请重新登录' }));
    const result = await run();
    expect(result).toMatchObject({ ok: false, message: expect.stringContaining('重新登录') });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('reports a cancelled download as cancelled, not as a failure', async () => {
    const controller = new AbortController();
    fetchMock.mockImplementation(() => {
      controller.abort();
      return Promise.reject(new DOMException('Aborted', 'AbortError'));
    });
    await expect(run(controller.signal)).resolves.toMatchObject({ ok: false, message: '已取消' });
  });
});
