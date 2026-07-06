import { db } from '../db';
import { NotificationStatus } from '../../generated/prisma/enums';
import {
  type NotificationEvent,
  type NotificationPayloadFor,
} from './events';
import { renderTemplate } from './render';
import {
  mockWebhookSender,
  sendWebhook,
  type WebhookSender,
} from './webhook';
import {
  PRIVATE_EVENT_MAX_CHANNELS,
  isPrivatePerCsEvent,
} from './admin';

// notify(event, payload) 是企业微信推送的**唯一公开入口**（CLAUDE.md
// §7.1）。永不抛（DECISIONS 2026-04-27 best-effort）：业务事务已 commit，
// 推送是后续观察；任何失败转写到 NotificationLog（status=FAILED）。
//
// 流程：
//   1. 查 active rule by eventType；不存在 → 早 return（不写 log）
//   2. 渲染 messageTemplate（render.ts 留缺失 placeholder 原样）
//   3. 对 rule.channelIds 里每个 active channel：发送 webhook → 写 log
//   4. 顶层 try/catch 兜底：连 DB 查 rule 都炸的极端场景 → console.error
//
// Mock 模式：dev/test 默认开（DECISIONS 2026-04-27）；prod 显式 true 也
// 接受。Mock 下不真 fetch，只写 status=SUCCESS errorMessage='MOCK' log。

const MOCK_ERROR_MESSAGE = 'MOCK';

export function isMockMode(env: NodeJS.ProcessEnv = process.env): boolean {
  // dev/test 默认 mock；prod 显式开关。
  if (env.NOTIFICATION_MOCK_MODE === 'true') return true;
  if (env.NOTIFICATION_MOCK_MODE === 'false') return false;
  return env.NODE_ENV !== 'production';
}

export type NotifyOptions = {
  // 测试 / debug 注入：覆盖 webhook sender / mock 判定 / 时钟。
  // 普通调用方完全不传。
  webhookSender?: WebhookSender;
  mockMode?: boolean;
  now?: Date;
};

