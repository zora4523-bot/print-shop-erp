import { describe, it, expect, vi, beforeEach } from 'vitest';

const { dbMock, txMock } = vi.hoisted(() => {
  const tx = {
    notificationRule: {
      findMany: vi.fn(),
      findUnique: vi.fn(),
      update: vi.fn(),
    },
    notificationChannel: {
      findMany: vi.fn(),
      delete: vi.fn(),
    },
  };
  const mock = {
    notificationChannel: {
      findMany: vi.fn(),
      findUnique: vi.fn(),
      create: vi.fn(),
      update: vi.fn(),
    },
    notificationRule: { findMany: vi.fn() },
    notificationLog: { count: vi.fn(), findMany: vi.fn() },
    $transaction: vi.fn(async (fn: (t: typeof tx) => Promise<unknown>) =>
      fn(tx),
    ),
  };
  return { dbMock: mock, txMock: tx };
});
vi.mock('@/lib/db', () => ({ db: dbMock }));

import {
  ChannelInUseError,
  EmptyChannelIdsError,
  RuleNotFoundError,
  StaleChannelIdsError,
  countRecentFailures,
  deleteChannel,
  listChannelsWithRefCount,
  updateRule,
  updateRuleWithGuard,
} from '../admin';

beforeEach(() => {
  dbMock.notificationChannel.findMany.mockReset();
  dbMock.notificationChannel.findUnique.mockReset();
  dbMock.notificationChannel.create.mockReset();
  dbMock.notificationChannel.update.mockReset();
  dbMock.notificationRule.findMany.mockReset();
  dbMock.notificationLog.count.mockReset();
  dbMock.notificationLog.findMany.mockReset();
  dbMock.$transaction.mockClear();
  txMock.notificationRule.findMany.mockReset();
  txMock.notificationRule.findUnique.mockReset();
  txMock.notificationRule.update.mockReset();
  txMock.notificationChannel.findMany.mockReset();
  txMock.notificationChannel.delete.mockReset();
});

describe('listChannelsWithRefCount', () => {
  it('计算每个 channel 被多少 active rule 引用', async () => {
    dbMock.notificationChannel.findMany.mockResolvedValue([
      {
        id: 'c1',
        channelKey: 'sched',
        channelName: '排产群',
        webhookUrl: 'https://qy/1',
        isActive: true,
        createdAt: new Date(),
        updatedAt: new Date(),
      },
      {
        id: 'c2',
        channelKey: 'owner',
        channelName: '老板群',
        webhookUrl: 'https://qy/2',
        isActive: true,
        createdAt: new Date(),
        updatedAt: new Date(),
      },
    ]);
    dbMock.notificationRule.findMany.mockResolvedValue([
      { channelIds: ['c1', 'c2'] },
      { channelIds: ['c1'] },
    ]);
    const r = await listChannelsWithRefCount();
    expect(r[0]!.id).toBe('c1');
    expect(r[0]!.referencingActiveRuleCount).toBe(2);
    expect(r[1]!.id).toBe('c2');
    expect(r[1]!.referencingActiveRuleCount).toBe(1);
  });

  it('inactive rule 不算引用（findMany where isActive=true）', async () => {
    dbMock.notificationChannel.findMany.mockResolvedValue([
      {
        id: 'c1',
        channelKey: 'k',
        channelName: 'n',
        webhookUrl: 'u',
        isActive: true,
        createdAt: new Date(),
        updatedAt: new Date(),
      },
    ]);
    dbMock.notificationRule.findMany.mockResolvedValue([]);
    const r = await listChannelsWithRefCount();
    expect(r[0]!.referencingActiveRuleCount).toBe(0);
    const where = dbMock.notificationRule.findMany.mock.calls[0][0].where;
    expect(where.isActive).toBe(true);
  });
});

describe('deleteChannel', () => {
  it('被 active rule 引用 → 抛 ChannelInUseError，不调 delete', async () => {
    txMock.notificationRule.findMany.mockResolvedValue([
      { eventType: 'ORDER_SUBMITTED' },
      { eventType: 'URGENT_ORDER' },
    ]);
    await expect(deleteChannel('c1')).rejects.toBeInstanceOf(
      ChannelInUseError,
    );
    expect(txMock.notificationChannel.delete).not.toHaveBeenCalled();
  });

  it('未被引用 → delete 调用', async () => {
    txMock.notificationRule.findMany.mockResolvedValue([]);
    await deleteChannel('c1');
    expect(txMock.notificationChannel.delete).toHaveBeenCalledWith({
      where: { id: 'c1' },
    });
  });

  it('查询是&ldquo;active rule + has channelId&rdquo;的复合条件', async () => {
    txMock.notificationRule.findMany.mockResolvedValue([]);
    await deleteChannel('c1');
    const where = txMock.notificationRule.findMany.mock.calls[0][0].where;
    expect(where.isActive).toBe(true);
    expect(where.channelIds).toEqual({ has: 'c1' });
  });
});

