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
//   - 最多 3 次进程内 attempts（initial + 2 retries），单次超时 10s
//   - 退避：首次 fail → 200ms → 800ms（指数退避，整次 await 累计 ≤ 16s）
//   - 进程内重试（immediate）：5xx / 网络错（DNS / TLS / connection reset）
//   - 交给 durable job 退避（defer）：429、企业微信限流类 errcode、**超时**
//   - 不再试（none）：其余 4xx、配置/内容类 errcode
//
// 为什么超时不做进程内重试：AbortSignal.timeout 只说明「响应没在 10s 内
// 回来」，**不**说明消息没送到。进程内再打两枪最坏会让同一条消息在群里
// 出现 3 次；外层 durable job 又会再来 5 轮 —— 3×5=15 条重复。把超时归到
// defer，同一条消息的上限降回「每轮 attempt 一次」。超时窗口同时从 5s 提到
// 10s，减少「其实送到了却判超时」的发生率。
//
// 错误返回字段约束（DECISIONS 2026-04-27）：errorMessage 只放 HTTP
// 状态码 + 异常类型字符串，**不**放 messageContent（避免业务字段冗余
// 流到日志 / errorMessage）。

const TIMEOUT_MS = 10_000;
const ATTEMPTS = 3;
const BACKOFF_MS = [0, 200, 800] as const; // 第 i 次 attempt 前等多久

// 进程内立刻重试只对「瞬时抖动」有用（TCP reset / 单次 5xx）。限流类失败
// 在 200ms / 800ms 之后必然还是限流，重试只是白打三枪 —— 这类直接跳出
// 进程内循环，交给 durable job 的 30s 起步退避
// （lib/background-jobs/policy.ts retryDelayMs）。
const IMMEDIATE_RETRY_STATUS: ReadonlySet<number> = new Set([408]);
const DEFERRED_RETRY_STATUS: ReadonlySet<number> = new Set([429]);

// AbortSignal.timeout 触发时 err.name 是 'TimeoutError'；手动 abort 是
// 'AbortError'。两者都表示「不知道服务端收没收到」，按 defer 处理。
const TIMEOUT_ERROR_NAMES: ReadonlySet<string> = new Set([
  'TimeoutError',
  'AbortError',
]);

// 企业微信的坑：HTTP 200 但 body 里 errcode != 0 才是真失败（下面 res.ok
// 分支已经处理）。这里把 errcode 分成「等一会儿有救」和「等到天荒地老也
// 一样」两类：
//   -1     系统繁忙 → 稍后重试
//   45009  接口调用超过限制（群机器人 20 条/分钟）→ 退避后重试
//   45033  接口并发调用超过限制 → 退避后重试
// 其余（93000 invalid webhook key / 40008 invalid msg / 45002 内容超长…）
// 都是配置或内容错误，重试多少次都一样 → 直接 FAILED，不让 durable job
// 白耗 attempts 变成没人能处置的死信。
const RETRYABLE_WECOM_ERRCODES: ReadonlySet<number> = new Set([
  -1, 45009, 45033,
]);

export type WebhookResult = {
  ok: boolean;
  retries: number; // 已重试次数（0 = 一次成功）
  errorMessage?: string; // 仅 ok=false 时填
  // 仅 ok=false 时有意义：进程内尝试已经耗尽（或被限流/超时跳过）之后，
  // 这次失败值不值得由**外层** durable job 再来一轮。notify 把它汇总进
  // NotifyOutcome，handleNotificationJob 据此决定抛不抛异常触发重试。
  retryable?: boolean;
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
    if (result.retry !== 'immediate') {
      // 'none'  → 4xx / 永久 errcode：谁都别再试了
      // 'defer' → 限流或超时：进程内再试没有意义（还可能刷屏），但外层
      //           退避之后值得再来一轮
      return {
        ok: false,
        retries: attempt,
        errorMessage: result.errorMessage,
        retryable: result.retry === 'defer',
      };
    }
    lastError = result.errorMessage;
  }
  // 进程内 3 次都是瞬时错误 —— 换个几十秒再来很可能就好了，交给 durable job。
  return {
    ok: false,
    retries: ATTEMPTS - 1,
    errorMessage: lastError ?? 'unknown error',
    retryable: true,
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

// 'none'      配置/内容错，谁都别再试
// 'immediate' 瞬时抖动，进程内立刻再试有意义
// 'defer'     限流 / 超时，进程内再试无意义，交给 durable job 的退避
type SendOnceRetry = 'none' | 'immediate' | 'defer';

type SendOnceResult =
  | { kind: 'ok' }
  | { kind: 'fail'; retry: SendOnceRetry; errorMessage: string };

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
      // 企业微信成功响应也是 200，body 里 errcode != 0 才是真失败。按
      // RETRYABLE_WECOM_ERRCODES 分流：限流/系统繁忙退避后重试，key 失效
      // 之类的配置错直接判死，不占用 durable job 的 attempts。
      const json = (await res.json().catch(() => null)) as {
        errcode?: number;
        errmsg?: string;
      } | null;
      if (json && typeof json.errcode === 'number' && json.errcode !== 0) {
        return {
          kind: 'fail',
          retry: RETRYABLE_WECOM_ERRCODES.has(json.errcode) ? 'defer' : 'none',
          errorMessage: `wecom errcode=${json.errcode}`,
        };
      }
      return { kind: 'ok' };
    }
    if (res.status >= 500) {
      return {
        kind: 'fail',
        retry: 'immediate',
        errorMessage: `http ${res.status}`,
      };
    }
    if (IMMEDIATE_RETRY_STATUS.has(res.status)) {
      return {
        kind: 'fail',
        retry: 'immediate',
        errorMessage: `http ${res.status}`,
      };
    }
    if (DEFERRED_RETRY_STATUS.has(res.status)) {
      // 429：立刻再打两枪只会让限流更久，直接交棒给 durable 退避。
      return {
        kind: 'fail',
        retry: 'defer',
        errorMessage: `http ${res.status}`,
      };
    }
    return {
      kind: 'fail',
      retry: 'none',
      errorMessage: `http ${res.status}`,
    };
  } catch (err) {
    // 超时（TimeoutError / AbortError）：服务端可能已经收到了，进程内重发
    // 会在群里刷重复消息 —— 交给外层退避，一轮只发一次。
    // 其余网络错（DNS / TLS / connection reset）几乎可以确定没送达，进程内
    // 立刻重试仍然划算。
    const name = err instanceof Error ? err.name : 'unknown';
    return {
      kind: 'fail',
      retry: TIMEOUT_ERROR_NAMES.has(name) ? 'defer' : 'immediate',
      errorMessage: name,
    };
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
