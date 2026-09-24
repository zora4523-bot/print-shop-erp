import {
  BackgroundJobStatus,
  NotificationChannelTransport,
  NotificationStatus,
  type NotificationChannelTransport as NotificationChannelTransportType,
  type NotificationSmartBotChatType,
  type NotificationStatus as NotificationStatusType,
} from '../../generated/prisma/enums';
import { randomBytes } from 'node:crypto';
import { db } from '../db';
import {
  NOTIFICATION_EVENTS,
  SUPERSEDED_BEFORE_SEND_ERROR,
  TEST_EVENT_TYPE,
  managementNotificationRoleForEvent,
  type ManagementNotificationRole,
  type NotificationEvent,
} from './events';
import { BACKGROUND_JOB_TYPES } from '../background-jobs/types';
import { resolveSetting } from '../settings';
import { databaseNow } from '../background-jobs/clock';
import { hasExclusiveConnectedSmartBotWorker } from '../background-jobs/smart-bot-availability';
import {
  configuredSmartBotIdDigest,
  hashSmartBotBindingCode,
  smartBotCredentialsConfigured,
} from './smart-bot';
import {
  notificationChannelSelectionIssue,
  type NotificationChannelSelectionIssue,
} from './channel-selection';

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
  transport: NotificationChannelTransportType;
  smartBotTargetId: string | null;
  smartBotChatType: NotificationSmartBotChatType | null;
  smartBotBoundAt: Date | null;
  smartBotBotMatchesConfigured: boolean;
  selectionIssue: NotificationChannelSelectionIssue | null;
  isActive: boolean;
  createdAt: Date;
  updatedAt: Date;
  // 引用此 channel 的规则或固定角色路由数（>0 时禁删）
  referencingConfigurationCount: number;
};

type ChannelWithoutRefCount = Omit<
  ChannelSummary,
  'referencingConfigurationCount'
>;

async function listChannels(): Promise<ChannelWithoutRefCount[]> {
  const channels = await db.notificationChannel.findMany({
    orderBy: [{ isActive: 'desc' }, { createdAt: 'asc' }],
    select: {
      id: true,
      channelKey: true,
      channelName: true,
      transport: true,
      smartBotBotDigest: true,
      smartBotTargetId: true,
      smartBotChatType: true,
      smartBotBoundAt: true,
      isActive: true,
      createdAt: true,
      updatedAt: true,
    },
  });
  const configuredDigest = configuredSmartBotIdDigest();
  const selectionContext = {
    smartBotCredentialsConfigured: smartBotCredentialsConfigured(),
    configuredSmartBotDigest: configuredDigest,
  };
  return channels.map((channel) => {
    const { smartBotBotDigest, ...safeChannel } = channel;
    return {
      ...safeChannel,
      smartBotBotMatchesConfigured:
        channel.transport !== NotificationChannelTransport.WECOM_SMART_BOT ||
        (configuredDigest !== null && smartBotBotDigest === configuredDigest),
      selectionIssue: notificationChannelSelectionIssue(
        channel,
        selectionContext,
      ),
    };
  });
}

function addChannelReferenceCounts(
  channels: readonly ChannelWithoutRefCount[],
  rules: readonly { channelIds: readonly string[] }[],
  rawManagementRouting?: unknown,
): ChannelSummary[] {
  const refCount = new Map<string, number>();
  for (const rule of rules) {
    for (const channelId of rule.channelIds) {
      refCount.set(channelId, (refCount.get(channelId) ?? 0) + 1);
    }
  }
  const routing = resolveSetting(
    'management_notification_routing',
    rawManagementRouting,
  );
  for (const role of [routing.factoryConfirmer, routing.owner]) {
    for (const channelId of role.channelIds) {
      refCount.set(channelId, (refCount.get(channelId) ?? 0) + 1);
    }
  }
  return channels.map((channel) => ({
    ...channel,
    referencingConfigurationCount: refCount.get(channel.id) ?? 0,
  }));
}

/**
 * 列出全部 channel + 每个 channel 被多少规则/固定角色路由引用，
 * 用于 UI 渲染&ldquo;删除前置&rdquo;红/灰按钮）。NotificationRule.channelIds 是
 * `String[]`，没 FK，得 JS 侧 cross-reference。
 *
 * 之前只数 active rule 的引用，导致&ldquo;rule 关掉但
 * channelIds 还指着&rdquo;的情况下能删 channel，留下 stale id。后续 owner
 * 重启 rule 就拿到悬空配置。所以这里数所有 rule，不管 isActive。
 */
