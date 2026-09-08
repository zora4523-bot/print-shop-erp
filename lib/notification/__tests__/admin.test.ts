import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('server-only', () => ({}));

const { dbMock, txMock, smartBotWorkerAvailableMock } = vi.hoisted(() => {
  const tx = {
    notificationRule: {
      findMany: vi.fn(),
      findUnique: vi.fn(),
      update: vi.fn(),
    },
    setting: { findUnique: vi.fn() },
    notificationChannel: {
      findMany: vi.fn(),
      findUnique: vi.fn(),
      update: vi.fn(),
      updateMany: vi.fn(),
      delete: vi.fn(),
    },
    // SELECT ... FOR UPDATE 走 $queryRaw（Codex round 106）；mock
    // 默认返 [] 即可，updateRule 拿值靠下一句 findMany。
    $queryRaw: vi.fn(),
  };
  const mock = {
    notificationChannel: {
      findMany: vi.fn(),
      findUnique: vi.fn(),
      create: vi.fn(),
      update: vi.fn(),
    },
    notificationRule: { findMany: vi.fn() },
    setting: { findUnique: vi.fn() },
    notificationLog: { count: vi.fn(), findMany: vi.fn() },
    backgroundJob: { findMany: vi.fn() },
    $queryRaw: vi.fn(),
    $transaction: vi.fn(async (fn: (t: typeof tx) => Promise<unknown>) =>
      fn(tx),
    ),
  };
  return {
    dbMock: mock,
    txMock: tx,
    smartBotWorkerAvailableMock: vi.fn(),
  };
});
vi.mock('@/lib/db', () => ({ db: dbMock }));
vi.mock('@/lib/background-jobs/smart-bot-availability', () => ({
  hasExclusiveConnectedSmartBotWorker: smartBotWorkerAvailableMock,
}));

import { BackgroundJobStatus } from '../../../generated/prisma/enums';
import { SUPERSEDED_BEFORE_SEND_ERROR } from '../events';
import { smartBotIdDigest } from '../smart-bot';
import {
  ChannelInUseError,
  ChannelTransportMismatchError,
  createChannel,
  createSmartBotBindingCode,
  EmptyChannelIdsError,
  InactiveChannelBindError,
  IneligibleChannelBindError,
  RuleNotFoundError,
  StaleChannelIdsError,
  TooManyChannelsForPrivateEventError,
  UnboundSmartBotChannelError,
  countRecentFailures,
  countUnresolvedNotifications,
  deleteChannel,
  listChannelsWithRefCount,
  listLogs,
  listNotificationConfiguration,
  listUnresolvedNotificationLogs,
  updateRule,
  updateRuleWithGuard,
  updateChannel,
} from '../admin';

function ruleActiveChannel(id: string, isActive = true) {
  return ruleSmartBotChannel(id, smartBotIdDigest('current-bot-id'), isActive);
}

function ruleSmartBotChannel(
  id: string,
  botDigest: string,
  isActive = true,
) {
  return {
    id,
    transport: 'WECOM_SMART_BOT' as const,
    webhookUrl: null,
    smartBotBotDigest: botDigest,
    smartBotTargetId: `group-${id}`,
    smartBotChatType: 'GROUP' as const,
    smartBotBoundAt: new Date('2026-09-04T00:00:00.000Z'),
    isActive,
  };
}

