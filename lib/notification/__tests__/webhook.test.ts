import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const { waitForSlotMock } = vi.hoisted(() => ({
  waitForSlotMock: vi.fn(),
}));

vi.mock('../webhook-throttle', () => ({
  waitForWebhookSendSlot: waitForSlotMock,
}));

import {
  WECOM_MARKDOWN_MAX_BYTES,
  mockWebhookSender,
  sendWebhook,
} from '../webhook';
import { isValidWecomGroupBotWebhookUrl } from '../webhook-url';

const VALID_WEBHOOK_URL =
  'https://qyapi.weixin.qq.com/cgi-bin/webhook/send?key=test-key';

describe('isValidWecomGroupBotWebhookUrl', () => {
  it('只接受官方端点和唯一非空 key 参数', () => {
    expect(isValidWecomGroupBotWebhookUrl(VALID_WEBHOOK_URL)).toBe(true);

    for (const invalid of [
      'http://qyapi.weixin.qq.com/cgi-bin/webhook/send?key=x',
      'https://attacker.example/cgi-bin/webhook/send?key=x',
      'https://user@qyapi.weixin.qq.com/cgi-bin/webhook/send?key=x',
      'https://qyapi.weixin.qq.com:8443/cgi-bin/webhook/send?key=x',
      'https://qyapi.weixin.qq.com/cgi-bin/webhook/send/?key=x',
      'https://qyapi.weixin.qq.com/cgi-bin/webhook/send',
      'https://qyapi.weixin.qq.com/cgi-bin/webhook/send?key=',
      'https://qyapi.weixin.qq.com/cgi-bin/webhook/send?key=%20',
      'https://qyapi.weixin.qq.com/cgi-bin/webhook/send?key=x&debug=1',
      'https://qyapi.weixin.qq.com/cgi-bin/webhook/send?key=x&key=y',
      'https://qyapi.weixin.qq.com/cgi-bin/webhook/send?key=x#fragment',
    ]) {
      expect(isValidWecomGroupBotWebhookUrl(invalid), invalid).toBe(false);
    }
  });

});

describe('mockWebhookSender', () => {
  it('returns ok=true with no retries', async () => {
    const r = await mockWebhookSender('https://x', 'hi');
    expect(r).toEqual({ ok: true, retries: 0 });
  });

  it('在 mock 模式也拒绝超过企业微信上限的最终内容', async () => {
    const r = await mockWebhookSender(
      'https://x',
      'a'.repeat(WECOM_MARKDOWN_MAX_BYTES + 1),
    );
    expect(r).toEqual({
      ok: false,
      retries: 0,
      errorMessage: 'wecom markdown content exceeds 4096 bytes',
      retryable: false,
    });
  });

  it('durable mock 也按 lease→freshness 检查，过期事实不记 SUCCESS', async () => {
    const order: string[] = [];
    const result = await mockWebhookSender('https://x', 'hi', {
      assertLease: async () => {
        order.push('lease');
      },
      beforeRequest: async () => {
        order.push('freshness');
        return false;
      },
    });

    expect(order).toEqual(['lease', 'freshness']);
    expect(result).toEqual({ ok: false, retries: 0, skipped: true });
  });
});

