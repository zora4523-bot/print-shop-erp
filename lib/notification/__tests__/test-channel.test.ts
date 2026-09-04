import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { NotificationStatus } from '../../../generated/prisma/enums';

const { dbMock, waitForSlotMock, enqueueMock, smartBotWorkerAvailableMock } = vi.hoisted(() => ({
  dbMock: {
    notificationChannel: { findUnique: vi.fn() },
    notificationLog: { create: vi.fn() },
  },
  waitForSlotMock: vi.fn(),
  enqueueMock: vi.fn(),
  smartBotWorkerAvailableMock: vi.fn(),
}));

vi.mock('@/lib/db', () => ({ db: dbMock }));
vi.mock('@/lib/notification/webhook-throttle', () => ({
  waitForWebhookSendSlot: waitForSlotMock,
}));
vi.mock('@/lib/background-jobs/repository', () => ({
  enqueueBackgroundJob: enqueueMock,
}));
vi.mock('@/lib/background-jobs/smart-bot-availability', () => ({
  hasExclusiveConnectedSmartBotWorker: smartBotWorkerAvailableMock,
}));
vi.mock('server-only', () => ({}));

import type { WebhookResult, WebhookSender } from '../webhook';
import { smartBotIdDigest } from '../smart-bot';
import {
  enqueueSmartBotChannelTest,
  TestChannelError,
  testChannel,
} from '../test-channel';

const attemptedAt = new Date('2026-08-23T06:00:00.000Z');
const smartBotDigest = smartBotIdDigest('bot-id-placeholder');

function senderReturning(result: WebhookResult): WebhookSender {
  return vi.fn(async () => result);
}

