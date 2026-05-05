import { after } from 'next/server';
import {
  type NotificationEvent,
  type NotificationPayloadFor,
} from './events';
import { notify } from './notify';

// `dispatchNotification` 是 5 个状态机 wire 点的标准入口（CLAUDE.md
// §7.1 公开 API 仍是 `notify`，wire 内部走这里）。
//
// 设计目标：
//   1. **不阻塞 Server Action** —— webhook.ts 最差 ~16s/channel 的
//      retry，await 会让&ldquo;工单已提交&rdquo;在用户屏幕上挂半分钟。
//   2. **不被 SIGTERM 静默吞掉** —— `void notify(...)` 是裸 fire-and-
//      forget；pm2 reload / Vercel serverless freeze 都会把进行中的
//      promise 一起切掉，连同 NotificationLog 一起丢（Codex round 110
//      P1）。Next 16 的 `after()` 是&ldquo;响应已发出但请求 scope 还
//      managed&rdquo;的官方机制——runtime 会等它跑完才允许进程退出。
//
// 失败模式：
//   - 在 Server Action / Route Handler 里调用 → after() 走 Next 管理；
//     notify 在响应后跑，SIGTERM 时 runtime 会等。
//   - 在 vitest / 一次性脚本里调 → 没有 Next request scope，after()
//     抛&ldquo;outside request scope&rdquo;错误。catch 这一类后降级成 `void
//     notify(...)`，让单测的 spy 仍能记录调用、走到 mock 路径。
//   - **任何其他**错误（Next runtime broken / after() 实现挂了 / 未来
//     api 变 throws 别的）→ console.warn 留 ops 信号再降级。否则
//     after()-without-after 静默回到&ldquo;SIGTERM 丢推送&rdquo;的状态，本文件
//     存在的意义就被绕开了（Codex round 111 medium）。
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

export function dispatchNotification<E extends NotificationEvent>(
  event: E,
  payload: NotificationPayloadFor<E>,
): void {
  try {
    after(() => notify(event, payload));
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
    void notify(event, payload);
  }
}