describe('sendWebhook', () => {
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    waitForSlotMock.mockReset().mockResolvedValue(undefined);
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
    const r = await sendWebhook(VALID_WEBHOOK_URL, 'hi');
    expect(r).toEqual({ ok: true, retries: 0 });
    expect(waitForSlotMock).toHaveBeenCalledExactlyOnceWith(
      VALID_WEBHOOK_URL,
      {},
    );
    expect(fetchMock).toHaveBeenCalledTimes(1);
    // body 走企业微信 markdown 格式
    const init = fetchMock.mock.calls[0]![1] as RequestInit;
    expect(init.method).toBe('POST');
    expect(init.redirect).toBe('manual');
    expect(JSON.parse(init.body as string)).toEqual({
      msgtype: 'markdown',
      markdown: { content: 'hi' },
    });
  });

  it('允许恰好 4096 个 UTF-8 字节并发送原内容', async () => {
    fetchMock.mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: async () => ({ errcode: 0, errmsg: 'ok' }),
    });
    // 1365 个中文字符是 4095 字节，再加 1 个 ASCII 字符刚好 4096。
    const content = `${'中'.repeat(1365)}a`;

    const r = await sendWebhook(VALID_WEBHOOK_URL, content);

    expect(r).toEqual({ ok: true, retries: 0 });
    expect(fetchMock).toHaveBeenCalledOnce();
    const init = fetchMock.mock.calls[0]![1] as RequestInit;
    expect(JSON.parse(init.body as string)).toEqual({
      msgtype: 'markdown',
      markdown: { content },
    });
  });

  it('超过 4096 个 UTF-8 字节时本地永久失败且不发 HTTP', async () => {
    // 字符数远低于 4096，但 1366 个中文字符编码后是 4098 字节。
    const content = '中'.repeat(1366);

    const r = await sendWebhook(VALID_WEBHOOK_URL, content);

    expect(r).toEqual({
      ok: false,
      retries: 0,
      errorMessage: 'wecom markdown content exceeds 4096 bytes',
      retryable: false,
    });
    expect(fetchMock).not.toHaveBeenCalled();
    expect(waitForSlotMock).not.toHaveBeenCalled();
  });

  it('URL 不符合官方格式时 fail-closed 且不发 HTTP', async () => {
    const r = await sendWebhook(
      'https://attacker.example/cgi-bin/webhook/send?key=x',
      'hi',
    );

    expect(r).toEqual({
      ok: false,
      retries: 0,
      errorMessage: 'invalid wecom webhook url',
      retryable: false,
    });
    expect(fetchMock).not.toHaveBeenCalled();
    expect(waitForSlotMock).not.toHaveBeenCalled();
  });

  it('permit 后先验证 lease，freshness 是真实 fetch 前最后一个 await', async () => {
    const order: string[] = [];
    waitForSlotMock.mockImplementationOnce(async () => {
      order.push('permit');
    });
    const assertLease = vi.fn(async () => {
      order.push('lease');
    });
    const beforeRequest = vi.fn(async () => {
      order.push('freshness');
      return true;
    });
    fetchMock.mockImplementationOnce(async () => {
      order.push('fetch');
      return {
        ok: true,
        status: 200,
        json: async () => ({ errcode: 0, errmsg: 'ok' }),
      };
    });

    await expect(
      sendWebhook(VALID_WEBHOOK_URL, 'hi', { assertLease, beforeRequest }),
    ).resolves.toEqual({ ok: true, retries: 0 });
    expect(order).toEqual(['permit', 'lease', 'freshness', 'fetch']);
  });

  it('全局 permit 表不可用时在 HTTP 前安全交给 durable 重试', async () => {
    waitForSlotMock.mockRejectedValueOnce(new Error('database unavailable'));

    await expect(sendWebhook(VALID_WEBHOOK_URL, 'hi')).resolves.toEqual({
      ok: false,
      retries: 0,
      errorMessage: 'webhook throttle unavailable',
      retryable: true,
    });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('permit 准备失败后事实已过期时优先 skipped，不落 RETRYING', async () => {
    const order: string[] = [];
    waitForSlotMock.mockImplementationOnce(async () => {
      order.push('permit');
      throw new Error('database unavailable');
    });
    const assertLease = vi.fn(async () => {
      order.push('lease');
    });
    const beforeRequest = vi.fn(async () => {
      order.push('freshness');
      return false;
    });

    await expect(
      sendWebhook(VALID_WEBHOOK_URL, 'hi', { assertLease, beforeRequest }),
    ).resolves.toEqual({ ok: false, retries: 0, skipped: true });
    expect(order).toEqual(['permit', 'lease', 'freshness']);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('3xx 不跟随重定向，按永久 HTTP 失败处理', async () => {
    fetchMock.mockResolvedValueOnce({
      ok: false,
      status: 302,
      json: async () => null,
    });

    const r = await sendWebhook(VALID_WEBHOOK_URL, 'hi');

    expect(r).toEqual({
      ok: false,
      retries: 0,
      errorMessage: 'http 302',
      retryable: false,
      unknown: false,
    });
    expect(fetchMock).toHaveBeenCalledOnce();
    const init = fetchMock.mock.calls[0]![1] as RequestInit;
    expect(init.redirect).toBe('manual');
  });

  it('200 OK + errcode!=0 → non-retryable FAILED, errorMessage 含 errcode', async () => {
    fetchMock.mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: async () => ({ errcode: 93000, errmsg: 'invalid webhook key' }),
    });
    const r = await sendWebhook(VALID_WEBHOOK_URL, 'hi');
    expect(r.ok).toBe(false);
    expect(r.retries).toBe(0);
    expect(r.errorMessage).toMatch(/errcode=93000/);
    // key 失效是配置错，外层 durable job 再来多少次也一样 → 不可重试
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
    const r = await sendWebhook(VALID_WEBHOOK_URL, 'hi');
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
    const r = await sendWebhook(VALID_WEBHOOK_URL, 'hi');
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
    const r = await sendWebhook(VALID_WEBHOOK_URL, 'hi');
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
    const r = await sendWebhook(VALID_WEBHOOK_URL, 'hi');
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
    const r = await sendWebhook(VALID_WEBHOOK_URL, 'hi');
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
    const r = await sendWebhook(VALID_WEBHOOK_URL, 'hi');
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
    const r = await sendWebhook(VALID_WEBHOOK_URL, 'hi');
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
    const r = await sendWebhook(VALID_WEBHOOK_URL, 'hi');
    expect(r.retryable).toBe(false);
    expect(r.unknown).toBe(true);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('网络异常（connection reset 之类）→ UNKNOWN，不猜测对端未收到', async () => {
    const netErr = new Error('Connection reset');
    netErr.name = 'TypeError';
    fetchMock.mockRejectedValue(netErr);
    const r = await sendWebhook(VALID_WEBHOOK_URL, 'hi');
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
    const r = await sendWebhook(VALID_WEBHOOK_URL, 'hi');
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
    const r = await sendWebhook(VALID_WEBHOOK_URL, 'hi');
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
    const r = await sendWebhook(VALID_WEBHOOK_URL, 'hi');
    expect(r).toMatchObject({ ok: false, unknown: true });
  });
});