export async function listChannelsWithRefCount(): Promise<ChannelSummary[]> {
  const [channels, allRules, routingSetting] = await Promise.all([
    listChannels(),
    db.notificationRule.findMany({
      // 故意不过滤 isActive —— 见函数注释。
      select: { channelIds: true },
    }),
    db.setting.findUnique({
      where: { key: 'management_notification_routing' },
      select: { value: true },
    }),
  ]);
  return addChannelReferenceCounts(channels, allRules, routingSetting?.value);
}

export async function getChannel(id: string): Promise<ChannelSummary | null> {
  const channel = await db.notificationChannel.findUnique({
    where: { id },
    select: {
      id: true,
      channelKey: true,
      channelName: true,
      transport: true,
      smartBotBotDigest: true,
      smartBotTargetId: true,
      smartBotChatType: true,
      smartBotBoundAt: true,
      isActive: true,
      createdAt: true,
      updatedAt: true,
    },
  });
  if (!channel) return null;
  const { smartBotBotDigest, ...safeChannel } = channel;
  const configuredDigest = configuredSmartBotIdDigest();
  const selectionContext = {
    smartBotCredentialsConfigured: smartBotCredentialsConfigured(),
    configuredSmartBotDigest: configuredDigest,
  };
  // 单条详情不必做交叉引用，referencingConfigurationCount 留 0（caller
  // 会从 list 拿，或者编辑场景下不需要）。
  return {
    ...safeChannel,
    smartBotBotMatchesConfigured:
      channel.transport !== NotificationChannelTransport.WECOM_SMART_BOT ||
      (configuredDigest !== null && smartBotBotDigest === configuredDigest),
    selectionIssue: notificationChannelSelectionIssue(
      channel,
      selectionContext,
    ),
    referencingConfigurationCount: 0,
  };
}

export type CreateChannelInput = {
  channelKey: string;
  channelName: string;
  transport: 'WECOM_SMART_BOT';
  isActive: boolean;
};

export async function createChannel(
  input: CreateChannelInput,
): Promise<{ id: string }> {
  if (input.transport !== NotificationChannelTransport.WECOM_SMART_BOT) {
    throw new ChannelTransportMismatchError();
  }
  const created = await db.notificationChannel.create({
    data: {
      channelKey: input.channelKey,
      channelName: input.channelName,
      transport: NotificationChannelTransport.WECOM_SMART_BOT,
      webhookUrl: null,
      isActive: false,
    },
    select: { id: true },
  });
  return created;
}

export type UpdateChannelInput = {
  transport: 'WECOM_SMART_BOT';
  channelName: string;
  isActive: boolean;
};

export class ChannelTransportMismatchError extends Error {
  constructor() {
    super('notification channel transport is immutable');
    this.name = 'ChannelTransportMismatchError';
  }
}

export class UnboundSmartBotChannelError extends Error {
  constructor() {
    super('unbound smart bot channel cannot be activated');
    this.name = 'UnboundSmartBotChannelError';
  }
}

export class SmartBotIdentityMismatchError extends Error {
  constructor() {
    super('smart bot channel belongs to another Bot ID');
    this.name = 'SmartBotIdentityMismatchError';
  }
}

/**
 * 仅编辑智能机器人 channel：name / isActive；旧版目标保持只读。
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
 * 已知边界：&ldquo;并发 deactivate + 新绑同一 channel 会留下
 * 'active rule + inactive channel' 状态&rdquo;——这与单 admin 顺序 'bind
 * 然后 deactivate' 的合法终态是同一个状态，安全网（notify FAILED
 * log）已覆盖。所以这条不锁，避免 UI 出现"先解绑才能停用"的繁琐。
 */
