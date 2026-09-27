import { createHash } from 'node:crypto';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('server-only', () => ({}));

const {
  dbMock,
  ledgerMock,
  routingMock,
  waitForSlotMock,
  DeliveryClaimConflictError,
} = vi.hoisted(() => {
  class DeliveryClaimConflictError extends Error {
    constructor(message: string) {
      super(message);
      this.name = 'NotificationDeliveryClaimConflictError';
    }
  }
  const mock = {
    order: { findUnique: vi.fn() },
    notificationRule: { findUnique: vi.fn() },
    notificationChannel: { findMany: vi.fn() },
    notificationLog: { create: vi.fn(), findUnique: vi.fn() },
    $queryRaw: vi.fn(),
  };
  return {
    dbMock: mock,
    DeliveryClaimConflictError,
    ledgerMock: {
      claim: vi.fn(),
      finalize: vi.fn(),
      reconcile: vi.fn(),
      recover: vi.fn(),
      markUnknown: vi.fn(),
    },
    routingMock: { resolve: vi.fn() },
    waitForSlotMock: vi.fn(),
  };
});
vi.mock('@/lib/db', () => ({ db: dbMock }));
vi.mock('@/lib/notification/delivery-ledger', () => ({
  claimDurableDelivery: ledgerMock.claim,
  finalizeDurableDelivery: ledgerMock.finalize,
  reconcileAbandonedDurableDeliveries: ledgerMock.reconcile,
  recoverDurableDeliveryFinalization: ledgerMock.recover,
  markDurableDeliveryUnknown: ledgerMock.markUnknown,
  NotificationDeliveryClaimConflictError: DeliveryClaimConflictError,
}));
vi.mock('@/lib/notification/management-routing', () => ({
  resolveManagementNotificationRoute: routingMock.resolve,
}));
vi.mock('@/lib/notification/webhook-throttle', () => ({
  waitForWebhookSendSlot: waitForSlotMock,
}));

import {
  notify,
  isMockMode,
  NotificationReplayConflictError,
  replayDurableNotificationLogs,
} from '../notify';
import type { WebhookSender } from '../webhook';
import type { NotificationEvent, NotificationPayloadFor } from '../events';
import { smartBotIdDigest } from '../smart-bot';

const smartBotDigest = smartBotIdDigest('bot-id-placeholder');
const recoverableManagementEventCases = [
  {
    event: 'ORDER_SUBMITTED',
    role: 'factoryConfirmer',
    payload: {
      orderId: 'o-managed',
      orderNo: 'O-MANAGED',
      submitterName: '张三',
      customerRef: null,
      urgentMark: '',
    },
  },
  {
    event: 'ORDER_CHANGE_REQUESTED',
    role: 'factoryConfirmer',
    payload: {
      orderId: 'o-managed',
      orderNo: 'O-MANAGED',
      summary: '申请修改工单',
      deepLink: '/orders#wo=O-MANAGED',
    },
  },
  {
    event: 'PRODUCTION_PROGRESS_ANOMALY',
    role: 'owner',
    payload: {
      orderId: 'o-managed',
      orderNo: 'O-MANAGED',
      summary: '报工进度异常',
      deepLink: '/orders#wo=O-MANAGED',
    },
  },
  {
    event: 'PRODUCTION_STAGNANT',
    role: 'owner',
    payload: {
      orderId: 'o-managed',
      orderNo: 'O-MANAGED',
      summary: '生产停滞',
      deepLink: '/orders#wo=O-MANAGED',
    },
  },
  {
    event: 'PENDING_FACTORY_BACKLOG',
    role: 'owner',
    payload: {
      orderId: 'o-managed',
      orderNo: 'O-MANAGED',
      summary: '待确认积压',
      deepLink: '/orders#wo=O-MANAGED',
    },
  },
] as const satisfies ReadonlyArray<{
  event: NotificationEvent;
  role: 'factoryConfirmer' | 'owner';
  payload: NotificationPayloadFor<NotificationEvent>;
}>;

function webhookDestinationFingerprint(webhookUrl: string): string {
  return createHash('sha256')
    .update('notification-destination\0', 'utf8')
    .update('WECOM_GROUP_WEBHOOK', 'utf8')
    .update('\0', 'utf8')
    .update(webhookUrl, 'utf8')
    .digest('hex');
}

beforeEach(() => {
  vi.stubEnv('APP_PUBLIC_URL', '');
  vi.stubEnv('WECOM_SMART_BOT_ID', 'bot-id-placeholder');
  vi.stubEnv('WECOM_SMART_BOT_SECRET', 'secret-placeholder');
  dbMock.order.findUnique.mockReset();
  dbMock.notificationRule.findUnique.mockReset();
  dbMock.notificationChannel.findMany.mockReset();
  dbMock.notificationLog.create.mockReset().mockResolvedValue({});
  dbMock.notificationLog.findUnique.mockReset();
  dbMock.$queryRaw.mockReset().mockResolvedValue([{ now: new Date('2026-08-22T08:00:00Z') }]);
  ledgerMock.claim.mockReset().mockImplementation(async (input: { channelId: string }) => ({
    claimed: true,
    attemptId: `attempt:${input.channelId}`,
  }));
  ledgerMock.finalize.mockReset().mockResolvedValue(undefined);
  ledgerMock.reconcile.mockReset().mockResolvedValue([]);
  ledgerMock.recover.mockReset().mockImplementation(async (input) => ({
    status: input.status,
    errorMessage: input.errorMessage,
  }));
  ledgerMock.markUnknown.mockReset().mockResolvedValue({
    status: 'UNKNOWN',
    errorMessage: 'delivery finalization failed',
  });
  waitForSlotMock.mockReset().mockResolvedValue(undefined);
  // Existing delivery tests exercise the legacy NotificationRule path. The
  // managed-role contract has focused cases below; production never returns
  // null for its five fixed events.
  routingMock.resolve.mockReset().mockResolvedValue(null);
});

afterEach(() => {
  vi.unstubAllEnvs();
});

describe('isMockMode', () => {
  it('NODE_ENV=production + 无 NOTIFICATION_MOCK_MODE → false', () => {
    expect(isMockMode({ NODE_ENV: 'production' } as NodeJS.ProcessEnv)).toBe(
      false,
    );
  });

  it('NODE_ENV=development → true（dev 默认）', () => {
    expect(
      isMockMode({ NODE_ENV: 'development' } as NodeJS.ProcessEnv),
    ).toBe(true);
  });

  it('NODE_ENV=test → true', () => {
    expect(isMockMode({ NODE_ENV: 'test' } as NodeJS.ProcessEnv)).toBe(true);
  });

  it('NOTIFICATION_MOCK_MODE=true 在 prod 也强制 true', () => {
    expect(
      isMockMode({
        NODE_ENV: 'production',
        NOTIFICATION_MOCK_MODE: 'true',
      } as NodeJS.ProcessEnv),
    ).toBe(true);
  });

  it('NOTIFICATION_MOCK_MODE=false 在 dev 强制 false', () => {
    expect(
      isMockMode({
        NODE_ENV: 'development',
        NOTIFICATION_MOCK_MODE: 'false',
      } as NodeJS.ProcessEnv),
    ).toBe(false);
  });
});