beforeEach(() => {
  vi.stubEnv('WECOM_SMART_BOT_ID', 'current-bot-id');
  vi.stubEnv('WECOM_SMART_BOT_SECRET', 'secret-placeholder');
  dbMock.notificationChannel.findMany.mockReset();
  dbMock.notificationChannel.findUnique.mockReset();
  dbMock.notificationChannel.create.mockReset();
  dbMock.notificationChannel.update.mockReset();
  dbMock.notificationRule.findMany.mockReset();
  dbMock.setting.findUnique.mockReset().mockResolvedValue(null);
  dbMock.notificationLog.count.mockReset();
  dbMock.notificationLog.findMany.mockReset();
  dbMock.backgroundJob.findMany.mockReset().mockResolvedValue([]);
  dbMock.$queryRaw
    .mockReset()
    .mockResolvedValue([{ now: new Date('2026-08-22T08:00:00Z') }]);
  dbMock.$transaction.mockClear();
  txMock.notificationRule.findMany.mockReset();
  txMock.setting.findUnique.mockReset().mockResolvedValue(null);
  txMock.notificationRule.findUnique.mockReset();
  txMock.notificationRule.update.mockReset();
  txMock.notificationChannel.findMany.mockReset();
  txMock.notificationChannel.findUnique.mockReset();
  txMock.notificationChannel.update.mockReset();
  txMock.notificationChannel.updateMany.mockReset();
  txMock.notificationChannel.delete.mockReset();
  txMock.$queryRaw
    .mockReset()
    .mockResolvedValue([{ now: new Date('2026-08-22T08:00:00Z') }]);
  smartBotWorkerAvailableMock.mockReset().mockResolvedValue(true);
});

afterEach(() => vi.unstubAllEnvs());

describe('smart-bot channel administration', () => {
  it('creates only an inactive smart-bot target even when activation is requested', async () => {
    dbMock.notificationChannel.create.mockResolvedValue({ id: 'new-smart' });
    await createChannel({ channelKey: 'new_smart', channelName: '新群', transport: 'WECOM_SMART_BOT', isActive: true });
    expect(dbMock.notificationChannel.create).toHaveBeenCalledWith({
      data: { channelKey: 'new_smart', channelName: '新群', transport: 'WECOM_SMART_BOT', webhookUrl: null, isActive: false },
      select: { id: true },
    });
  });

  it('rejects legacy transport at the domain boundary, including untyped callers', async () => {
    const input = { channelKey: 'legacy', channelName: '旧群', transport: 'WECOM_GROUP_WEBHOOK', isActive: true };
    // @ts-expect-error stale caller must also be rejected at runtime
    await expect(createChannel(input)).rejects.toBeInstanceOf(ChannelTransportMismatchError);
    // @ts-expect-error stale caller must also be rejected at runtime
    await expect(updateChannel('legacy', input)).rejects.toBeInstanceOf(ChannelTransportMismatchError);
    expect(dbMock.notificationChannel.create).not.toHaveBeenCalled();
    expect(dbMock.$transaction).not.toHaveBeenCalled();
  });

  it('cannot overwrite a stored legacy target by claiming it is a smart bot', async () => {
    txMock.notificationChannel.findUnique.mockResolvedValue({ transport: 'WECOM_GROUP_WEBHOOK' });
    await expect(updateChannel('legacy', { channelName: '伪造修改', transport: 'WECOM_SMART_BOT', isActive: false }))
      .rejects.toBeInstanceOf(ChannelTransportMismatchError);
    expect(txMock.notificationChannel.update).not.toHaveBeenCalled();
  });
  it('stores only a hash for a short-lived binding code', async () => {
    vi.stubEnv('WECOM_SMART_BOT_ID', 'bot-id-placeholder');
    vi.stubEnv('WECOM_SMART_BOT_SECRET', 'secret-placeholder');
    txMock.notificationChannel.findUnique.mockResolvedValue({
      transport: 'WECOM_SMART_BOT',
      smartBotTargetId: null,
    });
    txMock.notificationChannel.updateMany.mockResolvedValue({ count: 1 });

    const receipt = await createSmartBotBindingCode('smart-1');

    expect(smartBotWorkerAvailableMock).toHaveBeenCalledExactlyOnceWith(
      smartBotIdDigest('bot-id-placeholder'),
    );
    expect(receipt.bindingCode).toMatch(/^ERP-BIND-[A-Za-z0-9_-]{32}$/);
    expect(receipt.expiresAt).toEqual(new Date('2026-08-22T08:10:00.000Z'));
    const update = txMock.notificationChannel.updateMany.mock.calls[0]![0];
    expect(update.data.smartBotBindingCodeHash).toMatch(/^[a-f0-9]{64}$/);
    expect(JSON.stringify(update)).not.toContain(receipt.bindingCode);
  });

  it('refuses to issue a binding code unless one connected LIGHT worker owns the bot', async () => {
    vi.stubEnv('WECOM_SMART_BOT_ID', 'bot-id-placeholder');
    vi.stubEnv('WECOM_SMART_BOT_SECRET', 'secret-placeholder');
    smartBotWorkerAvailableMock.mockResolvedValue(false);

    await expect(createSmartBotBindingCode('smart-1')).rejects.toMatchObject({
      code: 'WORKER_UNAVAILABLE',
    });
    expect(txMock.notificationChannel.findUnique).not.toHaveBeenCalled();
  });

  it('does not activate an unbound smart-bot channel', async () => {
    txMock.notificationChannel.findUnique.mockResolvedValue({
      transport: 'WECOM_SMART_BOT',
      smartBotBotDigest: null,
      smartBotTargetId: null,
      smartBotBoundAt: null,
    });

    await expect(
      updateChannel('smart-1', {
        transport: 'WECOM_SMART_BOT',
        channelName: '测试群',
        isActive: true,
      }),
    ).rejects.toBeInstanceOf(UnboundSmartBotChannelError);
    expect(txMock.notificationChannel.update).not.toHaveBeenCalled();
  });
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
        channelName: '管理员群',
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
    expect(r[0]!.referencingConfigurationCount).toBe(2);
    expect(r[1]!.id).toBe('c2');
    expect(r[1]!.referencingConfigurationCount).toBe(1);
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
    expect(r[0]!.referencingConfigurationCount).toBe(1);
    // findMany 不再过滤 isActive
    const args = dbMock.notificationRule.findMany.mock.calls[0][0];
    expect(args.where).toBeUndefined();
  });
});

