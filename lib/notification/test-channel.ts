import { createHash, randomUUID } from 'node:crypto';
import {
  BackgroundJobQueue,
  NotificationChannelTransport,
  NotificationStatus,
} from '../../generated/prisma/enums';
import { databaseNow } from '../background-jobs/clock';
import { hasExclusiveConnectedSmartBotWorker } from '../background-jobs/smart-bot-availability';
import { enqueueBackgroundJob } from '../background-jobs/repository';
import { BACKGROUND_JOB_TYPES } from '../background-jobs/types';
import { db } from '../db';
import { TEST_EVENT_TYPE } from './events';
import { isMockMode } from './notify';
import {
  mockWebhookSender,
  sendWebhook,
  type WebhookResult,
  type WebhookSender,
} from './webhook';
import {
  configuredSmartBotIdDigest,
  mockSmartBotSender,
  sendSmartBot,
  smartBotDestinationFingerprint,
  type SmartBotSender,
} from './smart-bot';

const TEST_CHANNEL_MESSAGE = `**[测试推送]**
这是一条来自 ERP 后台的测试消息。
如能在该群看到此消息，说明通知通道配置正确。`;

export type TestChannelOptions = {
  // Test/debug injection follows NotifyOptions: the injected sender replaces
  // either default while mockMode still controls MOCK logging and UI wording.
  mockMode?: boolean;
  webhookSender?: WebhookSender;
  smartBotSender?: SmartBotSender;
  now?: Date;
  runInWorker?: boolean;
  signal?: AbortSignal;
  assertLease?: () => Promise<void>;
};

export type TestChannelOutcome =
  | { ok: true; mock: boolean }
  | { ok: false; mock: boolean; errorMessage: string };

export type TestChannelErrorCode =
  | 'CHANNEL_NOT_FOUND'
  | 'CHANNEL_INACTIVE'
  | 'SMART_BOT_NOT_BOUND'
  | 'SMART_BOT_IDENTITY_MISMATCH'
  | 'SMART_BOT_WORKER_REQUIRED'
  | 'SMART_BOT_WORKER_UNAVAILABLE'
  | 'CHANNEL_CONFIGURATION_INVALID'
  | 'LOG_WRITE_FAILED';

export class TestChannelError extends Error {
  constructor(
    public readonly code: TestChannelErrorCode,
    options?: ErrorOptions,
  ) {
    super(`cannot test notification channel: ${code}`, options);
    this.name = 'TestChannelError';
  }
}

/**
 * Sends one ad-hoc test message without creating a NotificationRule. Real
 * smart-bot calls are worker-only so a Web action can never establish a
 * competing long connection.
 */
