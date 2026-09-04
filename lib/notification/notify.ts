import { createHash } from 'node:crypto';
import { db } from '../db';
import {
  NotificationChannelTransport,
  NotificationStatus,
  OrderStatus,
  type NotificationChannelTransport as NotificationChannelTransportType,
  type NotificationSmartBotChatType,
} from '../../generated/prisma/enums';
import { databaseNow } from '../background-jobs/clock';
import { assertExecutionFence } from '../execution-fence';
import {
  PRIVATE_EVENT_MAX_CHANNELS,
  NOTIFICATION_EVENTS,
  SUPERSEDED_BEFORE_SEND_ERROR,
  isPrivatePerCsEvent,
  sanitizeNotificationPayload,
  type NotificationEvent,
  type NotificationPayloadFor,
} from './events';
import { renderTemplate } from './render';
import {
  mockWebhookSender,
  prepareWebhookSend,
  sendWebhook,
  type PreparedWebhookSend,
  type WebhookResult,
  type WebhookSender,
} from './webhook';
import {
  claimDurableDelivery,
  finalizeDurableDelivery,
  reconcileAbandonedDurableDeliveries,
  recoverDurableDeliveryFinalization,
  NotificationDeliveryClaimConflictError,
  type DurableDeliveryFinalState,
  type DurableDeliveryClaim,
} from './delivery-ledger';
import { resolveManagementNotificationRoute } from './management-routing';
import {
  mockSmartBotSender,
  configuredSmartBotIdDigest,
  prepareSmartBotSend,
  sendSmartBot,
  smartBotDestinationFingerprint,
  type PreparedSmartBotSend,
  type SmartBotSender,
  type SmartBotTarget,
} from './smart-bot';

// notify(event, payload) 是企业微信推送的**唯一公开入口**（CLAUDE.md
// §7.1）。它把失败转写到 NotificationLog，并在 NotifyOutcome 上标出
// 「可安全重试」与「结果未知」；真正抛异常驱动 durable job 状态机的是
// handleNotificationJob。
//
// 流程：
//   1. 查 active rule by eventType；不存在 → 早 return（不写 log）
//   2. 渲染 messageTemplate（render.ts 留缺失 placeholder 原样）
//   3. 真实路径先等待共享 webhook permit；durable 路径随后逐
//      channel 原子写 SENDING + fencing token，再立即发送 webhook
//   4. 只有持有 token 的 worker 才能落 SUCCESS/FAILED/RETRYING/UNKNOWN；
//      已有 SUCCESS/FAILED/UNKNOWN/SENDING 的 channel 都不会被再次发送
//   5. 顶层 try/catch 兜底：连 DB 查 rule 都炸的极端场景 → console.error
//      + outcome.retryable=true
//
// 日志状态：发送前 SENDING；成功 SUCCESS；明确未送达且可重试 RETRYING；
// 永久失败 FAILED；无法证明送达与否 UNKNOWN。UNKNOWN 与遗留 SENDING 都是
// do-not-resend 状态，避免把网络歧义变成重复消息。
//
// Mock 模式：dev/test 默认开（DECISIONS 2026-04-27）；prod 显式 true 也
// 接受。Mock 下不真 fetch，只写 status=SUCCESS errorMessage='MOCK' log。

const MOCK_ERROR_MESSAGE = 'MOCK';
export function isMockMode(env: NodeJS.ProcessEnv = process.env): boolean {
  // dev/test 默认 mock；prod 显式开关。
  if (env.NOTIFICATION_MOCK_MODE === 'true') return true;
  if (env.NOTIFICATION_MOCK_MODE === 'false') return false;
  return env.NODE_ENV !== 'production';
}

export type NotifyOptions = {
  // 测试 / debug 注入：覆盖 webhook sender / mock 判定 / 时钟。
  // 普通调用方完全不传。
  webhookSender?: WebhookSender;
  smartBotSender?: SmartBotSender;
  mockMode?: boolean;
  now?: Date;
  signal?: AbortSignal;
  assertLease?: () => Promise<void>;

  // ↓ 以下两项只有 durable job 路径传（handleNotificationJob），
  //   同步调用点（dispatch 的 after() / void 降级）一律不传。

  // deliveryKey = BackgroundJob.dedupeKey：一次逻辑投递在多次 attempt
  // 之间的稳定标识。传了才启用 pre-send reservation + fencing；不传时是
  // 没有自动重试能力的 inline 路径。
  deliveryKey?: string;
  // BackgroundJob.attempts. Required with deliveryKey so a later job
  // generation can distinguish an abandoned SENDING row from a concurrent
  // observer in the same generation.
  deliveryAttempt?: number;
};

// 投递结论。notify 本身仍然**永不抛**（DECISIONS 2026-04-27 的 best-effort
// 契约不变，所有同步调用点因此不受影响）——「要不要重试」的决定权上交给
// handleNotificationJob，由它抛异常让 BackgroundJob 走 durable 重试
// （CLAUDE.md §15.4）。这里不抛的理由是硬的：dispatch.ts 有 `void notify()`，
// notify 一旦会抛，Node 24 默认 unhandled-rejections=throw 会把 web 进程打崩。
export type NotifyOutcome = {
  event: string;
  attempted: number; // 本次真发了 webhook 的 channel 数
  delivered: number; // 本次发送成功
  skipped: number; // 之前的 attempt 已成功、本次跳过（幂等去重）
  failed: number; // 本次失败（含 channel inactive）
  retryable: boolean; // 存在值得由 durable job 再试一轮的失败
  unknown: number; // 已开始发送但没有可信终态；禁止自动重发
  unlogged: number; // 已知失败但无法落 NotificationLog（如路由引用缺失 FK）
  errorCodes: string[]; // 去重后的脱敏错误码，进 job result 给 ops 看
};

/** A stale owner decision that cannot become valid by retrying the same job. */
export class NotificationReplayConflictError extends Error {
  readonly partialOutcome: NotifyOutcome;

