import { randomUUID } from 'node:crypto';
import { BackgroundJobQueue, Prisma } from '../../generated/prisma/client';
import {
  NOTIFICATION_EVENTS,
  type NotificationEvent,
  type NotificationPayloadFor,
} from '../notification/events';
import { notify } from '../notification/notify';
import { enqueueBackgroundJob } from './repository';
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
): Promise<{ jobId: string; created: boolean; requeued: boolean }> {
  const body = JSON.parse(JSON.stringify({ event, payload })) as Prisma.InputJsonValue;
  const { job, created, requeued } = await enqueueBackgroundJob({
    type: BACKGROUND_JOB_TYPES.NOTIFICATION,
    queue: BackgroundJobQueue.LIGHT,
    dedupeKey:
      options.dedupeKey ?? `notification:${event}:${randomUUID()}`,
    payload: body,
    maxAttempts: 5,
    priority: 200,
    // 这里刻意用进程时钟而不是 databaseNow()：这是「排队节流」不是「重试
    // 定时」，几秒的钟差只会让整批一起早几秒或晚几秒，相对间隔不变；而
    // databaseNow() 会给每条扇出多一次往返。spreadIndex 缺省（单条事件）
    // 时留 undefined，让库默认的 now() 生效，与改动前逐字一致。
    availableAt: spreadAvailableAt(options.spreadIndex),
  });
  return { jobId: job.id, created, requeued };
}

function spreadAvailableAt(spreadIndex: number | undefined): Date | undefined {
  if (typeof spreadIndex !== 'number' || !Number.isFinite(spreadIndex)) {
    return undefined;
  }
  const slot = Math.max(0, Math.floor(spreadIndex));
  if (slot === 0) return undefined;
  return new Date(Date.now() + slot * FANOUT_SPACING_MS);
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

  // deliveryKey = job.dedupeKey：跨 attempt 稳定，notify 用它跳过已经推成功的
  // channel（部分成功不重复打扰）。finalAttempt 决定失败落 RETRYING 还是
  // FAILED —— claimNextBackgroundJob 在 claim 时已经把 attempts 加过 1，所以
  // job.attempts 就是「这是第几次」。
  const finalAttempt = job.attempts >= job.maxAttempts;

  const outcome = await notify(
    event as NotificationEvent,
    payload as NotificationPayloadFor<NotificationEvent>,
    { deliveryKey: job.dedupeKey, finalAttempt },
  );

  const result: Prisma.InputJsonObject = {
    event: outcome.event,
    attempted: outcome.attempted,
    delivered: outcome.delivered,
    skipped: outcome.skipped,
    failed: outcome.failed,
    unlogged: outcome.unlogged,
    errorCodes: outcome.errorCodes,
  };

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
      finalAttempt,
    });
    throw new NotificationDeliveryFailedError(result);
  }

  // 永久性失败（群被关停 / webhook key 失效 / 内容被拒）**不**抛：重试 5 次
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

function asRecord(value: Prisma.JsonValue): Record<string, Prisma.JsonValue> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new InvalidNotificationJobPayloadError();
  }
  return value as Record<string, Prisma.JsonValue>;
}

export class InvalidNotificationJobPayloadError extends Error {
  constructor() {
    super('invalid notification background job payload');
    this.name = 'InvalidNotificationJobPayloadError';
  }
}