export async function updateChannel(
  id: string,
  input: UpdateChannelInput,
): Promise<void> {
  if (input.transport !== NotificationChannelTransport.WECOM_SMART_BOT) {
    throw new ChannelTransportMismatchError();
  }
  await db.$transaction(async (tx) => {
    const channel = await tx.notificationChannel.findUnique({
      where: { id },
      select: {
        transport: true,
        smartBotBotDigest: true,
        smartBotTargetId: true,
        smartBotBoundAt: true,
      },
    });
    if (!channel) {
      await tx.notificationChannel.update({ where: { id }, data: {} });
      return;
    }
    if (channel.transport !== input.transport) {
      throw new ChannelTransportMismatchError();
    }
    if (
      channel.transport === NotificationChannelTransport.WECOM_SMART_BOT &&
      input.isActive &&
      (!channel.smartBotTargetId || !channel.smartBotBoundAt)
    ) {
      throw new UnboundSmartBotChannelError();
    }
    if (
      channel.transport === NotificationChannelTransport.WECOM_SMART_BOT &&
      input.isActive &&
      channel.smartBotBotDigest !== configuredSmartBotIdDigest()
    ) {
      throw new SmartBotIdentityMismatchError();
    }
    await tx.notificationChannel.update({
      where: { id },
      data: {
        channelName: input.channelName,
        isActive: input.isActive,
      },
    });
  });
}

export type SmartBotBindingCodeReceipt = {
  bindingCode: string;
  expiresAt: Date;
};

export type SmartBotBindingErrorCode =
  | 'CHANNEL_NOT_FOUND'
  | 'NOT_SMART_BOT'
  | 'ALREADY_BOUND'
  | 'CREDENTIALS_NOT_CONFIGURED'
  | 'WORKER_UNAVAILABLE'
  | 'CONFLICT';

export class SmartBotBindingError extends Error {
  constructor(public readonly code: SmartBotBindingErrorCode) {
    super(`cannot create smart bot binding code: ${code}`);
    this.name = 'SmartBotBindingError';
  }
}

/**
 * Creates a short-lived code for an unbound logical destination. Plaintext is
 * returned once; PostgreSQL only receives its domain-separated SHA-256 hash.
 */
export async function createSmartBotBindingCode(
  channelId: string,
): Promise<SmartBotBindingCodeReceipt> {
  if (!smartBotCredentialsConfigured()) {
    throw new SmartBotBindingError('CREDENTIALS_NOT_CONFIGURED');
  }
  if (
    !(await hasExclusiveConnectedSmartBotWorker(configuredSmartBotIdDigest()))
  ) {
    throw new SmartBotBindingError('WORKER_UNAVAILABLE');
  }
  const bindingCode = `ERP-BIND-${randomBytes(24).toString('base64url')}`;
  const bindingCodeHash = hashSmartBotBindingCode(bindingCode);

  return db.$transaction(async (tx) => {
    const channel = await tx.notificationChannel.findUnique({
      where: { id: channelId },
      select: { transport: true, smartBotTargetId: true },
    });
    if (!channel) throw new SmartBotBindingError('CHANNEL_NOT_FOUND');
    if (channel.transport !== NotificationChannelTransport.WECOM_SMART_BOT) {
      throw new SmartBotBindingError('NOT_SMART_BOT');
    }
    // A Channel ID is a durable recipient identity. Rebinding it would make an
    // owner-approved replay target a different group; create a new channel.
    if (channel.smartBotTargetId) {
      throw new SmartBotBindingError('ALREADY_BOUND');
    }

    const now = await databaseNow(tx);
    const expiresAt = new Date(now.getTime() + 10 * 60_000);
    const updated = await tx.notificationChannel.updateMany({
      where: {
        id: channelId,
        transport: NotificationChannelTransport.WECOM_SMART_BOT,
        smartBotTargetId: null,
      },
      data: {
        smartBotBindingCodeHash: bindingCodeHash,
        smartBotBindingExpiresAt: expiresAt,
        isActive: false,
      },
    });
    if (updated.count !== 1) throw new SmartBotBindingError('CONFLICT');
    return { bindingCode, expiresAt };
  });
}

export class ChannelInUseError extends Error {
  constructor(
    public readonly channelId: string,
    public readonly references: readonly ChannelReference[],
  ) {
    super(`channel ${channelId} 被 ${references.length} 项通知配置引用`);
    this.name = 'ChannelInUseError';
  }
}

export type ChannelReference =
  | { kind: 'rule'; eventType: string }
  | { kind: 'management-route'; role: ManagementNotificationRole };