  constructor(message: string, partialOutcome: NotifyOutcome) {
    super(message);
    this.name = 'NotificationReplayConflictError';
    this.partialOutcome = {
      ...partialOutcome,
      errorCodes: [...partialOutcome.errorCodes],
    };
  }
}

function emptyOutcome(event: string): NotifyOutcome {
  return {
    event,
    attempted: 0,
    delivered: 0,
    skipped: 0,
    failed: 0,
    retryable: false,
    unknown: 0,
    unlogged: 0,
    errorCodes: [],
  };
}

function recordErrorCode(outcome: NotifyOutcome, code: string): void {
  if (!outcome.errorCodes.includes(code)) outcome.errorCodes.push(code);
}

async function completionDeliveryIsCurrent(
  event: NotificationEvent,
  payload: Readonly<Record<string, unknown>>,
): Promise<boolean> {
  if (event !== NOTIFICATION_EVENTS.ORDER_COMPLETED) return true;
  const orderId = payload.orderId;
  if (typeof orderId !== 'string' || !orderId) return false;

  const order = await db.order.findUnique({
    where: { id: orderId },
    select: { status: true, workOrderVersion: true, completedAt: true },
  });
  if (!order?.completedAt) return false;
  // Cancellation does not create a new paper-work-order version and may keep
  // the historical completion timestamp. It must nevertheless suppress a
  // queued "completed" announcement that has not started external I/O yet.
  if (order.status === OrderStatus.CANCELLED) return false;

  const payloadVersion = payload.workOrderVersion;
  if (
    typeof payloadVersion === 'number' &&
    Number.isSafeInteger(payloadVersion) &&
    payloadVersion > 0
  ) {
    return order.workOrderVersion === payloadVersion;
  }

  // Compatibility for an already-enqueued pre-version payload. Only the
  // legacy terminal production state is safe to deliver without a generation.
  return order.status === OrderStatus.COMPLETED;
}

type DeliveryChannel = {
  id: string;
  transport?: NotificationChannelTransportType;
  webhookUrl: string | null;
  smartBotBotDigest: string | null;
  smartBotTargetId: string | null;
  smartBotChatType: NotificationSmartBotChatType | null;
  smartBotBoundAt: Date | null;
  isActive: boolean;
};

type PreparedChannelSend =
  | { transport: 'WECOM_GROUP_WEBHOOK'; value: PreparedWebhookSend }
  | { transport: 'WECOM_SMART_BOT'; value: PreparedSmartBotSend };

function smartBotTarget(channel: DeliveryChannel): SmartBotTarget | null {
  const configuredBotDigest = configuredSmartBotIdDigest();
  if (
    channel.transport !== NotificationChannelTransport.WECOM_SMART_BOT ||
    !configuredBotDigest ||
    channel.smartBotBotDigest !== configuredBotDigest ||
    !channel.smartBotTargetId ||
    !channel.smartBotChatType ||
    !channel.smartBotBoundAt
  ) {
    return null;
  }
  return {
    targetId: channel.smartBotTargetId,
    chatType: channel.smartBotChatType,
  };
}

type ChannelConfigurationFailure = Readonly<{
  reason: string;
  retryable: boolean;
}>;

function channelConfigurationFailure(
  channel: DeliveryChannel,
): ChannelConfigurationFailure | undefined {
  if (channel.transport !== NotificationChannelTransport.WECOM_SMART_BOT) {
    return channel.webhookUrl
      ? undefined
      : { reason: 'webhook endpoint missing', retryable: false };
  }
  if (
    channel.smartBotBotDigest &&
    channel.smartBotBotDigest !== configuredSmartBotIdDigest()
  ) {
    // Never hand this target to the currently configured Bot ID. The mismatch
    // is nevertheless recoverable by restoring the original Bot ID, so a
    // durable delivery must remain eligible for a later safe attempt.
    return { reason: 'smart bot identity changed', retryable: true };
  }
  return smartBotTarget(channel)
    ? undefined
    : { reason: 'smart bot target not bound', retryable: false };
}

function channelDestinationFingerprint(channel: DeliveryChannel): string {
  if (channel.transport === NotificationChannelTransport.WECOM_SMART_BOT) {
    const target = smartBotTarget(channel);
    const botId = process.env.WECOM_SMART_BOT_ID?.trim();
    if (target && botId) return smartBotDestinationFingerprint(botId, target);
  }
  return createHash('sha256')
    .update('notification-destination\0', 'utf8')
    .update(
      channel.transport ?? NotificationChannelTransport.WECOM_GROUP_WEBHOOK,
      'utf8',
    )
    .update('\0', 'utf8')
    .update(channel.webhookUrl ?? channel.smartBotTargetId ?? 'unconfigured', 'utf8')
    .digest('hex');
}