describe('notify', () => {
  const okSender: WebhookSender = vi.fn(async () => ({
    ok: true,
    retries: 0,
  }));
  const failSender: WebhookSender = vi.fn(async () => ({
    ok: false,
    retries: 0,
    errorMessage: 'wecom errcode=93000',
  }));

  beforeEach(() => {
    (okSender as unknown as ReturnType<typeof vi.fn>).mockClear();
    (failSender as unknown as ReturnType<typeof vi.fn>).mockClear();
  });

  it('rule 不存在 → 不写 log，不调 sender', async () => {
    dbMock.notificationRule.findUnique.mockResolvedValue(null);
    await notify('ORDER_SUBMITTED', {
      orderId: 'o1',
      orderNo: 'O-1',
      submitterName: '张三',
      customerRef: null,
      totalAmount: '0',
      urgentMark: '',
    });
    expect(dbMock.notificationLog.create).not.toHaveBeenCalled();
    expect(okSender).not.toHaveBeenCalled();
  });

  it('rule.isActive=false → 不写 log', async () => {
    dbMock.notificationRule.findUnique.mockResolvedValue({
      eventType: 'ORDER_SUBMITTED',
      channelIds: ['c1'],
      messageTemplate: '工单 {orderNo}',
      isActive: false,
    });
    await notify('ORDER_SUBMITTED', {
      orderId: 'o1',
      orderNo: 'O-1',
      submitterName: '张三',
      customerRef: null,
      totalAmount: '0',
      urgentMark: '',
    });
    expect(dbMock.notificationLog.create).not.toHaveBeenCalled();
  });

  it('rule.channelIds 为空 → 不写 log + console.warn', async () => {
    const warnSpy = vi
      .spyOn(console, 'warn')
      .mockImplementation(() => undefined);
    dbMock.notificationRule.findUnique.mockResolvedValue({
      eventType: 'ORDER_SUBMITTED',
      channelIds: [],
      messageTemplate: '工单 {orderNo}',
      isActive: true,
    });
    await notify('ORDER_SUBMITTED', {
      orderId: 'o1',
      orderNo: 'O-1',
      submitterName: '张三',
      customerRef: null,
      totalAmount: '0',
      urgentMark: '',
    });
    expect(dbMock.notificationLog.create).not.toHaveBeenCalled();
    expect(warnSpy).toHaveBeenCalledWith(
      expect.stringContaining('channelIds empty'),
    );
    warnSpy.mockRestore();
  });

  it('全部 channelIds stale（已删除）→ 不写 log + console.warn', async () => {
    const warnSpy = vi
      .spyOn(console, 'warn')
      .mockImplementation(() => undefined);
    dbMock.notificationRule.findUnique.mockResolvedValue({
      eventType: 'ORDER_SUBMITTED',
      channelIds: ['stale1', 'stale2'],
      messageTemplate: 'x',
      isActive: true,
    });
    dbMock.notificationChannel.findMany.mockResolvedValue([]);
    await notify('ORDER_SUBMITTED', {
      orderId: 'o1',
      orderNo: 'O-1',
      submitterName: '张三',
      customerRef: null,
      totalAmount: '0',
      urgentMark: '',
    });
    expect(dbMock.notificationLog.create).not.toHaveBeenCalled();
    expect(warnSpy).toHaveBeenCalledWith(
      expect.stringContaining('all channelIds stale'),
    );
    warnSpy.mockRestore();
  });

  it('mock-mode → 不调 sender，写 status=SUCCESS errorMessage=MOCK', async () => {
    dbMock.notificationRule.findUnique.mockResolvedValue({
      eventType: 'ORDER_SUBMITTED',
      channelIds: ['c1'],
      messageTemplate: '工单 {orderNo}',
      isActive: true,
    });
    dbMock.notificationChannel.findMany.mockResolvedValue([
      { id: 'c1', webhookUrl: 'https://qy/x', isActive: true },
    ]);

    await notify(
      'ORDER_SUBMITTED',
      {
        orderId: 'o1',
        orderNo: 'O-1',
        submitterName: '张三',
        customerRef: null,
        totalAmount: '0',
        urgentMark: '',
      },
      { mockMode: true },
    );

    expect(dbMock.notificationLog.create).toHaveBeenCalledTimes(1);
    const data = dbMock.notificationLog.create.mock.calls[0][0].data;
    expect(data.eventType).toBe('ORDER_SUBMITTED');
    expect(data.channelId).toBe('c1');
    expect(data.messageContent).toBe('工单 O-1');
    expect(data.status).toBe('SUCCESS');
    expect(data.errorMessage).toBe('MOCK');
    expect(data.relatedOrderId).toBe('o1');
    expect(data.sentAt).toBeInstanceOf(Date);
  });

  it('部署前入队的逾期载荷缺 externalSalesName → 按工单补上，新模板不漏出占位符', async () => {
    dbMock.notificationRule.findUnique.mockResolvedValue({
      eventType: 'ORDER_OVERDUE',
      channelIds: ['c1'],
      messageTemplate: '工单：{orderNo}\n外部销售：{externalSalesName}',
      isActive: true,
    });
    dbMock.notificationChannel.findMany.mockResolvedValue([
      { id: 'c1', webhookUrl: 'https://qy/x', isActive: true },
    ]);
    dbMock.order.findUnique.mockResolvedValueOnce({
      settlementType: 'NO_CHARGE',
      submitter: { displayName: '管理员' },
      sourceOrder: { submitter: { displayName: '桂林' } },
    });

    await notify(
      'ORDER_OVERDUE',
      {
        orderId: 'o1',
        orderNo: 'O-1',
        customerRef: '未填',
        promisedDate: '2026/09/20',
        daysOverdue: 2,
        status: '生产中',
      } as unknown as NotificationPayloadFor<'ORDER_OVERDUE'>,
      { mockMode: true },
    );

    expect(dbMock.order.findUnique).toHaveBeenCalledWith({
      where: { id: 'o1' },
      select: expect.objectContaining({ settlementType: true }),
    });
    expect(dbMock.notificationLog.create.mock.calls[0][0].data.messageContent).toBe(
      '工单：O-1\n外部销售：桂林',
    );
  });

  it('载荷已带 externalSalesName → 不回查工单', async () => {
    dbMock.notificationRule.findUnique.mockResolvedValue({
      eventType: 'ORDER_OVERDUE',
      channelIds: ['c1'],
      messageTemplate: '外部销售：{externalSalesName}',
      isActive: true,
    });
    dbMock.notificationChannel.findMany.mockResolvedValue([
      { id: 'c1', webhookUrl: 'https://qy/x', isActive: true },
    ]);

    await notify(
      'ORDER_OVERDUE',
      {
        orderId: 'o1',
        orderNo: 'O-1',
        externalSalesName: '未填',
        customerRef: '未填',
        promisedDate: '2026/09/20',
        daysOverdue: 2,
        status: '生产中',
      },
      { mockMode: true },
    );

    expect(dbMock.order.findUnique).not.toHaveBeenCalled();
    expect(dbMock.notificationLog.create.mock.calls[0][0].data.messageContent).toBe(
      '外部销售：未填',
    );
  });

  it('多 channel → 每 channel 一条 log', async () => {
    dbMock.notificationRule.findUnique.mockResolvedValue({
      eventType: 'URGENT_ORDER',
      channelIds: ['c1', 'c2'],
      messageTemplate: '🔥 急单 {orderNo}',
      isActive: true,
    });
    dbMock.notificationChannel.findMany.mockResolvedValue([
      { id: 'c1', webhookUrl: 'https://qy/1', isActive: true },
      { id: 'c2', webhookUrl: 'https://qy/2', isActive: true },
    ]);

    await notify(
      'URGENT_ORDER',
      {
        orderId: 'o1',
        orderNo: 'O-1',
        submitterName: '张三',
        externalSalesName: '外销甲',
        customerRef: null,
      },
      { webhookSender: okSender, mockMode: false },
    );

    expect(okSender).toHaveBeenCalledTimes(2);
    expect(dbMock.notificationLog.create).toHaveBeenCalledTimes(2);
    const channels = dbMock.notificationLog.create.mock.calls.map(
      (c) => c[0].data.channelId,
    );
    expect(channels).toEqual(['c1', 'c2']);
  });

  it('智能机器人通道使用绑定的群 chatid，不触发 webhook sender', async () => {
    dbMock.notificationRule.findUnique.mockResolvedValue({
      eventType: 'URGENT_ORDER',
      channelIds: ['smart-1'],
      messageTemplate: '🔥 急单 {orderNo}',
      isActive: true,
    });
    dbMock.notificationChannel.findMany.mockResolvedValue([
      {
        id: 'smart-1',
        transport: 'WECOM_SMART_BOT',
        webhookUrl: null,
        smartBotBotDigest: smartBotDigest,
        smartBotTargetId: 'group-chat-1',
        smartBotChatType: 'GROUP',
        smartBotBoundAt: new Date('2026-09-03T00:00:00Z'),
        isActive: true,
      },
    ]);
    const webhookSender: WebhookSender = vi.fn();
    const smartBotSender = vi.fn(async () => ({ ok: true, retries: 0 }));

    const outcome = await notify(
      'URGENT_ORDER',
      {
        orderId: 'o1',
        orderNo: 'O-1',
        submitterName: '张三',
        externalSalesName: '外销甲',
        customerRef: null,
      },
      { webhookSender, smartBotSender, mockMode: false },
    );

    expect(outcome).toMatchObject({ attempted: 1, delivered: 1, failed: 0 });
    expect(webhookSender).not.toHaveBeenCalled();
    expect(smartBotSender).toHaveBeenCalledExactlyOnceWith(
      { targetId: 'group-chat-1', chatType: 'GROUP' },
      '🔥 急单 O-1',
    );
    expect(dbMock.notificationLog.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        channelId: 'smart-1',
        destinationFingerprint: expect.stringMatching(/^[a-f0-9]{64}$/),
        status: 'SUCCESS',
      }),
    });
  });

  it('更换 Bot ID 后拒绝把旧 chatid 交给新机器人', async () => {
    dbMock.notificationRule.findUnique.mockResolvedValue({
      eventType: 'URGENT_ORDER',
      channelIds: ['smart-old'],
      messageTemplate: '急单 {orderNo}',
      isActive: true,
    });
    dbMock.notificationChannel.findMany.mockResolvedValue([
      {
        id: 'smart-old',
        transport: 'WECOM_SMART_BOT',
        webhookUrl: null,
        smartBotBotDigest: smartBotIdDigest('old-bot-id'),
        smartBotTargetId: 'old-group-chat',
        smartBotChatType: 'GROUP',
        smartBotBoundAt: new Date('2026-09-03T00:00:00Z'),
        isActive: true,
      },
    ]);
    const smartBotSender = vi.fn();

    const outcome = await notify(
      'URGENT_ORDER',
      {
        orderId: 'o1',
        orderNo: 'O-1',
        submitterName: '张三',
        externalSalesName: '外销甲',
        customerRef: null,
      },
      { smartBotSender, mockMode: false },
    );

    expect(outcome).toMatchObject({ attempted: 0, delivered: 0, failed: 1 });
    expect(smartBotSender).not.toHaveBeenCalled();
    expect(dbMock.notificationLog.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        status: 'FAILED',
        errorMessage: 'smart bot identity changed',
      }),
    });
  });

  it('持久任务在 Bot ID 暂时不匹配时保留可安全重试状态', async () => {
    dbMock.notificationRule.findUnique.mockResolvedValue({
      eventType: 'URGENT_ORDER',
      channelIds: ['smart-old'],
      messageTemplate: '急单 {orderNo}',
      isActive: true,
    });
    dbMock.notificationChannel.findMany.mockResolvedValue([
      {
        id: 'smart-old',
        transport: 'WECOM_SMART_BOT',
        webhookUrl: null,
        smartBotBotDigest: smartBotIdDigest('old-bot-id'),
        smartBotTargetId: 'old-group-chat',
        smartBotChatType: 'GROUP',
        smartBotBoundAt: new Date('2026-09-03T00:00:00Z'),
        isActive: true,
      },
    ]);
    const smartBotSender = vi.fn();

    const outcome = await notify(
      'URGENT_ORDER',
      {
        orderId: 'o1',
        orderNo: 'O-1',
        submitterName: '张三',
        externalSalesName: '外销甲',
        customerRef: null,
      },
      {
        deliveryKey: 'notification:URGENT_ORDER:o1',
        deliveryAttempt: 1,
        smartBotSender,
        mockMode: false,
      },
    );

    expect(smartBotSender).not.toHaveBeenCalled();
    expect(ledgerMock.finalize).toHaveBeenCalledWith(
      expect.objectContaining({
        channelId: 'smart-old',
        status: 'RETRYING',
        errorMessage: 'smart bot identity changed',
        sent: false,
      }),
    );
    expect(outcome).toMatchObject({
      attempted: 0,
      delivered: 0,
      failed: 1,
      retryable: true,
    });
  });

  it('旧版 ORDER_COMPLETED 已被新纸质工单升版覆盖 → 跳过且不发 webhook', async () => {
    dbMock.notificationRule.findUnique.mockResolvedValue({
      eventType: 'ORDER_COMPLETED',
      channelIds: ['c1'],
      messageTemplate: '工单 {orderNo} 已完工',
      isActive: true,
    });
    dbMock.notificationChannel.findMany.mockResolvedValue([
      { id: 'c1', webhookUrl: 'https://qy/1', isActive: true },
    ]);
    dbMock.order.findUnique.mockResolvedValue({
      status: 'PACKING',
      workOrderVersion: 3,
      completedAt: new Date('2026-09-02T08:00:00.000Z'),
    });

    await expect(
      notify(
        'ORDER_COMPLETED',
        {
          orderId: 'o1',
          orderNo: 'O-1',
          workOrderVersion: 2,
          externalSalesName: '外销甲',
          customerRef: null,
        },
        { webhookSender: okSender, mockMode: false },
      ),
    ).resolves.toMatchObject({
      attempted: 0,
      delivered: 0,
      skipped: 1,
      failed: 0,
    });
    expect(okSender).not.toHaveBeenCalled();
    expect(dbMock.notificationLog.create).not.toHaveBeenCalled();
    expect(ledgerMock.claim).not.toHaveBeenCalled();
  });

  it('ORDER_COMPLETED 排队后订单已取消 → 即使版本和 completedAt 未变也不发送', async () => {
    dbMock.notificationRule.findUnique.mockResolvedValue({
      eventType: 'ORDER_COMPLETED',
      channelIds: ['c1'],
      messageTemplate: '工单 {orderNo} 已完工',
      isActive: true,
    });
    dbMock.notificationChannel.findMany.mockResolvedValue([
      { id: 'c1', webhookUrl: 'https://qy/1', isActive: true },
    ]);
    dbMock.order.findUnique.mockResolvedValue({
      status: 'CANCELLED',
      workOrderVersion: 2,
      completedAt: new Date('2026-09-02T08:00:00.000Z'),
    });

    const outcome = await notify(
      'ORDER_COMPLETED',
      {
        orderId: 'o1',
        orderNo: 'O-1',
        workOrderVersion: 2,
        externalSalesName: '外销甲',
        customerRef: null,
      },
      { webhookSender: okSender, mockMode: false },
    );

    expect(outcome).toMatchObject({ attempted: 0, skipped: 1, failed: 0 });
    expect(okSender).not.toHaveBeenCalled();
    expect(dbMock.notificationLog.create).not.toHaveBeenCalled();
  });

  it('durable 真实发送先等 permit，再写 SENDING，并在 fetch 前重验 lease', async () => {
    const sequence: string[] = [];
    const current = {
      status: 'PACKING',
      workOrderVersion: 2,
      completedAt: new Date('2026-09-02T08:00:00.000Z'),
    };
    dbMock.notificationRule.findUnique.mockResolvedValue({
      eventType: 'ORDER_COMPLETED',
      channelIds: ['c1'],
      messageTemplate: '工单 {orderNo} 生产已完成',
      isActive: true,
    });
    dbMock.notificationChannel.findMany.mockResolvedValue([
      {
        id: 'c1',
        webhookUrl:
          'https://qyapi.weixin.qq.com/cgi-bin/webhook/send?key=shared',
        isActive: true,
      },
    ]);
    dbMock.order.findUnique.mockImplementation(async () => {
      sequence.push('freshness');
      return current;
    });
    waitForSlotMock.mockImplementationOnce(async () => {
      sequence.push('permit');
    });
    ledgerMock.claim.mockImplementationOnce(async () => {
      sequence.push('claim');
      return { claimed: true, attemptId: 'attempt:c1' };
    });
    const assertLease = vi.fn(async () => {
      sequence.push('lease');
    });
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => {
        sequence.push('fetch');
        return {
          ok: true,
          status: 200,
          json: async () => ({ errcode: 0, errmsg: 'ok' }),
        };
      }),
    );

    try {
      await expect(
        notify(
          'ORDER_COMPLETED',
          {
            orderId: 'o1',
            orderNo: 'O-1',
            workOrderVersion: 2,
            externalSalesName: '外销甲',
            customerRef: null,
          },
          {
            mockMode: false,
            now: new Date('2026-09-02T08:01:00.000Z'),
            deliveryKey: 'notification:ORDER_COMPLETED:o1:v2',
            deliveryAttempt: 1,
            assertLease,
          },
        ),
      ).resolves.toMatchObject({ delivered: 1, unknown: 0 });
      expect(sequence).toEqual([
        'lease',
        'freshness',
        'permit',
        'freshness',
        'lease',
        'claim',
        'lease',
        'freshness',
        'fetch',
      ]);
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it('ORDER_COMPLETED 等 permit 期间升版时，在 SENDING/fetch 前安全跳过', async () => {
    dbMock.notificationRule.findUnique.mockResolvedValue({
      eventType: 'ORDER_COMPLETED',
      channelIds: ['c1'],
      messageTemplate: '工单 {orderNo} 生产已完成',
      isActive: true,
    });
    dbMock.notificationChannel.findMany.mockResolvedValue([
      {
        id: 'c1',
        webhookUrl:
          'https://qyapi.weixin.qq.com/cgi-bin/webhook/send?key=shared',
        isActive: true,
      },
    ]);
    dbMock.order.findUnique
      .mockResolvedValueOnce({
        status: 'PACKING',
        workOrderVersion: 2,
        completedAt: new Date('2026-09-02T08:00:00.000Z'),
      })
      .mockResolvedValueOnce({
        status: 'PACKING',
        workOrderVersion: 3,
        completedAt: new Date('2026-09-02T08:00:00.000Z'),
      });
    vi.stubGlobal('fetch', vi.fn());

    try {
      await expect(
        notify(
          'ORDER_COMPLETED',
          {
            orderId: 'o1',
            orderNo: 'O-1',
            workOrderVersion: 2,
            externalSalesName: '外销甲',
            customerRef: null,
          },
          {
            mockMode: false,
            now: new Date('2026-09-02T08:01:00.000Z'),
            deliveryKey: 'notification:ORDER_COMPLETED:o1:v2',
            deliveryAttempt: 1,
          },
        ),
      ).resolves.toMatchObject({
        attempted: 0,
        delivered: 0,
        skipped: 1,
        unknown: 0,
      });
      expect(waitForSlotMock).toHaveBeenCalledOnce();
      expect(ledgerMock.claim).not.toHaveBeenCalled();
      expect(fetch).not.toHaveBeenCalled();
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it('ORDER_COMPLETED claim 后再升版时终结账本，不遗留 SENDING/UNKNOWN 或自动重发', async () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    dbMock.notificationRule.findUnique.mockResolvedValue({
      eventType: 'ORDER_COMPLETED',
      channelIds: ['c1'],
      messageTemplate: '工单 {orderNo} 生产已完成',
      isActive: true,
    });
    dbMock.notificationChannel.findMany.mockResolvedValue([
      {
        id: 'c1',
        webhookUrl:
          'https://qyapi.weixin.qq.com/cgi-bin/webhook/send?key=shared',
        isActive: true,
      },
    ]);
    const current = {
      status: 'PACKING',
      workOrderVersion: 2,
      completedAt: new Date('2026-09-02T08:00:00.000Z'),
    };
    dbMock.order.findUnique
      .mockResolvedValueOnce(current)
      .mockResolvedValueOnce(current)
      .mockResolvedValueOnce({ ...current, workOrderVersion: 3 });
    ledgerMock.finalize.mockRejectedValueOnce(
      new Error('database response lost'),
    );
    vi.stubGlobal('fetch', vi.fn());

    try {
      await expect(
        notify(
          'ORDER_COMPLETED',
          {
            orderId: 'o1',
            orderNo: 'O-1',
            workOrderVersion: 2,
            externalSalesName: '外销甲',
            customerRef: null,
          },
          {
            mockMode: false,
            now: new Date('2026-09-02T08:01:00.000Z'),
            deliveryKey: 'notification:ORDER_COMPLETED:o1:v2',
            deliveryAttempt: 1,
          },
        ),
      ).resolves.toMatchObject({
        attempted: 0,
        delivered: 0,
        skipped: 1,
        failed: 0,
        retryable: false,
        unknown: 0,
      });
      expect(ledgerMock.claim).toHaveBeenCalledOnce();
      expect(ledgerMock.finalize).toHaveBeenCalledExactlyOnceWith({
        deliveryKey: 'notification:ORDER_COMPLETED:o1:v2',
        channelId: 'c1',
        attemptId: 'attempt:c1',
        jobAttempt: 1,
        status: 'FAILED',
        errorMessage: 'notification superseded before webhook send',
        retryCount: 0,
        sent: false,
      });
      expect(ledgerMock.recover).toHaveBeenCalledExactlyOnceWith({
        deliveryKey: 'notification:ORDER_COMPLETED:o1:v2',
        channelId: 'c1',
        attemptId: 'attempt:c1',
        jobAttempt: 1,
        status: 'FAILED',
        errorMessage: 'notification superseded before webhook send',
        retryCount: 0,
        sent: false,
      });
      expect(fetch).not.toHaveBeenCalled();
    } finally {
      warnSpy.mockRestore();
      vi.unstubAllGlobals();
    }
  });

  it('ORDER_COMPLETED durable mock 在 claim 后升版时不会误记 SUCCESS', async () => {
    dbMock.notificationRule.findUnique.mockResolvedValue({
      eventType: 'ORDER_COMPLETED',
      channelIds: ['c1'],
      messageTemplate: '工单 {orderNo} 生产已完成',
      isActive: true,
    });
    dbMock.notificationChannel.findMany.mockResolvedValue([
      { id: 'c1', webhookUrl: 'https://qy/1', isActive: true },
    ]);
    const current = {
      status: 'PACKING',
      workOrderVersion: 2,
      completedAt: new Date('2026-09-02T08:00:00.000Z'),
    };
    dbMock.order.findUnique
      .mockResolvedValueOnce(current)
      .mockResolvedValueOnce({ ...current, workOrderVersion: 3 });

    const outcome = await notify(
      'ORDER_COMPLETED',
      {
        orderId: 'o1',
        orderNo: 'O-1',
        workOrderVersion: 2,
        externalSalesName: '外销甲',
        customerRef: null,
      },
      {
        mockMode: true,
        now: new Date('2026-09-02T08:01:00.000Z'),
        deliveryKey: 'notification:ORDER_COMPLETED:o1:v2',
        deliveryAttempt: 1,
      },
    );

    expect(ledgerMock.claim).toHaveBeenCalledOnce();
    expect(ledgerMock.finalize).toHaveBeenCalledExactlyOnceWith(
      expect.objectContaining({
        status: 'FAILED',
        errorMessage: 'notification superseded before webhook send',
      }),
    );
    expect(outcome).toMatchObject({
      attempted: 0,
      delivered: 0,
      skipped: 1,
      failed: 0,
    });
  });

  it.each(['PACKING', 'ON_HOLD'])(
    'ORDER_COMPLETED 当前版本且状态为 %s → 发送；暂停不否定生产已完成事实',
    async (status) => {
      dbMock.notificationRule.findUnique.mockResolvedValue({
        eventType: 'ORDER_COMPLETED',
        channelIds: ['c1'],
        messageTemplate: '工单 {orderNo} 生产已完成',
        isActive: true,
      });
      dbMock.notificationChannel.findMany.mockResolvedValue([
        { id: 'c1', webhookUrl: 'https://qy/1', isActive: true },
      ]);
      dbMock.order.findUnique.mockResolvedValue({
        status,
        workOrderVersion: 2,
        completedAt: new Date('2026-09-02T08:00:00.000Z'),
      });

      const outcome = await notify(
        'ORDER_COMPLETED',
        {
          orderId: 'o1',
          orderNo: 'O-1',
          workOrderVersion: 2,
          externalSalesName: '外销甲',
          customerRef: null,
        },
        { webhookSender: okSender, mockMode: false },
      );

      expect(outcome).toMatchObject({
        attempted: 1,
        delivered: 1,
        skipped: 0,
      });
      expect(okSender).toHaveBeenCalledTimes(1);
      expect(dbMock.notificationLog.create).toHaveBeenCalledTimes(1);
    },
  );

  it('历史无 workOrderVersion 的 ORDER_COMPLETED payload 仅在 legacy COMPLETED 状态兼容发送', async () => {
    dbMock.notificationRule.findUnique.mockResolvedValue({
      eventType: 'ORDER_COMPLETED',
      channelIds: ['c1'],
      messageTemplate: '工单 {orderNo} 生产已完成',
      isActive: true,
    });
    dbMock.notificationChannel.findMany.mockResolvedValue([
      { id: 'c1', webhookUrl: 'https://qy/1', isActive: true },
    ]);
    dbMock.order.findUnique.mockResolvedValue({
      status: 'COMPLETED',
      workOrderVersion: 1,
      completedAt: new Date('2026-09-02T08:00:00.000Z'),
    });
    const legacyPayload = {
      orderId: 'o1',
      orderNo: 'O-1',
      customerRef: null,
    } as unknown as NotificationPayloadFor<'ORDER_COMPLETED'>;

    const outcome = await notify('ORDER_COMPLETED', legacyPayload, {
      webhookSender: okSender,
      mockMode: false,
    });

    expect(outcome).toMatchObject({ attempted: 1, delivered: 1, skipped: 0 });
    expect(okSender).toHaveBeenCalledTimes(1);
  });

  it('inactive channel 写 FAILED log（不 send；Codex round 101 P2）', async () => {
    dbMock.notificationRule.findUnique.mockResolvedValue({
      eventType: 'ORDER_SUBMITTED',
      channelIds: ['c1', 'c2'],
      messageTemplate: 'x',
      isActive: true,
    });
    dbMock.notificationChannel.findMany.mockResolvedValue([
      { id: 'c1', webhookUrl: 'https://qy/1', isActive: true },
      { id: 'c2', webhookUrl: 'https://qy/2', isActive: false },
    ]);
    await notify(
      'ORDER_SUBMITTED',
      {
        orderId: 'o1',
        orderNo: 'O-1',
        submitterName: '张三',
        customerRef: null,
        totalAmount: '0',
        urgentMark: '',
      },
      { webhookSender: okSender, mockMode: false },
    );
    // 仅 active channel 真发；inactive 不调 sender
    expect(okSender).toHaveBeenCalledTimes(1);
    // 但 2 条 log 都写：c1=SUCCESS, c2=FAILED w/ errorMessage='channel inactive'
    expect(dbMock.notificationLog.create).toHaveBeenCalledTimes(2);
    const c1Data = dbMock.notificationLog.create.mock.calls[0][0].data;
    const c2Data = dbMock.notificationLog.create.mock.calls[1][0].data;
    expect(c1Data.channelId).toBe('c1');
    expect(c1Data.status).toBe('SUCCESS');
    expect(c2Data.channelId).toBe('c2');
    expect(c2Data.status).toBe('FAILED');
    expect(c2Data.errorMessage).toBe('channel inactive');
    expect(c2Data.sentAt).toBeNull();
    // findMany 不应再过滤 isActive（要把 inactive 也拉回来分流）
    const where = dbMock.notificationChannel.findMany.mock.calls[0][0].where;
    expect(where.isActive).toBeUndefined();
  });

  it('rule.channelIds 含重复 id → 仅发一次（Codex round 117 medium 防回归 + round 118：不误报 stale）', async () => {
    const warnSpy = vi
      .spyOn(console, 'warn')
      .mockImplementation(() => undefined);
    dbMock.notificationRule.findUnique.mockResolvedValue({
      eventType: 'ORDER_SUBMITTED',
      channelIds: ['c1', 'c1', 'c2', 'c1'], // 重复 c1
      messageTemplate: 'x',
      isActive: true,
    });
    dbMock.notificationChannel.findMany.mockResolvedValue([
      { id: 'c1', webhookUrl: 'https://qy/1', isActive: true },
      { id: 'c2', webhookUrl: 'https://qy/2', isActive: true },
    ]);
    await notify(
      'ORDER_SUBMITTED',
      {
        orderId: 'o1',
        orderNo: 'O-1',
        submitterName: '张三',
        customerRef: null,
        totalAmount: '0',
        urgentMark: '',
      },
      { webhookSender: okSender, mockMode: false },
    );
    // 2 个 unique channel → 各一次（不是 4 次）
    expect(okSender).toHaveBeenCalledTimes(2);
    expect(dbMock.notificationLog.create).toHaveBeenCalledTimes(2);
    const channelIds = dbMock.notificationLog.create.mock.calls.map(
      (c) => c[0].data.channelId,
    );
    // 顺序保留：c1 在前（重复折叠到第一次出现）
    expect(channelIds).toEqual(['c1', 'c2']);
    // **不**误报 stale（round 118 medium：之前用 raw rule.channelIds.length
    // 比较会把&ldquo;有重复&rdquo;误读成&ldquo;有缺失&rdquo;）。
    expect(warnSpy).not.toHaveBeenCalledWith(
      expect.stringContaining('some channelIds stale'),
    );
    warnSpy.mockRestore();
  });

  it('按 rule.channelIds 顺序投递，不被 PG `IN()` 乱序影响（Codex round 116 high）', async () => {
    dbMock.notificationRule.findUnique.mockResolvedValue({
      eventType: 'ORDER_SUBMITTED',
      channelIds: ['owner-group', 'sales-group'],
      messageTemplate: 'x',
      isActive: true,
    });
    // PG 返回顺序乱了（sales-group 在前）—— 模拟 IN(...) 不保证顺序。
    dbMock.notificationChannel.findMany.mockResolvedValue([
      { id: 'sales-group', webhookUrl: 'https://qy/sales', isActive: true },
      { id: 'owner-group', webhookUrl: 'https://qy/owner', isActive: true },
    ]);
    await notify(
      'ORDER_SUBMITTED',
      {
        orderId: 'o1',
        orderNo: 'O-1',
        submitterName: '张三',
        customerRef: null,
        totalAmount: '0',
        urgentMark: '',
      },
      { webhookSender: okSender, mockMode: false },
    );
    expect(
      dbMock.notificationLog.create.mock.calls.map((call) => call[0].data.channelId),
    ).toEqual(['owner-group', 'sales-group']);
    expect(okSender).toHaveBeenNthCalledWith(1, 'https://qy/owner', expect.any(String));
  });

  it('其他事件 ORDER_SUBMITTED + 多 channel → 不 cap', async () => {
    dbMock.notificationRule.findUnique.mockResolvedValue({
      eventType: 'ORDER_SUBMITTED',
      channelIds: ['c1', 'c2'],
      messageTemplate: 'x',
      isActive: true,
    });
    dbMock.notificationChannel.findMany.mockResolvedValue([
      { id: 'c1', webhookUrl: 'https://qy/1', isActive: true },
      { id: 'c2', webhookUrl: 'https://qy/2', isActive: true },
    ]);
    await notify(
      'ORDER_SUBMITTED',
      {
        orderId: 'o1',
        orderNo: 'O-1',
        submitterName: '张三',
        customerRef: null,
        totalAmount: '0',
        urgentMark: '',
      },
      { webhookSender: okSender, mockMode: false },
    );
    // 两个都发
    expect(okSender).toHaveBeenCalledTimes(2);
  });

  it('部分 channelIds stale → 已存在的还发，console.warn', async () => {
    const warnSpy = vi
      .spyOn(console, 'warn')
      .mockImplementation(() => undefined);
    dbMock.notificationRule.findUnique.mockResolvedValue({
      eventType: 'ORDER_SUBMITTED',
      channelIds: ['c1', 'stale-id'],
      messageTemplate: 'x',
      isActive: true,
    });
    dbMock.notificationChannel.findMany.mockResolvedValue([
      { id: 'c1', webhookUrl: 'https://qy/1', isActive: true },
    ]);
    await notify(
      'ORDER_SUBMITTED',
      {
        orderId: 'o1',
        orderNo: 'O-1',
        submitterName: '张三',
        customerRef: null,
        totalAmount: '0',
        urgentMark: '',
      },
      { webhookSender: okSender, mockMode: false },
    );
    expect(okSender).toHaveBeenCalledTimes(1);
    expect(dbMock.notificationLog.create).toHaveBeenCalledTimes(1);
    expect(warnSpy).toHaveBeenCalledWith(
      expect.stringContaining('some channelIds stale'),
    );
    warnSpy.mockRestore();
  });

  it('永久性 webhook 失败 → status=FAILED + errorMessage（不抛）', async () => {
    dbMock.notificationRule.findUnique.mockResolvedValue({
      eventType: 'ORDER_SUBMITTED',
      channelIds: ['c1'],
      messageTemplate: 'x',
      isActive: true,
    });
    dbMock.notificationChannel.findMany.mockResolvedValue([
      { id: 'c1', webhookUrl: 'https://qy/1', isActive: true },
    ]);

    await expect(
      notify(
        'ORDER_SUBMITTED',
        {
          orderId: 'o1',
          orderNo: 'O-1',
          submitterName: '张三',
          customerRef: null,
          totalAmount: '0',
          urgentMark: '',
        },
        { webhookSender: failSender, mockMode: false },
      ),
    ).resolves.toMatchObject({ delivered: 0, failed: 1, retryable: false });

    const data = dbMock.notificationLog.create.mock.calls[0][0].data;
    expect(data.status).toBe('FAILED');
    expect(data.retryCount).toBe(0);
    expect(data.errorMessage).toBe('wecom errcode=93000');
    expect(data.sentAt).toBeNull();
  });

  it('relatedOrderId 仅当 payload 有 orderId 时填', async () => {
    dbMock.notificationRule.findUnique.mockResolvedValue({
      eventType: 'DAILY_WORKER_SALARY',
      channelIds: ['c1'],
      messageTemplate: '日薪结算 {date}',
      isActive: true,
    });
    dbMock.notificationChannel.findMany.mockResolvedValue([
      { id: 'c1', webhookUrl: 'https://qy/1', isActive: true },
    ]);

    await notify(
      'DAILY_WORKER_SALARY',
      { date: '2026-04-27', workerCount: 5, totalAmount: '3,200.00' },
      { mockMode: true },
    );
    const data = dbMock.notificationLog.create.mock.calls[0][0].data;
    expect(data.relatedOrderId).toBeNull();
  });

  it('顶层错误（DB 查 rule 抛）被 catch → 不抛', async () => {
    const errSpy = vi
      .spyOn(console, 'error')
      .mockImplementation(() => undefined);
    dbMock.notificationRule.findUnique.mockRejectedValue(
      new Error('connection lost'),
    );
    await expect(
      notify('ORDER_SUBMITTED', {
        orderId: 'o1',
        orderNo: 'O-1',
        submitterName: '张三',
        customerRef: null,
        totalAmount: '0',
        urgentMark: '',
      }),
    ).resolves.toMatchObject({ retryable: true, errorCodes: ['Error'] });
    // 基础设施故障必须标成可重试，否则 job 又会像改动前那样静默 SUCCEEDED。
    expect(dbMock.notificationLog.create).not.toHaveBeenCalled();
    errSpy.mockRestore();
  });

  it('log 写入失败被 catch → 仍不抛', async () => {
    const errSpy = vi
      .spyOn(console, 'error')
      .mockImplementation(() => undefined);
    dbMock.notificationRule.findUnique.mockResolvedValue({
      eventType: 'ORDER_SUBMITTED',
      channelIds: ['c1'],
      messageTemplate: 'x',
      isActive: true,
    });
    dbMock.notificationChannel.findMany.mockResolvedValue([
      { id: 'c1', webhookUrl: 'https://qy/1', isActive: true },
    ]);
    dbMock.notificationLog.create.mockRejectedValue(new Error('FK violation'));

    await expect(
      notify(
        'ORDER_SUBMITTED',
        {
          orderId: 'o1',
          orderNo: 'O-1',
          submitterName: '张三',
          customerRef: null,
          totalAmount: '0',
          urgentMark: '',
        },
        { webhookSender: okSender, mockMode: false },
      ),
    ).resolves.toMatchObject({ delivered: 1, unlogged: 1, retryable: false });
    errSpy.mockRestore();
  });

  it('sender 内部 throw 被 catch，写 UNKNOWN log（不盲目重发）', async () => {
    dbMock.notificationRule.findUnique.mockResolvedValue({
      eventType: 'ORDER_SUBMITTED',
      channelIds: ['c1'],
      messageTemplate: 'x',
      isActive: true,
    });
    dbMock.notificationChannel.findMany.mockResolvedValue([
      { id: 'c1', webhookUrl: 'https://qy/1', isActive: true },
    ]);
    const buggyErr = new Error('boom');
    buggyErr.name = 'BuggyError';
    const buggySender: WebhookSender = vi.fn(async () => {
      throw buggyErr;
    });

    await notify(
      'ORDER_SUBMITTED',
      {
        orderId: 'o1',
        orderNo: 'O-1',
        submitterName: '张三',
        customerRef: null,
        totalAmount: '0',
        urgentMark: '',
      },
      { webhookSender: buggySender, mockMode: false },
    );

    const data = dbMock.notificationLog.create.mock.calls[0][0].data;
    expect(data.status).toBe('UNKNOWN');
    expect(data.errorMessage).toBe('BuggyError');
  });

  it.each([
    ['', '/orders#wo=O-99'],
    ['https://erp.example.com/', 'https://erp.example.com/orders#wo=O-99'],
  ])('management messageContent 只渲染单号与安全摘要，并使用公网配置 %s', async (publicUrl, expectedLink) => {
    vi.stubEnv('APP_PUBLIC_URL', publicUrl);
    dbMock.notificationRule.findUnique.mockResolvedValue({
      eventType: 'ORDER_SUBMITTED',
      channelIds: ['c1'],
      messageTemplate: '工单 {orderNo}\n{summary}\n{deepLink}',
      isActive: true,
    });
    dbMock.notificationChannel.findMany.mockResolvedValue([
      { id: 'c1', webhookUrl: 'https://qy/1', isActive: true },
    ]);

    await notify(
      'ORDER_SUBMITTED',
      {
        orderId: 'o1',
        orderNo: 'O-99',
        submitterName: '李四',
        customerRef: null,
        totalAmount: '0',
        urgentMark: '',
      },
      { mockMode: true },
    );
    const data = dbMock.notificationLog.create.mock.calls[0][0].data;
    expect(data.messageContent).toBe(
      `工单 O-99\n新工单已提交，待工厂确认\n${expectedLink}`,
    );
    expect(data.messageContent).not.toContain('李四');
  });

  it('托管事件只用固定角色路由，忽略 legacy rule.channelIds', async () => {
    routingMock.resolve.mockResolvedValue({
      role: 'factoryConfirmer',
      enabled: true,
      channelIds: ['factory-channel'],
    });
    dbMock.notificationRule.findUnique.mockResolvedValue({
      eventType: 'ORDER_SUBMITTED',
      channelIds: ['legacy-owner-channel'],
      messageTemplate: '工单 {orderNo}',
      isActive: true,
    });
    dbMock.notificationChannel.findMany.mockResolvedValue([
      {
        id: 'factory-channel',
        webhookUrl: 'https://qy/factory',
        isActive: true,
      },
    ]);

    await notify(
      'ORDER_SUBMITTED',
      {
        orderId: 'o1',
        orderNo: 'O-1',
        submitterName: '张三',
        urgentMark: '',
      },
      { webhookSender: okSender, mockMode: false },
    );

    expect(dbMock.notificationChannel.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: { in: ['factory-channel'] } },
      }),
    );
    expect(okSender).toHaveBeenCalledWith(
      'https://qy/factory',
      expect.any(String),
    );
  });

  it.each([
    ['角色关闭', { role: 'owner', enabled: false, channelIds: ['owner-channel'] }],
    ['角色空群', { role: 'owner', enabled: true, channelIds: [] }],
  ])('%s时 fail-closed，不回退 legacy 群', async (_label, route) => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    routingMock.resolve.mockResolvedValue(route);
    dbMock.notificationRule.findUnique.mockResolvedValue({
      eventType: 'PRODUCTION_STAGNANT',
      channelIds: ['legacy-channel'],
      messageTemplate: '{summary}',
      isActive: true,
    });

    const outcome = await notify('PRODUCTION_STAGNANT', {
      orderId: 'o1',
      orderNo: 'O-1',
      summary: '停滞',
      deepLink: '/orders#wo=O-1',
    }, { webhookSender: okSender, mockMode: false });

    expect(outcome).toMatchObject({ attempted: 0, delivered: 0, failed: 0 });
    expect(dbMock.notificationChannel.findMany).not.toHaveBeenCalled();
    expect(okSender).not.toHaveBeenCalled();
    expect(dbMock.notificationLog.create).not.toHaveBeenCalled();
    warnSpy.mockRestore();
  });

  it('托管路由含已停用群时整次 fail-closed，并写 FAILED log', async () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    routingMock.resolve.mockResolvedValue({
      role: 'owner',
      enabled: true,
      channelIds: ['owner-channel'],
    });
    dbMock.notificationRule.findUnique.mockResolvedValue({
      eventType: 'PRODUCTION_STAGNANT',
      channelIds: ['legacy-channel'],
      messageTemplate: '{summary}',
      isActive: true,
    });
    dbMock.notificationChannel.findMany.mockResolvedValue([
      {
        id: 'owner-channel',
        webhookUrl: 'https://qy/owner',
        isActive: false,
      },
    ]);

    const outcome = await notify('PRODUCTION_STAGNANT', {
      orderId: 'o1',
      orderNo: 'O-1',
      summary: '停滞',
      deepLink: '/orders#wo=O-1',
    }, { webhookSender: okSender, mockMode: false });

    expect(outcome).toMatchObject({
      attempted: 0,
      delivered: 0,
      failed: 1,
      unlogged: 0,
      errorCodes: ['channel inactive'],
    });
    expect(okSender).not.toHaveBeenCalled();
    expect(dbMock.notificationLog.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        eventType: 'PRODUCTION_STAGNANT',
        channelId: 'owner-channel',
        status: 'FAILED',
        errorMessage: 'channel inactive',
      }),
    });
    expect(warnSpy).toHaveBeenCalledWith(
      expect.stringContaining('management route fail-closed'),
    );
    warnSpy.mockRestore();
  });

  it('托管路由含缺失群时把无法落 FK 日志的失败写进 outcome', async () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    routingMock.resolve.mockResolvedValue({
      role: 'owner',
      enabled: true,
      channelIds: ['missing-owner-channel'],
    });
    dbMock.notificationRule.findUnique.mockResolvedValue({
      eventType: 'PRODUCTION_STAGNANT',
      channelIds: ['legacy-channel'],
      messageTemplate: '{summary}',
      isActive: true,
    });
    dbMock.notificationChannel.findMany.mockResolvedValue([]);

    const outcome = await notify('PRODUCTION_STAGNANT', {
      orderId: 'o1',
      orderNo: 'O-1',
      summary: '停滞',
      deepLink: '/orders#wo=O-1',
    }, { webhookSender: okSender, mockMode: false });

    expect(outcome).toMatchObject({
      attempted: 0,
      delivered: 0,
      failed: 1,
      unlogged: 1,
      errorCodes: ['management channel missing'],
    });
    expect(okSender).not.toHaveBeenCalled();
    expect(dbMock.notificationLog.create).not.toHaveBeenCalled();
    expect(warnSpy).toHaveBeenCalledWith(
      expect.stringContaining('management route fail-closed'),
    );
    warnSpy.mockRestore();
  });
});