function managementRouteReferences(
  raw: unknown,
  channelId: string,
): ChannelReference[] {
  const routing = resolveSetting('management_notification_routing', raw);
  const references: ChannelReference[] = [];
  if (routing.factoryConfirmer.channelIds.includes(channelId)) {
    references.push({ kind: 'management-route', role: 'factoryConfirmer' });
  }
  if (routing.owner.channelIds.includes(channelId)) {
    references.push({ kind: 'management-route', role: 'owner' });
  }
  return references;
}

/**
 * 删除 channel 前置检查：被任何 rule（不管 isActive）或固定角色
 * 路由引用就拒绝。强一致性走 transaction：检查 + delete 在同一个 tx 内，
 * 避免&ldquo;检查通过之后另一个 owner 把 rule 加上&rdquo;的 race。
 *
 * 之前只过滤 isActive=true 的 rule，导致 owner
 * 把 rule 关掉就能删 channel，留下 channelIds 里的 stale id —— 后续
 * 启用规则时是悬空 ID。所以&ldquo;被任何 rule 引用&rdquo;就拒绝；要彻底删
 * channel，先去所有 rule（含未启用的）里把它从 channelIds 移除。
 *
 * 和 updateRule 之间的并发竞态——admin A 在
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
    // FOR UPDATE 锁 c2 行 —— 与 updateRule 的相同锁路径会聚。
    //如果 c2 已不存在，FOR UPDATE 返空，下面的
    // delete 自然抛 RecordNotFound。
    await tx.$queryRaw`
      SELECT id FROM "NotificationChannel"
      WHERE id = ${id}
      FOR UPDATE
    `;
    const [referencingRules, routingSetting] = await Promise.all([
      tx.notificationRule.findMany({
        where: {
          // 故意不过滤 isActive —— 见函数注释。
          channelIds: { has: id },
        },
        select: { eventType: true },
      }),
      tx.setting.findUnique({
        where: { key: 'management_notification_routing' },
        select: { value: true },
      }),
    ]);
    const references: ChannelReference[] = [
      ...referencingRules.map((rule) => ({
        kind: 'rule' as const,
        eventType: rule.eventType,
      })),
      ...managementRouteReferences(routingSetting?.value, id),
    ];
    if (references.length > 0) {
      throw new ChannelInUseError(id, references);
    }
    await tx.notificationChannel.delete({ where: { id } });
  });
}

// ─────────────────────────────────────────────────────────────────────
// Rule 列表 / 详情 / 更新（seed 默认 15 条）
// ─────────────────────────────────────────────────────────────────────

export type RuleSummary = {
  eventType: string;
  channelIds: string[];
  messageTemplate: string;
  isActive: boolean;
  updatedAt: Date;
};

/**
 * 列出全部 15 条 rule（按 eventType 字母序固定，让 UI 顺序稳定）。
 * 兼容场景：seed.ts 把 15 条 rule 首次创建出来；如果某条因为 schema
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

/**
 * 通知管理首页同时需要 channel 引用数和完整 rule 列表。
 * 单独调用 `listChannelsWithRefCount()` + `listRules()` 会把
 * NotificationRule 读两遍；这个组合入口只读一次完整 rules，
 * 然后用同一份快照在内存中计算 channel 引用数。
 */