async function sendToChannel(
  outcome: NotifyOutcome,
  input: {
    channel: DeliveryChannel;
    messageContent: string;
    webhookSender: WebhookSender;
    smartBotSender: SmartBotSender;
    signal?: AbortSignal;
    assertLease?: () => Promise<void>;
    beforeRequest?: () => Promise<boolean>;
    preparedSend?: PreparedChannelSend;
    inactiveChannelRetryable: boolean;
    blockedReason?: string;
    blockedReasonRetryable?: boolean;
  },
): Promise<WebhookResult> {
  if (input.blockedReason || !input.channel.isActive) {
    try {
      // Local no-I/O outcomes still happen after a durable claim. Apply the
      // same post-claim business fence so an inactive replay cannot turn a
      // superseded completion into RETRYING.
      await assertExecutionFence({
        ...(input.signal ? { signal: input.signal } : {}),
        ...(input.assertLease ? { assertLease: input.assertLease } : {}),
      });
      if (input.beforeRequest && !(await input.beforeRequest())) {
        outcome.skipped += 1;
        return { ok: false, retries: 0, skipped: true };
      }
      input.signal?.throwIfAborted();
    } catch (error) {
      if (input.signal?.aborted && error === input.signal.reason) throw error;
      return {
        ok: false,
        retries: 0,
        errorMessage: 'webhook pre-send check unavailable',
        retryable: true,
      };
    }
  }
  if (input.blockedReason) {
    return {
      ok: false,
      retries: 0,
      errorMessage: input.blockedReason,
      retryable: input.blockedReasonRetryable === true,
    };
  }
  if (!input.channel.isActive) {
    return {
      ok: false,
      retries: 0,
      errorMessage: 'channel inactive',
      retryable: input.inactiveChannelRetryable,
    };
  }

  input.signal?.throwIfAborted();
  outcome.attempted += 1;
  try {
    const hasOptions = Boolean(
      input.signal ||
        input.assertLease ||
        input.beforeRequest ||
        input.preparedSend,
    );
    const commonOptions = {
      ...(input.signal ? { signal: input.signal } : {}),
      ...(input.assertLease ? { assertLease: input.assertLease } : {}),
      ...(input.beforeRequest ? { beforeRequest: input.beforeRequest } : {}),
    };
    let result: WebhookResult;
    if (input.channel.transport === NotificationChannelTransport.WECOM_SMART_BOT) {
      const target = smartBotTarget(input.channel);
      if (!target) {
        return {
          ok: false,
          retries: 0,
          errorMessage: 'smart bot target not bound',
          retryable: false,
        };
      }
      const prepared =
        input.preparedSend?.transport === 'WECOM_SMART_BOT'
          ? input.preparedSend.value
          : undefined;
      result = hasOptions
        ? await input.smartBotSender(target, input.messageContent, {
            ...commonOptions,
            ...(prepared ? { preparedSend: prepared } : {}),
          })
        : await input.smartBotSender(target, input.messageContent);
    } else {
      if (!input.channel.webhookUrl) {
        return {
          ok: false,
          retries: 0,
          errorMessage: 'webhook endpoint missing',
          retryable: false,
        };
      }
      const prepared =
        input.preparedSend?.transport === 'WECOM_GROUP_WEBHOOK'
          ? input.preparedSend.value
          : undefined;
      result = hasOptions
        ? await input.webhookSender(input.channel.webhookUrl, input.messageContent, {
            ...commonOptions,
            ...(prepared ? { preparedSend: prepared } : {}),
          })
        : await input.webhookSender(
            input.channel.webhookUrl,
            input.messageContent,
          );
    }
    if (result.skipped) {
      outcome.attempted -= 1;
      outcome.skipped += 1;
    }
    return result;
  } catch (error) {
    if (input.signal?.aborted && error === input.signal.reason) throw error;
    // The sender normally catches its own errors. An unexpected throw after
    // starting external I/O is ambiguous and must never become an auto-resend.
    return {
      ok: false,
      retries: 0,
      errorMessage: error instanceof Error ? error.name : 'sender error',
      retryable: false,
      unknown: true,
    };
  }
}

function classifyWebhookResult(
  result: WebhookResult,
  options: { durable: boolean; mock: boolean },
): {
  status: Exclude<NotificationStatus, 'SENDING'>;
  errorMessage: string | null;
  unknown: boolean;
  retryable: boolean;
} {
  const unknown = !result.ok && result.unknown === true;
  const retryable = !unknown && !result.ok && result.retryable === true;
  const status = result.ok
    ? NotificationStatus.SUCCESS
    : unknown
      ? NotificationStatus.UNKNOWN
      : retryable && options.durable
        ? NotificationStatus.RETRYING
        : NotificationStatus.FAILED;
  const errorMessage = result.ok
    ? options.mock
      ? MOCK_ERROR_MESSAGE
      : null
    : (result.errorMessage ?? 'unknown error');

  return { status, errorMessage, unknown, retryable };
}

function applyRecordedWebhookResult(
  outcome: NotifyOutcome,
  recorded: ReturnType<typeof classifyWebhookResult>,
): void {
  if (recorded.status === NotificationStatus.SUCCESS) {
    outcome.delivered += 1;
  } else if (recorded.status === NotificationStatus.UNKNOWN) {
    outcome.unknown += 1;
    recordErrorCode(
      outcome,
      recorded.errorMessage ?? 'delivery outcome unknown',
    );
  } else {
    outcome.failed += 1;
    if (recorded.retryable) {
      outcome.retryable = true;
    }
    recordErrorCode(outcome, recorded.errorMessage ?? 'unknown error');
  }
}

function recordWebhookResult(
  outcome: NotifyOutcome,
  result: WebhookResult,
  options: { durable: boolean; mock: boolean },
): ReturnType<typeof classifyWebhookResult> {
  const recorded = classifyWebhookResult(result, options);
  applyRecordedWebhookResult(outcome, recorded);
  return recorded;
}

function recordFromFinalState(
  finalState: DurableDeliveryFinalState,
): ReturnType<typeof classifyWebhookResult> {
  return {
    status: finalState.status,
    errorMessage: finalState.errorMessage,
    unknown: finalState.status === NotificationStatus.UNKNOWN,
    retryable: finalState.status === NotificationStatus.RETRYING,
  };
}

async function finalizeClaimedDelivery(
  event: NotificationEvent,
  input: Parameters<typeof finalizeDurableDelivery>[0],
): Promise<DurableDeliveryFinalState> {
  try {
    await finalizeDurableDelivery(input);
    return { status: input.status, errorMessage: input.errorMessage };
  } catch (error) {
    try {
      const recovered = await recoverDurableDeliveryFinalization(input);
      console.warn(
        `[notify] recovered delivery finalization event=${event} channel=${input.channelId} status=${recovered.status}`,
      );
      return recovered;
    } catch (recoveryError) {
      console.error(
        `[notify] failed to recover delivery finalization event=${event} channel=${input.channelId}`,
        recoveryError instanceof Error ? recoveryError.name : 'UnknownError',
      );
      throw error;
    }
  }
}