// ── durable job 路径（传 deliveryKey）──────────────────────────────────
// Every channel is reserved before HTTP. These tests deliberately mock the
// ledger itself; delivery-ledger.test.ts locks its atomic SQL/fencing contract.
describe('notify · durable delivery ledger', () => {
  const submitted = {
    orderId: 'o1',
    orderNo: 'O-1',
    submitterName: '张三',
    customerRef: null,
    totalAmount: '0',
    urgentMark: '',
  } as const;

  function twoChannels() {
    dbMock.notificationRule.findUnique.mockResolvedValue({
      eventType: 'ORDER_SUBMITTED',
      channelIds: ['c1', 'c2'],
      messageTemplate: 'x',
      isActive: true,
    });
    dbMock.notificationChannel.findMany.mockResolvedValue([
      { id: 'c1', webhookUrl: 'https://qy/1', isActive: true },
      { id: 'c2', webhookUrl: 'https://qy/2', isActive: true },
    ]);
  }

  it.each(recoverableManagementEventCases)(
    '$event 在 Bot ID 暂缺时整条管理路由零发送，且所有现存群保留 RETRYING',
    async ({ event, role, payload }) => {
      vi.stubEnv('WECOM_SMART_BOT_ID', '');
      const expectedBotDigest = smartBotIdDigest('expected-bot-id');
      routingMock.resolve.mockResolvedValue({
        role,
        enabled: true,
        channelIds: ['managed-webhook', 'managed-smart-bot'],
      });
      dbMock.notificationRule.findUnique.mockResolvedValue({
        eventType: event,
        channelIds: ['legacy-channel'],
        messageTemplate: '工单 {orderNo}',
        isActive: true,
      });
      dbMock.notificationChannel.findMany.mockResolvedValue([
        {
          id: 'managed-webhook',
          transport: 'WECOM_GROUP_WEBHOOK',
          webhookUrl: 'https://qy.example/managed-webhook',
          smartBotBotDigest: null,
          smartBotTargetId: null,
          smartBotChatType: null,
          smartBotBoundAt: null,
          isActive: true,
        },
        {
          id: 'managed-smart-bot',
          transport: 'WECOM_SMART_BOT',
          webhookUrl: null,
          smartBotBotDigest: expectedBotDigest,
          smartBotTargetId: 'managed-group',
          smartBotChatType: 'GROUP',
          smartBotBoundAt: new Date('2026-09-05T00:00:00Z'),
          isActive: true,
        },
      ]);
      const webhookSender: WebhookSender = vi.fn();
      const smartBotSender = vi.fn();

      const outcome = await notify(event, payload, {
        deliveryKey: `notification:${event}:o-managed`,
        deliveryAttempt: 1,
        webhookSender,
        smartBotSender,
        mockMode: false,
      });

      expect(webhookSender).not.toHaveBeenCalled();
      expect(smartBotSender).not.toHaveBeenCalled();
      expect(ledgerMock.claim).toHaveBeenCalledTimes(2);
      expect(ledgerMock.finalize).toHaveBeenCalledTimes(2);
      for (const [input] of ledgerMock.finalize.mock.calls) {
        expect(input).toEqual(
          expect.objectContaining({
            status: 'RETRYING',
            errorMessage: 'management route incomplete',
            sent: false,
          }),
        );
      }
      expect(outcome).toMatchObject({
        attempted: 0,
        delivered: 0,
        skipped: 0,
        failed: 2,
        unknown: 0,
        retryable: true,
      });
    },
  );

  it('错误 Bot ID 恢复后只投递未成功群，并保留既有 SUCCESS 去重', async () => {
    const expectedBotId = 'expected-bot-id';
    vi.stubEnv('WECOM_SMART_BOT_ID', 'wrong-bot-id');
    routingMock.resolve.mockResolvedValue({
      role: 'owner',
      enabled: true,
      channelIds: ['already-success', 'pending-webhook', 'pending-smart-bot'],
    });
    dbMock.notificationRule.findUnique.mockResolvedValue({
      eventType: 'PRODUCTION_STAGNANT',
      channelIds: ['legacy-channel'],
      messageTemplate: '{summary}',
      isActive: true,
    });
    dbMock.notificationChannel.findMany.mockResolvedValue([
      {
        id: 'already-success',
        transport: 'WECOM_GROUP_WEBHOOK',
        webhookUrl: 'https://qy.example/already-success',
        smartBotBotDigest: null,
        smartBotTargetId: null,
        smartBotChatType: null,
        smartBotBoundAt: null,
        isActive: true,
      },
      {
        id: 'pending-webhook',
        transport: 'WECOM_GROUP_WEBHOOK',
        webhookUrl: 'https://qy.example/pending-webhook',
        smartBotBotDigest: null,
        smartBotTargetId: null,
        smartBotChatType: null,
        smartBotBoundAt: null,
        isActive: true,
      },
      {
        id: 'pending-smart-bot',
        transport: 'WECOM_SMART_BOT',
        webhookUrl: null,
        smartBotBotDigest: smartBotIdDigest(expectedBotId),
        smartBotTargetId: 'owner-group',
        smartBotChatType: 'GROUP',
        smartBotBoundAt: new Date('2026-09-05T00:00:00Z'),
        isActive: true,
      },
    ]);
    ledgerMock.claim
      .mockResolvedValueOnce({
        claimed: false,
        status: 'SUCCESS',
        errorMessage: null,
      })
      .mockResolvedValueOnce({ claimed: true, attemptId: 'attempt:pending-webhook:1' })
      .mockResolvedValueOnce({ claimed: true, attemptId: 'attempt:pending-smart-bot:1' });
    const webhookSender: WebhookSender = vi.fn(async () => ({ ok: true, retries: 0 }));
    const smartBotSender = vi.fn(async () => ({ ok: true, retries: 0 }));
    const payload = {
      orderId: 'o-managed',
      orderNo: 'O-MANAGED',
      summary: '生产停滞',
      deepLink: '/orders#wo=O-MANAGED',
    } as const;

    const blocked = await notify('PRODUCTION_STAGNANT', payload, {
      deliveryKey: 'notification:PRODUCTION_STAGNANT:o-managed',
      deliveryAttempt: 1,
      webhookSender,
      smartBotSender,
      mockMode: false,
    });

    expect(webhookSender).not.toHaveBeenCalled();
    expect(smartBotSender).not.toHaveBeenCalled();
    expect(blocked).toMatchObject({
      skipped: 1,
      failed: 2,
      retryable: true,
    });
    expect(
      ledgerMock.finalize.mock.calls.map(([input]) => input.status),
    ).toEqual(['RETRYING', 'RETRYING']);

    vi.stubEnv('WECOM_SMART_BOT_ID', expectedBotId);
    ledgerMock.claim.mockReset();
    ledgerMock.claim
      .mockResolvedValueOnce({
        claimed: false,
        status: 'SUCCESS',
        errorMessage: null,
      })
      .mockResolvedValueOnce({ claimed: true, attemptId: 'attempt:pending-webhook:2' })
      .mockResolvedValueOnce({ claimed: true, attemptId: 'attempt:pending-smart-bot:2' });
    ledgerMock.finalize.mockClear();

    const recovered = await notify('PRODUCTION_STAGNANT', payload, {
      deliveryKey: 'notification:PRODUCTION_STAGNANT:o-managed',
      deliveryAttempt: 2,
      webhookSender,
      smartBotSender,
      mockMode: false,
    });

    expect(webhookSender).toHaveBeenCalledExactlyOnceWith(
      'https://qy.example/pending-webhook',
      '生产停滞',
    );
    expect(smartBotSender).toHaveBeenCalledExactlyOnceWith(
      { targetId: 'owner-group', chatType: 'GROUP' },
      '生产停滞',
    );
    expect(ledgerMock.finalize).toHaveBeenCalledTimes(2);
    expect(
      ledgerMock.finalize.mock.calls.map(([input]) => input.status),
    ).toEqual(['SUCCESS', 'SUCCESS']);
    expect(recovered).toMatchObject({
      attempted: 2,
      delivered: 2,
      skipped: 1,
      failed: 0,
      unknown: 0,
      retryable: false,
    });
  });

  it('身份错配与停用群并存时按永久阻塞处理，不放宽整条管理路由', async () => {
    vi.stubEnv('WECOM_SMART_BOT_ID', 'wrong-bot-id');
    routingMock.resolve.mockResolvedValue({
      role: 'owner',
      enabled: true,
      channelIds: ['healthy-webhook', 'mismatched-bot', 'inactive-webhook'],
    });
    dbMock.notificationRule.findUnique.mockResolvedValue({
      eventType: 'PRODUCTION_STAGNANT',
      channelIds: ['legacy-channel'],
      messageTemplate: '{summary}',
      isActive: true,
    });
    dbMock.notificationChannel.findMany.mockResolvedValue([
      {
        id: 'healthy-webhook',
        transport: 'WECOM_GROUP_WEBHOOK',
        webhookUrl: 'https://qy.example/healthy',
        smartBotBotDigest: null,
        smartBotTargetId: null,
        smartBotChatType: null,
        smartBotBoundAt: null,
        isActive: true,
      },
      {
        id: 'mismatched-bot',
        transport: 'WECOM_SMART_BOT',
        webhookUrl: null,
        smartBotBotDigest: smartBotIdDigest('expected-bot-id'),
        smartBotTargetId: 'owner-group',
        smartBotChatType: 'GROUP',
        smartBotBoundAt: new Date('2026-09-05T00:00:00Z'),
        isActive: true,
      },
      {
        id: 'inactive-webhook',
        transport: 'WECOM_GROUP_WEBHOOK',
        webhookUrl: 'https://qy.example/inactive',
        smartBotBotDigest: null,
        smartBotTargetId: null,
        smartBotChatType: null,
        smartBotBoundAt: null,
        isActive: false,
      },
    ]);
    const webhookSender: WebhookSender = vi.fn();
    const smartBotSender = vi.fn();

    const outcome = await notify(
      'PRODUCTION_STAGNANT',
      {
        orderId: 'o-managed',
        orderNo: 'O-MANAGED',
        summary: '生产停滞',
        deepLink: '/orders#wo=O-MANAGED',
      },
      {
        deliveryKey: 'notification:PRODUCTION_STAGNANT:o-managed',
        deliveryAttempt: 1,
        webhookSender,
        smartBotSender,
        mockMode: false,
      },
    );

    expect(webhookSender).not.toHaveBeenCalled();
    expect(smartBotSender).not.toHaveBeenCalled();
    expect(ledgerMock.claim).toHaveBeenCalledTimes(3);
    expect(
      ledgerMock.finalize.mock.calls.map(([input]) => input.status),
    ).toEqual(['FAILED', 'FAILED', 'FAILED']);
    expect(outcome).toMatchObject({
      attempted: 0,
      delivered: 0,
      failed: 3,
      unknown: 0,
      retryable: false,
    });
  });

  it.each(['smartBotTargetId', 'smartBotChatType', 'smartBotBoundAt'])(
    '同一机器人身份错配且 %s 缺失时，永久绑定错误优先', async (missingField) => {
      vi.stubEnv('WECOM_SMART_BOT_ID', 'wrong-bot-id');
      routingMock.resolve.mockResolvedValue({ role: 'owner', enabled: true, channelIds: ['bot'] });
      dbMock.notificationRule.findUnique.mockResolvedValue({
        eventType: 'PRODUCTION_STAGNANT', channelIds: [], messageTemplate: '{summary}', isActive: true,
      });
      dbMock.notificationChannel.findMany.mockResolvedValue([{
        id: 'bot', transport: 'WECOM_SMART_BOT', webhookUrl: null, isActive: true,
        smartBotBotDigest: smartBotIdDigest('expected-bot-id'), smartBotTargetId: 'group',
        smartBotChatType: 'GROUP', smartBotBoundAt: new Date('2026-09-05T00:00:00Z'),
        [missingField]: null,
      }]);
      const smartBotSender = vi.fn();
      const outcome = await notify('PRODUCTION_STAGNANT', {
        orderId: 'o1', orderNo: 'O-1', summary: '停滞', deepLink: '/orders#wo=O-1',
      }, { deliveryKey: 'notification:PRODUCTION_STAGNANT:o1', deliveryAttempt: 1, smartBotSender, mockMode: false });
      expect(smartBotSender).not.toHaveBeenCalled();
      expect(outcome.retryable).toBe(false);
      expect(ledgerMock.finalize).toHaveBeenCalledWith(expect.objectContaining({ status: 'FAILED' }));
    },
  );

  it('surfaces an older SENDING row before an inactive-rule early return', async () => {
    ledgerMock.reconcile.mockResolvedValueOnce(['c1']);
    dbMock.notificationRule.findUnique.mockResolvedValue({
      eventType: 'ORDER_SUBMITTED',
      channelIds: ['c1'],
      messageTemplate: 'x',
      isActive: false,
    });

    const outcome = await notify('ORDER_SUBMITTED', submitted, {
      mockMode: false,
      deliveryKey: 'dk-1',
      deliveryAttempt: 3,
    });

    expect(ledgerMock.reconcile).toHaveBeenCalledExactlyOnceWith({
      deliveryKey: 'dk-1',
      jobAttempt: 3,
    });
    expect(outcome).toMatchObject({
      attempted: 0,
      unknown: 1,
      retryable: false,
    });
    expect(outcome.errorCodes).toContain(
      'worker lease ended before delivery was finalized',
    );
    expect(ledgerMock.claim).not.toHaveBeenCalled();
  });

  it('counts a reconciled UNKNOWN exactly once when its channel is inspected', async () => {
    twoChannels();
    ledgerMock.reconcile.mockResolvedValueOnce(['c1']);
    ledgerMock.claim
      .mockResolvedValueOnce({
        claimed: false,
        status: 'UNKNOWN',
        errorMessage: 'worker lease ended before delivery was finalized',
      })
      .mockResolvedValueOnce({ claimed: true, attemptId: 'attempt:c2' });
    const sender: WebhookSender = vi.fn(async () => ({ ok: true, retries: 0 }));

    const outcome = await notify('ORDER_SUBMITTED', submitted, {
      webhookSender: sender,
      mockMode: false,
      deliveryKey: 'dk-1',
      deliveryAttempt: 3,
    });

    expect(outcome).toMatchObject({ delivered: 1, unknown: 1 });
    expect(sender).toHaveBeenCalledTimes(1);
  });

  it.each(['http 429', 'wecom errcode=45009'])(
    'reserves before send and persists SUCCESS / RETRYING for %s',
    async (errorMessage) => {
      twoChannels();
      const sender: WebhookSender = vi.fn(async (url: string) =>
        url.endsWith('/1')
          ? { ok: true, retries: 0 }
          : { ok: false, retries: 0, errorMessage, retryable: true },
      );

      const outcome = await notify('ORDER_SUBMITTED', submitted, {
        webhookSender: sender,
        mockMode: false,
        deliveryKey: 'dk-1',
        deliveryAttempt: 2,
      });

      expect(outcome).toMatchObject({
        attempted: 2,
        delivered: 1,
        failed: 1,
        unknown: 0,
        retryable: true,
      });
      expect(ledgerMock.claim).toHaveBeenCalledTimes(2);
      expect(ledgerMock.claim.mock.invocationCallOrder[0]).toBeLessThan(
        (sender as ReturnType<typeof vi.fn>).mock.invocationCallOrder[0]!,
      );
      expect(ledgerMock.finalize).toHaveBeenNthCalledWith(
        1,
        expect.objectContaining({
          channelId: 'c1',
          status: 'SUCCESS',
          sent: true,
        }),
      );
      expect(ledgerMock.finalize).toHaveBeenNthCalledWith(
        2,
        expect.objectContaining({
          channelId: 'c2',
          status: 'RETRYING',
          sent: false,
          errorMessage,
        }),
      );
      expect(dbMock.notificationLog.create).not.toHaveBeenCalled();
    },
  );

  it('initial durable delivery treats an inactive channel as permanent', async () => {
    dbMock.notificationRule.findUnique.mockResolvedValue({
      eventType: 'ORDER_SUBMITTED',
      channelIds: ['c1'],
      messageTemplate: 'x',
      isActive: true,
    });
    dbMock.notificationChannel.findMany.mockResolvedValue([
      { id: 'c1', webhookUrl: 'https://qy/1', isActive: false },
    ]);
    const sender: WebhookSender = vi.fn();

    const outcome = await notify('ORDER_SUBMITTED', submitted, {
      webhookSender: sender,
      mockMode: false,
      deliveryKey: 'dk-1',
      deliveryAttempt: 1,
    });

    expect(sender).not.toHaveBeenCalled();
    expect(ledgerMock.finalize).toHaveBeenCalledWith(
      expect.objectContaining({
        channelId: 'c1',
        status: 'FAILED',
        errorMessage: 'channel inactive',
      }),
    );
    expect(outcome).toMatchObject({
      attempted: 0,
      failed: 1,
      retryable: false,
    });
  });

  it('托管路由失效时为所有仍存在的群预留并终结 FAILED ledger', async () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    routingMock.resolve.mockResolvedValue({
      role: 'owner',
      enabled: true,
      channelIds: ['c-active', 'c-inactive'],
    });
    dbMock.notificationRule.findUnique.mockResolvedValue({
      eventType: 'PRODUCTION_STAGNANT',
      channelIds: ['legacy-channel'],
      messageTemplate: '{summary}',
      isActive: true,
    });
    dbMock.notificationChannel.findMany.mockResolvedValue([
      { id: 'c-active', webhookUrl: 'https://qy/active', isActive: true },
      { id: 'c-inactive', webhookUrl: 'https://qy/inactive', isActive: false },
    ]);
    const sender: WebhookSender = vi.fn();

    const outcome = await notify('PRODUCTION_STAGNANT', {
      orderId: 'o1',
      orderNo: 'O-1',
      summary: '停滞',
      deepLink: '/orders#wo=O-1',
    }, {
      webhookSender: sender,
      mockMode: false,
      deliveryKey: 'dk-managed-route',
      deliveryAttempt: 1,
    });

    expect(sender).not.toHaveBeenCalled();
    expect(ledgerMock.claim).toHaveBeenCalledTimes(2);
    expect(ledgerMock.finalize).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({
        channelId: 'c-active',
        status: 'FAILED',
        errorMessage: 'management route incomplete',
      }),
    );
    expect(ledgerMock.finalize).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({
        channelId: 'c-inactive',
        status: 'FAILED',
        errorMessage: 'channel inactive',
      }),
    );
    expect(outcome).toMatchObject({
      attempted: 0,
      delivered: 0,
      failed: 2,
      retryable: false,
    });
    warnSpy.mockRestore();
  });

  it('skips a prior SUCCESS without sending it again', async () => {
    twoChannels();
    ledgerMock.claim
      .mockResolvedValueOnce({
        claimed: false,
        status: 'SUCCESS',
        errorMessage: null,
      })
      .mockResolvedValueOnce({ claimed: true, attemptId: 'attempt:c2' });
    const sender: WebhookSender = vi.fn(async () => ({ ok: true, retries: 0 }));

    const outcome = await notify('ORDER_SUBMITTED', submitted, {
      webhookSender: sender,
      mockMode: false,
      deliveryKey: 'dk-1',
      deliveryAttempt: 2,
    });

    expect(sender).toHaveBeenCalledTimes(1);
    expect(sender).toHaveBeenCalledWith('https://qy/2', expect.any(String));
    expect(outcome).toMatchObject({ skipped: 1, delivered: 1, unknown: 0 });
  });

  it('an existing SENDING/UNKNOWN reservation blocks automatic resend', async () => {
    twoChannels();
    ledgerMock.claim.mockResolvedValue({
      claimed: false,
      status: 'UNKNOWN',
      errorMessage: 'response lost',
    });
    const sender: WebhookSender = vi.fn(async () => ({ ok: true, retries: 0 }));

    const outcome = await notify('ORDER_SUBMITTED', submitted, {
      webhookSender: sender,
      mockMode: false,
      deliveryKey: 'dk-1',
      deliveryAttempt: 2,
    });

    expect(sender).not.toHaveBeenCalled();
    expect(outcome).toMatchObject({ unknown: 2, retryable: false });
    expect(outcome.errorCodes).toEqual(['response lost']);
  });

  it('failed finalization and recovery remains retryable until reconciliation', async () => {
    const errSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    twoChannels();
    ledgerMock.finalize.mockRejectedValueOnce(new Error('database response lost'));
    ledgerMock.recover.mockRejectedValueOnce(new Error('database unavailable'));
    const sender: WebhookSender = vi.fn(async () => ({ ok: true, retries: 0 }));

    const outcome = await notify('ORDER_SUBMITTED', submitted, {
      webhookSender: sender,
      mockMode: false,
      deliveryKey: 'dk-1',
      deliveryAttempt: 2,
    });

    expect(sender).toHaveBeenCalledTimes(1);
    expect(ledgerMock.recover).toHaveBeenCalledWith({
      deliveryKey: 'dk-1',
      channelId: 'c1',
      attemptId: 'attempt:c1',
      jobAttempt: 2,
      status: 'SUCCESS',
      errorMessage: null,
      retryCount: 0,
      sent: true,
    });
    expect(outcome).toMatchObject({ delivered: 0, unknown: 0, retryable: true });
    expect(outcome.unlogged).toBe(0);
    errSpy.mockRestore();
  });

  it('trusts an already-committed SUCCESS when its finalize response was lost', async () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    twoChannels();
    ledgerMock.finalize.mockRejectedValueOnce(new Error('database response lost'));
    ledgerMock.recover.mockResolvedValueOnce({
      status: 'SUCCESS',
      errorMessage: null,
    });
    const sender: WebhookSender = vi.fn(async () => ({ ok: true, retries: 0 }));

    const outcome = await notify('ORDER_SUBMITTED', submitted, {
      webhookSender: sender,
      mockMode: false,
      deliveryKey: 'dk-1',
      deliveryAttempt: 2,
    });

    expect(sender).toHaveBeenCalledTimes(2);
    expect(outcome).toMatchObject({
      delivered: 2,
      failed: 0,
      unknown: 0,
      retryable: false,
    });
    warnSpy.mockRestore();
  });

  it('trusts an already-committed RETRYING state when its finalize response was lost', async () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    twoChannels();
    ledgerMock.finalize.mockRejectedValueOnce(new Error('database response lost'));
    ledgerMock.recover.mockResolvedValueOnce({
      status: 'RETRYING',
      errorMessage: 'wecom smart bot errcode 45009',
    });
    const sender: WebhookSender = vi
      .fn()
      .mockResolvedValueOnce({
        ok: false,
        retries: 0,
        errorMessage: 'wecom smart bot errcode 45009',
        retryable: true,
      })
      .mockResolvedValueOnce({ ok: true, retries: 0 });

    const outcome = await notify('ORDER_SUBMITTED', submitted, {
      webhookSender: sender,
      mockMode: false,
      deliveryKey: 'dk-1',
      deliveryAttempt: 2,
    });

    expect(outcome).toMatchObject({
      delivered: 1,
      failed: 1,
      unknown: 0,
      retryable: true,
    });
    warnSpy.mockRestore();
  });

  it('claim failure happens before HTTP and remains retryable', async () => {
    const errSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    twoChannels();
    ledgerMock.claim.mockRejectedValueOnce(new Error('postgres unavailable'));
    const sender: WebhookSender = vi.fn(async () => ({ ok: true, retries: 0 }));

    const outcome = await notify('ORDER_SUBMITTED', submitted, {
      webhookSender: sender,
      mockMode: false,
      deliveryKey: 'dk-1',
      deliveryAttempt: 2,
    });

    expect(sender).not.toHaveBeenCalled();
    expect(outcome.retryable).toBe(true);
    errSpy.mockRestore();
  });

  it('provider ambiguity finalizes UNKNOWN and does not mark retryable', async () => {
    twoChannels();
    const sender: WebhookSender = vi.fn(async () => ({
      ok: false,
      retries: 0,
      errorMessage: 'TimeoutError',
      retryable: false,
      unknown: true,
    }));

    const outcome = await notify('ORDER_SUBMITTED', submitted, {
      webhookSender: sender,
      mockMode: false,
      deliveryKey: 'dk-1',
      deliveryAttempt: 2,
    });

    expect(outcome).toMatchObject({ unknown: 2, retryable: false });
    expect(ledgerMock.finalize).toHaveBeenCalledTimes(2);
    for (const [input] of ledgerMock.finalize.mock.calls) {
      expect(input).toEqual(expect.objectContaining({ status: 'UNKNOWN' }));
    }
  });

  it('inline path still creates terminal logs and never uses durable claims', async () => {
    twoChannels();
    const sender: WebhookSender = vi.fn(async () => ({
      ok: false,
      retries: 0,
      errorMessage: 'http 429',
      retryable: true,
    }));

    const outcome = await notify('ORDER_SUBMITTED', submitted, {
      webhookSender: sender,
      mockMode: false,
    });

    expect(ledgerMock.claim).not.toHaveBeenCalled();
    expect(dbMock.notificationLog.create).toHaveBeenCalledTimes(2);
    expect(
      dbMock.notificationLog.create.mock.calls.map((call) => call[0].data.status),
    ).toEqual(['FAILED', 'FAILED']);
    expect(outcome.retryable).toBe(true);
  });
});

