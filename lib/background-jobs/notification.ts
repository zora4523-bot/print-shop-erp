import { randomUUID } from 'node:crypto';
import { BackgroundJobQueue, Prisma } from '../../generated/prisma/client';
import {
  NOTIFICATION_EVENTS,
  type NotificationEvent,
  type NotificationPayloadFor,
} from '../notification/events';
import {
  notify,
  NotificationReplayConflictError,
  replayDurableNotificationLogs,
  type ManualNotificationReplayTarget,
  type NotifyOutcome,
} from '../notification/notify';
import { databaseNow } from './clock';
import {
  enqueueBackgroundJob,
  type EnqueueClient,
} from './repository';
import { BACKGROUND_JOB_TYPES, type ClaimedBackgroundJob } from './types';

const EVENT_SET: ReadonlySet<string> = new Set(
  Object.values(NOTIFICATION_EVENTS),
);

// 企业微信群机器人是 20 条/分钟。批量扇出（逾期工单可以有 200 张，见
// ORDER_OVERDUE_NOTIFY_CAP）如果一股脑入队，LIGHT worker 会在几秒内把整批
// 打出去，除了前 20 条全部 429 / errcode 45009；退避总窗口只有
// 30+60+120+240s，再来几轮还是同样的 burst，最后整批 DEAD —— 通知没送到，
// 死信队列还被灌满。所以按序把 availableAt 摊开，让出队速率天然低于限额。
//
// 3500ms ≈ 17 条/分钟，留了一点余量给同一个群的其它事件。
const FANOUT_SPACING_MS = 3_500;

export async function enqueueNotificationJob<E extends NotificationEvent>(
  event: E,
  payload: NotificationPayloadFor<E>,
  options: { dedupeKey?: string; spreadIndex?: number } = {},
  client?: EnqueueClient,
): Promise<{ jobId: string; created: boolean; requeued: boolean }> {
  const body = JSON.parse(JSON.stringify({ event, payload })) as Prisma.InputJsonValue;
  const { job, created, requeued } = await enqueueBackgroundJob({
    type: BACKGROUND_JOB_TYPES.NOTIFICATION,
    queue: BackgroundJobQueue.LIGHT,
    dedupeKey:
      options.dedupeKey ?? `notification:${event}:${randomUUID()}`,
    payload: body,
    // Official common-error guidance caps retries for errcode -1 at three.
    // maxAttempts includes the first delivery, so 4 = initial + 3 retries.
    maxAttempts: 4,
    priority: 200,
    // availableAt 最终由 claim 的数据库 now() 判断，因此排队节流的基准也
    // 必须来自数据库。Web 主机慢 5 分钟时，Date.now()+slot 会让前约 85 个
    // slot 入库即过期，整批瞬间出队、直接撞上企业微信 20 条/分钟限额。
    // spreadIndex 缺省或为 0 时仍留 undefined，使用列的数据库 now() 默认值。
    availableAt: await spreadAvailableAt(options.spreadIndex, client),
  }, client);
  return { jobId: job.id, created, requeued };
}

async function spreadAvailableAt(
  spreadIndex: number | undefined,
  client?: EnqueueClient,
): Promise<Date | undefined> {
  if (typeof spreadIndex !== 'number' || !Number.isFinite(spreadIndex)) {
    return undefined;
  }
  const slot = Math.max(0, Math.floor(spreadIndex));
  if (slot === 0) return undefined;
  const at = await databaseNow(client);
  return new Date(at.getTime() + slot * FANOUT_SPACING_MS);
}