function recordUnclaimedDelivery(
  outcome: NotifyOutcome,
  claim: Exclude<DurableDeliveryClaim, { claimed: true }>,
  unknownAlreadyRecorded = false,
): void {
  if (claim.status === NotificationStatus.SUCCESS) {
    outcome.skipped += 1;
    return;
  }
  if (claim.status === NotificationStatus.FAILED) {
    outcome.failed += 1;
    recordErrorCode(
      outcome,
      claim.errorMessage ?? 'previous permanent delivery failure',
    );
    return;
  }

  // SENDING may be a genuinely concurrent owner or a process that died after
  // HTTP. UNKNOWN is already terminal. Neither may be sent automatically.
  if (unknownAlreadyRecorded && claim.status === NotificationStatus.UNKNOWN) {
    return;
  }
  outcome.unknown += 1;
  recordErrorCode(
    outcome,
    claim.errorMessage ?? 'delivery outcome unknown',
  );
}

async function deliverClaimedChannel(
  outcome: NotifyOutcome,
  input: {
    event: NotificationEvent;
    channel: DeliveryChannel;
    messageContent: string;
    deliveryKey: string;
    deliveryAttempt: number;
    attemptId: string;
    webhookSender: WebhookSender;
    smartBotSender: SmartBotSender;
    mock: boolean;
    signal?: AbortSignal;
    assertLease?: () => Promise<void>;
    beforeRequest?: () => Promise<boolean>;
    preparedSend?: PreparedChannelSend;
    inactiveChannelRetryable: boolean;
    blockedReason?: string;
    blockedReasonRetryable?: boolean;
  },
): Promise<void> {
  const result = await sendToChannel(outcome, input);
  if (result.skipped) {
    // The business fact changed after the global-permit wait but before fetch.
    // Close the fenced SENDING row as a permanent, explicitly superseded
    // terminal record. No external request occurred and the owning job must
    // succeed without an automatic resend.
    const finalState = await finalizeClaimedDelivery(input.event, {
      deliveryKey: input.deliveryKey,
      channelId: input.channel.id,
      attemptId: input.attemptId,
      jobAttempt: input.deliveryAttempt,
      status: NotificationStatus.FAILED,
      errorMessage: SUPERSEDED_BEFORE_SEND_ERROR,
      retryCount: 0,
      sent: false,
    });
    if (
      finalState.status !== NotificationStatus.FAILED ||
      finalState.errorMessage !== SUPERSEDED_BEFORE_SEND_ERROR
    ) {
      outcome.skipped -= 1;
      applyRecordedWebhookResult(outcome, recordFromFinalState(finalState));
    }
    return;
  }
  const recorded = classifyWebhookResult(result, {
    durable: true,
    mock: input.mock,
  });

  let finalState: DurableDeliveryFinalState;
  try {
    finalState = await finalizeClaimedDelivery(input.event, {
      deliveryKey: input.deliveryKey,
      channelId: input.channel.id,
      attemptId: input.attemptId,
      jobAttempt: input.deliveryAttempt,
      status: recorded.status,
      errorMessage: recorded.errorMessage,
      retryCount: result.retries,
      sent: result.ok,
    });
  } catch (error) {
    // External I/O already started. If neither finalization statement can
    // establish a terminal row, keep the job retryable rather than terminating
    // it before a later generation can reconcile SENDING into visible UNKNOWN.
    // The reservation itself remains a durable do-not-resend fence.
    outcome.retryable = true;
    recordErrorCode(
      outcome,
      error instanceof Error ? error.name : 'NotificationLedgerError',
    );
    throw error;
  }
  applyRecordedWebhookResult(outcome, recordFromFinalState(finalState));
}

async function persistInlineDeliveryLog(
  outcome: NotifyOutcome,
  input: {
    event: NotificationEvent;
    channelId: string;
    messageContent: string;
    result: WebhookResult;
    recorded: ReturnType<typeof recordWebhookResult>;
    relatedOrderId: string | null;
    destinationFingerprint: string;
    now: Date;
  },
): Promise<void> {
  // Inline/dev path has no durable retry key and retains best-effort log
  // semantics. Any missing log is returned as an explicit unknown outcome.
  try {
    await db.notificationLog.create({
      data: {
        eventType: input.event,
        channelId: input.channelId,
        destinationFingerprint: input.destinationFingerprint,
        messageContent: input.messageContent,
        status: input.recorded.status,
        errorMessage: input.recorded.errorMessage,
        retryCount: input.result.retries,
        relatedOrderId: input.relatedOrderId,
        sentAt: input.result.ok ? input.now : null,
        lastAttemptAt: input.now,
      },
    });
  } catch {
    // log 写入失败不能再抛（业务已成功）。落到 console.error 让
    // ops 能从 stdout 抓到。
    console.error(
      `[notify] failed to write NotificationLog event=${input.event} channel=${input.channelId}`,
    );
    // 送达了却没留下凭证 = 下一次 attempt 认不出这个 channel 已经成功，
    // 会重复推一条。计数上报到 job result，让 ops 能把「群里看到两条」
    // 对上号。这是本方案 at-least-once 的已知边界。
    if (input.result.ok || input.recorded.unknown) {
      outcome.unlogged += 1;
      outcome.unknown += input.recorded.unknown ? 0 : 1;
    }
  }
}

