// 企业微信 Webhook 适配器。
//
// 文档参考：https://developer.work.weixin.qq.com/document/path/99110
// 文本消息格式：
//   {
//     "msgtype": "markdown",
//     "markdown": { "content": "..." }
//   }
// markdown content 上限 4096 字节。
//
// 重试策略（SPEC §8.2）：单次 HTTP 超时 10s；只有下游明确回绝且
// 稍后可恢复的限流错误才交给 durable job 退避。没有 provider 幂等键时，
// 进程内立即重发不能证明安全，因此每个 job attempt 最多发一次。
//   - 交给 durable job 退避（defer）：429、企业微信限流类 errcode
//   - 结果未知（unknown）：5xx / 408 / 超时 / 网络异常 /
//     非法 200 body；
//     禁止自动重发
//   - 不再试（none）：其余 4xx、配置/内容类 errcode
//
// 为什么 unknown 不重试：企业微信机器人不接收调用方幂等键。请求开始后若
// 响应丢失，本地无法证明群里没收到；自动重发会制造重复通知。因此 durable
// ledger 把它记成 UNKNOWN，交给运维人工核对。
//
// 错误返回字段约束（DECISIONS 2026-04-27）：errorMessage 只放 HTTP
// 状态码 + 异常类型字符串，**不**放 messageContent（避免业务字段冗余
// 流到日志 / errorMessage）。

import { assertExecutionFence } from '../execution-fence';
import { isWecomMarkdownWithinLimit } from './limits';
import { waitForWebhookSendSlot } from './webhook-throttle';
import { isValidWecomGroupBotWebhookUrl } from './webhook-url';

export { WECOM_MARKDOWN_MAX_BYTES } from './limits';

const TIMEOUT_MS = 10_000;
const MARKDOWN_TOO_LONG_ERROR =
  'wecom markdown content exceeds 4096 bytes';
const INVALID_WEBHOOK_URL_ERROR = 'invalid wecom webhook url';
const THROTTLE_UNAVAILABLE_ERROR = 'webhook throttle unavailable';
const PRE_SEND_CHECK_UNAVAILABLE_ERROR = 'webhook pre-send check unavailable';

// 限流类失败在 200ms / 800ms 之后必然还是限流，交给 durable
// job 的 30s 起步退避（lib/background-jobs/policy.ts retryDelayMs）。
const DEFERRED_RETRY_STATUS: ReadonlySet<number> = new Set([429]);

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
  retries: number; // 兼容旧日志形状；当前发送器永返 0
  errorMessage?: string; // 仅 ok=false 时填
  // 仅 ok=false 时有意义：下游是否已明确拒绝、且退避后值得由
  // **外层** durable job 再来一轮。notify 把它汇总进
  // NotifyOutcome，handleNotificationJob 据此决定抛不抛异常触发重试。
  retryable?: boolean;
  // Request may have reached the provider, but no valid acknowledgement was
  // observed. Callers must persist UNKNOWN and must not automatically resend.
  unknown?: boolean;
  // A fact that was current before waiting for the shared permit became stale
  // before fetch. No external request was attempted and durable callers may
  // safely terminalize their pre-send delivery claim.
  skipped?: boolean;
};

/** Opaque, single-use proof that the real transport passed its global gate. */
export type PreparedWebhookSend = Readonly<{
  kind: 'prepared-wecom-webhook-send';
}>;

type PreparedWebhookSendState = {
  url: string;
  content: string;
  result: WebhookResult | null;
};

const preparedWebhookSends = new WeakMap<
  PreparedWebhookSend,
  PreparedWebhookSendState
>();

export type WebhookSender = (
  url: string,
  content: string,
  options?: {
    signal?: AbortSignal;
    assertLease?: () => Promise<void>;
    beforeRequest?: () => Promise<boolean>;
    preparedSend?: PreparedWebhookSend;
  },
) => Promise<WebhookResult>;

