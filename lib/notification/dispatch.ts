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
//     抛 `Error: after() may only be called within a Server Component,
//     Server Action, Route Handler, or Middleware`。catch 后降级成
//     `void notify(...)`，让单测的 spy 仍能记录调用、走到 mock 路径。

export function dispatchNotification<E extends NotificationEvent>(
  event: E,
  payload: NotificationPayloadFor<E>,
): void {
  try {
    after(() => notify(event, payload));
  } catch {
    // No request scope (unit test / CLI script) → fall back to fire-
    // and-forget. notify 永不抛（best-effort 顶层 catch），所以这条
    // void promise 不会在 unhandled rejection 里冒头。
    void notify(event, payload);
  }
}
