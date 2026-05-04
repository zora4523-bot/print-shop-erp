// 企业微信 Webhook 适配器。
//
// 文档参考：https://developer.work.weixin.qq.com/document/path/91770
// 文本消息格式：
//   {
//     "msgtype": "markdown",
//     "markdown": { "content": "..." }
//   }
// markdown content 上限 4096 字节。
//
// 重试策略（SPEC §8.2）：失败重试 3 次。这里实现：
//   - 最多 3 次 attempts（initial + 2 retries），单次超时 5s
//   - 退避：首次 fail → 200ms → 800ms（指数退避，整次 await 累计 ≤ 16s）
//   - retryable：5xx / network error / AbortError（超时）
//   - non-retryable：4xx → 直接 FAILED（webhook URL key 写错 / 配置失效，
//     重试也是死循环）
//
// 错误返回字段约束（DECISIONS 2026-04-27）：errorMessage 只放 HTTP
// 状态码 + 异常类型字符串，**不**放 messageContent（避免业务字段冗余
// 流到日志 / errorMessage）。

const TIMEOUT_MS = 5000;
const ATTEMPTS = 3;
const BACKOFF_MS = [0, 200, 800] as const; // 第 i 次 attempt 前等多久

export type WebhookResult = {
  ok: boolean;
  retries: number; // 已重试次数（0 = 一次成功）
  errorMessage?: string; // 仅 ok=false 时填
};

export type WebhookSender = (
  url: string,
  content: string,
) => Promise<WebhookResult>;

/**
 * 真实 fetch 实现。Mock-mode 下走 `mockWebhookSender` 而不是这个。
 */
export const sendWebhook: WebhookSender = async (url, content) => {
  let lastError: string | undefined;
  for (let attempt = 0; attempt < ATTEMPTS; attempt++) {
    if (BACKOFF_MS[attempt]! > 0) {
      await sleep(BACKOFF_MS[attempt]!);
    }
    const result = await sendOnce(url, content);
    if (result.kind === 'ok') {
      return { ok: true, retries: attempt };
    }
    if (!result.retryable) {
      // 4xx —— 不再重试
      return {
        ok: false,
        retries: attempt,
        errorMessage: result.errorMessage,
      };
    }
    lastError = result.errorMessage;
  }
  return {
    ok: false,
    retries: ATTEMPTS - 1,
    errorMessage: lastError ?? 'unknown error',
  };
};

/**
 * Mock-mode 实现：不真发 HTTP，立刻返成功。NotificationLog 仍写
 * status=SUCCESS（caller 决定 errorMessage='MOCK'）。
 */
export const mockWebhookSender: WebhookSender = async () => {
  return { ok: true, retries: 0 };
};

// ─── internals ───

type SendOnceResult =
  | { kind: 'ok' }
  | { kind: 'fail'; retryable: boolean; errorMessage: string };

async function sendOnce(
  url: string,
  content: string,
): Promise<SendOnceResult> {
  try {
    // AbortSignal.timeout(ms) 是 Node 24 内建（也在 modern fetch 标准里），
    // 不需要手动 setTimeout(controller.abort)。
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        msgtype: 'markdown',
        markdown: { content },
      }),
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    if (res.ok) {
      // 企业微信成功响应也是 200，但 body 可能含 errcode != 0（业务错）。
      // 这里把 errcode!=0 当 non-retryable —— 一般是 webhook URL key
      // 失效 / 频率超限（频率超限是 retryable，但 SPEC 没要求按 errcode
      // 分类，简化处理：4xx 同等对待）。
      const json = (await res.json().catch(() => null)) as {
        errcode?: number;
        errmsg?: string;
      } | null;
      if (json && typeof json.errcode === 'number' && json.errcode !== 0) {
        return {
          kind: 'fail',
          retryable: false,
          errorMessage: `wecom errcode=${json.errcode}`,
        };
      }
      return { kind: 'ok' };
    }
    if (res.status >= 500) {
      return {
        kind: 'fail',
        retryable: true,
        errorMessage: `http ${res.status}`,
      };
    }
    return {
      kind: 'fail',
      retryable: false,
      errorMessage: `http ${res.status}`,
    };
  } catch (err) {
    // AbortError（超时）+ 网络错误（DNS / TLS / connection reset）都
    // 走这里，统一 retryable。
    const name = err instanceof Error ? err.name : 'unknown';
    return {
      kind: 'fail',
      retryable: true,
      errorMessage: name,
    };
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