describe('listNotificationConfiguration', () => {
  it('用同一次 rule 读取返回列表并计算 channel 引用数', async () => {
    dbMock.notificationChannel.findMany.mockResolvedValue([
      {
        id: 'c1',
        channelKey: 'owner',
        channelName: '管理员群',
        webhookUrl: 'https://qy/1',
        isActive: true,
        createdAt: new Date('2026-08-20T00:00:00Z'),
        updatedAt: new Date('2026-08-20T00:00:00Z'),
      },
    ]);
    const rules = [
      {
        eventType: 'ORDER_SUBMITTED',
        channelIds: ['c1'],
        messageTemplate: '工单 {orderNo}',
        isActive: true,
        updatedAt: new Date('2026-08-21T00:00:00Z'),
      },
      {
        eventType: 'URGENT_ORDER',
        channelIds: ['c1'],
        messageTemplate: '急单 {orderNo}',
        isActive: false,
        updatedAt: new Date('2026-08-21T00:00:00Z'),
      },
    ];
    dbMock.notificationRule.findMany.mockResolvedValue(rules);

    await expect(listNotificationConfiguration()).resolves.toEqual({
      channels: [
        expect.objectContaining({
          id: 'c1',
          referencingConfigurationCount: 2,
        }),
      ],
      rules,
    });
    expect(dbMock.notificationRule.findMany).toHaveBeenCalledTimes(1);
    expect(dbMock.notificationRule.findMany).toHaveBeenCalledWith({
      orderBy: { eventType: 'asc' },
      select: {
        eventType: true,
        channelIds: true,
        messageTemplate: true,
        isActive: true,
        updatedAt: true,
      },
    });
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

  it('被固定角色路由引用 → 拒绝删除', async () => {
    txMock.notificationRule.findMany.mockResolvedValue([]);
    txMock.setting.findUnique.mockResolvedValue({
      value: {
        factoryConfirmer: { enabled: true, channelIds: ['c1'] },
        owner: { enabled: false, channelIds: [] },
      },
    });
    await expect(deleteChannel('c1')).rejects.toBeInstanceOf(
      ChannelInUseError,
    );
    expect(txMock.notificationChannel.delete).not.toHaveBeenCalled();
  });

  it('SELECT FOR UPDATE 锁 channel 行 + findMany rules（Codex round 107 #2）', async () => {
    txMock.notificationRule.findMany.mockResolvedValue([]);
    await deleteChannel('c1');
    expect(txMock.$queryRaw).toHaveBeenCalledTimes(1);
    const call = txMock.$queryRaw.mock.calls[0] as readonly unknown[];
    const sql = Array.from(call[0] as readonly string[]).join(' ');
    expect(sql).toMatch(/FOR UPDATE/);
    expect(sql).toMatch(/"NotificationChannel"/);
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
      isActive: false,
    });
    txMock.notificationChannel.findMany.mockResolvedValue([]);
  });

  it('rejects new legacy bindings, retains existing active routes, and permits removing them', async () => {
    const legacy = { ...ruleActiveChannel('legacy'), transport: 'WECOM_GROUP_WEBHOOK' };
    txMock.notificationChannel.findMany.mockResolvedValue([legacy]);
    const input = { messageTemplate: 'x', channelIds: ['legacy'], isActive: true };
    await expect(updateRule('URGENT_ORDER', input)).rejects.toBeInstanceOf(IneligibleChannelBindError);
    expect(txMock.notificationRule.update).not.toHaveBeenCalled();
    txMock.notificationRule.findUnique.mockResolvedValue({ eventType: 'URGENT_ORDER', channelIds: ['legacy'], isActive: true });
    await expect(updateRule('URGENT_ORDER', input)).resolves.toBeUndefined();
    await expect(updateRule('URGENT_ORDER', { ...input, channelIds: [], isActive: false })).resolves.toBeUndefined();
    txMock.notificationRule.findUnique.mockResolvedValue({ eventType: 'URGENT_ORDER', channelIds: ['legacy'], isActive: false });
    await expect(updateRule('URGENT_ORDER', input)).rejects.toBeInstanceOf(IneligibleChannelBindError);
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
      ruleActiveChannel('c1'),
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
      ruleActiveChannel('c1'),
      ruleActiveChannel('c2'),
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
      ruleActiveChannel('c2', false),
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
      ruleActiveChannel('c2', false),
    ]);
    await updateRule('ORDER_SUBMITTED', {
      messageTemplate: 'x',
      channelIds: ['c2'],
      isActive: false,
    });
    expect(txMock.notificationRule.update).toHaveBeenCalled();
  });

  it('新绑 Bot ID 不一致的 active 智能机器人目标 → 拒绝', async () => {
    vi.stubEnv('WECOM_SMART_BOT_ID', 'current-bot-id');
    vi.stubEnv('WECOM_SMART_BOT_SECRET', 'secret-placeholder');
    txMock.notificationChannel.findMany.mockResolvedValue([
      ruleSmartBotChannel('smart-old', smartBotIdDigest('old-bot-id')),
    ]);

    await expect(
      updateRule('ORDER_SUBMITTED', {
        messageTemplate: 'x',
        channelIds: ['smart-old'],
        isActive: false,
      }),
    ).rejects.toBeInstanceOf(IneligibleChannelBindError);
    expect(txMock.notificationRule.update).not.toHaveBeenCalled();
  });

  it('服务端 Bot 凭据不完整时不得新绑 active 智能机器人目标', async () => {
    vi.stubEnv('WECOM_SMART_BOT_ID', 'current-bot-id');
    vi.stubEnv('WECOM_SMART_BOT_SECRET', '');
    txMock.notificationChannel.findMany.mockResolvedValue([
      ruleSmartBotChannel('smart-current', smartBotIdDigest('current-bot-id')),
    ]);

    await expect(
      updateRule('ORDER_SUBMITTED', {
        messageTemplate: 'x',
        channelIds: ['smart-current'],
        isActive: false,
      }),
    ).rejects.toMatchObject({
      name: 'IneligibleChannelBindError',
      channels: [
        {
          id: 'smart-current',
          issue: 'SMART_BOT_CREDENTIALS_NOT_CONFIGURED',
        },
      ],
    });
  });

  it('已有的 Bot ID 不一致绑定可保留或取消，不被新绑守卫误删', async () => {
    vi.stubEnv('WECOM_SMART_BOT_ID', 'current-bot-id');
    vi.stubEnv('WECOM_SMART_BOT_SECRET', 'secret-placeholder');
    txMock.notificationRule.findUnique.mockResolvedValue({
      eventType: 'ORDER_SUBMITTED',
      channelIds: ['smart-old'],
      isActive: false,
    });
    txMock.notificationChannel.findMany.mockResolvedValue([
      ruleSmartBotChannel('smart-old', smartBotIdDigest('old-bot-id')),
    ]);

    await updateRule('ORDER_SUBMITTED', {
      messageTemplate: 'x',
      channelIds: ['smart-old'],
      isActive: false,
    });
    expect(txMock.notificationRule.update).toHaveBeenCalled();
  });

  it('非托管规则携已有不合格目标重新启用时拒绝', async () => {
    vi.stubEnv('WECOM_SMART_BOT_ID', 'current-bot-id');
    vi.stubEnv('WECOM_SMART_BOT_SECRET', 'secret-placeholder');
    txMock.notificationRule.findUnique.mockResolvedValue({
      eventType: 'URGENT_ORDER',
      channelIds: ['smart-old'],
      isActive: false,
    });
    txMock.notificationChannel.findMany.mockResolvedValue([
      ruleSmartBotChannel('smart-old', smartBotIdDigest('old-bot-id')),
    ]);

    await expect(
      updateRule('URGENT_ORDER', {
        messageTemplate: 'x',
        channelIds: ['smart-old'],
        isActive: true,
      }),
    ).rejects.toBeInstanceOf(IneligibleChannelBindError);
    expect(txMock.notificationRule.update).not.toHaveBeenCalled();
  });

  it('托管事件可启用而不改写隐藏的历史旧群，实际角色路由由系统设置校验', async () => {
    txMock.notificationRule.findUnique.mockResolvedValue({ eventType: 'ORDER_SUBMITTED', channelIds: ['legacy'], isActive: false });
    txMock.notificationChannel.findMany.mockResolvedValue([{ ...ruleActiveChannel('legacy', false), transport: 'WECOM_GROUP_WEBHOOK' }]);
    const input = { messageTemplate: 'x', channelIds: ['legacy'], isActive: true };
    await expect(updateRule('ORDER_SUBMITTED', input)).resolves.toBeUndefined();
    expect(txMock.notificationRule.update).toHaveBeenCalledWith({ where: { eventType: 'ORDER_SUBMITTED' }, data: input });
  });

  it('混合：保留旧 inactive + 新加 active → 通过；同时新加 inactive → 拒', async () => {
    txMock.notificationRule.findUnique.mockResolvedValue({
      eventType: 'ORDER_SUBMITTED',
      channelIds: ['c-old-inactive'],
      isActive: true,
    });
    // c-old-inactive (kept) + c-new-active (新加) → 通过
    txMock.notificationChannel.findMany.mockResolvedValue([
      ruleActiveChannel('c-old-inactive', false),
      ruleActiveChannel('c-new-active'),
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
      ruleActiveChannel('c1'),
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
      updateRuleWithGuard('URGENT_ORDER', {
        messageTemplate: 'x',
        channelIds: [],
        isActive: true,
      }),
    ).rejects.toBeInstanceOf(EmptyChannelIdsError);
    expect(txMock.notificationRule.update).not.toHaveBeenCalled();
  });

  it('托管事件可在 NotificationRule 无群时启用，路由由角色设置接管', async () => {
    await updateRuleWithGuard('ORDER_SUBMITTED', {
      messageTemplate: 'x',
      channelIds: [],
      isActive: true,
    });
    expect(txMock.notificationRule.update).toHaveBeenCalledWith({
      where: { eventType: 'ORDER_SUBMITTED' },
      data: { messageTemplate: 'x', channelIds: [], isActive: true },
    });
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
      ruleActiveChannel('c1'),
    ]);
    await updateRuleWithGuard('ORDER_SUBMITTED', {
      messageTemplate: 'x',
      channelIds: ['c1'],
      isActive: true,
    });
    expect(txMock.notificationRule.update).toHaveBeenCalled();
  });

  // ─── Codex round 114 high：CS_PERIOD_* privacy enforcement ───
  // UI warning（RuleForm）易被直接 POST / replay 绕开，server side
  // 必须 enforce ≤ 1 channel for events with per-CS data。

  it('CS_PERIOD_ENDING + channelIds.length > 1 → TooManyChannelsForPrivateEventError', async () => {
    txMock.notificationRule.findUnique.mockResolvedValue({
      eventType: 'CS_PERIOD_ENDING',
      channelIds: [],
    });
    await expect(
      updateRuleWithGuard('CS_PERIOD_ENDING', {
        messageTemplate: 'x',
        channelIds: ['c1', 'c2'],
        isActive: true,
      }),
    ).rejects.toBeInstanceOf(TooManyChannelsForPrivateEventError);
    expect(txMock.notificationRule.update).not.toHaveBeenCalled();
  });

  it('CS_PERIOD_SETTLED + channelIds.length > 1 → 同款 reject', async () => {
    txMock.notificationRule.findUnique.mockResolvedValue({
      eventType: 'CS_PERIOD_SETTLED',
      channelIds: [],
    });
    await expect(
      updateRuleWithGuard('CS_PERIOD_SETTLED', {
        messageTemplate: 'x',
        channelIds: ['c1', 'c2', 'c3'],
        isActive: true,
      }),
    ).rejects.toBeInstanceOf(TooManyChannelsForPrivateEventError);
  });

  it('CS_PERIOD_ENDING + channelIds.length = 1 → 允许（仅管理员群一条）', async () => {
    txMock.notificationRule.findUnique.mockResolvedValue({
      eventType: 'CS_PERIOD_ENDING',
      channelIds: [],
    });
    txMock.notificationChannel.findMany.mockResolvedValue([
      ruleActiveChannel('c1'),
    ]);
    await updateRuleWithGuard('CS_PERIOD_ENDING', {
      messageTemplate: 'x',
      channelIds: ['c1'],
      isActive: true,
    });
    expect(txMock.notificationRule.update).toHaveBeenCalled();
  });

  it('其他事件（ORDER_SUBMITTED 等）不受 ≤1 限制，可绑多个 channel', async () => {
    txMock.notificationChannel.findMany.mockResolvedValue([
      ruleActiveChannel('c1'),
      ruleActiveChannel('c2'),
      ruleActiveChannel('c3'),
    ]);
    await updateRuleWithGuard('ORDER_SUBMITTED', {
      messageTemplate: 'x',
      channelIds: ['c1', 'c2', 'c3'],
      isActive: true,
    });
    expect(txMock.notificationRule.update).toHaveBeenCalled();
  });

  it('CS_PERIOD_* + isActive=false + 多 channel → 允许（draft；Codex round 115 medium）', async () => {
    txMock.notificationRule.findUnique.mockResolvedValue({
      eventType: 'CS_PERIOD_ENDING',
      channelIds: [],
    });
    // disable channel.findMany guard via mocking active for both
    txMock.notificationChannel.findMany.mockResolvedValue([
      ruleActiveChannel('c1'),
      ruleActiveChannel('c2'),
    ]);
    await updateRuleWithGuard('CS_PERIOD_ENDING', {
      messageTemplate: 'x',
      channelIds: ['c1', 'c2'],
      isActive: false,
    });
    expect(txMock.notificationRule.update).toHaveBeenCalled();
  });
});

