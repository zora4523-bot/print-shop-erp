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
    // key 失效是配置错，外层 durable job 再来 5 次也一样 → 不可重试
    expect(r.retryable).toBe(false);
    // 不重试
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('200 OK + errcode=45009（频率超限）→ retryable，且**不**做进程内重试', async () => {
    // 群机器人 20 条/分钟。200ms 后再打一枪必然还是限流，只会把限流窗口
    // 拖长 —— 直接交棒给 durable job 的 30s 起步退避。
    fetchMock.mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ errcode: 45009, errmsg: 'api freq out of limit' }),
    });
    const r = await sendWebhook('https://x', 'hi');
    expect(r.ok).toBe(false);
    expect(r.retryable).toBe(true);
    expect(r.errorMessage).toMatch(/errcode=45009/);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('200 OK + errcode=-1（系统繁忙）→ retryable，1 次调用', async () => {
    fetchMock.mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ errcode: -1, errmsg: 'system busy' }),
    });
    const r = await sendWebhook('https://x', 'hi');
    expect(r.ok).toBe(false);
    expect(r.retryable).toBe(true);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('HTTP 429 → retryable，1 次调用（限流不做进程内重试）', async () => {
    fetchMock.mockResolvedValue({
      ok: false,
      status: 429,
      json: async () => null,
    });
    const r = await sendWebhook('https://x', 'hi');
    expect(r.ok).toBe(false);
    expect(r.retryable).toBe(true);
    expect(r.errorMessage).toMatch(/http 429/);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('HTTP 408 → 标 UNKNOWN 且不自动重发', async () => {
    fetchMock.mockResolvedValue({
      ok: false,
      status: 408,
      json: async () => null,
    });
    const r = await sendWebhook('https://x', 'hi');
    expect(r.ok).toBe(false);
    expect(r.retryable).toBe(false);
    expect(r.unknown).toBe(true);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('HTTP 500 → UNKNOWN 且只发一次', async () => {
    fetchMock.mockResolvedValue({
      ok: false,
      status: 500,
      json: async () => null,
    });
    const r = await sendWebhook('https://x', 'hi');
    expect(r.ok).toBe(false);
    expect(r.retries).toBe(0);
    expect(r.errorMessage).toMatch(/http 500/);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(r.retryable).toBe(false);
    expect(r.unknown).toBe(true);
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
    expect(r.retryable).toBe(false);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('超时（TimeoutError）→ UNKNOWN 且只发一次，禁止自动重发', async () => {
    // 超时只说明「响应没回来」，不说明消息没送到。因此归 UNKNOWN，
    // 进程内与外层 durable job 都不自动重发。
    const abortErr = new Error('Aborted');
    abortErr.name = 'TimeoutError';
    fetchMock.mockRejectedValue(abortErr);
    const r = await sendWebhook('https://x', 'hi');
    expect(r.ok).toBe(false);
    expect(r.retries).toBe(0);
    expect(r.errorMessage).toBe('TimeoutError');
    expect(r.retryable).toBe(false);
    expect(r.unknown).toBe(true);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('手动 abort（AbortError）与超时同等对待', async () => {
    const abortErr = new Error('The operation was aborted');
    abortErr.name = 'AbortError';
    fetchMock.mockRejectedValue(abortErr);
    const r = await sendWebhook('https://x', 'hi');
    expect(r.retryable).toBe(false);
    expect(r.unknown).toBe(true);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('网络异常（connection reset 之类）→ UNKNOWN，不猜测对端未收到', async () => {
    const netErr = new Error('Connection reset');
    netErr.name = 'TypeError';
    fetchMock.mockRejectedValue(netErr);
    const r = await sendWebhook('https://x', 'hi');
    expect(r.ok).toBe(false);
    expect(r.retries).toBe(0);
    expect(r.errorMessage).toBe('TypeError');
    expect(r.retryable).toBe(false);
    expect(r.unknown).toBe(true);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('5xx 后即使下一次可成功也不自动重发', async () => {
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
    expect(r).toMatchObject({ ok: false, retries: 0, unknown: true });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('企业微信 200 但 body 不是 JSON → UNKNOWN，绝不伪报成功', async () => {
    fetchMock.mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: async () => {
        throw new Error('not json');
      },
    });
    const r = await sendWebhook('https://x', 'hi');
    expect(r).toMatchObject({
      ok: false,
      retries: 0,
      retryable: false,
      unknown: true,
      errorMessage: 'invalid wecom response',
    });
  });

  it('企业微信 200 JSON 缺少 errcode → UNKNOWN', async () => {
    fetchMock.mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: async () => ({}),
    });
    const r = await sendWebhook('https://x', 'hi');
    expect(r).toMatchObject({ ok: false, unknown: true });
  });
});
