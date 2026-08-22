import { db } from '../db';
import { NotificationStatus } from '../../generated/prisma/enums';
import {
  PRIVATE_EVENT_MAX_CHANNELS,
  isPrivatePerCsEvent,
  type NotificationEvent,
  type NotificationPayloadFor,
} from './events';
import { renderTemplate } from './render';
import {
  mockWebhookSender,
  sendWebhook,
  type WebhookResult,
  type WebhookSender,
} from './webhook';

// notify(event, payload) 是企业微信推送的**唯一公开入口**（CLAUDE.md
// §7.1）。永不抛（DECISIONS 2026-04-27 best-effort）：业务事务已 commit，
// 推送是后续观察；任何失败转写到 NotificationLog，并在返回的 NotifyOutcome
// 上标出「值不值得重试」——真正抛异常触发 durable 重试的是
// handleNotificationJob，不是这里（见 NotifyOutcome 上的长注释）。
//
// 流程：
//   1. 查 active rule by eventType；不存在 → 早 return（不写 log）
//   2. 渲染 messageTemplate（render.ts 留缺失 placeholder 原样）
//   3. 传了 deliveryKey 时先查出这次投递已经推成功的 channel，跳过它们
//   4. 对 rule.channelIds 里每个 active channel：发送 webhook → 写 log
//      （有 deliveryKey 走 upsert 就地翻状态，没有则 create 新行）
//   5. 顶层 try/catch 兜底：连 DB 查 rule 都炸的极端场景 → console.error
//      + outcome.retryable=true
//
// 日志状态：成功 SUCCESS；还有重试机会的瞬时失败 RETRYING；永久失败与
// 最后一次 attempt 的失败 FAILED（owner 首页的 24h 失败告警条只数 FAILED，
// 所以瞬时抖动不会误报，重试成功也会把那一行翻回 SUCCESS）。
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

  // ↓ 以下两项只有 durable job 路径传（handleNotificationJob），
  //   同步调用点（dispatch 的 after() / void 降级）一律不传。

  // deliveryKey = BackgroundJob.dedupeKey：一次逻辑投递在多次 attempt
  // 之间的稳定标识。传了才启用幂等语义：
  //   - 开跑前查 (deliveryKey, status=SUCCESS) 已成功的 channel → 跳过
  //   - 写 log 走 upsert(deliveryKey, channelId) → 同一行就地翻转状态
  // 不传时行为与本次改动前逐字一致（每次 create 新行、不跳过）。
  deliveryKey?: string;

  // 本次是不是 job 的最后一次 attempt。最后一次之后不会再有重试，失败
  // 必须落 FAILED（countRecentFailures 的 24h 告警条只认 FAILED）；之前
  // 的可重试失败落 RETRYING，免得一次瞬时 5xx 把告警条点红、重试成功了
  // 还挂在那儿。
  finalAttempt?: boolean;
};

// 投递结论。notify 本身仍然**永不抛**（DECISIONS 2026-04-27 的 best-effort
// 契约不变，所有同步调用点因此不受影响）——「要不要重试」的决定权上交给
// handleNotificationJob，由它抛异常让 BackgroundJob 走 durable 重试
// （CLAUDE.md §15.4）。这里不抛的理由是硬的：dispatch.ts 有 `void notify()`，
// notify 一旦会抛，Node 24 默认 unhandled-rejections=throw 会把 web 进程打崩。
export type NotifyOutcome = {
  event: string;
  attempted: number; // 本次真发了 webhook 的 channel 数
  delivered: number; // 本次发送成功
  skipped: number; // 之前的 attempt 已成功、本次跳过（幂等去重）
  failed: number; // 本次失败（含 channel inactive）
  retryable: boolean; // 存在值得由 durable job 再试一轮的失败
  unlogged: number; // 送达了但 NotificationLog 没写进去（幂等凭证缺失）
  errorCodes: string[]; // 去重后的脱敏错误码，进 job result 给 ops 看
};

