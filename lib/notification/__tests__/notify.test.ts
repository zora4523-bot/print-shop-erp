import { describe, it, expect, vi, beforeEach } from 'vitest';

const { dbMock } = vi.hoisted(() => {
  const mock = {
    notificationRule: { findUnique: vi.fn() },
    notificationChannel: { findMany: vi.fn() },
    // findMany / upsert 只在传了 deliveryKey（durable job 路径）时用到；
    // 不传 deliveryKey 的同步路径仍然走 create，行为逐字未变。
    notificationLog: { create: vi.fn(), findMany: vi.fn(), upsert: vi.fn() },
  };
  return { dbMock: mock };
});
vi.mock('@/lib/db', () => ({ db: dbMock }));

import { notify, isMockMode } from '../notify';
import type { WebhookSender } from '../webhook';

beforeEach(() => {
  dbMock.notificationRule.findUnique.mockReset();
  dbMock.notificationChannel.findMany.mockReset();
  dbMock.notificationLog.create.mockReset().mockResolvedValue({});
  dbMock.notificationLog.findMany.mockReset().mockResolvedValue([]);
  dbMock.notificationLog.upsert.mockReset().mockResolvedValue({});
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
    retries: 2,
    errorMessage: 'http 500',
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

  it('webhook 失败 → status=FAILED + retryCount + errorMessage（不抛）', async () => {
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
    expect(data.retryCount).toBe(2);
    expect(data.errorMessage).toBe('http 500');
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

  it('sender 内部 throw 被 catch，写 FAILED log（不抛）', async () => {
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
    expect(data.status).toBe('FAILED');
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
//
// notify 的公开契约仍然是**永不抛**；它只把「值不值得重试」放进返回值，
// 由 handleNotificationJob 决定抛不抛。这一组用例锁的就是这条边界，以及
// 「重试不重复打扰已经收到消息的群」。
describe('notify · deliveryKey（durable 重试）', () => {
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

  it('部分成功 + 可重试失败 → outcome.retryable=true，失败方写 RETRYING', async () => {
    twoChannels();
    const sender: WebhookSender = vi.fn(async (url: string) =>
      url.endsWith('/1')
        ? { ok: true, retries: 0 }
        : { ok: false, retries: 2, errorMessage: 'http 500', retryable: true },
    );

    const outcome = await notify('ORDER_SUBMITTED', submitted, {
      webhookSender: sender,
      mockMode: false,
      deliveryKey: 'dk-1',
    });

    expect(outcome).toMatchObject({
      attempted: 2,
      delivered: 1,
      skipped: 0,
      failed: 1,
      retryable: true,
      unlogged: 0,
      errorCodes: ['http 500'],
    });
    // 带 deliveryKey 一律走 upsert，绝不再 create 新行
    expect(dbMock.notificationLog.create).not.toHaveBeenCalled();
    expect(dbMock.notificationLog.upsert).toHaveBeenCalledTimes(2);
    const first = dbMock.notificationLog.upsert.mock.calls[0][0];
    const second = dbMock.notificationLog.upsert.mock.calls[1][0];
    expect(first.where.deliveryKey_channelId).toEqual({
      deliveryKey: 'dk-1',
      channelId: 'c1',
    });
    expect(second.where.deliveryKey_channelId).toEqual({
      deliveryKey: 'dk-1',
      channelId: 'c2',
    });
    expect(first.create.status).toBe('SUCCESS');
    expect(first.create.deliveryKey).toBe('dk-1');
    // 还有 attempt 可用 → RETRYING，别去点亮 owner 的 24h 失败告警条
    expect(second.create.status).toBe('RETRYING');
  });

  it('重试时跳过上一次已经推成功的 channel（核心防回归）', async () => {
    twoChannels();
    dbMock.notificationLog.findMany.mockResolvedValue([{ channelId: 'c1' }]);
    const sender: WebhookSender = vi.fn(async () => ({ ok: true, retries: 0 }));

    const outcome = await notify('ORDER_SUBMITTED', submitted, {
      webhookSender: sender,
      mockMode: false,
      deliveryKey: 'dk-1',
    });

    expect(dbMock.notificationLog.findMany).toHaveBeenCalledWith({
      where: { deliveryKey: 'dk-1', status: 'SUCCESS' },
      select: { channelId: true },
    });
    // c1 已送达 → 一次都不再打扰
    expect(sender).toHaveBeenCalledTimes(1);
    expect(sender).toHaveBeenCalledWith('https://qy/2', expect.any(String));
    expect(outcome).toMatchObject({
      attempted: 1,
      delivered: 1,
      skipped: 1,
      failed: 0,
      retryable: false,
    });
    expect(dbMock.notificationLog.upsert).toHaveBeenCalledTimes(1);
  });

  it('永久性失败（key 失效 / channel 关停）不重试，落 FAILED', async () => {
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
    const sender: WebhookSender = vi.fn(async () => ({
      ok: false,
      retries: 0,
      errorMessage: 'wecom errcode=93000',
      retryable: false,
    }));

    const outcome = await notify('ORDER_SUBMITTED', submitted, {
      webhookSender: sender,
      mockMode: false,
      deliveryKey: 'dk-1',
    });

    expect(outcome).toMatchObject({ failed: 2, retryable: false });
    expect(outcome.errorCodes).toEqual([
      'wecom errcode=93000',
      'channel inactive',
    ]);
    const statuses = dbMock.notificationLog.upsert.mock.calls.map(
      (c) => c[0].create.status,
    );
    // 不是 RETRYING —— 重试 5 次结果一样，不能白耗 attempts 变死信
    expect(statuses).toEqual(['FAILED', 'FAILED']);
  });

  it('finalAttempt=true → 可重试失败也落 FAILED，但 outcome 仍标 retryable', async () => {
    twoChannels();
    const sender: WebhookSender = vi.fn(async () => ({
      ok: false,
      retries: 2,
      errorMessage: 'http 500',
      retryable: true,
    }));

    const outcome = await notify('ORDER_SUBMITTED', submitted, {
      webhookSender: sender,
      mockMode: false,
      deliveryKey: 'dk-1',
      finalAttempt: true,
    });

    // 最后一次之后没人会再重试了，必须让 24h 告警条看得到终局失败
    const statuses = dbMock.notificationLog.upsert.mock.calls.map(
      (c) => c[0].create.status,
    );
    expect(statuses).toEqual(['FAILED', 'FAILED']);
    // 但 handler 仍要抛，交给 failBackgroundJob 判 DEAD
    expect(outcome.retryable).toBe(true);
  });

  it('mock 模式即使带 deliveryKey 也永远不触发重试', async () => {
    twoChannels();
    const outcome = await notify('ORDER_SUBMITTED', submitted, {
      mockMode: true,
      deliveryKey: 'dk-1',
    });
    expect(outcome).toMatchObject({ delivered: 2, failed: 0, retryable: false });
    const created = dbMock.notificationLog.upsert.mock.calls[0][0].create;
    expect(created.status).toBe('SUCCESS');
    expect(created.errorMessage).toBe('MOCK');
  });

  it('送达但 upsert 写失败 → 不抛，unlogged 计数（at-least-once 的已知边界）', async () => {
    const errSpy = vi
      .spyOn(console, 'error')
      .mockImplementation(() => undefined);
    twoChannels();
    dbMock.notificationLog.upsert.mockRejectedValue(new Error('deadlock'));
    const sender: WebhookSender = vi.fn(async () => ({ ok: true, retries: 0 }));

    const outcome = await notify('ORDER_SUBMITTED', submitted, {
      webhookSender: sender,
      mockMode: false,
      deliveryKey: 'dk-1',
    });

    // 幂等凭证没写下 → 下一轮会重复推，但至少被显式计数，ops 能对上号
    expect(outcome).toMatchObject({ delivered: 2, unlogged: 2, retryable: false });
    expect(errSpy).toHaveBeenCalled();
    errSpy.mockRestore();
  });

  it('查已送达 channel 的那条 findMany 炸掉 → 标 retryable，不盲发', async () => {
    const errSpy = vi
      .spyOn(console, 'error')
      .mockImplementation(() => undefined);
    twoChannels();
    dbMock.notificationLog.findMany.mockRejectedValue(new Error('conn lost'));
    const sender: WebhookSender = vi.fn(async () => ({ ok: true, retries: 0 }));

    const outcome = await notify('ORDER_SUBMITTED', submitted, {
      webhookSender: sender,
      mockMode: false,
      deliveryKey: 'dk-1',
    });

    // 不知道谁已经收到过就绝不发：一条都不发，交给下一轮
    expect(sender).not.toHaveBeenCalled();
    expect(outcome.retryable).toBe(true);
    errSpy.mockRestore();
  });

  it('不传 deliveryKey → 零行为变化：走 create、不查 findMany、可重试失败也写 FAILED', async () => {
    twoChannels();
    const sender: WebhookSender = vi.fn(async () => ({
      ok: false,
      retries: 2,
      errorMessage: 'http 500',
      retryable: true,
    }));

    const outcome = await notify('ORDER_SUBMITTED', submitted, {
      webhookSender: sender,
      mockMode: false,
    });

    expect(dbMock.notificationLog.findMany).not.toHaveBeenCalled();
    expect(dbMock.notificationLog.upsert).not.toHaveBeenCalled();
    expect(dbMock.notificationLog.create).toHaveBeenCalledTimes(2);
    const statuses = dbMock.notificationLog.create.mock.calls.map(
      (c) => c[0].data.status,
    );
    // 同步路径没人会重试它 → RETRYING 会永远挂着，只能写 FAILED
    expect(statuses).toEqual(['FAILED', 'FAILED']);
    // outcome 仍标 retryable，但同步调用点根本不看返回值
    expect(outcome.retryable).toBe(true);
  });
});
