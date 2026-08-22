import type { Prisma } from '../../generated/prisma/client';

// 「任务成功了，但一条也没送出去」是通知路径刻意保留的一种终局：永久性
// 投递失败（群被关停 / webhook key 失效 / 内容被拒）重试多少次结果都一样，
// 抛异常只会白耗 attempts 把死信队列灌满 ops 无法处置的行，所以
// handleNotificationJob 让 job 正常 SUCCEEDED，把证据写进 result。
//
// 代价是 ops 页会看到一行绿色的 SUCCEEDED —— completeBackgroundJob 在成功
// 路径显式把 lastErrorCode 置 null，错误码列就是个 '—'。这个函数把 result
// 里的 failed / errorCodes 提上来，补回那条腿：/owner/background-jobs 的
// 错误码列优先显示 lastErrorCode，没有就显示这里的摘要。
//
// 纯函数、只读 JSON，不碰 Prisma 运行时（type-only import）。

const MAX_CODES = 3;
const MAX_LENGTH = 80;

export function backgroundJobFailureSummary(job: {
  lastErrorCode: string | null;
  result?: Prisma.JsonValue | null;
}): string | null {
  if (job.lastErrorCode) return job.lastErrorCode;
  const failed = readFailedCount(job.result);
  if (failed <= 0) return null;
  const codes = readErrorCodes(job.result);
  if (codes.length === 0) return `failed=${failed}`;
  const shown = codes.slice(0, MAX_CODES).join(', ');
  const suffix = codes.length > MAX_CODES ? '…' : '';
  return truncate(`failed=${failed} (${shown}${suffix})`);
}

function readFailedCount(result: Prisma.JsonValue | null | undefined): number {
  if (!result || typeof result !== 'object' || Array.isArray(result)) return 0;
  const raw = (result as Record<string, Prisma.JsonValue>).failed;
  return typeof raw === 'number' && Number.isFinite(raw) ? raw : 0;
}

function readErrorCodes(result: Prisma.JsonValue | null | undefined): string[] {
  if (!result || typeof result !== 'object' || Array.isArray(result)) return [];
  const raw = (result as Record<string, Prisma.JsonValue>).errorCodes;
  if (!Array.isArray(raw)) return [];
  return raw.filter((code): code is string => typeof code === 'string');
}

function truncate(text: string): string {
  return text.length <= MAX_LENGTH ? text : `${text.slice(0, MAX_LENGTH - 1)}…`;
}
