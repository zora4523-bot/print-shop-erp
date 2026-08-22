import type { Prisma } from '../../generated/prisma/client';
import { db } from '../db';

/** 能跑 raw query 的任意 client：连接池本身，或一个已打开的事务。 */
export type ClockClient = Pick<Prisma.TransactionClient, '$queryRaw'>;

/**
 * 后台任务所有时间戳的唯一来源。
 *
 * 租约靠比较 `heartbeatAt` / `lockedAt` / `availableAt` 与一个截止点来判定。
 * 一旦部署到第二台机器，这个比较的两侧就由不同 Node 进程写入和读取；只要
 * 时钟偏差超过一个租约（默认 5 分钟），快的那台就会把活着的 worker 判成
 * 僵尸并重新 claim 同一个 job —— 同一份导出 / 同一条通知被执行两次。
 * 数据库是它们唯一共享的时钟。
 *
 * `now()` 即 `transaction_timestamp()`：整个事务内固定不变。传入一个已打开
 * 的 `tx`，事务里写下的每一行就都盖同一个瞬间的戳。事务外它退化成该语句
 * 自己的瞬间，正是一次性读取想要的语义。
 */
export async function databaseNow(client: ClockClient = db): Promise<Date> {
  const rows = await client.$queryRaw<Array<{ now: Date }>>`SELECT now() AS "now"`;
  const at = rows[0]?.now;
  // 绝不 fallback 到 new Date()：静默回落到 Node 时钟就是本模块要防的那个 bug。
  if (!(at instanceof Date)) {
    throw new Error('background jobs: database clock unavailable');
  }
  return at;
}
