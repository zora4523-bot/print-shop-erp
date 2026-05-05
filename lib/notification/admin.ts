import { db } from '../db';
import {
  NotificationStatus,
  type NotificationStatus as NotificationStatusType,
} from '../../generated/prisma/enums';
import { NOTIFICATION_EVENTS, type NotificationEvent } from './events';

// 推送配置 / 日志的 admin-side 读写。Prisma 调用集中在这里（CLAUDE.md
// 三层架构：app → actions → lib → Prisma）。Server Actions 在
// actions/owner-notifications.ts 里封装权限 + 表单解析，业务在这里。

// ─────────────────────────────────────────────────────────────────────
// Channel 列表 / 详情 / CRUD
// ─────────────────────────────────────────────────────────────────────

export type ChannelSummary = {
  id: string;
  channelKey: string;
  channelName: string;
  webhookUrl: string;
  isActive: boolean;
  createdAt: Date;
  updatedAt: Date;
  // 引用此 channel 的 active rule 数（>0 时禁删）
  referencingActiveRuleCount: number;
};

/**
 * 列出全部 channel + 每个 channel 被多少 rule 引用（不管 isActive，
 * 用于 UI 渲染&ldquo;删除前置&rdquo;红/灰按钮）。NotificationRule.channelIds 是
 * `String[]`，没 FK，得 JS 侧 cross-reference。
 *
 * Codex round 103 #1：之前只数 active rule 的引用，导致&ldquo;rule 关掉但
 * channelIds 还指着&rdquo;的情况下能删 channel，留下 stale id。后续 owner
 * 重启 rule 就拿到悬空配置。所以这里数所有 rule，不管 isActive。
 */
export async function listChannelsWithRefCount(): Promise<ChannelSummary[]> {
  const [channels, allRules] = await Promise.all([
    db.notificationChannel.findMany({
      orderBy: [{ isActive: 'desc' }, { createdAt: 'asc' }],
      select: {
        id: true,
        channelKey: true,
        channelName: true,
        webhookUrl: true,
        isActive: true,
        createdAt: true,
        updatedAt: true,
      },
    }),
    db.notificationRule.findMany({
      // 故意不过滤 isActive —— 见函数注释。
      select: { channelIds: true },
    }),
  ]);
  // 把所有 rule 引用的 channelId 拍平成 multiset，count by channelId
  const refCount = new Map<string, number>();
  for (const r of allRules) {
    for (const cid of r.channelIds) {
      refCount.set(cid, (refCount.get(cid) ?? 0) + 1);
    }
  }
  return channels.map((c) => ({
    ...c,
    referencingActiveRuleCount: refCount.get(c.id) ?? 0,
  }));
}

export async function getChannel(id: string): Promise<ChannelSummary | null> {
  const c = await db.notificationChannel.findUnique({
    where: { id },
    select: {
      id: true,
      channelKey: true,
      channelName: true,
      webhookUrl: true,
      isActive: true,
      createdAt: true,
      updatedAt: true,
    },
  });
  if (!c) return null;
  // 单条详情不必做交叉引用，referencingActiveRuleCount 留 0（caller
  // 会从 list 拿，或者编辑场景下不需要）。
  return { ...c, referencingActiveRuleCount: 0 };
}

export type CreateChannelInput = {
  channelKey: string;
  channelName: string;
  webhookUrl: string;
  isActive: boolean;
};

export async function createChannel(
  input: CreateChannelInput,
): Promise<{ id: string }> {
  const created = await db.notificationChannel.create({
    data: input,
    select: { id: true },
  });
  return created;
}

export type UpdateChannelInput = {
  channelName: string;
  webhookUrl: string;
  isActive: boolean;
};

/**
 * 编辑 channel：name / webhookUrl / isActive。
 *
 * **不**做"如果 isActive 翻 false 则拒绝有规则引用"的 cross-check。
 * 这是有意设计（DECISIONS Slice B）：
 * - Round 103 #2 立约&ldquo;停用 channel 不丢现有 binding&rdquo; —— 即业务允许
 *   "rule.channelIds 引用 inactive channel"这种共存状态
 * - notify() 见到 inactive channel 写 status=FAILED log（Slice A 设
 *   计）—— owner 从 dashboard 红色告警条看到，可手动重启或解绑
 * - 删除路径不同：删了 channel 留下 stale ID 是无法恢复的，必须严
 *   防（deleteChannel 的 FOR UPDATE 会聚锁路径）
 *
 * Codex round 107 #1 说&ldquo;并发 deactivate + 新绑同一 channel 会留下
 * 'active rule + inactive channel' 状态&rdquo;——这与单 admin 顺序 'bind
 * 然后 deactivate' 的合法终态是同一个状态，安全网（notify FAILED
 * log）已覆盖。所以这条不锁，避免 UI 出现"先解绑才能停用"的繁琐。
 */
