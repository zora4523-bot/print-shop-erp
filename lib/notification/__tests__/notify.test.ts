import { describe, it, expect, vi, beforeEach } from 'vitest';

const { dbMock, ledgerMock, DeliveryClaimConflictError } = vi.hoisted(() => {
  class DeliveryClaimConflictError extends Error {
    constructor(message: string) {
      super(message);
      this.name = 'NotificationDeliveryClaimConflictError';
    }
  }
  const mock = {
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
      markUnknown: vi.fn(),
    },
  };
});
vi.mock('@/lib/db', () => ({ db: dbMock }));
vi.mock('@/lib/notification/delivery-ledger', () => ({
  claimDurableDelivery: ledgerMock.claim,
  finalizeDurableDelivery: ledgerMock.finalize,
  markDurableDeliveryUnknown: ledgerMock.markUnknown,
  NotificationDeliveryClaimConflictError: DeliveryClaimConflictError,
}));

import {
  notify,
  isMockMode,
  NotificationReplayConflictError,
  replayDurableNotificationLogs,
} from '../notify';
import type { WebhookSender } from '../webhook';

beforeEach(() => {
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
  ledgerMock.markUnknown.mockReset().mockResolvedValue(undefined);
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

  it('CS_PERIOD_ENDING + legacy 多 channel → 运行时 cap 到 1 + console.warn（Codex round 115 high）', async () => {
    const warnSpy = vi
      .spyOn(console, 'warn')
      .mockImplementation(() => undefined);
    dbMock.notificationRule.findUnique.mockResolvedValue({
      eventType: 'CS_PERIOD_ENDING',
      channelIds: ['c1', 'c2', 'c3'],
      messageTemplate: 'x',
      isActive: true,
    });
    dbMock.notificationChannel.findMany.mockResolvedValue([
      { id: 'c1', webhookUrl: 'https://qy/1', isActive: true },
      { id: 'c2', webhookUrl: 'https://qy/2', isActive: true },
      { id: 'c3', webhookUrl: 'https://qy/3', isActive: true },
    ]);
    await notify(
      'CS_PERIOD_ENDING',
      { periodId: 'p1', csName: '张', daysLeft: 3, totalSales: '100,000.00' },
      { webhookSender: okSender, mockMode: false },
    );
    // 只发 1 个 channel（cap）
    expect(okSender).toHaveBeenCalledTimes(1);
    expect(dbMock.notificationLog.create).toHaveBeenCalledTimes(1);
    expect(dbMock.notificationLog.create.mock.calls[0][0].data.channelId).toBe('c1');
    // console.warn 留 ops 信号
    expect(warnSpy).toHaveBeenCalledWith(
      expect.stringContaining('CS_PERIOD privacy cap'),
    );
    warnSpy.mockRestore();
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

  it('CS_PERIOD privacy cap 按 rule.channelIds 顺序选第 1 个，不被 PG `IN()` 乱序影响（Codex round 116 high）', async () => {
    const warnSpy = vi
      .spyOn(console, 'warn')
      .mockImplementation(() => undefined);
    // rule 里 owner-group 在前，sales-group 在后——owner 期望优先发
    // owner-group。
    dbMock.notificationRule.findUnique.mockResolvedValue({
      eventType: 'CS_PERIOD_SETTLED',
      channelIds: ['owner-group', 'sales-group'],
      messageTemplate: 'x',
      isActive: true,
    });
    // 但 PG 返回顺序乱了（sales-group 在前）—— 模拟 IN(...) 不保证顺序。
    dbMock.notificationChannel.findMany.mockResolvedValue([
      { id: 'sales-group', webhookUrl: 'https://qy/sales', isActive: true },
      { id: 'owner-group', webhookUrl: 'https://qy/owner', isActive: true },
    ]);
    await notify(
      'CS_PERIOD_SETTLED',
      { settledCount: 1, csName: '张', totalSales: '10,000', commission: '300' },
      { webhookSender: okSender, mockMode: false },
    );
    // **必须发到 owner-group**（rule.channelIds[0]），不能是 sales-group
    expect(dbMock.notificationLog.create.mock.calls[0][0].data.channelId).toBe(
      'owner-group',
    );
    expect(okSender).toHaveBeenCalledTimes(1);
    // sender 第一个参数（webhook URL）也应该是 owner 的，不是 sales 的
    expect(okSender).toHaveBeenCalledWith('https://qy/owner', expect.any(String));
    warnSpy.mockRestore();
  });

  it('CS_PERIOD_SETTLED + 单 channel → 不 cap 不 warn', async () => {
    const warnSpy = vi
      .spyOn(console, 'warn')
      .mockImplementation(() => undefined);
    dbMock.notificationRule.findUnique.mockResolvedValue({
      eventType: 'CS_PERIOD_SETTLED',
      channelIds: ['c1'],
      messageTemplate: 'x',
      isActive: true,
    });
    dbMock.notificationChannel.findMany.mockResolvedValue([
      { id: 'c1', webhookUrl: 'https://qy/1', isActive: true },
    ]);
    await notify(
      'CS_PERIOD_SETTLED',
      { settledCount: 1, csName: '张', totalSales: '10,000.00', commission: '300.00' },
      { webhookSender: okSender, mockMode: false },
    );
    expect(okSender).toHaveBeenCalledTimes(1);
    expect(warnSpy).not.toHaveBeenCalledWith(
      expect.stringContaining('CS_PERIOD privacy cap'),
    );
    warnSpy.mockRestore();
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

  it('messageContent 写 log 是渲染后的 string（含 payload 字段）', async () => {
    dbMock.notificationRule.findUnique.mockResolvedValue({
      eventType: 'ORDER_SUBMITTED',
      channelIds: ['c1'],
      messageTemplate: '工单 {orderNo} 由 {submitterName} 提交',
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
    expect(data.messageContent).toBe('工单 O-99 由 李四 提交');
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

  it('successful HTTP followed by ledger failure becomes UNKNOWN, never unlogged success', async () => {
    const errSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    twoChannels();
    ledgerMock.finalize.mockRejectedValueOnce(new Error('database response lost'));
    const sender: WebhookSender = vi.fn(async () => ({ ok: true, retries: 0 }));

    const outcome = await notify('ORDER_SUBMITTED', submitted, {
      webhookSender: sender,
      mockMode: false,
      deliveryKey: 'dk-1',
      deliveryAttempt: 2,
    });

    expect(sender).toHaveBeenCalledTimes(1);
    expect(ledgerMock.markUnknown).toHaveBeenCalledWith({
      deliveryKey: 'dk-1',
      channelId: 'c1',
      attemptId: 'attempt:c1',
      errorMessage: 'delivery finalization failed',
    });
    expect(outcome).toMatchObject({ delivered: 1, unknown: 1, retryable: true });
    expect(outcome.unlogged).toBe(0);
    errSpy.mockRestore();
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
    channel: {
      id: 'c-old',
      webhookUrl: 'https://qy.example/original',
      isActive: true,
    },
  };

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