export async function testChannel(
  channelId: string,
  options: TestChannelOptions = {},
): Promise<TestChannelOutcome> {
  const channel = await db.notificationChannel.findUnique({
    where: { id: channelId },
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
  if (!channel) throw new TestChannelError('CHANNEL_NOT_FOUND');
  if (!channel.isActive) throw new TestChannelError('CHANNEL_INACTIVE');

  const mock = options.mockMode ?? isMockMode();
  if (
    channel.transport === NotificationChannelTransport.WECOM_SMART_BOT &&
    (!channel.smartBotTargetId ||
      !channel.smartBotChatType ||
      !channel.smartBotBoundAt)
  ) {
    throw new TestChannelError('SMART_BOT_NOT_BOUND');
  }
  if (
    channel.transport === NotificationChannelTransport.WECOM_SMART_BOT &&
    channel.smartBotBotDigest !== configuredSmartBotIdDigest()
  ) {
    throw new TestChannelError('SMART_BOT_IDENTITY_MISMATCH');
  }
  if (
    channel.transport === NotificationChannelTransport.WECOM_SMART_BOT &&
    !mock &&
    !options.runInWorker
  ) {
    throw new TestChannelError('SMART_BOT_WORKER_REQUIRED');
  }
  if (
    channel.transport === NotificationChannelTransport.WECOM_GROUP_WEBHOOK &&
    !channel.webhookUrl
  ) {
    throw new TestChannelError('CHANNEL_CONFIGURATION_INVALID');
  }

  const webhookSender =
    options.webhookSender ?? (mock ? mockWebhookSender : sendWebhook);
  const smartBotSender =
    options.smartBotSender ?? (mock ? mockSmartBotSender : sendSmartBot);
  // Read the shared clock before external I/O. If the DB clock is unavailable,
  // no message has been sent and the caller can safely surface the fault.
  const attemptedAt = options.now ?? (await databaseNow());

  let result: WebhookResult;
  try {
    if (channel.transport === NotificationChannelTransport.WECOM_SMART_BOT) {
      const target = {
        targetId: channel.smartBotTargetId!,
        chatType: channel.smartBotChatType!,
      };
      const hasOptions = Boolean(options.signal || options.assertLease);
      result = hasOptions
        ? await smartBotSender(target, TEST_CHANNEL_MESSAGE, {
            ...(options.signal ? { signal: options.signal } : {}),
            ...(options.assertLease
              ? { assertLease: options.assertLease }
              : {}),
          })
        : await smartBotSender(target, TEST_CHANNEL_MESSAGE);
    } else {
      const hasOptions = Boolean(options.signal || options.assertLease);
      result = hasOptions
        ? await webhookSender(channel.webhookUrl!, TEST_CHANNEL_MESSAGE, {
            ...(options.signal ? { signal: options.signal } : {}),
            ...(options.assertLease
              ? { assertLease: options.assertLease }
              : {}),
          })
        : await webhookSender(channel.webhookUrl!, TEST_CHANNEL_MESSAGE);
    }
  } catch (error) {
    // An unexpected sender throw may happen after request bytes left this
    // process. Without provider idempotency it is UNKNOWN, never auto-retry.
    result = {
      ok: false,
      retries: 0,
      errorMessage: error instanceof Error ? error.name : 'sender error',
      retryable: false,
      unknown: true,
    };
  }

  try {
    await db.notificationLog.create({
      data: {
        eventType: TEST_EVENT_TYPE,
        channelId: channel.id,
        destinationFingerprint: testDestinationFingerprint(channel),
        messageContent: TEST_CHANNEL_MESSAGE,
        status: result.ok
          ? NotificationStatus.SUCCESS
          : result.unknown
            ? NotificationStatus.UNKNOWN
            : NotificationStatus.FAILED,
        errorMessage: result.ok
          ? mock
            ? 'MOCK'
            : null
          : (result.errorMessage ?? 'unknown error'),
        retryCount: result.retries,
        relatedOrderId: null,
        sentAt: result.ok ? attemptedAt : null,
        lastAttemptAt: attemptedAt,
      },
    });
  } catch (error) {
    // HTTP may already have succeeded. Never report a green test without its
    // owner-visible audit row; log only the exception type, not webhook data.
    console.error(
      '[testChannel] failed to persist NotificationLog:',
      error instanceof Error ? error.name : 'UnknownError',
    );
    throw new TestChannelError('LOG_WRITE_FAILED', { cause: error });
  }

  if (result.ok) return { ok: true, mock };
  return {
    ok: false,
    mock,
    errorMessage: result.errorMessage ?? 'unknown',
  };
}

export async function enqueueSmartBotChannelTest(
  channelId: string,
): Promise<{ queued: true; mock: boolean }> {
  const channel = await db.notificationChannel.findUnique({
    where: { id: channelId },
    select: {
      transport: true,
      smartBotBotDigest: true,
      smartBotTargetId: true,
      smartBotChatType: true,
      smartBotBoundAt: true,
      isActive: true,
    },
  });
  if (!channel) throw new TestChannelError('CHANNEL_NOT_FOUND');
  if (!channel.isActive) throw new TestChannelError('CHANNEL_INACTIVE');
  if (
    channel.transport !== NotificationChannelTransport.WECOM_SMART_BOT ||
    !channel.smartBotTargetId ||
    !channel.smartBotChatType ||
    !channel.smartBotBoundAt
  ) {
    throw new TestChannelError('SMART_BOT_NOT_BOUND');
  }
  if (channel.smartBotBotDigest !== configuredSmartBotIdDigest()) {
    throw new TestChannelError('SMART_BOT_IDENTITY_MISMATCH');
  }
  const mock = isMockMode();
  if (
    !mock &&
    !(await hasExclusiveConnectedSmartBotWorker(configuredSmartBotIdDigest()))
  ) {
    throw new TestChannelError('SMART_BOT_WORKER_UNAVAILABLE');
  }
  await enqueueBackgroundJob({
    type: BACKGROUND_JOB_TYPES.NOTIFICATION_CHANNEL_TEST,
    queue: BackgroundJobQueue.LIGHT,
    dedupeKey: `notification-channel-test:${channelId}:${randomUUID()}`,
    payload: { channelId },
    priority: 200,
    // There is no provider idempotency key. A failed/ambiguous test must never
    // be automatically sent again.
    maxAttempts: 1,
  });
  return { queued: true, mock };
}

type TestDestination = {
  transport?: 'WECOM_GROUP_WEBHOOK' | 'WECOM_SMART_BOT';
  webhookUrl: string | null;
  smartBotBotDigest: string | null;
  smartBotTargetId: string | null;
  smartBotChatType: 'SINGLE' | 'GROUP' | null;
};

function testDestinationFingerprint(channel: TestDestination): string {
  if (
    channel.transport === NotificationChannelTransport.WECOM_SMART_BOT &&
    channel.smartBotBotDigest === configuredSmartBotIdDigest() &&
    channel.smartBotTargetId &&
    channel.smartBotChatType &&
    process.env.WECOM_SMART_BOT_ID?.trim()
  ) {
    return smartBotDestinationFingerprint(
      process.env.WECOM_SMART_BOT_ID.trim(),
      {
        targetId: channel.smartBotTargetId,
        chatType: channel.smartBotChatType,
      },
    );
  }
  return createHash('sha256')
    .update('notification-test-destination\0', 'utf8')
    .update(
      channel.transport ?? NotificationChannelTransport.WECOM_GROUP_WEBHOOK,
      'utf8',
    )
    .update('\0', 'utf8')
    .update(channel.webhookUrl ?? channel.smartBotTargetId ?? 'unconfigured')
    .digest('hex');
}