export async function updateChannel(
  id: string,
  input: UpdateChannelInput,
): Promise<void> {
  await db.notificationChannel.update({
    where: { id },
    data: input,
  });
}

export class ChannelInUseError extends Error {
  constructor(
    public readonly channelId: string,
    public readonly referencingRules: readonly { eventType: string }[],
  ) {
    super(`channel ${channelId} 被 ${referencingRules.length} 个启用规则引用`);
    this.name = 'ChannelInUseError';
  }
}

/**
 * 删除 channel 前置检查：被任何 rule（不管 isActive）的 channelIds
 * 引用就拒绝。强一致性走 transaction：检查 + delete 在同一个 tx 内，
 * 避免&ldquo;检查通过之后另一个 owner 把 rule 加上&rdquo;的 race。
 *
 * Codex round 103 #1：之前只过滤 isActive=true 的 rule，导致 owner
 * 把 rule 关掉就能删 channel，留下 channelIds 里的 stale id —— 后续
 * 启用规则时是悬空 ID。所以&ldquo;被任何 rule 引用&rdquo;就拒绝；要彻底删
 * channel，先去所有 rule（含未启用的）里把它从 channelIds 移除。
 *
 * Codex round 107 #2：和 updateRule 之间的并发竞态——admin A 在
 * updateRule 里 SELECT FOR UPDATE 了 c2，正在 read rules / 准备 update；
 * 同时 admin B 调 deleteChannel(c2)。如果 B 没有自己 FOR UPDATE c2，
 * B 的 findMany 可能在 A 提交前看不到 A 的新 rule.channelIds 引用，
 * 然后 B 删了 c2，A 提交后 rule.channelIds 留下 stale ID。修：先 FOR
 * UPDATE c2 行，与 updateRule 的锁路径会聚一处——A 持锁时 B 等，B 持
 * 锁时 A 等；都拿到锁后再 findMany rules，看到对方已 commit 的引用。
 *
 * NotificationLog FK channelId → ON DELETE 没设 cascade（schema 默认
 * RESTRICT）；但已删 channel 不该再生新 log。如果有历史 log 引用，
 * delete 会被 PG FK 拒绝——也是合理保护（保留 audit）。
 */
export async function deleteChannel(id: string): Promise<void> {
  await db.$transaction(async (tx) => {
    // FOR UPDATE 锁 c2 行 —— 与 updateRule 的相同锁路径会聚（Codex
    // round 107 #2）。如果 c2 已不存在，FOR UPDATE 返空，下面的
    // delete 自然抛 RecordNotFound。
    await tx.$queryRaw`
      SELECT id FROM "NotificationChannel"
      WHERE id = ${id}
      FOR UPDATE
    `;
    const referencingRules = await tx.notificationRule.findMany({
      where: {
        // 故意不过滤 isActive —— 见函数注释。
        channelIds: { has: id },
      },
      select: { eventType: true },
    });
    if (referencingRules.length > 0) {
      throw new ChannelInUseError(id, referencingRules);
    }
    await tx.notificationChannel.delete({ where: { id } });
  });
}

// ─────────────────────────────────────────────────────────────────────
// Rule 列表 / 详情 / 更新（lazy upsert 默认 10 条）
// ─────────────────────────────────────────────────────────────────────

export type RuleSummary = {
  eventType: string;
  channelIds: string[];
  messageTemplate: string;
  isActive: boolean;
  updatedAt: Date;
};

/**
 * 列出全部 10 条 rule（按 eventType 字母序固定，让 UI 顺序稳定）。
 * 兼容场景：seed.ts 把 10 条 rule upsert 出来；如果某条因为 schema
 * 飘忽缺失，这里仍然返已有的（UI 显示&ldquo;未配置&rdquo;空槽）。
 */
export async function listRules(): Promise<RuleSummary[]> {
  const rules = await db.notificationRule.findMany({
    orderBy: { eventType: 'asc' },
    select: {
      eventType: true,
      channelIds: true,
      messageTemplate: true,
      isActive: true,
      updatedAt: true,
    },
  });
  return rules;
}

export async function getRule(eventType: string): Promise<RuleSummary | null> {
  return db.notificationRule.findUnique({
    where: { eventType },
    select: {
      eventType: true,
      channelIds: true,
      messageTemplate: true,
      isActive: true,
      updatedAt: true,
    },
  });
}

export type UpdateRuleInput = {
  messageTemplate: string;
  channelIds: string[];
  isActive: boolean;
};

export class RuleNotFoundError extends Error {
  constructor(public readonly eventType: string) {
    super(`通知规则 ${eventType} 不存在`);
    this.name = 'RuleNotFoundError';
  }
}

