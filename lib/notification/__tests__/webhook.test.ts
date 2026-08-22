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

  it('HTTP 408 → 进程内重试 3 次后 retryable', async () => {
    fetchMock.mockResolvedValue({
      ok: false,
      status: 408,
      json: async () => null,
    });
    const r = await sendWebhook('https://x', 'hi');
    expect(r.ok).toBe(false);
    expect(r.retryable).toBe(true);
    expect(fetchMock).toHaveBeenCalledTimes(3);
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
    // 进程内 3 枪都是瞬时错 → 交给 durable job 再来一轮
    expect(r.retryable).toBe(true);
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

  it('超时（TimeoutError）→ retryable，但**只发一次**（防群里刷重复消息）', async () => {
    // 超时只说明「响应没回来」，不说明消息没送到。进程内重发最坏让同一条
    // 消息在群里出现 3 次，外层 durable job 再来 5 轮就是 15 条。所以超时
    // 归 defer：一轮 attempt 只打一枪，重复上限从 15 降回 5。
    const abortErr = new Error('Aborted');
    abortErr.name = 'TimeoutError';
    fetchMock.mockRejectedValue(abortErr);
    const r = await sendWebhook('https://x', 'hi');
    expect(r.ok).toBe(false);
    expect(r.retries).toBe(0);
    expect(r.errorMessage).toBe('TimeoutError');
    expect(r.retryable).toBe(true);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('手动 abort（AbortError）与超时同等对待', async () => {
    const abortErr = new Error('The operation was aborted');
    abortErr.name = 'AbortError';
    fetchMock.mockRejectedValue(abortErr);
    const r = await sendWebhook('https://x', 'hi');
    expect(r.retryable).toBe(true);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('网络异常（connection reset 之类）→ retryable，仍做进程内 3 次重试', async () => {
    // 连接层错误几乎可以确定服务端没收到，进程内立刻重试不会刷重复消息。
    const netErr = new Error('Connection reset');
    netErr.name = 'TypeError';
    fetchMock.mockRejectedValue(netErr);
    const r = await sendWebhook('https://x', 'hi');
    expect(r.ok).toBe(false);
    expect(r.retries).toBe(2);
    expect(r.errorMessage).toBe('TypeError');
    expect(r.retryable).toBe(true);
    expect(fetchMock).toHaveBeenCalledTimes(3);
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
