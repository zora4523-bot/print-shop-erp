import { after } from 'next/server';
import {
  sanitizeNotificationPayload,
  type NotificationEvent,
  type NotificationPayloadFor,
} from './events';
import { notify } from './notify';
import { backgroundJobsMode } from '../background-jobs/mode';

// `dispatchNotification` 是 5 个状态机 wire 点的标准入口（CLAUDE.md
// §7.1 公开 API 仍是 `notify`，wire 内部走这里）。
//
// 生产 durable 模式只在请求内将事件写入 PostgreSQL 任务账本；
// webhook 重试由 LIGHT worker 执行，因此响应不被外部 HTTP 阻塞，
// PM2 reload 也不会丢掉已入队任务。dev/test 的 inline 模式仍使用
// Next 16 `after()`，以保持本地开发无需额外 worker。
//
// inline 模式的失败模式：
//   - 在 Server Action / Route Handler 里调用 → after() 走 Next 管理；
//     notify 在响应后跑，SIGTERM 时 runtime 会等。
//   - 在 vitest / 一次性脚本里调 → 没有 Next request scope，after()
//     抛&ldquo;outside request scope&rdquo;错误。catch 这一类后降级成 `void
//     notify(...)`，让单测的 spy 仍能记录调用、走到 mock 路径。
//   - **任何其他**错误（Next runtime broken / after() 实现挂了 / 未来
//     api 变 throws 别的）→ console.warn 留 ops 信号再降级。否则
//     after()-without-after 静默回到&ldquo;SIGTERM 丢推送&rdquo;的状态，本文件
//     存在的意义就被绕开了。
//
// 识别 expected error：Next 抛的 message 含 `request scope`（Next 16
// 的实现在 src/server/after/after.ts，错误消息&ldquo;cannot be called
// outside of a request&rdquo; / 类似变体）。这里用 substring 而不是 instanceof
// 因为 Next 不导出错误类。版本漂移时最坏情况 = console.warn 上多一
// 条 noise，不会让 wire 失效。

const EXPECTED_NO_SCOPE_PATTERNS = [
  'request scope',
  'request store',
  'outside of a request',
];

function isExpectedNoScope(err: unknown): boolean {
  if (!(err instanceof Error)) return false;
  const msg = err.message.toLowerCase();
  return EXPECTED_NO_SCOPE_PATTERNS.some((p) => msg.includes(p));
}

export async function dispatchNotification<E extends NotificationEvent>(
  event: E,
  payload: NotificationPayloadFor<E>,
  // spreadIndex：批量扇出时传循环下标，durable 模式据此把 availableAt 摊开，
  // 避免整批同时打向企业微信被限流（见 background-jobs/notification.ts 的
  // FANOUT_SPACING_MS）。inline 模式忽略它 —— dev/test 本来就不真发。
  options: { dedupeKey?: string; spreadIndex?: number } = {},
): Promise<void> {
  const safePayload = sanitizeNotificationPayload(event, payload);
  if (backgroundJobsMode() === 'durable') {
    // Lazy import keeps the inline test/dev path free of lib/db side effects.
    // It also avoids loading Prisma into a process that only exercises the
    // pure notification renderer.
    const { enqueueNotificationJob } = await import(
      '../background-jobs/notification'
    );
    // Never fall back to inline delivery here. An enqueue response can be lost
    // after PostgreSQL committed; inline fallback would then send once while
    // the worker sends the already-created job again. Propagate the error so
    // callers and durable parent jobs can retry the stable dedupe key.
    await enqueueNotificationJob(event, safePayload, options);
    return;
  }

  try {
    after(() => notify(event, safePayload));
  } catch (err) {
    if (!isExpectedNoScope(err)) {
      // 非预期错误——可能是 Next runtime 故障或 api 变更。打 console
      // 让 ops 看到，再降级到 void。降级后 SIGTERM 风险回归，但至少
      // wire 还能 deliver；ops 收到信号能立刻查 Next 版本。
      console.warn(
        `[dispatchNotification] after() failed unexpectedly: ${
          err instanceof Error ? `${err.name}: ${err.message}` : String(err)
        } — falling back to void notify()`,
      );
    }
    // No request scope (unit test / CLI script) OR unexpected failure
    // → fire-and-forget。notify 永不抛（best-effort 顶层 catch），
    // 这条 void promise 不会在 unhandled rejection 里冒头。
    void notify(event, safePayload);
  }
}