export async function listNotificationConfiguration(): Promise<{
  channels: ChannelSummary[];
  rules: RuleSummary[];
}> {
  const [channels, rules, routingSetting] = await Promise.all([
    listChannels(),
    listRules(),
    db.setting.findUnique({
      where: { key: 'management_notification_routing' },
      select: { value: true },
    }),
  ]);
  return {
    channels: addChannelReferenceCounts(
      channels,
      rules,
      routingSetting?.value,
    ),
    rules,
  };
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

export class IneligibleChannelBindError extends Error {
  constructor(
    public readonly channels: readonly {
      id: string;
      issue: Exclude<NotificationChannelSelectionIssue, 'INACTIVE'>;
    }[],
  ) {
    super(
      `不能新绑定当前不可用的 channel：${channels
        .map(({ id, issue }) => `${id}(${issue})`)
        .join(', ')}`,
    );
    this.name = 'IneligibleChannelBindError';
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
      select: { eventType: true, channelIds: true, isActive: true },
    });
    if (!rule) {
      throw new RuleNotFoundError(eventType);
    }

    // 3. channelIds 合法性
    if (input.channelIds.length > 0) {
      // SELECT FOR UPDATE 锁住引用的 channel 行，
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
        select: {
          id: true,
          transport: true,
          smartBotBotDigest: true,
          smartBotTargetId: true,
          smartBotChatType: true,
          smartBotBoundAt: true,
          isActive: true,
        },
      });
      const foundIds = new Set(found.map((c) => c.id));
      const invalid = input.channelIds.filter((id) => !foundIds.has(id));
      if (invalid.length > 0) {
        throw new StaleChannelIdsError(invalid);
      }
      // 服务端对称防"新增 inactive 绑定"。RuleForm
      // 已 disable 客户端 checkbox，但并发场景（admin A 加载表单 →
      // admin B 关闭 channel → admin A 提交）/ 直接 POST 不走 UI
      // 都能突破前端。OLD channelIds 里已有的 inactive ID 允许保留
      // （round 103 #2 承诺&ldquo;停用 channel 不丢现有 binding&rdquo;），仅
      // 拒&ldquo;新增的 inactive&rdquo;。
      const oldBound = new Set(rule.channelIds);
      // 从停用切到启用会让全部保留绑定重新成为实际发送目标，因此与
      // 新增绑定等价，不能借 oldBound 绕过可用性校验。
      // 托管事件始终从角色设置取实际收件群（notify 无回退），规则中
      // 保留的旧 ID 仅为历史兼容。启用事件不能被这些隐藏旧字段卡住；
      // 真正的角色路由仍由 updateSettings 校验，新加 ID 也仍须校验。
      const activatesRule = input.isActive && !rule.isActive &&
        !managementNotificationRoleForEvent(eventType);
      const newlyAddedInactive = found
        .filter(
          (c) => !c.isActive && (activatesRule || !oldBound.has(c.id)),
        )
        .map((c) => c.id);
      if (newlyAddedInactive.length > 0) {
        throw new InactiveChannelBindError(newlyAddedInactive);
      }
      const selectionContext = {
        smartBotCredentialsConfigured: smartBotCredentialsConfigured(),
        configuredSmartBotDigest: configuredSmartBotIdDigest(),
      };
      const newlyAddedIneligible = found.flatMap((channel) => {
        if (!activatesRule && oldBound.has(channel.id)) return [];
        const issue = notificationChannelSelectionIssue(
          channel,
          selectionContext,
        );
        return issue && issue !== 'INACTIVE'
          ? [{ id: channel.id, issue }]
          : [];
      });
      if (newlyAddedIneligible.length > 0) {
        throw new IneligibleChannelBindError(newlyAddedIneligible);
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

/**
 * Action 层调用：跨字段校验（schema 不能跨字段，留给 action）：
 * 启用规则 + channelIds 空 → EmptyChannelIdsError。
 * 校验通过后委托给 updateRule。
 */
export async function updateRuleWithGuard(
  eventType: string,
  input: UpdateRuleInput,
): Promise<void> {
  if (
    input.isActive &&
    input.channelIds.length === 0 &&
    !managementNotificationRoleForEvent(eventType)
  ) {
    throw new EmptyChannelIdsError(eventType);
  }
  return updateRule(eventType, input);
}

// ─────────────────────────────────────────────────────────────────────
// 日志列表（owner UI 显示）
// ─────────────────────────────────────────────────────────────────────

export type LogFilter = {
  eventType?: NotificationEvent;
  status?: NotificationStatusType;
  // 按最近一次投递时间范围（半开区间）
  start?: Date;
  end?: Date;
  limit?: number; // 默认 50
  skip?: number;
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
  deliveryKey: string | null;
  deliveryStateVersion: number;
  lastAttemptAt: Date;
  createdAt: Date;
  updatedAt: Date;
  /** 投递日志所属的持久化后台任务状态；inline/测试投递为 null。 */
  backgroundJobStatus: BackgroundJobStatus | null;
  /**
   * RETRYING 本身只表示可重试；当对应的 durable job 已经 DEAD
   * 时，才是需要 owner 介入的死信。不改 NotificationLog 的单调状态，
   * 只在读模型上暴露跨账本契约。
   */
  hasDeadLetterJob: boolean;
};

export async function listLogs(filter: LogFilter = {}): Promise<LogRow[]> {
  const limit = Math.min(200, Math.max(1, filter.limit ?? 50));
  const skip = Math.max(0, Math.floor(filter.skip ?? 0));
  const rows = await db.notificationLog.findMany({
    where: {
      ...(filter.eventType ? { eventType: filter.eventType } : {}),
      ...(filter.status ? { status: filter.status } : {}),
      ...(filter.start || filter.end
        ? {
            lastAttemptAt: {
              ...(filter.start ? { gte: filter.start } : {}),
              ...(filter.end ? { lt: filter.end } : {}),
            },
          }
        : {}),
    },
    orderBy: [{ lastAttemptAt: 'desc' }, { id: 'desc' }],
    skip,
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
      deliveryKey: true,
      deliveryStateVersion: true,
      lastAttemptAt: true,
      createdAt: true,
      updatedAt: true,
      channel: { select: { channelName: true } },
    },
  });
  const deliveryKeys = [
    ...new Set(rows.flatMap((row) => (row.deliveryKey ? [row.deliveryKey] : []))),
  ];
  const jobs =
    deliveryKeys.length === 0
      ? []
      : await db.backgroundJob.findMany({
          where: {
            type: BACKGROUND_JOB_TYPES.NOTIFICATION,
            dedupeKey: { in: deliveryKeys },
          },
          select: { dedupeKey: true, status: true },
        });
  const jobStatusByDeliveryKey = new Map(
    jobs.map((job) => [job.dedupeKey, job.status] as const),
  );
  return rows.map((r) => ({
    id: r.id,
    eventType: r.eventType,
    channelId: r.channelId,
    channelName: r.channel?.channelName ?? null,
    messageContent: r.messageContent,
    status: r.status,
    errorMessage: r.errorMessage,
    retryCount: r.retryCount,
    relatedOrderId: r.relatedOrderId,
    sentAt: r.sentAt,
    deliveryKey: r.deliveryKey,
    deliveryStateVersion: r.deliveryStateVersion,
    lastAttemptAt: r.lastAttemptAt,
    createdAt: r.createdAt,
    updatedAt: r.updatedAt,
    backgroundJobStatus: r.deliveryKey
      ? (jobStatusByDeliveryKey.get(r.deliveryKey) ?? null)
      : null,
    hasDeadLetterJob:
      r.status === NotificationStatus.RETRYING &&
      r.deliveryKey !== null &&
      jobStatusByDeliveryKey.get(r.deliveryKey) === BackgroundJobStatus.DEAD,
  }));
}