export async function handleNotificationJob(
  job: ClaimedBackgroundJob,
): Promise<Prisma.InputJsonValue> {
  const body = asRecord(job.payload);
  const event = body.event;
  const payload = body.payload;
  if (
    typeof event !== 'string' ||
    !EVENT_SET.has(event) ||
    !payload ||
    typeof payload !== 'object' ||
    Array.isArray(payload)
  ) {
    throw new InvalidNotificationJobPayloadError();
  }

  const replayTargets = manualReplayTargets(body.manualReplay);
  let replayConflict = false;
  let outcome: NotifyOutcome;
  if (replayTargets) {
    try {
      outcome = await replayDurableNotificationLogs(event as NotificationEvent, {
        deliveryKey: job.dedupeKey,
        deliveryAttempt: job.attempts,
        targets: replayTargets,
        payload: payload as Record<string, unknown>,
        ...(job.signal ? { signal: job.signal } : {}),
        ...(job.assertLease ? { assertLease: job.assertLease } : {}),
      });
    } catch (error) {
      if (!(error instanceof NotificationReplayConflictError)) throw error;
      replayConflict = true;
      const conflictCode = error.name;
      outcome = {
        ...error.partialOutcome,
        failed: error.partialOutcome.failed + 1,
        errorCodes: error.partialOutcome.errorCodes.includes(conflictCode)
          ? [...error.partialOutcome.errorCodes]
          : [...error.partialOutcome.errorCodes, conflictCode],
      };
    }
  } else {
    outcome = await notify(
      event as NotificationEvent,
      payload as NotificationPayloadFor<NotificationEvent>,
      {
        deliveryKey: job.dedupeKey,
        deliveryAttempt: job.attempts,
        ...(job.signal ? { signal: job.signal } : {}),
        ...(job.assertLease ? { assertLease: job.assertLease } : {}),
      },
    );
  }

  const result: Prisma.InputJsonObject = {
    event: outcome.event,
    attempted: outcome.attempted,
    delivered: outcome.delivered,
    skipped: outcome.skipped,
    failed: outcome.failed,
    unknown: outcome.unknown,
    unlogged: outcome.unlogged,
    errorCodes: outcome.errorCodes,
  };

  if (outcome.unknown > 0) {
    // The webhook request may have been accepted, but no trustworthy final
    // acknowledgement was persisted. The pre-send SENDING/UNKNOWN ledger row
    // prevents every later attempt from sending it again. Keep failing the job
    // so ops sees a DEAD task and decides manually; never turn ambiguity into a
    // silent SUCCEEDED or an automatic duplicate.
    throw new NotificationDeliveryUnknownError(result);
  }

  if (replayConflict) {
    // A stale owner form or CAS generation cannot become valid by retrying the
    // same payload. Throw a dedicated terminal error so failBackgroundJob
    // makes the owning job DEAD immediately; any earlier RETRYING ledger row
    // then remains paired with that DEAD job for the owner-visible B5 contract.
    // UNKNOWN above still wins.
    throw new NotificationReplayTerminalError(result);
  }

  if (outcome.retryable) {
    // CLAUDE.md §15.4：带着部分进度重抛，绝不把没送出去的 channel 标成成功。
    // 已成功的 channel 就落在 NotificationLog(status=SUCCESS) 里，下一次
    // attempt 会跳过它们 —— 这就是「携带的进度」，而且是持久化的。
    //
    // 只打计数：channel id、消息正文不进进程日志（和 lib/cron/tasks.ts 的
    // logPartialBatchProgress 同一条纪律）。
    console.error('[job:notification] retryable delivery failure:', {
      event: outcome.event,
      attempted: outcome.attempted,
      delivered: outcome.delivered,
      skipped: outcome.skipped,
      failed: outcome.failed,
      attempt: job.attempts,
      maxAttempts: job.maxAttempts,
    });
    throw new NotificationDeliveryFailedError(result);
  }

  // 永久性失败（群被关停 / webhook key 失效 / 内容被拒）**不**抛：重试多少次
  // 结果一模一样，只会白耗 attempts、把死信队列灌满 ops 无法处置的行。证据
  // 留在 NotificationLog(status=FAILED)，owner 的 24h 失败告警条和
  // /owner/notifications 日志列表就是这条路径的通报渠道；job.result 里的
  // failed / errorCodes 也会渲染到 /owner/background-jobs 的错误码列
  // （listBackgroundJobs 会 select result，见 repository.ts）。
  return result;
}

export class NotificationDeliveryFailedError extends Error {
  // 与 DailyBatchUnexpectedError / BillGenerationUnexpectedError 同形：异常
  // 本身携带这一轮已经完成了多少。注意消费者只有进程日志 —— failBackgroundJob
  // 只落 lastErrorCode（= 本类的 name）。持久化的进度在 NotificationLog 上，
  // 不在这里。
  readonly partialResult: Prisma.InputJsonObject;

  constructor(partialResult: Prisma.InputJsonObject) {
    super('notification delivery failed with retryable errors');
    this.name = 'NotificationDeliveryFailedError';
    this.partialResult = partialResult;
  }
}

export class NotificationDeliveryUnknownError extends Error {
  readonly partialResult: Prisma.InputJsonObject;

  constructor(partialResult: Prisma.InputJsonObject) {
    super('notification delivery outcome is unknown; automatic resend blocked');
    this.name = 'NotificationDeliveryUnknownError';
    this.partialResult = partialResult;
  }
}

export class NotificationReplayTerminalError extends Error {
  readonly partialResult: Prisma.InputJsonObject;

  constructor(partialResult: Prisma.InputJsonObject) {
    super('manual notification replay conflicted; stale payload retry blocked');
    this.name = 'NotificationReplayTerminalError';
    this.partialResult = partialResult;
  }
}

function asRecord(value: Prisma.JsonValue): Record<string, Prisma.JsonValue> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new InvalidNotificationJobPayloadError();
  }
  return value as Record<string, Prisma.JsonValue>;
}

function manualReplayTargets(
  value: Prisma.JsonValue | undefined,
): ManualNotificationReplayTarget[] | null {
  if (value === undefined) return null;
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new InvalidNotificationJobPayloadError();
  }
  const targets = value.targets;
  if (!Array.isArray(targets) || targets.length === 0) {
    throw new InvalidNotificationJobPayloadError();
  }
  return targets.map((target) => {
    if (!target || typeof target !== 'object' || Array.isArray(target)) {
      throw new InvalidNotificationJobPayloadError();
    }
    if (
      typeof target.logId !== 'string' ||
      target.logId.length === 0 ||
      typeof target.stateVersion !== 'number' ||
      !Number.isSafeInteger(target.stateVersion) ||
      target.stateVersion < 0
    ) {
      throw new InvalidNotificationJobPayloadError();
    }
    return { logId: target.logId, stateVersion: target.stateVersion };
  });
}

export class InvalidNotificationJobPayloadError extends Error {
  constructor() {
    super('invalid notification background job payload');
    this.name = 'InvalidNotificationJobPayloadError';
  }
}