describe('updateRule', () => {
  beforeEach(() => {
    txMock.notificationRule.findUnique.mockResolvedValue({
      eventType: 'ORDER_SUBMITTED',
    });
    txMock.notificationChannel.findMany.mockResolvedValue([]);
  });

  it('未知事件 → RuleNotFoundError（NOTIFICATION_EVENTS 字典外）', async () => {
    await expect(
      updateRule('NOT_A_REAL_EVENT', {
        messageTemplate: 'x',
        channelIds: [],
        isActive: false,
      }),
    ).rejects.toBeInstanceOf(RuleNotFoundError);
  });

  it('rule 不存在（事件合法但 DB 没 row）→ RuleNotFoundError', async () => {
    txMock.notificationRule.findUnique.mockResolvedValue(null);
    await expect(
      updateRule('ORDER_SUBMITTED', {
        messageTemplate: 'x',
        channelIds: [],
        isActive: false,
      }),
    ).rejects.toBeInstanceOf(RuleNotFoundError);
  });

  it('channelIds 引用不存在 channel → StaleChannelIdsError', async () => {
    txMock.notificationChannel.findMany.mockResolvedValue([{ id: 'c1' }]);
    await expect(
      updateRule('ORDER_SUBMITTED', {
        messageTemplate: 'x',
        channelIds: ['c1', 'stale-2'],
        isActive: true,
      }),
    ).rejects.toBeInstanceOf(StaleChannelIdsError);
  });

  it('channelIds 全部命中 → update 调用', async () => {
    txMock.notificationChannel.findMany.mockResolvedValue([
      { id: 'c1' },
      { id: 'c2' },
    ]);
    await updateRule('ORDER_SUBMITTED', {
      messageTemplate: '工单 {orderNo}',
      channelIds: ['c1', 'c2'],
      isActive: true,
    });
    expect(txMock.notificationRule.update).toHaveBeenCalledWith({
      where: { eventType: 'ORDER_SUBMITTED' },
      data: {
        messageTemplate: '工单 {orderNo}',
        channelIds: ['c1', 'c2'],
        isActive: true,
      },
    });
  });

  it('channelIds 空 + isActive false → 不查 channels（短路）', async () => {
    await updateRule('ORDER_SUBMITTED', {
      messageTemplate: 'x',
      channelIds: [],
      isActive: false,
    });
    expect(txMock.notificationChannel.findMany).not.toHaveBeenCalled();
    expect(txMock.notificationRule.update).toHaveBeenCalled();
  });
});

describe('updateRuleWithGuard', () => {
  beforeEach(() => {
    txMock.notificationRule.findUnique.mockResolvedValue({
      eventType: 'ORDER_SUBMITTED',
    });
  });

  it('isActive=true && channelIds=[] → EmptyChannelIdsError（不进 updateRule）', async () => {
    await expect(
      updateRuleWithGuard('ORDER_SUBMITTED', {
        messageTemplate: 'x',
        channelIds: [],
        isActive: true,
      }),
    ).rejects.toBeInstanceOf(EmptyChannelIdsError);
    expect(txMock.notificationRule.update).not.toHaveBeenCalled();
  });

  it('isActive=false && channelIds=[] → 允许（暂存草稿）', async () => {
    await updateRuleWithGuard('ORDER_SUBMITTED', {
      messageTemplate: 'x',
      channelIds: [],
      isActive: false,
    });
    expect(txMock.notificationRule.update).toHaveBeenCalled();
  });

  it('isActive=true && channelIds 非空 → 走 updateRule 正常路径', async () => {
    txMock.notificationChannel.findMany.mockResolvedValue([{ id: 'c1' }]);
    await updateRuleWithGuard('ORDER_SUBMITTED', {
      messageTemplate: 'x',
      channelIds: ['c1'],
      isActive: true,
    });
    expect(txMock.notificationRule.update).toHaveBeenCalled();
  });
});

describe('countRecentFailures', () => {
  it('查近 24 小时 status=FAILED 的计数', async () => {
    dbMock.notificationLog.count.mockResolvedValue(3);
    const before = Date.now();
    const r = await countRecentFailures(24);
    expect(r).toBe(3);
    const where = dbMock.notificationLog.count.mock.calls[0][0].where;
    expect(where.status).toBe('FAILED');
    const since = where.createdAt.gte as Date;
    const diff = before - since.getTime();
    // 24h ± 1s tolerance
    expect(diff).toBeGreaterThanOrEqual(24 * 60 * 60 * 1000 - 1000);
    expect(diff).toBeLessThanOrEqual(24 * 60 * 60 * 1000 + 1000);
  });

  it('窗口可配（默认 24，1 小时也支持）', async () => {
    dbMock.notificationLog.count.mockResolvedValue(0);
    await countRecentFailures(1);
    const since = dbMock.notificationLog.count.mock.calls[0][0].where.createdAt
      .gte as Date;
    const diff = Date.now() - since.getTime();
    expect(diff).toBeLessThanOrEqual(60 * 60 * 1000 + 1000);
  });
});