export async function notify<E extends NotificationEvent>(
  event: E,
  payload: NotificationPayloadFor<E>,
  opts: NotifyOptions = {},
): Promise<NotifyOutcome> {
  const outcome = emptyOutcome(event);
  try {
    const safePayload = sanitizeNotificationPayload(event, payload);
    const mock = opts.mockMode ?? isMockMode();
    const webhookSender: WebhookSender =
      opts.webhookSender ?? (mock ? mockWebhookSender : sendWebhook);
    const smartBotSender: SmartBotSender =
      opts.smartBotSender ?? (mock ? mockSmartBotSender : sendSmartBot);
    const now = opts.now ?? (await databaseNow());
    const deliveryKey = opts.deliveryKey;
    let reconciledChannelIds = new Set<string>();
    if (deliveryKey) {
      if (
        !Number.isSafeInteger(opts.deliveryAttempt) ||
        (opts.deliveryAttempt ?? 0) < 1
      ) {
        throw new Error('durable notification delivery attempt is missing');
      }
      reconciledChannelIds = new Set(
        await reconcileAbandonedDurableDeliveries({
          deliveryKey,
          jobAttempt: opts.deliveryAttempt!,
        }),
      );
      if (reconciledChannelIds.size > 0) {
        outcome.unknown += reconciledChannelIds.size;
        recordErrorCode(
          outcome,
          'worker lease ended before delivery was finalized',
        );
      }
    }

    const rule = await db.notificationRule.findUnique({
      where: { eventType: event },
      select: {
        eventType: true,
        channelIds: true,
        messageTemplate: true,
        isActive: true,
      },
    });
    if (!rule || !rule.isActive) {
      // 没规则 / 关闭了：不写 log。"事件根本没配置"是一种正常状态——
      // 比如 STOCK_ALERT 在本波 P1 #2 是&ldquo;接口在但没配规则&rdquo;。
      return outcome;
    }
    const managementRoute = await resolveManagementNotificationRoute(event);
    if (managementRoute && !managementRoute.enabled) {
      // 管理事件的收件角色已明确关闭。不能回退到 rule.channelIds，
      // 否则可以绕过角色开关，也会让事件→角色真值变成可配置。
      return outcome;
    }
    const configuredChannelIds = managementRoute
      ? managementRoute.channelIds
      : rule.channelIds;
    if (configuredChannelIds.length === 0) {
      // 配了规则但没绑 channel：等同&ldquo;开了 active 却没收件人&rdquo;。
      // 没法写 NotificationLog（channelId 是 FK 必填），只能打
      // console 让 ops 看到。Slice B 的 admin UI 会在 isActive=true
      // && channelIds=[] 时拒绝保存，杜绝这条路径。
      console.warn(
        `[notify] ${managementRoute ? `management role ${managementRoute.role}` : 'rule'} active but channelIds empty event=${event}`,
      );
      // 配置问题，重试一万次也还是没有收件人 → retryable 保持 false。
      return outcome;
    }

    // 渲染一次，所有 channel 共用同一份 content（同事件就是同消息）。
    const content = renderTemplate(rule.messageTemplate, safePayload);

    // **去重 + 保序**：存量 rule.channelIds 可能含重复 id（schema String[]
    // 不强制 unique）。先 dedupe 出 unique 列表，
    // 后续 stale 比较和 reorder 都基于这条（避免 round 118 medium：
    // 用 raw rule.channelIds.length 做 stale 比较会把&ldquo;有重复&rdquo;误报成
    // &ldquo;有 stale id&rdquo;）。
    const uniqueConfiguredChannelIds = Array.from(
      new Set(configuredChannelIds),
    );

    // 拉到所有引用的 channel——**不**过滤 isActive。下面分流：active
    // 真发送，inactive 写 FAILED log（避免&ldquo;启用 channel 又被关&rdquo;的
    // 静默漏推）。
    const fetched = await db.notificationChannel.findMany({
      where: { id: { in: uniqueConfiguredChannelIds } },
      select: {
        id: true,
        transport: true,
        webhookUrl: true,
        smartBotBotDigest: true,
        smartBotTargetId: true,
        smartBotChatType: true,
        smartBotBoundAt: true,
        isActive: true,
      },
    });
    // **PG `IN (...)` 不保证返回顺序**——必须按配置 ID 顺
    // 序重排。否则 CS_PERIOD_* runtime cap 的
    // slice(0, 1) 会随机选 channel：legacy `['owner-group', 'sales-
    // group']` 可能把客服金额发到 sales-group 而漏 owner-group。
    const byId = new Map(fetched.map((c) => [c.id, c]));
    const channels = uniqueConfiguredChannelIds
      .map((id) => byId.get(id))
      .filter((c): c is NonNullable<typeof c> => c !== undefined);
    const missingChannelCount =
      uniqueConfiguredChannelIds.length - channels.length;
    const managementRouteBlocked = Boolean(
      managementRoute &&
        (missingChannelCount > 0 ||
          channels.some(
            (channel) =>
              !channel.isActive || Boolean(channelConfigurationFailure(channel)),
          )),
    );

    // 托管的五类管理事件用更严的 all-or-nothing 收件人契约：
    // 任意 ID 已删除或已停用时整次不发，不把同一条管理通知只发给
    // 半数收件群，也不回退到 NotificationRule.channelIds。已存在的
    // channel 仍走下面的 ledger，落永久 FAILED；缺失 ID 因 FK 无法写
    // NotificationLog，必须显式计入 durable job.result 的 failed/unlogged。
    if (managementRoute && managementRouteBlocked) {
      console.warn(
        `[notify] management route fail-closed event=${event} role=${managementRoute.role} configured=${uniqueConfiguredChannelIds.length} found=${channels.length} inactive=${channels.filter((channel) => !channel.isActive).length}`,
      );
      if (missingChannelCount > 0) {
        outcome.failed += missingChannelCount;
        outcome.unlogged += missingChannelCount;
        recordErrorCode(outcome, 'management channel missing');
      }
    }
    if (channels.length === 0) {
      if (managementRouteBlocked) return outcome;
      // channelIds 全是 stale ID（指向已删 channel）。FK 不让我们
      // 写 NotificationLog，只能打 console。Slice B 的 channel 删
      // 除会拒绝&ldquo;有 active rule 引用&rdquo;的 channel，杜绝此路径。
      console.warn(
        `[notify] rule active but all channelIds stale event=${event}`,
      );
      // 同上：指向已删 channel 是配置问题，不该占用 job 的 attempts。
      return outcome;
    }
    if (channels.length < uniqueConfiguredChannelIds.length) {
      // 部分 unique ID stale（其他还能用）—— 打 console 提示。
      // 用 unique 而非 raw rule.channelIds 比较，避免重复 id 误报。
      console.warn(
        `[notify] some channelIds stale event=${event} have=${channels.length} expected=${uniqueConfiguredChannelIds.length}`,
      );
    }

    // **Runtime privacy cap for CS_PERIOD_***：
    // updateRuleWithGuard 是写时校验，对升级前已存在的多 channel 行
    // 无效。这里 send-side cap 兜底——CS_PERIOD_* 含具体客服业绩 /
    // 提成数据，绑多 channel 会让所有群看到所有客服金额。运行时 slice
    // 到 PRIVATE_EVENT_MAX_CHANNELS 并 console.warn，让 ops 知道有
    // legacy 配置该 owner 手动清理（schema 加 per-user 路由前的兜底）。
    let effectiveChannels = channels;
    if (
      isPrivatePerCsEvent(event) &&
      effectiveChannels.length > PRIVATE_EVENT_MAX_CHANNELS
    ) {
      console.warn(
        `[notify] CS_PERIOD privacy cap event=${event} configured=${effectiveChannels.length} sending_to=${PRIVATE_EVENT_MAX_CHANNELS} (legacy config; owner please trim in /owner/notifications)`,
      );
      effectiveChannels = effectiveChannels.slice(
        0,
        PRIVATE_EVENT_MAX_CHANNELS,
      );
    }

    // payload.orderId / outsourceId / periodId 任一存在就关联到日志，
    // 让 dashboard 后期能 join 反查。仅 Order 是被 schema 显式索引的
    // (relatedOrderId)；其他 fk 暂留 null（schema 没建对应列）。
    const relatedOrderId = extractOrderId(safePayload);

    // Durable 路径不是“发完再写日志”。真实发送先在不写
    // SENDING 的情况下等待全局 permit；随后用唯一键原子预留
    // SENDING + fencing token，只有拿到 token 的 attempt 才能做外部 I/O。
    // SUCCESS/FAILED/UNKNOWN 都是单调终态；只有明确未送达的 RETRYING 可重领。
    const beforeRequest =
      event === NOTIFICATION_EVENTS.ORDER_COMPLETED
        ? () =>
            completionDeliveryIsCurrent(
              event,
              safePayload as Readonly<Record<string, unknown>>,
            )
        : undefined;

    // 顺序处理（不并行）：单 server action 触发 1-2 channel 不并行无
    // 影响；并行会让 NotificationLog 写入顺序乱，dashboard 显示&ldquo;时
    // 间倒置&rdquo;。
    for (const channel of effectiveChannels) {
      // A successful check refreshes the database lease immediately before
      // the channel reservation/external I/O. If ownership is uncertain, do
      // not begin a webhook request.
      await opts.assertLease?.();
      opts.signal?.throwIfAborted();

      // An ORDER_COMPLETED job can wait behind other LIGHT work while an
      // approved change creates a newer paper-work-order generation. Re-read
      // immediately before each external request; the stale generation is a
      // deliberate skip, not a delivery failure worth retrying.
      if (
        !(await completionDeliveryIsCurrent(
          event,
          safePayload as Readonly<Record<string, unknown>>,
        ))
      ) {
        outcome.skipped += 1;
        continue;
      }

      const configurationFailure = channelConfigurationFailure(channel);
      const blockedReason =
        managementRouteBlocked && channel.isActive
          ? 'management route incomplete'
          : configurationFailure?.reason;
      const blockedReasonRetryable =
        !managementRouteBlocked && configurationFailure?.retryable === true;
      let preparedSend: PreparedChannelSend | undefined;
      if (
        webhookSender === sendWebhook &&
        channel.transport !== NotificationChannelTransport.WECOM_SMART_BOT &&
        channel.webhookUrl &&
        channel.isActive &&
        !blockedReason
      ) {
        // The only potentially long wait happens before a durable SENDING row
        // exists. Lease loss here therefore cannot create a false UNKNOWN.
        preparedSend = {
          transport: 'WECOM_GROUP_WEBHOOK',
          value: await prepareWebhookSend(channel.webhookUrl, content, {
            ...(opts.signal ? { signal: opts.signal } : {}),
          }),
        };

        // ORDER_COMPLETED may become stale while waiting behind another event
        // for this same destination. Recheck before claiming the ledger.
        if (
          !(await completionDeliveryIsCurrent(
            event,
            safePayload as Readonly<Record<string, unknown>>,
          ))
        ) {
          outcome.skipped += 1;
          continue;
        }
        await opts.assertLease?.();
        opts.signal?.throwIfAborted();
      } else if (
        smartBotSender === sendSmartBot &&
        channel.transport === NotificationChannelTransport.WECOM_SMART_BOT &&
        channel.isActive &&
        !blockedReason
      ) {
        const target = smartBotTarget(channel);
        if (target) {
          preparedSend = {
            transport: 'WECOM_SMART_BOT',
            value: await prepareSmartBotSend(target, content, {
              ...(opts.signal ? { signal: opts.signal } : {}),
            }),
          };
        }

        if (
          !(await completionDeliveryIsCurrent(
            event,
            safePayload as Readonly<Record<string, unknown>>,
          ))
        ) {
          outcome.skipped += 1;
          continue;
        }
        await opts.assertLease?.();
        opts.signal?.throwIfAborted();
      }

      const destinationFingerprint = channelDestinationFingerprint(channel);

      if (deliveryKey) {
        if (
          !Number.isSafeInteger(opts.deliveryAttempt) ||
          (opts.deliveryAttempt ?? 0) < 1
        ) {
          throw new Error('durable notification delivery attempt is missing');
        }
        const claim = await claimDurableDelivery({
          deliveryKey,
          jobAttempt: opts.deliveryAttempt!,
          eventType: event,
          channelId: channel.id,
          destinationFingerprint,
          messageContent: content,
          relatedOrderId,
        });
        if (!claim.claimed) {
          recordUnclaimedDelivery(
            outcome,
            claim,
            reconciledChannelIds.has(channel.id),
          );
          continue;
        }
        await deliverClaimedChannel(outcome, {
          event,
          channel,
          messageContent: content,
          deliveryKey,
          deliveryAttempt: opts.deliveryAttempt!,
          attemptId: claim.attemptId,
          webhookSender,
          smartBotSender,
          mock,
          ...(opts.signal ? { signal: opts.signal } : {}),
          ...(opts.assertLease ? { assertLease: opts.assertLease } : {}),
          ...(beforeRequest ? { beforeRequest } : {}),
          ...(preparedSend ? { preparedSend } : {}),
          // A channel disabled before an initial delivery is a permanent
          // configuration failure, not a reason to burn the job retry budget.
          inactiveChannelRetryable: false,
          ...(blockedReason
            ? { blockedReason, blockedReasonRetryable }
            : {}),
        });
        continue;
      }

      const result = await sendToChannel(outcome, {
        channel,
        messageContent: content,
        webhookSender,
        smartBotSender,
        ...(opts.signal ? { signal: opts.signal } : {}),
        ...(opts.assertLease ? { assertLease: opts.assertLease } : {}),
        ...(beforeRequest ? { beforeRequest } : {}),
        ...(preparedSend ? { preparedSend } : {}),
        inactiveChannelRetryable: false,
        ...(blockedReason ? { blockedReason, blockedReasonRetryable } : {}),
      });
      if (result.skipped) continue;
      const recorded = recordWebhookResult(outcome, result, {
        durable: false,
        mock,
      });
      await persistInlineDeliveryLog(outcome, {
        event,
        channelId: channel.id,
        messageContent: content,
        result,
        recorded,
        relatedOrderId,
        destinationFingerprint,
        now,
      });
    }
    return outcome;
  } catch (err) {
    // A durable worker's lease signal is a fencing boundary, not a delivery
    // failure to translate. Preserve the original lease error so the worker
    // can stop without a stale fail/complete write.
    if (opts.signal?.aborted && err === opts.signal.reason) throw err;
    // 顶层兜底：连 db.notificationRule.findUnique 都炸（连接断开 / schema
    // drift）的极端情况。返回显式失败结论；durable handler 会据此抛出。
    console.error(
      `[notify] uncaught error event=${event}:`,
      err instanceof Error ? err.name : err,
    );
    // 但**要**把它标成可重试：这类是基础设施故障，一条都没发出去，durable
    // job 该再来一次。同步调用点忽略返回值，行为不变。
    outcome.retryable = true;
    recordErrorCode(outcome, err instanceof Error ? err.name : 'UnknownError');
    return outcome;
  }
}