function emptyOutcome(event: string): NotifyOutcome {
  return {
    event,
    attempted: 0,
    delivered: 0,
    skipped: 0,
    failed: 0,
    retryable: false,
    unlogged: 0,
    errorCodes: [],
  };
}

function recordErrorCode(outcome: NotifyOutcome, code: string): void {
  if (!outcome.errorCodes.includes(code)) outcome.errorCodes.push(code);
}

export async function notify<E extends NotificationEvent>(
  event: E,
  payload: NotificationPayloadFor<E>,
  opts: NotifyOptions = {},
): Promise<NotifyOutcome> {
  const outcome = emptyOutcome(event);
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
      return outcome;
    }
    if (rule.channelIds.length === 0) {
      // 配了规则但没绑 channel：等同&ldquo;开了 active 却没收件人&rdquo;。
      // 没法写 NotificationLog（channelId 是 FK 必填），只能打
      // console 让 ops 看到。Slice B 的 admin UI 会在 isActive=true
      // && channelIds=[] 时拒绝保存，杜绝这条路径。
      console.warn(
        `[notify] rule active but channelIds empty event=${event}`,
      );
      // 配置问题，重试一万次也还是没有收件人 → retryable 保持 false。
      return outcome;
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
      // 同上：指向已删 channel 是配置问题，不该占用 job 的 attempts。
      return outcome;
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

    // **部分成功的解法**：fan-out 是多 channel 循环，3 个群里第 2 个失败就
    // 整体重抛的话，重试会把第 1 个群再打扰一遍。这里用 NotificationLog
    // 当现成的进度账本 —— (deliveryKey, channelId) 唯一索引让它既能查
    // 「谁已经成功」，又能就地更新，不需要另开一张表。这就是 §15.4 说的
    // 「携带部分进度」，而且是持久化的：worker 重启、换机器都不丢。
    //
    // 这条查询自己炸掉 → 落到顶层 catch → outcome.retryable=true → job 重试，
    // 不会在「不知道谁成功过」的情况下盲发。
    const deliveryKey = opts.deliveryKey;
    const deliveredChannelIds = new Set<string>();
    if (deliveryKey) {
      const alreadyDelivered = await db.notificationLog.findMany({
        where: { deliveryKey, status: NotificationStatus.SUCCESS },
        select: { channelId: true },
      });
      for (const row of alreadyDelivered) {
        deliveredChannelIds.add(row.channelId);
      }
    }

    // 顺序处理（不并行）：单 server action 触发 1-2 channel 不并行无
    // 影响；并行会让 NotificationLog 写入顺序乱，dashboard 显示&ldquo;时
    // 间倒置&rdquo;。
    for (const channel of effectiveChannels) {
      if (deliveredChannelIds.has(channel.id)) {
        // 上一次 attempt 已经把这个群推成功了（NotificationLog 是唯一凭证）。
        // 重试只补没送到的 channel，绝不重复打扰已经收到消息的群。
        outcome.skipped += 1;
        continue;
      }

      let result: WebhookResult;
      if (!channel.isActive) {
        // Inactive channel：不发 webhook，但**仍写 FAILED log** —
        // 否则 owner 关掉 channel 后会以为推送&ldquo;成功&rdquo;了（其实没发）。
        // NotificationLog 是 single source of truth，必须留证据。
        // retryable=false：群被关掉是配置问题，重试 5 次它还是关着，只会
        // 白耗 attempts 把 job 拖成 DEAD、污染死信告警。
        result = {
          ok: false,
          retries: 0,
          errorMessage: 'channel inactive',
          retryable: false,
        };
      } else {
        outcome.attempted += 1;
        try {
          result = await sender(channel.webhookUrl, content);
        } catch (err) {
          // sender 不应抛（webhook.ts 内部已 catch），但留兜底。未知异常按
          // 可重试处理：真是偶发就自愈，真是代码 bug 就会稳定走到 DEAD ——
          // 那是个响亮且可查的信号，好过静默标成功。
          result = {
            ok: false,
            retries: 0,
            errorMessage: err instanceof Error ? err.name : 'sender error',
            retryable: true,
          };
        }
      }

      const retryable = !result.ok && result.retryable === true;
      // 还有 attempt 可用的可重试失败 → RETRYING，别去点亮 owner 的 24h
      // 失败告警条（countRecentFailures 只数 FAILED）。最后一次 attempt、
      // 永久性失败、以及没有 deliveryKey 的同步路径（没人会再重试）→ FAILED。
      const status = result.ok
        ? NotificationStatus.SUCCESS
        : retryable && deliveryKey && !opts.finalAttempt
          ? NotificationStatus.RETRYING
          : NotificationStatus.FAILED;
      if (result.ok) {
        outcome.delivered += 1;
      } else {
        outcome.failed += 1;
        if (retryable) outcome.retryable = true;
        recordErrorCode(outcome, result.errorMessage ?? 'unknown error');
      }
      // mock-mode 成功时打 'MOCK' 标记，让 owner 在 log 列表能区分
      // "真送出" 和 "测试 / 开发期"。
      const errorMessage = result.ok
        ? mock
          ? MOCK_ERROR_MESSAGE
          : null
        : (result.errorMessage ?? 'unknown error');
      const logData = {
        eventType: event,
        channelId: channel.id,
        messageContent: content,
        status,
        errorMessage,
        retryCount: result.retries,
        relatedOrderId,
        sentAt: result.ok ? now : null,
      };
      // best-effort log write —— 写入失败不抛
      try {
        if (deliveryKey) {
          // 同一 (deliveryKey, channelId) 复用同一行：重试时 RETRYING /
          // FAILED 就地翻成 SUCCESS，owner 的 24h 失败告警条会自愈，不会
          // 因为「重试前留了一行 FAILED」一直挂红。
          await db.notificationLog.upsert({
            where: {
              deliveryKey_channelId: { deliveryKey, channelId: channel.id },
            },
            create: { ...logData, deliveryKey },
            update: {
              messageContent: logData.messageContent,
              status: logData.status,
              errorMessage: logData.errorMessage,
              // 这里只记「最后一次 attempt 的进程内重试次数」，不跨 attempt
              // 累加 —— 跨 attempt 的历史在 BackgroundJobAttempt 里，累加会
              // 让 owner 看到的「重试 N 次」和 webhook 语义脱节。
              retryCount: logData.retryCount,
              relatedOrderId: logData.relatedOrderId,
              sentAt: logData.sentAt,
            },
          });
        } else {
          await db.notificationLog.create({ data: logData });
        }
      } catch {
        // log 写入失败不能再抛（业务已成功）。落到 console.error 让
        // ops 能从 stdout 抓到。
        console.error(
          `[notify] failed to write NotificationLog event=${event} channel=${channel.id}`,
        );
        // 送达了却没留下凭证 = 下一次 attempt 认不出这个 channel 已经成功，
        // 会重复推一条。计数上报到 job result，让 ops 能把「群里看到两条」
        // 对上号。这是本方案 at-least-once 的已知边界。
        if (result.ok) outcome.unlogged += 1;
      }
    }
    return outcome;
  } catch (err) {
    // 顶层兜底：连 db.notificationRule.findUnique 都炸（连接断开 / schema
    // drift）的极端情况。业务已 commit，吞异常并打 console —— 公开契约仍是
    // 永不抛（同步调用点靠这条契约活着）。
    console.error(
      `[notify] uncaught error event=${event}:`,
      err instanceof Error ? err.name : err,
    );
    // 但**要**把它标成可重试：这类是基础设施故障，一条都没发出去，durable
    // job 该再来一次。同步调用点忽略返回值，行为不变。
    outcome.retryable = true;
    recordErrorCode(outcome, err instanceof Error ? err.name : 'UnknownError');
    return outcome;
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