describe('replayDurableNotificationLogs', () => {
  const deliveryKey = 'notification:ORDER_SUBMITTED:o1';
  const retryingLog = {
    id: 'log-c2',
    deliveryKey,
    eventType: 'ORDER_SUBMITTED',
    status: 'RETRYING',
    messageContent: '**原工单 O-1**',
    relatedOrderId: 'o1',
    deliveryStateVersion: 4,
    deliveryJobAttempt: 5,
    destinationFingerprint: webhookDestinationFingerprint(
      'https://qy.example/original',
    ),
    channel: {
      id: 'c-old',
      webhookUrl: 'https://qy.example/original',
      isActive: true,
    },
  };

  it('人工确认未送达也不能重放已被新纸质工单版本覆盖的完工消息', async () => {
    dbMock.order.findUnique.mockResolvedValue({
      status: 'PACKING',
      workOrderVersion: 3,
      completedAt: new Date('2026-09-02T08:00:00.000Z'),
    });
    const sender: WebhookSender = vi.fn();

    const outcome = await replayDurableNotificationLogs('ORDER_COMPLETED', {
      deliveryKey: 'notification:ORDER_COMPLETED:o1:v2',
      deliveryAttempt: 6,
      targets: [{ logId: 'log-c2', stateVersion: 4 }],
      payload: {
        orderId: 'o1',
        orderNo: 'O-1',
        workOrderVersion: 2,
        customerRef: null,
      },
      webhookSender: sender,
      mockMode: false,
    });

    expect(outcome).toMatchObject({ attempted: 0, skipped: 1, failed: 0 });
    expect(dbMock.notificationLog.findUnique).not.toHaveBeenCalled();
    expect(ledgerMock.claim).not.toHaveBeenCalled();
    expect(sender).not.toHaveBeenCalled();
  });

  it('钉住原 channelId + 原渲染内容，不读当前 rule/channelIds/template', async () => {
    dbMock.notificationLog.findUnique.mockResolvedValue(retryingLog);
    const sender: WebhookSender = vi.fn(async () => ({ ok: true, retries: 0 }));

    const outcome = await replayDurableNotificationLogs('ORDER_SUBMITTED', {
      deliveryKey,
      deliveryAttempt: 6,
      targets: [{ logId: 'log-c2', stateVersion: 4 }],
      webhookSender: sender,
      mockMode: false,
    });

    expect(dbMock.notificationRule.findUnique).not.toHaveBeenCalled();
    expect(dbMock.notificationChannel.findMany).not.toHaveBeenCalled();
    expect(sender).toHaveBeenCalledExactlyOnceWith(
      'https://qy.example/original',
      '**原工单 O-1**',
    );
    expect(ledgerMock.claim).toHaveBeenCalledExactlyOnceWith({
      deliveryKey,
      jobAttempt: 6,
      eventType: 'ORDER_SUBMITTED',
      channelId: 'c-old',
      destinationFingerprint: expect.stringMatching(/^[a-f0-9]{64}$/),
      messageContent: '**原工单 O-1**',
      relatedOrderId: 'o1',
      expectedStateVersion: 4,
    });
    expect(ledgerMock.finalize).toHaveBeenCalledWith(
      expect.objectContaining({ status: 'SUCCESS', channelId: 'c-old' }),
    );
    expect(outcome).toMatchObject({ attempted: 1, delivered: 1, unknown: 0 });
  });

  it('已成功的 c1 仅计入 skipped，只向 RETRYING 的 c2 发一次', async () => {
    dbMock.notificationLog.findUnique
      .mockResolvedValueOnce({
        ...retryingLog,
        id: 'log-c1',
        status: 'SUCCESS',
        deliveryStateVersion: 5,
        channel: {
          id: 'c1',
          webhookUrl: 'https://qy.example/c1',
          isActive: true,
        },
      })
      .mockResolvedValueOnce({
        ...retryingLog,
        destinationFingerprint: webhookDestinationFingerprint(
          'https://qy.example/c2',
        ),
        channel: {
          id: 'c2',
          webhookUrl: 'https://qy.example/c2',
          isActive: true,
        },
      });
    const sender: WebhookSender = vi.fn(async () => ({ ok: true, retries: 0 }));

    const outcome = await replayDurableNotificationLogs('ORDER_SUBMITTED', {
      deliveryKey,
      deliveryAttempt: 6,
      targets: [
        { logId: 'log-c1', stateVersion: 4 },
        { logId: 'log-c2', stateVersion: 4 },
      ],
      webhookSender: sender,
      mockMode: false,
    });

    expect(sender).toHaveBeenCalledExactlyOnceWith(
      'https://qy.example/c2',
      '**原工单 O-1**',
    );
    expect(outcome).toMatchObject({ skipped: 1, attempted: 1, delivered: 1 });
  });

  it('升级前没有目标指纹的旧记录不允许盲目重放', async () => {
    dbMock.notificationLog.findUnique.mockResolvedValue({
      ...retryingLog,
      destinationFingerprint: null,
    });
    const sender: WebhookSender = vi.fn();

    await expect(
      replayDurableNotificationLogs('ORDER_SUBMITTED', {
        deliveryKey,
        deliveryAttempt: 6,
        targets: [{ logId: 'log-c2', stateVersion: 4 }],
        webhookSender: sender,
        mockMode: false,
      }),
    ).rejects.toBeInstanceOf(NotificationReplayConflictError);

    expect(sender).not.toHaveBeenCalled();
    expect(ledgerMock.claim).not.toHaveBeenCalled();
  });

  it('原群已停用时保持原目标并落 RETRYING，不转发到新群', async () => {
    dbMock.notificationLog.findUnique.mockResolvedValue({
      ...retryingLog,
      channel: { ...retryingLog.channel, isActive: false },
    });
    const sender: WebhookSender = vi.fn();

    const outcome = await replayDurableNotificationLogs('ORDER_SUBMITTED', {
      deliveryKey,
      deliveryAttempt: 6,
      targets: [{ logId: 'log-c2', stateVersion: 4 }],
      webhookSender: sender,
      mockMode: false,
    });

    expect(sender).not.toHaveBeenCalled();
    expect(ledgerMock.finalize).toHaveBeenCalledWith(
      expect.objectContaining({
        channelId: 'c-old',
        status: 'RETRYING',
        errorMessage: 'channel inactive',
      }),
    );
    expect(outcome).toMatchObject({ retryable: true, failed: 1, delivered: 0 });
  });

  it('ORDER_COMPLETED 人工重放 claim 后升版且原群停用时落 superseded，不落 RETRYING', async () => {
    const completionDeliveryKey = 'notification:ORDER_COMPLETED:o1:v2';
    dbMock.notificationLog.findUnique.mockResolvedValue({
      ...retryingLog,
      deliveryKey: completionDeliveryKey,
      eventType: 'ORDER_COMPLETED',
      channel: { ...retryingLog.channel, isActive: false },
    });
    const current = {
      status: 'PACKING',
      workOrderVersion: 2,
      completedAt: new Date('2026-09-02T08:00:00.000Z'),
    };
    dbMock.order.findUnique
      .mockResolvedValueOnce(current)
      .mockResolvedValueOnce({ ...current, workOrderVersion: 3 });
    const sender: WebhookSender = vi.fn();

    const outcome = await replayDurableNotificationLogs('ORDER_COMPLETED', {
      deliveryKey: completionDeliveryKey,
      deliveryAttempt: 6,
      targets: [{ logId: 'log-c2', stateVersion: 4 }],
      payload: {
        orderId: 'o1',
        orderNo: 'O-1',
        workOrderVersion: 2,
        customerRef: null,
      },
      webhookSender: sender,
      mockMode: false,
    });

    expect(ledgerMock.claim).toHaveBeenCalledOnce();
    expect(sender).not.toHaveBeenCalled();
    expect(ledgerMock.finalize).toHaveBeenCalledExactlyOnceWith(
      expect.objectContaining({
        status: 'FAILED',
        errorMessage: 'notification superseded before webhook send',
      }),
    );
    expect(outcome).toMatchObject({
      attempted: 0,
      skipped: 1,
      failed: 0,
      retryable: false,
    });
  });

  it('中间一个 job attempt 未轮到该目标时，后续新 generation 仍能安全续传', async () => {
    dbMock.notificationLog.findUnique.mockResolvedValue({
      ...retryingLog,
      // attempt 6 已明确收到 429 并落 RETRYING；attempt 7 在处理
      // 更早的 channel 时失败，没轮到本行。attempt 8 不能因为
      // 中间跳过一代就把这个已明确未送达的目标永久卡死。
      deliveryStateVersion: 6,
      deliveryJobAttempt: 6,
    });
    const sender: WebhookSender = vi.fn(async () => ({ ok: true, retries: 0 }));

    const outcome = await replayDurableNotificationLogs('ORDER_SUBMITTED', {
      deliveryKey,
      deliveryAttempt: 8,
      targets: [{ logId: 'log-c2', stateVersion: 4 }],
      webhookSender: sender,
      mockMode: false,
    });

    expect(ledgerMock.claim).toHaveBeenCalledWith(
      expect.objectContaining({
        jobAttempt: 8,
        expectedStateVersion: 6,
      }),
    );
    expect(sender).toHaveBeenCalledTimes(1);
    expect(outcome).toMatchObject({ delivered: 1, unknown: 0 });
  });

  it('claim CAS conflict is typed and never reaches the webhook', async () => {
    dbMock.notificationLog.findUnique.mockResolvedValue(retryingLog);
    ledgerMock.claim.mockRejectedValueOnce(
      new DeliveryClaimConflictError('delivery state changed'),
    );
    const sender: WebhookSender = vi.fn();

    await expect(
      replayDurableNotificationLogs('ORDER_SUBMITTED', {
        deliveryKey,
        deliveryAttempt: 6,
        targets: [{ logId: 'log-c2', stateVersion: 4 }],
        webhookSender: sender,
        mockMode: false,
      }),
    ).rejects.toBeInstanceOf(NotificationReplayConflictError);
    expect(sender).not.toHaveBeenCalled();
  });

  it('ordinary replay claim infrastructure errors remain retryable', async () => {
    const errorSpy = vi
      .spyOn(console, 'error')
      .mockImplementation(() => undefined);
    dbMock.notificationLog.findUnique.mockResolvedValue(retryingLog);
    ledgerMock.claim.mockRejectedValueOnce(new Error('postgres unavailable'));
    const sender: WebhookSender = vi.fn();

    const outcome = await replayDurableNotificationLogs('ORDER_SUBMITTED', {
      deliveryKey,
      deliveryAttempt: 6,
      targets: [{ logId: 'log-c2', stateVersion: 4 }],
      webhookSender: sender,
      mockMode: false,
    });

    expect(outcome).toMatchObject({ retryable: true, unknown: 0 });
    expect(outcome.errorCodes).toContain('Error');
    expect(sender).not.toHaveBeenCalled();
    errorSpy.mockRestore();
  });

  it('stale payload cannot send a newer manually reopened RETRYING generation', async () => {
    dbMock.notificationLog.findUnique.mockResolvedValue({
      ...retryingLog,
      deliveryStateVersion: 8,
      // The paused worker is also attempt 6. A resolver stamped that DEAD
      // generation into the row, so only the newly re-armed attempt 7 may
      // claim it; target v4 from the stale payload is not authorization.
      deliveryJobAttempt: 6,
    });
    const sender: WebhookSender = vi.fn();

    await expect(
      replayDurableNotificationLogs('ORDER_SUBMITTED', {
        deliveryKey,
        deliveryAttempt: 6,
        targets: [{ logId: 'log-c2', stateVersion: 4 }],
        webhookSender: sender,
        mockMode: false,
      }),
    ).rejects.toBeInstanceOf(NotificationReplayConflictError);

    expect(sender).not.toHaveBeenCalled();
    expect(ledgerMock.claim).not.toHaveBeenCalled();
  });
});
