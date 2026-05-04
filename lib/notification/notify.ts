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
      // 配了但没绑 channel：等同关闭，不写 log。
      return;
    }

    // 渲染一次，所有 channel 共用同一份 content（同事件就是同消息）。
    const content = renderTemplate(rule.messageTemplate, payload);

    // 拉到所有引用的 channel 一起；过滤 inactive。
    const channels = await db.notificationChannel.findMany({
      where: {
        id: { in: rule.channelIds },
        isActive: true,
      },
      select: { id: true, webhookUrl: true },
    });
    if (channels.length === 0) return;

    // payload.orderId / outsourceId / periodId 任一存在就关联到日志，
    // 让 dashboard 后期能 join 反查。仅 Order 是被 schema 显式索引的
    // (relatedOrderId)；其他 fk 暂留 null（schema 没建对应列）。
    const relatedOrderId = extractOrderId(payload);

    // 顺序发送（不并行）：单 server action 触发 1-2 channel 不并行无影响；
    // 并行会让 NotificationLog 写入顺序乱，dashboard 显示&ldquo;时间倒置&rdquo;。
    for (const channel of channels) {
      let result;
      try {
        result = await sender(channel.webhookUrl, content);
      } catch (err) {
        // sender 不应抛（webhook.ts 内部已 catch），但留兜底
        result = {
          ok: false,
          retries: 0,
          errorMessage: err instanceof Error ? err.name : 'sender error',
        };
      }
      const status = result.ok
        ? NotificationStatus.SUCCESS
        : NotificationStatus.FAILED;
      // mock-mode 成功时打 'MOCK' 标记，让 owner 在 log 列表能区分
      // "真送出" 和 "测试 / 开发期"。
      const errorMessage =
        mock && result.ok
          ? MOCK_ERROR_MESSAGE
          : result.ok
            ? null
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