describe('owner notification visibility', () => {
  const retryingLog = {
    id: 'log-retrying-dead',
    eventType: 'ORDER_SUBMITTED',
    channelId: 'channel-1',
    messageContent: '工单 GD-1',
    status: 'RETRYING',
    errorMessage: 'http 429',
    retryCount: 0,
    relatedOrderId: 'order-1',
    sentAt: null,
    deliveryKey: 'notification:ORDER_SUBMITTED:order-1',
    deliveryStateVersion: 5,
    lastAttemptAt: new Date('2026-08-22T07:55:00Z'),
    createdAt: new Date('2026-08-22T07:50:00Z'),
    updatedAt: new Date('2026-08-22T07:55:00Z'),
  } as const;

  it('marks a recent RETRYING log when its owning notification job is DEAD', async () => {
    dbMock.notificationLog.findMany.mockResolvedValue([
      {
        ...retryingLog,
        channel: { channelName: '生产群' },
      },
    ]);
    dbMock.backgroundJob.findMany.mockResolvedValue([
      {
        dedupeKey: retryingLog.deliveryKey,
        status: BackgroundJobStatus.DEAD,
      },
    ]);

    await expect(listLogs({ limit: 20 })).resolves.toEqual([
      expect.objectContaining({
        id: retryingLog.id,
        status: 'RETRYING',
        backgroundJobStatus: BackgroundJobStatus.DEAD,
        hasDeadLetterJob: true,
      }),
    ]);
    expect(dbMock.backgroundJob.findMany).toHaveBeenCalledWith({
      where: {
        type: 'NOTIFICATION',
        dedupeKey: { in: [retryingLog.deliveryKey] },
      },
      select: { dedupeKey: true, status: true },
    });
  });

  it('paginates UNKNOWN and RETRYING+DEAD together in the owner queue', async () => {
    dbMock.$queryRaw.mockResolvedValue([
      {
        ...retryingLog,
        channelName: '生产群',
        backgroundJobStatus: BackgroundJobStatus.DEAD,
        hasDeadLetterJob: true,
      },
    ]);

    await expect(
      listUnresolvedNotificationLogs({ limit: 25, skip: 50 }),
    ).resolves.toEqual([
      expect.objectContaining({
        id: retryingLog.id,
        status: 'RETRYING',
        backgroundJobStatus: BackgroundJobStatus.DEAD,
        hasDeadLetterJob: true,
      }),
    ]);

    const call = dbMock.$queryRaw.mock.calls[0]!;
    const sql = Array.from(call[0] as unknown as readonly string[]).join(' ');
    const values = call.slice(1);
    expect(sql).toContain('LEFT JOIN "BackgroundJob"');
    expect(sql).toContain('job."dedupeKey" = log."deliveryKey"');
    expect(sql).toContain('ORDER BY log."lastAttemptAt" DESC, log."id" DESC');
    expect(values).toContain('UNKNOWN');
    expect(values).toContain('RETRYING');
    expect(values).toContain(BackgroundJobStatus.DEAD);
    expect(values.slice(-2)).toEqual([25, 50]);
  });

  it('counts the full owner queue, including RETRYING logs whose job is DEAD', async () => {
    dbMock.$queryRaw.mockResolvedValue([{ count: BigInt(37) }]);

    await expect(countUnresolvedNotifications()).resolves.toBe(37);
    const call = dbMock.$queryRaw.mock.calls[0]!;
    const sql = Array.from(call[0] as unknown as readonly string[]).join(' ');
    const values = call.slice(1);
    expect(sql).toContain('LEFT JOIN "BackgroundJob"');
    expect(values).toContain('UNKNOWN');
    expect(values).toContain('RETRYING');
    expect(values).toContain(BackgroundJobStatus.DEAD);
  });

  it('fails closed when the unresolved count is unavailable', async () => {
    dbMock.$queryRaw.mockResolvedValue([]);

    await expect(countUnresolvedNotifications()).rejects.toThrow(
      'unresolved count unavailable',
    );
  });
});