export class StaleChannelIdsError extends Error {
  constructor(public readonly invalidIds: readonly string[]) {
    super(`channelIds 含已删除/不存在的 channel：${invalidIds.join(', ')}`);
    this.name = 'StaleChannelIdsError';
  }
}

export class InactiveChannelBindError extends Error {
  constructor(public readonly inactiveIds: readonly string[]) {
    super(
      `不能新绑定已停用的 channel：${inactiveIds.join(', ')}（先启用再绑）`,
    );
    this.name = 'InactiveChannelBindError';
  }
}

/**
 * 更新 rule。校验：
 * 1. eventType 必须是 NOTIFICATION_EVENTS 已定义的（防 owner 通过
 *    URL 直接传 `/owner/notifications/rules/INVALID_EVENT`）。
 * 2. channelIds 引用的 channel 必须全部存在（避免悬空 ID）。
 * 3. isActive=true 时 channelIds 不能空（业务校验，schema 跨字段约束）。
 *
 * 注：notify.ts 自己也容忍 stale ID（写 console.warn），但 UI 这里
 * 严格挡，因为 owner 是手动选的，stale 一定是 race（其他 admin 同时
 * 删了 channel）—— 让 owner 重选最干净。
 */
export async function updateRule(
  eventType: string,
  input: UpdateRuleInput,
): Promise<void> {
  // 1. event 合法性
  const valid = (Object.values(NOTIFICATION_EVENTS) as string[]).includes(
    eventType,
  );
  if (!valid) {
    throw new RuleNotFoundError(eventType);
  }

  await db.$transaction(async (tx) => {
    // 2. rule 存在性（lazy upsert 不在这条路径——seed 已建好）+ 拿
    //    OLD channelIds 用于"新增的 channelId 必须 active"校验
    const rule = await tx.notificationRule.findUnique({
      where: { eventType },
      select: { eventType: true, channelIds: true },
    });
    if (!rule) {
      throw new RuleNotFoundError(eventType);
    }

    // 3. channelIds 合法性
    if (input.channelIds.length > 0) {
      // Codex round 106：SELECT FOR UPDATE 锁住引用的 channel 行，
      // 阻塞并发 UPDATE NotificationChannel SET isActive=false 直到
      // 本 tx 提交。否则 admin A 读到 c2 active → admin B 关 c2 →
      // admin A 提交带 c2 binding 的规则，留下&ldquo;active rule + inactive
      // channel&rdquo;的脏状态。FOR UPDATE 配合 db.$transaction 的隐式
      // READ COMMITTED 隔离已足够——锁在 tx 提交后释放，B 必须等。
      // Prisma 没有 forUpdate 选项，走 $queryRaw（没用 $executeRaw
      // 因为我们要拿回结果做 isActive 检查）。
      await tx.$queryRaw`
        SELECT id FROM "NotificationChannel"
        WHERE id = ANY(${input.channelIds}::text[])
        FOR UPDATE
      `;
      const found = await tx.notificationChannel.findMany({
        where: { id: { in: input.channelIds } },
        select: { id: true, isActive: true },
      });
      const foundIds = new Set(found.map((c) => c.id));
      const invalid = input.channelIds.filter((id) => !foundIds.has(id));
      if (invalid.length > 0) {
        throw new StaleChannelIdsError(invalid);
      }
      // Codex round 105：服务端对称防"新增 inactive 绑定"。RuleForm
      // 已 disable 客户端 checkbox，但并发场景（admin A 加载表单 →
      // admin B 关闭 channel → admin A 提交）/ 直接 POST 不走 UI
      // 都能突破前端。OLD channelIds 里已有的 inactive ID 允许保留
      // （round 103 #2 承诺&ldquo;停用 channel 不丢现有 binding&rdquo;），仅
      // 拒&ldquo;新增的 inactive&rdquo;。
      const oldBound = new Set(rule.channelIds);
      const newlyAddedInactive = found
        .filter((c) => !c.isActive && !oldBound.has(c.id))
        .map((c) => c.id);
      if (newlyAddedInactive.length > 0) {
        throw new InactiveChannelBindError(newlyAddedInactive);
      }
    }

    await tx.notificationRule.update({
      where: { eventType },
      data: input,
    });
  });
}

export class EmptyChannelIdsError extends Error {
  constructor(public readonly eventType: string) {
    super(`规则 ${eventType} 启用时必须至少绑定 1 个渠道`);
    this.name = 'EmptyChannelIdsError';
  }
}