export async function notify<E extends NotificationEvent>(
  event: E,
  payload: NotificationPayloadFor<E>,
  opts: NotifyOptions = {},
): Promise<void> {
  try {
    const mock = opts.mockMode ?? isMockMode();
    const sender: WebhookSender =
      opts.webhookSender ?? (mock ? mockWebhookSender : sendWebhook);
    const now = opts.now ?? new Date();

    const rule = await db.notificationRule.findUnique({
      where: { eventType: event },
      select: {
        eventType: true,
        channelIds: true,
        messageTemplate: true,
        isActive: true,
      },
    });
    if (!rule || !rule.isActive) {
      // 没规则 / 关闭了：不写 log。"事件根本没配置"是一种正常状态——
      // 比如 STOCK_ALERT 在本波 P1 #2 是&ldquo;接口在但没配规则&rdquo;。
      return;
    }
    if (rule.channelIds.length === 0) {
      // 配了规则但没绑 channel：等同&ldquo;开了 active 却没收件人&rdquo;。
      // 没法写 NotificationLog（channelId 是 FK 必填），只能打
      // console 让 ops 看到。Slice B 的 admin UI 会在 isActive=true
      // && channelIds=[] 时拒绝保存，杜绝这条路径。
      console.warn(
        `[notify] rule active but channelIds empty event=${event}`,
      );
      return;
    }

    // 渲染一次，所有 channel 共用同一份 content（同事件就是同消息）。
    const content = renderTemplate(rule.messageTemplate, payload);

    // **去重 + 保序**：rule.channelIds 可能含重复 id（schema String[]
    // 不强制 unique）。先 dedupe 出 unique 列表，
    // 后续 stale 比较和 reorder 都基于这条（避免 round 118 medium：
    // 用 raw rule.channelIds.length 做 stale 比较会把&ldquo;有重复&rdquo;误报成
    // &ldquo;有 stale id&rdquo;）。
    const uniqueRuleChannelIds = Array.from(new Set(rule.channelIds));

    // 拉到所有引用的 channel——**不**过滤 isActive。下面分流：active
    // 真发送，inactive 写 FAILED log（避免&ldquo;启用 channel 又被关&rdquo;的
    // 静默漏推）。
    const fetched = await db.notificationChannel.findMany({
      where: { id: { in: uniqueRuleChannelIds } },
      select: { id: true, webhookUrl: true, isActive: true },
    });
    // **PG `IN (...)` 不保证返回顺序**——必须按 uniqueRuleChannelIds 顺
    // 序重排。否则 CS_PERIOD_* runtime cap 的
    // slice(0, 1) 会随机选 channel：legacy `['owner-group', 'sales-
    // group']` 可能把客服金额发到 sales-group 而漏 owner-group。
    const byId = new Map(fetched.map((c) => [c.id, c]));
    const channels = uniqueRuleChannelIds
      .map((id) => byId.get(id))
      .filter((c): c is NonNullable<typeof c> => c !== undefined);
    if (channels.length === 0) {
      // channelIds 全是 stale ID（指向已删 channel）。FK 不让我们
      // 写 NotificationLog，只能打 console。Slice B 的 channel 删
      // 除会拒绝&ldquo;有 active rule 引用&rdquo;的 channel，杜绝此路径。
      console.warn(
        `[notify] rule active but all channelIds stale event=${event}`,
      );
      return;
    }
    if (channels.length < uniqueRuleChannelIds.length) {
      // 部分 unique ID stale（其他还能用）—— 打 console 提示。
      // 用 unique 而非 raw rule.channelIds 比较，避免重复 id 误报。
      console.warn(
        `[notify] some channelIds stale event=${event} have=${channels.length} expected=${uniqueRuleChannelIds.length}`,
      );
    }

    // **Runtime privacy cap for CS_PERIOD_***：
    // updateRuleWithGuard 是写时校验，对升级前已存在的多 channel 行
    // 无效。这里 send-side cap 兜底——CS_PERIOD_* 含具体客服业绩 /
    // 提成数据，绑多 channel 会让所有群看到所有客服金额。运行时 slice
    // 到 PRIVATE_EVENT_MAX_CHANNELS 并 console.warn，让 ops 知道有
    // legacy 配置该 owner 手动清理（schema 加 per-user 路由前的兜底）。
    let effectiveChannels = channels;
    if (
      isPrivatePerCsEvent(event) &&
      effectiveChannels.length > PRIVATE_EVENT_MAX_CHANNELS
    ) {
      console.warn(
        `[notify] CS_PERIOD privacy cap event=${event} configured=${effectiveChannels.length} sending_to=${PRIVATE_EVENT_MAX_CHANNELS} (legacy config; owner please trim in /owner/notifications)`,
      );
      effectiveChannels = effectiveChannels.slice(
        0,
        PRIVATE_EVENT_MAX_CHANNELS,
      );
    }

    // payload.orderId / outsourceId / periodId 任一存在就关联到日志，
    // 让 dashboard 后期能 join 反查。仅 Order 是被 schema 显式索引的
    // (relatedOrderId)；其他 fk 暂留 null（schema 没建对应列）。
    const relatedOrderId = extractOrderId(payload);

    // 顺序处理（不并行）：单 server action 触发 1-2 channel 不并行无
    // 影响；并行会让 NotificationLog 写入顺序乱，dashboard 显示&ldquo;时
    // 间倒置&rdquo;。
    for (const channel of effectiveChannels) {
      let result;
      if (!channel.isActive) {
        // Inactive channel：不发 webhook，但**仍写 FAILED log** —
        // 否则 owner 关掉 channel 后会以为推送&ldquo;成功&rdquo;了（其实没发）。
        // NotificationLog 是 single source of truth，必须留证据。
        result = {
          ok: false as const,
          retries: 0,
          errorMessage: 'channel inactive',
        };
      } else {
        try {
          result = await sender(channel.webhookUrl, content);
        } catch (err) {
          // sender 不应抛（webhook.ts 内部已 catch），但留兜底
          result = {
            ok: false as const,
            retries: 0,
            errorMessage: err instanceof Error ? err.name : 'sender error',
          };
        }
      }
      const status = result.ok
        ? NotificationStatus.SUCCESS
        : NotificationStatus.FAILED;
      // mock-mode 成功时打 'MOCK' 标记，让 owner 在 log 列表能区分
      // "真送出" 和 "测试 / 开发期"。
      const errorMessage = result.ok
        ? mock
          ? MOCK_ERROR_MESSAGE
          : null
        : (result.errorMessage ?? 'unknown error');
      // best-effort log write —— 写入失败不抛
      try {
        await db.notificationLog.create({
          data: {
            eventType: event,
            channelId: channel.id,
            messageContent: content,
            status,
            errorMessage,
            retryCount: result.retries,
            relatedOrderId,
            sentAt: result.ok ? now : null,
          },
        });
      } catch {
        // log 写入失败不能再抛（业务已成功）。落到 console.error 让
        // ops 能从 stdout 抓到。
        console.error(
          `[notify] failed to write NotificationLog event=${event} channel=${channel.id}`,
        );
      }
    }
  } catch (err) {
    // 顶层兜底：连 db.notificationRule.findUnique 都炸（连接断开 / schema
    // drift）的极端情况。业务已 commit，吞异常并打 console。
    console.error(
      `[notify] uncaught error event=${event}:`,
      err instanceof Error ? err.name : err,
    );
  }
}

// payload.orderId 提取 —— TS 类型已经约束 ORDER_* 事件必有 orderId，
// 但 OUTSOURCE_OVERDUE / CS_PERIOD_* / DAILY_WORKER_SALARY 没有。
// 用 unknown 类型保护读出。
function extractOrderId(payload: unknown): string | null {
  if (typeof payload !== 'object' || payload === null) return null;
  const v = (payload as Record<string, unknown>).orderId;
  return typeof v === 'string' ? v : null;
}
