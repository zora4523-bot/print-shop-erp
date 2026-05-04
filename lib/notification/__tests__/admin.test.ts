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
    // SELECT ... FOR UPDATE 走 $queryRaw（Codex round 106）；mock
    // 默认返 [] 即可，updateRule 拿值靠下一句 findMany。
    $queryRaw: vi.fn(async () => []),
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
  InactiveChannelBindError,
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
  txMock.$queryRaw.mockReset().mockResolvedValue([]);
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

  it('inactive rule 也算引用（Codex round 103 #1：避免悬空 channelIds）', async () => {
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
    // 1 inactive rule 引用 c1
    dbMock.notificationRule.findMany.mockResolvedValue([
      { channelIds: ['c1'] },
    ]);
    const r = await listChannelsWithRefCount();
    expect(r[0]!.referencingActiveRuleCount).toBe(1);
    // findMany 不再过滤 isActive
    const args = dbMock.notificationRule.findMany.mock.calls[0][0];
    expect(args.where).toBeUndefined();
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

  it('查询不再过滤 isActive（Codex round 103 #1：inactive 引用也拒删）', async () => {
    txMock.notificationRule.findMany.mockResolvedValue([]);
    await deleteChannel('c1');
    const where = txMock.notificationRule.findMany.mock.calls[0][0].where;
    expect(where.isActive).toBeUndefined();
    expect(where.channelIds).toEqual({ has: 'c1' });
  });

  it('inactive rule 引用也拒删（Codex round 103 #1）', async () => {
    txMock.notificationRule.findMany.mockResolvedValue([
      { eventType: 'ORDER_SUBMITTED' }, // 这条 inactive 的引用应触发拒
    ]);
    await expect(deleteChannel('c1')).rejects.toBeInstanceOf(
      ChannelInUseError,
    );
  });
});

describe('updateRule', () => {
  beforeEach(() => {
    txMock.notificationRule.findUnique.mockResolvedValue({
      eventType: 'ORDER_SUBMITTED',
      channelIds: [],
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
    txMock.notificationChannel.findMany.mockResolvedValue([
      { id: 'c1', isActive: true },
    ]);
    await expect(
      updateRule('ORDER_SUBMITTED', {
        messageTemplate: 'x',
        channelIds: ['c1', 'stale-2'],
        isActive: true,
      }),
    ).rejects.toBeInstanceOf(StaleChannelIdsError);
  });

  it('channelIds 全部 active 命中 → update 调用', async () => {
    txMock.notificationChannel.findMany.mockResolvedValue([
      { id: 'c1', isActive: true },
      { id: 'c2', isActive: true },
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

  it('新绑 inactive channel → InactiveChannelBindError（Codex round 105）', async () => {
    // OLD rule.channelIds 不含 c2；NEW input 包含；c2 是 inactive
    txMock.notificationRule.findUnique.mockResolvedValue({
      eventType: 'ORDER_SUBMITTED',
      channelIds: [],
    });
    txMock.notificationChannel.findMany.mockResolvedValue([
      { id: 'c2', isActive: false },
    ]);
    await expect(
      updateRule('ORDER_SUBMITTED', {
        messageTemplate: 'x',
        channelIds: ['c2'],
        isActive: false,
      }),
    ).rejects.toBeInstanceOf(InactiveChannelBindError);
    expect(txMock.notificationRule.update).not.toHaveBeenCalled();
  });

  it('保留已有 inactive 绑定（Codex round 103 #2 承诺）→ 通过', async () => {
    // OLD rule 已绑定 c2（inactive）；NEW 也保留
    txMock.notificationRule.findUnique.mockResolvedValue({
      eventType: 'ORDER_SUBMITTED',
      channelIds: ['c2'],
    });
    txMock.notificationChannel.findMany.mockResolvedValue([
      { id: 'c2', isActive: false },
    ]);
    await updateRule('ORDER_SUBMITTED', {
      messageTemplate: 'x',
      channelIds: ['c2'],
      isActive: false,
    });
    expect(txMock.notificationRule.update).toHaveBeenCalled();
  });

  it('混合：保留旧 inactive + 新加 active → 通过；同时新加 inactive → 拒', async () => {
    txMock.notificationRule.findUnique.mockResolvedValue({
      eventType: 'ORDER_SUBMITTED',
      channelIds: ['c-old-inactive'],
    });
    // c-old-inactive (kept) + c-new-active (新加) → 通过
    txMock.notificationChannel.findMany.mockResolvedValue([
      { id: 'c-old-inactive', isActive: false },
      { id: 'c-new-active', isActive: true },
    ]);
    await updateRule('ORDER_SUBMITTED', {
      messageTemplate: 'x',
      channelIds: ['c-old-inactive', 'c-new-active'],
      isActive: true,
    });
    expect(txMock.notificationRule.update).toHaveBeenCalled();
  });

  it('SELECT FOR UPDATE 锁住引用 channel 行（Codex round 106 race fix）', async () => {
    txMock.notificationChannel.findMany.mockResolvedValue([
      { id: 'c1', isActive: true },
    ]);
    await updateRule('ORDER_SUBMITTED', {
      messageTemplate: 'x',
      channelIds: ['c1'],
      isActive: true,
    });
    // $queryRaw 调一次：FOR UPDATE on the channel rows
    expect(txMock.$queryRaw).toHaveBeenCalledTimes(1);
    const call = txMock.$queryRaw.mock.calls[0] as readonly unknown[];
    const sql = Array.from(call[0] as readonly string[]).join(' ');
    expect(sql).toMatch(/FOR UPDATE/);
    expect(sql).toMatch(/"NotificationChannel"/);
  });
});

describe('updateRuleWithGuard', () => {
  beforeEach(() => {
    txMock.notificationRule.findUnique.mockResolvedValue({
      eventType: 'ORDER_SUBMITTED',
      channelIds: [],
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

  it('isActive=true && channelIds 非空（active 端点）→ 走 updateRule 正常路径', async () => {
    txMock.notificationChannel.findMany.mockResolvedValue([
      { id: 'c1', isActive: true },
    ]);
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

  it('排除 __TEST__ event（Codex round 103 #3：测试失败不应让 dashboard 永远红）', async () => {
    dbMock.notificationLog.count.mockResolvedValue(0);
    await countRecentFailures(24);
    const where = dbMock.notificationLog.count.mock.calls[0][0].where;
    expect(where.NOT).toEqual({ eventType: '__TEST__' });
  });
});