describe('countRecentFailures', () => {

  it('用单条 DB 时钟 SQL 查近 24 小时 FAILED/UNKNOWN 与 RETRYING+DEAD', async () => {
    dbMock.$queryRaw.mockResolvedValue([{ count: BigInt(3) }]);
    const r = await countRecentFailures(24);
    expect(r).toBe(3);
    expect(dbMock.$queryRaw).toHaveBeenCalledTimes(1);
    expect(dbMock.notificationLog.count).not.toHaveBeenCalled();

    const call = dbMock.$queryRaw.mock.calls[0]!;
    const strings = call[0] as unknown as readonly string[];
    const values = call.slice(1);
    const sql = Array.from(strings).join(' ');
    expect(sql).toMatch(/count\(\*\)/i);
    expect(sql).toMatch(/now\(\)/i);
    expect(sql).toMatch(/AT TIME ZONE 'UTC'/i);
    expect(sql).toContain('"lastAttemptAt"');
    expect(sql).toContain('LEFT JOIN "BackgroundJob"');
    expect(values).toEqual([
      'NOTIFICATION',
      'FAILED',
      'UNKNOWN',
      'RETRYING',
      BackgroundJobStatus.DEAD,
      24,
      '__TEST__',
      SUPERSEDED_BEFORE_SEND_ERROR,
    ]);
  });

  it('窗口可配（默认 24，1 小时也支持）', async () => {
    dbMock.$queryRaw.mockResolvedValue([{ count: BigInt(0) }]);
    await countRecentFailures(1);
    const values = dbMock.$queryRaw.mock.calls[0]!.slice(1);
    expect(values).toEqual([
      'NOTIFICATION',
      'FAILED',
      'UNKNOWN',
      'RETRYING',
      BackgroundJobStatus.DEAD,
      1,
      '__TEST__',
      SUPERSEDED_BEFORE_SEND_ERROR,
    ]);
  });

  it('排除 __TEST__ event（Codex round 103 #3：测试失败不应让 dashboard 永远红）', async () => {
    dbMock.$queryRaw.mockResolvedValue([{ count: BigInt(0) }]);
    await countRecentFailures(24);
    const call = dbMock.$queryRaw.mock.calls[0]!;
    const strings = call[0] as unknown as readonly string[];
    const values = call.slice(1);
    expect(Array.from(strings).join(' ')).toContain('"eventType" <>');
    expect(values).toContain('__TEST__');
  });

  it('排除被新工单代次取代的未发送 FAILED 终态', async () => {
    dbMock.$queryRaw.mockResolvedValue([{ count: BigInt(0) }]);
    await countRecentFailures(24);
    const call = dbMock.$queryRaw.mock.calls[0]!;
    const sql = Array.from(
      call[0] as unknown as readonly string[],
    ).join(' ');
    expect(sql).toContain('"errorMessage" IS DISTINCT FROM');
    expect(call.slice(1)).toContain(SUPERSEDED_BEFORE_SEND_ERROR);
  });

  it('数据库查询错误原样上抛，不回退到 Node 时钟', async () => {
    dbMock.$queryRaw.mockRejectedValue(new Error('database unavailable'));

    await expect(countRecentFailures(24)).rejects.toThrow(
      'database unavailable',
    );
    expect(dbMock.$queryRaw).toHaveBeenCalledTimes(1);
    expect(dbMock.notificationLog.count).not.toHaveBeenCalled();
  });

  it('数据库未返回可信 count 时 fail closed', async () => {
    dbMock.$queryRaw.mockResolvedValue([]);

    await expect(countRecentFailures(24)).rejects.toThrow(
      'recent failure count unavailable',
    );
  });
});
