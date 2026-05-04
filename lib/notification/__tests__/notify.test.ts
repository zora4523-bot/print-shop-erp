import { describe, it, expect, vi, beforeEach } from 'vitest';

const { dbMock } = vi.hoisted(() => {
  const mock = {
    notificationRule: { findUnique: vi.fn() },
    notificationChannel: { findMany: vi.fn() },
    notificationLog: { create: vi.fn() },
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
    ).resolves.toBeUndefined();

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
    ).resolves.toBeUndefined();
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
    ).resolves.toBeUndefined();
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