beforeEach(() => {
  vi.stubEnv('WECOM_SMART_BOT_ID', 'bot-id-placeholder');
  vi.stubEnv('WECOM_SMART_BOT_SECRET', 'secret-placeholder');
  waitForSlotMock.mockReset().mockResolvedValue(undefined);
  enqueueMock.mockReset().mockResolvedValue({
    job: { id: 'test-job-1' },
    created: true,
    requeued: false,
  });
  smartBotWorkerAvailableMock.mockReset().mockResolvedValue(true);
  dbMock.notificationChannel.findUnique.mockReset().mockResolvedValue({
    id: 'channel-1',
    webhookUrl: 'https://qy.example.test/webhook',
    isActive: true,
  });
  dbMock.notificationLog.create.mockReset().mockResolvedValue({ id: 'log-1' });
  vi.stubGlobal(
    'fetch',
    vi.fn(() => {
      throw new Error('real fetch must not run in test-channel tests');
    }),
  );
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('testChannel', () => {
  it('uses an injected mock sender and records SUCCESS / MOCK at one timestamp', async () => {
    const sender = senderReturning({ ok: true, retries: 0 });

    await expect(
      testChannel('channel-1', {
        mockMode: true,
        webhookSender: sender,
        now: attemptedAt,
      }),
    ).resolves.toEqual({ ok: true, mock: true });

    expect(dbMock.notificationChannel.findUnique).toHaveBeenCalledWith({
      where: { id: 'channel-1' },
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
    expect(sender).toHaveBeenCalledExactlyOnceWith(
      'https://qy.example.test/webhook',
      expect.stringContaining('[测试推送]'),
    );
    expect(dbMock.notificationLog.create).toHaveBeenCalledWith({
      data: {
        eventType: '__TEST__',
        channelId: 'channel-1',
        destinationFingerprint: expect.stringMatching(/^[a-f0-9]{64}$/),
        messageContent: expect.stringContaining('ERP 后台'),
        status: NotificationStatus.SUCCESS,
        errorMessage: 'MOCK',
        retryCount: 0,
        relatedOrderId: null,
        sentAt: attemptedAt,
        lastAttemptAt: attemptedAt,
      },
    });
    expect(fetch).not.toHaveBeenCalled();
    expect(waitForSlotMock).not.toHaveBeenCalled();
  });

  it('requires the LIGHT worker for a real smart-bot test', async () => {
    dbMock.notificationChannel.findUnique.mockResolvedValue({
      id: 'smart-1',
      transport: 'WECOM_SMART_BOT',
      webhookUrl: null,
      smartBotBotDigest: smartBotDigest,
      smartBotTargetId: 'group-chat-1',
      smartBotChatType: 'GROUP',
      smartBotBoundAt: attemptedAt,
      isActive: true,
    });
    const smartBotSender = vi.fn();

    await expect(
      testChannel('smart-1', {
        mockMode: false,
        smartBotSender,
        now: attemptedAt,
      }),
    ).rejects.toMatchObject({ code: 'SMART_BOT_WORKER_REQUIRED' });
    expect(smartBotSender).not.toHaveBeenCalled();
  });

  it('sends a smart-bot test from the worker and persists its result', async () => {
    dbMock.notificationChannel.findUnique.mockResolvedValue({
      id: 'smart-1',
      transport: 'WECOM_SMART_BOT',
      webhookUrl: null,
      smartBotBotDigest: smartBotDigest,
      smartBotTargetId: 'group-chat-1',
      smartBotChatType: 'GROUP',
      smartBotBoundAt: attemptedAt,
      isActive: true,
    });
    const smartBotSender = vi.fn(async () => ({ ok: true, retries: 0 }));

    await expect(
      testChannel('smart-1', {
        mockMode: false,
        runInWorker: true,
        smartBotSender,
        now: attemptedAt,
      }),
    ).resolves.toEqual({ ok: true, mock: false });
    expect(smartBotSender).toHaveBeenCalledExactlyOnceWith(
      { targetId: 'group-chat-1', chatType: 'GROUP' },
      expect.stringContaining('[测试推送]'),
    );
    expect(dbMock.notificationLog.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        channelId: 'smart-1',
        status: 'SUCCESS',
      }),
    });
  });

  it('queues a one-attempt smart-bot test without putting credentials in payload', async () => {
    vi.stubEnv('NOTIFICATION_MOCK_MODE', 'false');
    dbMock.notificationChannel.findUnique.mockResolvedValue({
      transport: 'WECOM_SMART_BOT',
      smartBotBotDigest: smartBotDigest,
      smartBotTargetId: 'group-chat-1',
      smartBotChatType: 'GROUP',
      smartBotBoundAt: attemptedAt,
      isActive: true,
    });

    await expect(enqueueSmartBotChannelTest('smart-1')).resolves.toMatchObject({
      queued: true,
    });
    expect(smartBotWorkerAvailableMock).toHaveBeenCalledExactlyOnceWith(
      smartBotDigest,
    );
    expect(enqueueMock).toHaveBeenCalledExactlyOnceWith(
      expect.objectContaining({
        type: 'NOTIFICATION_CHANNEL_TEST',
        queue: 'LIGHT',
        payload: { channelId: 'smart-1' },
        maxAttempts: 1,
      }),
    );
    expect(JSON.stringify(enqueueMock.mock.calls)).not.toContain('secret');
  });

  it('refuses to queue a real smart-bot test without one connected LIGHT owner', async () => {
    vi.stubEnv('NOTIFICATION_MOCK_MODE', 'false');
    smartBotWorkerAvailableMock.mockResolvedValue(false);
    dbMock.notificationChannel.findUnique.mockResolvedValue({
      transport: 'WECOM_SMART_BOT',
      smartBotBotDigest: smartBotDigest,
      smartBotTargetId: 'group-chat-1',
      smartBotChatType: 'GROUP',
      smartBotBoundAt: attemptedAt,
      isActive: true,
    });

    await expect(enqueueSmartBotChannelTest('smart-1')).rejects.toMatchObject({
      code: 'SMART_BOT_WORKER_UNAVAILABLE',
    });
    expect(enqueueMock).not.toHaveBeenCalled();
  });

  it('真实测试发送与业务事件共用 webhook 全局 permit', async () => {
    const webhookUrl =
      'https://qyapi.weixin.qq.com/cgi-bin/webhook/send?key=test-key';
    dbMock.notificationChannel.findUnique.mockResolvedValueOnce({
      id: 'channel-1',
      webhookUrl,
      isActive: true,
    });
    vi.mocked(fetch)
      .mockReset()
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ errcode: 0, errmsg: 'ok' }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        }),
      );

    await expect(
      testChannel('channel-1', {
        mockMode: false,
        now: attemptedAt,
      }),
    ).resolves.toEqual({ ok: true, mock: false });

    expect(waitForSlotMock).toHaveBeenCalledExactlyOnceWith(webhookUrl, {});
    expect(fetch).toHaveBeenCalledOnce();
  });

  it('uses an injected real-mode sender without marking the successful log MOCK', async () => {
    const sender = senderReturning({ ok: true, retries: 0 });

    await expect(
      testChannel('channel-1', {
        mockMode: false,
        webhookSender: sender,
        now: attemptedAt,
      }),
    ).resolves.toEqual({ ok: true, mock: false });

    expect(sender).toHaveBeenCalledTimes(1);
    expect(dbMock.notificationLog.create.mock.calls[0]![0].data).toMatchObject({
      status: NotificationStatus.SUCCESS,
      errorMessage: null,
      sentAt: attemptedAt,
    });
    expect(fetch).not.toHaveBeenCalled();
    expect(waitForSlotMock).not.toHaveBeenCalled();
  });

  it.each([
    { errorMessage: 'http 429' },
    { errorMessage: 'wecom errcode=45009' },
  ])(
    'records an inline rate-limit result as FAILED: $errorMessage',
    async ({ errorMessage }) => {
      const sender = senderReturning({
        ok: false,
        retries: 0,
        retryable: true,
        errorMessage,
      });

      await expect(
        testChannel('channel-1', {
          mockMode: false,
          webhookSender: sender,
          now: attemptedAt,
        }),
      ).resolves.toEqual({ ok: false, mock: false, errorMessage });

      expect(
        dbMock.notificationLog.create.mock.calls[0]![0].data,
      ).toMatchObject({
        status: NotificationStatus.FAILED,
        errorMessage,
        sentAt: null,
      });
      expect(fetch).not.toHaveBeenCalled();
    },
  );

  it.each([
    { errorMessage: 'http 500' },
    { errorMessage: 'TimeoutError' },
    { errorMessage: 'TypeError' },
  ])(
    'records an ambiguous delivery as UNKNOWN: $errorMessage',
    async ({ errorMessage }) => {
      const sender = senderReturning({
        ok: false,
        retries: 0,
        retryable: false,
        unknown: true,
        errorMessage,
      });

      await expect(
        testChannel('channel-1', {
          mockMode: false,
          webhookSender: sender,
          now: attemptedAt,
        }),
      ).resolves.toEqual({ ok: false, mock: false, errorMessage });

      expect(
        dbMock.notificationLog.create.mock.calls[0]![0].data,
      ).toMatchObject({
        status: NotificationStatus.UNKNOWN,
        errorMessage,
        sentAt: null,
      });
      expect(fetch).not.toHaveBeenCalled();
    },
  );

  it('treats an unexpected sender throw as UNKNOWN and never calls fetch itself', async () => {
    const sender: WebhookSender = vi.fn(async () => {
      const error = new Error('socket reset after send');
      error.name = 'TypeError';
      throw error;
    });

    await expect(
      testChannel('channel-1', {
        mockMode: false,
        webhookSender: sender,
        now: attemptedAt,
      }),
    ).resolves.toEqual({
      ok: false,
      mock: false,
      errorMessage: 'TypeError',
    });
    expect(dbMock.notificationLog.create.mock.calls[0]![0].data.status).toBe(
      NotificationStatus.UNKNOWN,
    );
    expect(fetch).not.toHaveBeenCalled();
  });

  it('rejects a missing or inactive channel before selecting a sender', async () => {
    const sender = senderReturning({ ok: true, retries: 0 });
    dbMock.notificationChannel.findUnique.mockResolvedValueOnce(null);

    await expect(
      testChannel('missing', {
        mockMode: false,
        webhookSender: sender,
        now: attemptedAt,
      }),
    ).rejects.toMatchObject({ code: 'CHANNEL_NOT_FOUND' });

    dbMock.notificationChannel.findUnique.mockResolvedValueOnce({
      id: 'channel-1',
      webhookUrl: 'https://qy.example.test/webhook',
      isActive: false,
    });
    await expect(
      testChannel('channel-1', {
        mockMode: false,
        webhookSender: sender,
        now: attemptedAt,
      }),
    ).rejects.toMatchObject({ code: 'CHANNEL_INACTIVE' });

    expect(sender).not.toHaveBeenCalled();
    expect(dbMock.notificationLog.create).not.toHaveBeenCalled();
    expect(fetch).not.toHaveBeenCalled();
  });

  it('fails closed when the webhook result cannot be persisted', async () => {
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});
    const cause = new Error('database unavailable');
    dbMock.notificationLog.create.mockRejectedValue(cause);

    const testRequest = testChannel('channel-1', {
      mockMode: true,
      webhookSender: senderReturning({ ok: true, retries: 0 }),
      now: attemptedAt,
    });
    await expect(testRequest).rejects.toBeInstanceOf(TestChannelError);
    await expect(testRequest).rejects.toMatchObject({
      code: 'LOG_WRITE_FAILED',
      cause,
    });
    expect(consoleError).toHaveBeenCalledWith(
      '[testChannel] failed to persist NotificationLog:',
      'Error',
    );
    expect(fetch).not.toHaveBeenCalled();
  });
});