function validateMarkdownContent(content: string): WebhookResult | null {
  if (isWecomMarkdownWithinLimit(content)) {
    return null;
  }
  return {
    ok: false,
    retries: 0,
    errorMessage: MARKDOWN_TOO_LONG_ERROR,
    retryable: false,
  };
}

function preparedWebhookSend(
  url: string,
  content: string,
  result: WebhookResult | null,
): PreparedWebhookSend {
  const prepared = Object.freeze({
    kind: 'prepared-wecom-webhook-send' as const,
  });
  preparedWebhookSends.set(prepared, { url, content, result });
  return prepared;
}

/**
 * Completes every potentially long pre-send step without creating a durable
 * SENDING ledger row. `notify` uses this before claiming; direct callers let
 * `sendWebhook` call it internally (including the owner test-channel action).
 */
export async function prepareWebhookSend(
  url: string,
  content: string,
  options: { signal?: AbortSignal } = {},
): Promise<PreparedWebhookSend> {
  options.signal?.throwIfAborted();
  if (!isValidWecomGroupBotWebhookUrl(url)) {
    return preparedWebhookSend(url, content, {
      ok: false,
      retries: 0,
      errorMessage: INVALID_WEBHOOK_URL_ERROR,
      retryable: false,
    });
  }
  const validationFailure = validateMarkdownContent(content);
  if (validationFailure) {
    return preparedWebhookSend(url, content, validationFailure);
  }

  try {
    await waitForWebhookSendSlot(url, {
      ...(options.signal ? { signal: options.signal } : {}),
    });
  } catch (error) {
    if (options.signal?.aborted && error === options.signal.reason) {
      throw error;
    }
    // Reservation failed before any external I/O, so a durable retry is safe.
    return preparedWebhookSend(url, content, {
      ok: false,
      retries: 0,
      errorMessage: THROTTLE_UNAVAILABLE_ERROR,
      retryable: true,
    });
  }
  return preparedWebhookSend(url, content, null);
}

/**
 * 真实 fetch 实现。Mock-mode 下走 `mockWebhookSender` 而不是这个。
 */
export const sendWebhook: WebhookSender = async (url, content, options) => {
  options?.signal?.throwIfAborted();
  const prepared =
    options?.preparedSend ??
    (await prepareWebhookSend(url, content, {
      ...(options?.signal ? { signal: options.signal } : {}),
    }));
  const preparedState = preparedWebhookSends.get(prepared);
  preparedWebhookSends.delete(prepared);
  const preparedResult: WebhookResult | null =
    !preparedState ||
    preparedState.url !== url ||
    preparedState.content !== content
      ? {
          ok: false,
          retries: 0,
          errorMessage: PRE_SEND_CHECK_UNAVAILABLE_ERROR,
          retryable: true,
        }
      : preparedState.result;
  try {
    options?.signal?.throwIfAborted();
    // Waiting can outlive a durable heartbeat. Prove ownership first; the
    // business freshness read below must remain the final await before fetch,
    // otherwise an async lease refresh could hide a generation change.
    await assertExecutionFence(options);
    if (options?.beforeRequest && !(await options.beforeRequest())) {
      return { ok: false, retries: 0, skipped: true };
    }
    options?.signal?.throwIfAborted();
  } catch (error) {
    if (options?.signal?.aborted && error === options.signal.reason) {
      throw error;
    }
    return {
      ok: false,
      retries: 0,
      errorMessage: PRE_SEND_CHECK_UNAVAILABLE_ERROR,
      retryable: true,
    };
  }

  // Even a locally prepared failure must yield to a stale business fact: a
  // superseded ORDER_COMPLETED delivery is terminal, not RETRYING.
  if (preparedResult) return preparedResult;

  const result = await sendOnce(url, content, options?.signal);
  if (result.kind === 'ok') {
    return { ok: true, retries: 0 };
  }
  return {
    ok: false,
    retries: 0,
    errorMessage: result.errorMessage,
    retryable: result.retry === 'defer',
    unknown: result.retry === 'unknown',
  };
};

