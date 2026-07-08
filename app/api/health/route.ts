import { NextResponse } from 'next/server';
import { db } from '@/lib/db';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// 健康检查端点 —— 供 PM2 / Nginx / 外部监控探活。
//
// 无认证（liveness 探针不应依赖登录态），middleware matcher 已排除
// `api/health`。刻意只回最小信息：DB 连通 + 版本 + 时间，不泄漏
// 连接串 / env / 内部细节。
//
//   200 {status:'ok', db:'ok'}      → 应用活着且能查库
//   503 {status:'error', db:'down'} → 应用活着但库不通（DB 挂/连不上）
//
// 用法：
//   curl -fsS https://host/api/health         # 探活，非 200 即异常
export async function GET(): Promise<Response> {
  const version = process.env.APP_VERSION ?? 'dev';
  const time = new Date().toISOString();

  try {
    // 最便宜的连通性探测；单条 SELECT 1，不碰业务表。
    await db.$queryRaw`SELECT 1`;
  } catch {
    return NextResponse.json(
      { status: 'error', db: 'down', version, time },
      { status: 503 },
    );
  }

  return NextResponse.json({ status: 'ok', db: 'ok', version, time });
}