// CS 业绩 / 提成事件（含具体客服金额）只能绑 ≤ 1 个 channel——多绑
// 会让所有 channel 看到所有客服的金额。schema 没 per-user 路由
// （SPEC §8.1 &ldquo;对应客服&rdquo; 1:1 推送等 P2 加 User.notificationChannelId
// 后实现）。Codex round 113 high → round 114 high：UI 警告易被
// 直接 POST / replay 绕开，server side 必须 enforce。
const PRIVATE_PER_CS_EVENTS = new Set([
  'CS_PERIOD_ENDING',
  'CS_PERIOD_SETTLED',
]);
const MAX_PRIVATE_CHANNELS = 1;

export class TooManyChannelsForPrivateEventError extends Error {
  constructor(
    public readonly eventType: string,
    public readonly count: number,
  ) {
    super(
      `${eventType} 含具体客服金额，最多绑 ${MAX_PRIVATE_CHANNELS} 个 channel（当前 ${count}）`,
    );
    this.name = 'TooManyChannelsForPrivateEventError';
  }
}

/**
 * Action 层调用：跨字段 + 跨事件类型的多重校验（schema 不能跨字段，
 * 留给 action）：
 *   1. 启用规则 + channelIds 空 → EmptyChannelIdsError
 *   2. CS_PERIOD_* 事件 channelIds > 1 → TooManyChannelsForPrivateEventError
 *      （Codex round 114 high：privacy enforcement，UI 警告必须有
 *      server-side guard 兜底）
 * 校验通过后委托给 updateRule。
 */
export async function updateRuleWithGuard(
  eventType: string,
  input: UpdateRuleInput,
): Promise<void> {
  if (input.isActive && input.channelIds.length === 0) {
    throw new EmptyChannelIdsError(eventType);
  }
  if (
    PRIVATE_PER_CS_EVENTS.has(eventType) &&
    input.channelIds.length > MAX_PRIVATE_CHANNELS
  ) {
    throw new TooManyChannelsForPrivateEventError(
      eventType,
      input.channelIds.length,
    );
  }
  return updateRule(eventType, input);
}

// ─────────────────────────────────────────────────────────────────────
// 日志列表（owner UI 显示）
// ─────────────────────────────────────────────────────────────────────

export type LogFilter = {
  eventType?: NotificationEvent;
  status?: NotificationStatusType;
  // 按 createdAt 范围（半开区间）
  start?: Date;
  end?: Date;
  limit?: number; // 默认 50
};

export type LogRow = {
  id: string;
  eventType: string;
  channelId: string;
  channelName: string | null; // join 出来；channel 已删则 null
  messageContent: string;
  status: NotificationStatusType;
  errorMessage: string | null;
  retryCount: number;
  relatedOrderId: string | null;
  sentAt: Date | null;
  createdAt: Date;
};

export async function listLogs(filter: LogFilter = {}): Promise<LogRow[]> {
  const limit = filter.limit ?? 50;
  const rows = await db.notificationLog.findMany({
    where: {
      ...(filter.eventType ? { eventType: filter.eventType } : {}),
      ...(filter.status ? { status: filter.status } : {}),
      ...(filter.start || filter.end
        ? {
            createdAt: {
              ...(filter.start ? { gte: filter.start } : {}),
              ...(filter.end ? { lt: filter.end } : {}),
            },
          }
        : {}),
    },
    orderBy: { createdAt: 'desc' },
    take: limit,
    select: {
      id: true,
      eventType: true,
      channelId: true,
      messageContent: true,
      status: true,
      errorMessage: true,
      retryCount: true,
      relatedOrderId: true,
      sentAt: true,
      createdAt: true,
      channel: { select: { channelName: true } },
    },
  });
  return rows.map((r) => ({
    id: r.id,
    eventType: r.eventType,
    channelId: r.channelId,
    channelName: r.channel?.channelName ?? null,
    messageContent: r.messageContent,
    status: r.status as NotificationStatusType,
    errorMessage: r.errorMessage,
    retryCount: r.retryCount,
    relatedOrderId: r.relatedOrderId,
    sentAt: r.sentAt,
    createdAt: r.createdAt,
  }));
}

// 让 UI 一眼看出"最近一次推送是不是失败"——dashboard 顶部告警条。
//
// Codex round 103 #3：手动测试按钮也写 NotificationLog 行（eventType
// = '__TEST__'）；如果 owner 测过一次失败的 webhook URL，那条 log
// 会让 24h 告警条无限挂红——与"真生产推送健康"的状态混淆。所以这里
// 显式排除 __TEST__ event，告警条只反应真业务事件失败。
export async function countRecentFailures(
  windowHours = 24,
): Promise<number> {
  const since = new Date(Date.now() - windowHours * 60 * 60 * 1000);
  return db.notificationLog.count({
    where: {
      status: NotificationStatus.FAILED,
      createdAt: { gte: since },
      NOT: { eventType: '__TEST__' },
    },
  });
}