type UnresolvedLogQueryOptions = {
  limit?: number;
  skip?: number;
};

/**
 * Owner 必须处置的通知队列：
 * - UNKNOWN 需要人工确认是否送达；
 * - RETRYING 仍保持可重试语义，但 owning BackgroundJob 已 DEAD 时自动
 *   重试已经耗尽，也必须进入 owner 队列。
 *
 * 分页必须在数据库里对合并后的队列执行；分别查两类再在
 * Node 里合并会使 skip/take 丢行或重行。
 */
export async function listUnresolvedNotificationLogs(
  options: UnresolvedLogQueryOptions = {},
): Promise<LogRow[]> {
  const limit = Math.min(200, Math.max(1, options.limit ?? 50));
  const skip = Math.max(0, Math.floor(options.skip ?? 0));
  const rows = await db.$queryRaw<LogRow[]>`
    SELECT log."id",
           log."eventType",
           log."channelId",
           channel."channelName" AS "channelName",
           log."messageContent",
           log."status",
           log."errorMessage",
           log."retryCount",
           log."relatedOrderId",
           log."sentAt",
           log."deliveryKey",
           log."deliveryStateVersion",
           log."lastAttemptAt",
           log."createdAt",
           log."updatedAt",
           job."status" AS "backgroundJobStatus",
           (
             log."status" = ${NotificationStatus.RETRYING}::"NotificationStatus"
             AND job."status" = ${BackgroundJobStatus.DEAD}::"BackgroundJobStatus"
           ) AS "hasDeadLetterJob"
      FROM "NotificationLog" AS log
      LEFT JOIN "NotificationChannel" AS channel
        ON channel."id" = log."channelId"
      LEFT JOIN "BackgroundJob" AS job
        ON job."dedupeKey" = log."deliveryKey"
       AND job."type" = ${BACKGROUND_JOB_TYPES.NOTIFICATION}
     WHERE log."status" = ${NotificationStatus.UNKNOWN}::"NotificationStatus"
        OR (
          log."status" = ${NotificationStatus.RETRYING}::"NotificationStatus"
          AND job."status" = ${BackgroundJobStatus.DEAD}::"BackgroundJobStatus"
        )
     ORDER BY log."lastAttemptAt" DESC, log."id" DESC
     LIMIT ${limit}
     OFFSET ${skip}
  `;
  return rows;
}

