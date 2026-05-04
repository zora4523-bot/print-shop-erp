import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { mockWebhookSender, sendWebhook } from '../webhook';

describe('mockWebhookSender', () => {
  it('returns ok=true with no retries', async () => {
    const r = await mockWebhookSender('https://x', 'hi');
    expect(r).toEqual({ ok: true, retries: 0 });
  });
});

describe('sendWebhook', () => {
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('200 OK + errcode=0 → ok=true, retries=0', async () => {
    fetchMock.mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: async () => ({ errcode: 0, errmsg: 'ok' }),
    });
    const r = await sendWebhook('https://x', 'hi');
    expect(r).toEqual({ ok: true, retries: 0 });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    // body 走企业微信 markdown 格式
    const init = fetchMock.mock.calls[0]![1] as RequestInit;
    expect(init.method).toBe('POST');
    expect(JSON.parse(init.body as string)).toEqual({
      msgtype: 'markdown',
      markdown: { content: 'hi' },
    });
  });

  it('200 OK + errcode!=0 → non-retryable FAILED, errorMessage 含 errcode', async () => {
    fetchMock.mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: async () => ({ errcode: 93000, errmsg: 'invalid webhook key' }),
    });
    const r = await sendWebhook('https://x', 'hi');
    expect(r.ok).toBe(false);
    expect(r.retries).toBe(0);
    expect(r.errorMessage).toMatch(/errcode=93000/);
    // 不重试
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('500 → 重试 3 次（initial + 2 retry）→ FAILED', async () => {
    fetchMock.mockResolvedValue({
      ok: false,
      status: 500,
      json: async () => null,
    });
    const r = await sendWebhook('https://x', 'hi');
    expect(r.ok).toBe(false);
    expect(r.retries).toBe(2); // 0-indexed attempts；最后一次 attempt=2
    expect(r.errorMessage).toMatch(/http 500/);
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });

  it('4xx → non-retryable，单次 FAILED', async () => {
    fetchMock.mockResolvedValueOnce({
      ok: false,
      status: 404,
      json: async () => null,
    });
    const r = await sendWebhook('https://x', 'hi');
    expect(r.ok).toBe(false);
    expect(r.retries).toBe(0);
    expect(r.errorMessage).toMatch(/http 404/);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('AbortError（超时）→ retryable，3 次后 FAILED', async () => {
    const abortErr = new Error('Aborted');
    abortErr.name = 'TimeoutError';
    fetchMock.mockRejectedValue(abortErr);
    const r = await sendWebhook('https://x', 'hi');
    expect(r.ok).toBe(false);
    expect(r.retries).toBe(2);
    expect(r.errorMessage).toBe('TimeoutError');
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });

  it('网络异常（throw 任意 Error）→ retryable', async () => {
    const netErr = new Error('Connection reset');
    netErr.name = 'TypeError';
    fetchMock.mockRejectedValue(netErr);
    const r = await sendWebhook('https://x', 'hi');
    expect(r.ok).toBe(false);
    expect(r.retries).toBe(2);
    expect(r.errorMessage).toBe('TypeError');
  });

  it('5xx → 5xx → 200：第三次成功 ok=true retries=2', async () => {
    fetchMock
      .mockResolvedValueOnce({
        ok: false,
        status: 500,
        json: async () => null,
      })
      .mockResolvedValueOnce({
        ok: false,
        status: 502,
        json: async () => null,
      })
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({ errcode: 0 }),
      });
    const r = await sendWebhook('https://x', 'hi');
    expect(r.ok).toBe(true);
    expect(r.retries).toBe(2);
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });

  it('企业微信成功响应 body 不是 JSON（解析失败）→ 仍按 ok=true 处理', async () => {
    // 极少见但官方文档说总返 JSON。即使 body 拿不到，我们也信 200。
    fetchMock.mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: async () => {
        throw new Error('not json');
      },
    });
    const r = await sendWebhook('https://x', 'hi');
    expect(r).toEqual({ ok: true, retries: 0 });
  });
});