/**
 * Mock-mode 实现：不真发 HTTP；合法内容立刻返成功，超长内容与真实发送
 * 使用同一校验。成功时 NotificationLog 仍写 status=SUCCESS（caller 决定
 * errorMessage='MOCK'）。
 */
export const mockWebhookSender: WebhookSender = async (
  _url,
  content,
  options,
) => {
  options?.signal?.throwIfAborted();
  try {
    // Mock durable deliveries still own a real ledger claim. Preserve the
    // same fence -> freshness ordering as the real adapter so a superseded
    // completion cannot be recorded as a successful mock delivery.
    await assertExecutionFence(options);
    if (options?.beforeRequest && !(await options.beforeRequest())) {
      return { ok: false, retries: 0, skipped: true };
    }
    options?.signal?.throwIfAborted();
  } catch (error) {
    if (options?.signal?.aborted && error === options.signal.reason) {
      throw error;
    }
    return {
      ok: false,
      retries: 0,
      errorMessage: PRE_SEND_CHECK_UNAVAILABLE_ERROR,
      retryable: true,
    };
  }
  return validateMarkdownContent(content) ?? { ok: true, retries: 0 };
};

// ─── internals ───

// 'none'      配置/内容错，谁都别再试
// 'defer'     明确限流，进程内再试无意义，交给 durable job 的退避
// 'unknown'   请求可能已被接受，没有下游幂等键时禁止自动重发
type SendOnceRetry = 'none' | 'defer' | 'unknown';

type SendOnceResult =
  | { kind: 'ok' }
  | { kind: 'fail'; retry: SendOnceRetry; errorMessage: string };

async function sendOnce(
  url: string,
  content: string,
  signal?: AbortSignal,
): Promise<SendOnceResult> {
  try {
    // AbortSignal.timeout(ms) 是 Node 24 内建（也在 modern fetch 标准里），
    // 不需要手动 setTimeout(controller.abort)。
    const res = await fetch(url, {
      method: 'POST',
      // 官方端点没有重定向契约；禁止 fetch 自动把含 key 的 URL 跟到
      // 其他 origin，3xx 会在下面作为永久 HTTP 失败处理。
      redirect: 'manual',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        msgtype: 'markdown',
        markdown: { content },
      }),
      signal: signal
        ? AbortSignal.any([signal, AbortSignal.timeout(TIMEOUT_MS)])
        : AbortSignal.timeout(TIMEOUT_MS),
    });
    if (res.ok) {
      // 企业微信成功响应也是 200，body 里 errcode != 0 才是真失败。按
      // RETRYABLE_WECOM_ERRCODES 分流：限流/系统繁忙退避后重试，key 失效
      // 之类的配置错直接判死，不占用 durable job 的 attempts。
      const json = (await res.json().catch(() => null)) as {
        errcode?: number;
        errmsg?: string;
      } | null;
      if (!json || typeof json.errcode !== 'number') {
        return {
          kind: 'fail',
          retry: 'unknown',
          errorMessage: 'invalid wecom response',
        };
      }
      if (json.errcode !== 0) {
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
        // A provider or reverse proxy can emit 5xx after the request has been
        // accepted and the message committed. Without a downstream idempotency
        // key, treating it as a definite rejection can multiply one message
        // across both the in-process and durable retry loops.
        retry: 'unknown',
        errorMessage: `http ${res.status}`,
      };
    }
    if (res.status === 408) {
      return {
        kind: 'fail',
        // A timeout response does not prove the request was rejected before
        // processing. Without provider idempotency, retrying can duplicate it.
        retry: 'unknown',
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
    // fetch 暴露的网络异常没有一个可靠字段能证明请求 body 尚未到达对端。
    // DNS/TLS 往往是发送前失败，但 connection reset 也可能发生在对端接收后；
    // 为了不把同一业务消息刷进群里，统一进入可观测 UNKNOWN。
    const name = err instanceof Error ? err.name : 'unknown';
    return {
      kind: 'fail',
      retry: 'unknown',
      errorMessage: name,
    };
  }
}