export type ManualNotificationReplayTarget = {
  logId: string;
  stateVersion: number;
};

/**
 * Replay owner-confirmed-not-delivered rows without consulting the current
 * rule, channel list or message template. The original log pins the recipient
 * and rendered content. A destination fingerprint prevents a changed endpoint
 * or rebound bot target from silently receiving an old replay.
 */
export async function replayDurableNotificationLogs(
  event: NotificationEvent,
  options: {
    deliveryKey: string;
    deliveryAttempt: number;
    targets: readonly ManualNotificationReplayTarget[];
    /** Original job payload, used to reject stale order generations. */
    payload?: Readonly<Record<string, unknown>>;
    signal?: AbortSignal;
    assertLease?: () => Promise<void>;
    webhookSender?: WebhookSender;
    smartBotSender?: SmartBotSender;
    mockMode?: boolean;
  },
): Promise<NotifyOutcome> {
  const outcome = emptyOutcome(event);
  try {
    if (
      !Number.isSafeInteger(options.deliveryAttempt) ||
      options.deliveryAttempt < 1 ||
      options.targets.length === 0
    ) {
      throw new Error('invalid manual notification replay target');
    }
    const mock = options.mockMode ?? isMockMode();
    const webhookSender =
      options.webhookSender ?? (mock ? mockWebhookSender : sendWebhook);
    const smartBotSender =
      options.smartBotSender ?? (mock ? mockSmartBotSender : sendSmartBot);

    for (const target of options.targets) {
      await options.assertLease?.();
      options.signal?.throwIfAborted();

      // An owner confirming "not delivered" authorizes a transport retry,
      // not delivery of business information that has since become false.
      // Reuse the normal ORDER_COMPLETED generation/cancellation fence before
      // every replay target and before reading/claiming its delivery ledger.
      if (
        !(await completionDeliveryIsCurrent(event, options.payload ?? {}))
      ) {
        outcome.skipped += 1;
        continue;
      }

      const log = await db.notificationLog.findUnique({
        where: { id: target.logId },
        select: {
          id: true,
          deliveryKey: true,
          eventType: true,
          status: true,
          destinationFingerprint: true,
          messageContent: true,
          relatedOrderId: true,
          deliveryStateVersion: true,
          deliveryJobAttempt: true,
          channel: {
            select: {
              id: true,
              transport: true,
              webhookUrl: true,
              smartBotBotDigest: true,
              smartBotTargetId: true,
              smartBotChatType: true,
              smartBotBoundAt: true,
              isActive: true,
            },
          },
        },
      });
      if (
        !log ||
        log.deliveryKey !== options.deliveryKey ||
        log.eventType !== event ||
        log.deliveryStateVersion < target.stateVersion
      ) {
        throw new NotificationReplayConflictError(
          'manual notification replay ledger mismatch',
          outcome,
        );
      }

      if (log.status === NotificationStatus.SUCCESS) {
        outcome.skipped += 1;
        continue;
      }
      if (log.status === NotificationStatus.FAILED) {
        outcome.failed += 1;
        recordErrorCode(outcome, 'previous permanent delivery failure');
        continue;
      }
      if (log.status !== NotificationStatus.RETRYING) {
        outcome.unknown += 1;
        recordErrorCode(outcome, 'delivery outcome requires owner review');
        continue;
      }

      const destinationFingerprint = channelDestinationFingerprint(log.channel);
      // Rows created before destination pinning cannot prove which historical
      // recipient the owner reviewed. Fail closed instead of filling the new
      // column from today's channel and potentially replaying an old message
      // into a different group.
      if (
        !log.destinationFingerprint ||
        log.destinationFingerprint !== destinationFingerprint
      ) {
        throw new NotificationReplayConflictError(
          'manual notification replay destination changed',
          outcome,
        );
      }

      const exactOwnerResolution =
        log.deliveryStateVersion === target.stateVersion;
      const safeAutomaticContinuation =
        log.deliveryStateVersion > target.stateVersion &&
        log.deliveryJobAttempt !== null &&
        log.deliveryJobAttempt < options.deliveryAttempt;
      if (!exactOwnerResolution && !safeAutomaticContinuation) {
        throw new NotificationReplayConflictError(
          'manual notification replay state generation mismatch',
          outcome,
        );
      }

      const beforeRequest = () =>
        completionDeliveryIsCurrent(event, options.payload ?? {});
      let preparedSend: PreparedChannelSend | undefined;
      if (
        webhookSender === sendWebhook &&
        log.channel.transport !== NotificationChannelTransport.WECOM_SMART_BOT &&
        log.channel.webhookUrl &&
        log.channel.isActive
      ) {
        preparedSend = {
          transport: 'WECOM_GROUP_WEBHOOK',
          value: await prepareWebhookSend(
            log.channel.webhookUrl,
            log.messageContent,
            { ...(options.signal ? { signal: options.signal } : {}) },
          ),
        };
        if (!(await beforeRequest())) {
          outcome.skipped += 1;
          continue;
        }
        await options.assertLease?.();
        options.signal?.throwIfAborted();
      } else if (
        smartBotSender === sendSmartBot &&
        log.channel.transport === NotificationChannelTransport.WECOM_SMART_BOT &&
        log.channel.isActive
      ) {
        const smartTarget = smartBotTarget(log.channel);
        if (smartTarget) {
          preparedSend = {
            transport: 'WECOM_SMART_BOT',
            value: await prepareSmartBotSend(
              smartTarget,
              log.messageContent,
              { ...(options.signal ? { signal: options.signal } : {}) },
            ),
          };
        }
        if (!(await beforeRequest())) {
          outcome.skipped += 1;
          continue;
        }
        await options.assertLease?.();
        options.signal?.throwIfAborted();
      }

      let claim: DurableDeliveryClaim;
      try {
        claim = await claimDurableDelivery({
          deliveryKey: options.deliveryKey,
          jobAttempt: options.deliveryAttempt,
          eventType: event,
          channelId: log.channel.id,
          destinationFingerprint,
          // This is the content the owner inspected before choosing resend.
          messageContent: log.messageContent,
          relatedOrderId: log.relatedOrderId,
          // The row was read immediately above. Claiming with this exact
          // version closes the read -> webhook ABA window; deliveryJobAttempt
          // additionally rejects a paused worker from an older job generation.
          expectedStateVersion: log.deliveryStateVersion,
        });
      } catch (error) {
        if (error instanceof NotificationDeliveryClaimConflictError) {
          throw new NotificationReplayConflictError(error.message, outcome);
        }
        throw error;
      }
      if (!claim.claimed) {
        recordUnclaimedDelivery(outcome, claim);
        continue;
      }

      const configurationFailure = channelConfigurationFailure(log.channel);
      await deliverClaimedChannel(outcome, {
        event,
        channel: log.channel,
        messageContent: log.messageContent,
        deliveryKey: options.deliveryKey,
        deliveryAttempt: options.deliveryAttempt,
        attemptId: claim.attemptId,
        webhookSender,
        smartBotSender,
        mock,
        ...(options.signal ? { signal: options.signal } : {}),
        ...(options.assertLease ? { assertLease: options.assertLease } : {}),
        ...(event === NOTIFICATION_EVENTS.ORDER_COMPLETED
          ? { beforeRequest }
          : {}),
        ...(preparedSend ? { preparedSend } : {}),
        // The owner explicitly chose the original recipient. Keep it pinned
        // and retry only after that same channel is re-enabled.
        inactiveChannelRetryable: true,
        ...(configurationFailure
          ? {
              blockedReason: configurationFailure.reason,
              blockedReasonRetryable: configurationFailure.retryable,
            }
          : {}),
      });
    }
    return outcome;
  } catch (error) {
    if (options.signal?.aborted && error === options.signal.reason) throw error;
    if (error instanceof NotificationReplayConflictError) throw error;
    console.error(
      `[notify:manual-replay] uncaught error event=${event}:`,
      error instanceof Error ? error.name : error,
    );
    outcome.retryable = true;
    recordErrorCode(
      outcome,
      error instanceof Error ? error.name : 'UnknownError',
    );
    return outcome;
  }
}

// payload.orderId 提取 —— TS 类型已经约束 ORDER_* 事件必有 orderId，
// 但 OUTSOURCE_OVERDUE / CS_PERIOD_* / DAILY_WORKER_SALARY 没有。
// 用 unknown 类型保护读出。
function extractOrderId(payload: unknown): string | null {
  if (typeof payload !== 'object' || payload === null) return null;
  const v = (payload as Record<string, unknown>).orderId;
  return typeof v === 'string' ? v : null;
}