export async function countUnresolvedNotifications(): Promise<number> {
  const rows = await db.$queryRaw<Array<{ count: bigint }>>`
    SELECT count(*)::bigint AS "count"
      FROM "NotificationLog" AS log
      LEFT JOIN "BackgroundJob" AS job
        ON job."dedupeKey" = log."deliveryKey"
       AND job."type" = ${BACKGROUND_JOB_TYPES.NOTIFICATION}
     WHERE log."status" = ${NotificationStatus.UNKNOWN}::"NotificationStatus"
        OR (
          log."status" = ${NotificationStatus.RETRYING}::"NotificationStatus"
          AND job."status" = ${BackgroundJobStatus.DEAD}::"BackgroundJobStatus"
        )
  `;
  const count = rows[0]?.count;
  if (typeof count !== 'bigint') {
    throw new Error('notification admin: unresolved count unavailable');
  }
  if (count > BigInt(Number.MAX_SAFE_INTEGER)) {
    throw new Error('notification admin: unresolved count exceeds safe integer');
  }
  return Number(count);
}


// 让 UI 一眼看出"最近一次推送是不是失败"——dashboard 顶部告警条。
// RETRYING 只有在 owning BackgroundJob 已 DEAD 时计入：任务尚在
// PENDING/RUNNING 时是正常退避，不应报警；耗尽 attempts 后则已无
// 自动处理者，必须显示给 owner。
//
// 手动测试按钮也写 NotificationLog 行（eventType
// = '__TEST__'）；如果 owner 测过一次失败的 webhook URL，那条 log
// 会让 24h 告警条无限挂红——与"真生产推送健康"的状态混淆。所以这里
// 显式排除 __TEST__ event，告警条只反应真业务事件失败。
export async function countRecentFailures(
  windowHours = 24,
): Promise<number> {
  // 时间窗口仍以 PostgreSQL 时钟为准，但把“读 DB now”和
  // “count”合成一条语句，避免每次打开 owner 页面都串行跑
  // 两次数据库往返。不回退到 Node 时钟，原始查询错误也直接上抛。
  const rows = await db.$queryRaw<Array<{ count: bigint }>>`
    SELECT count(*)::bigint AS "count"
      FROM "NotificationLog" AS log
      LEFT JOIN "BackgroundJob" AS job
        ON job."dedupeKey" = log."deliveryKey"
       AND job."type" = ${BACKGROUND_JOB_TYPES.NOTIFICATION}
     WHERE (
       log."status" IN (
       ${NotificationStatus.FAILED}::"NotificationStatus",
       ${NotificationStatus.UNKNOWN}::"NotificationStatus"
       )
       OR (
         log."status" = ${NotificationStatus.RETRYING}::"NotificationStatus"
         AND job."status" = ${BackgroundJobStatus.DEAD}::"BackgroundJobStatus"
       )
     )
       AND log."lastAttemptAt" >= (
         (now() AT TIME ZONE 'UTC')
           - (${windowHours}::double precision * INTERVAL '1 hour')
       )
       AND log."eventType" <> ${TEST_EVENT_TYPE}
       AND log."errorMessage" IS DISTINCT FROM ${SUPERSEDED_BEFORE_SEND_ERROR}
  `;
  const count = rows[0]?.count;
  if (typeof count !== 'bigint') {
    throw new Error('notification admin: recent failure count unavailable');
  }
  if (count > BigInt(Number.MAX_SAFE_INTEGER)) {
    throw new Error('notification admin: recent failure count exceeds safe integer');
  }
  return Number(count);
}
