import { NextResponse } from 'next/server';
import { db } from '@/lib/db';
import {
  assessBackgroundJobHealth,
  getBackgroundJobHealth,
} from '@/lib/background-jobs/health';
import { backgroundJobsMode } from '@/lib/background-jobs/mode';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// 就绪探针 —— 回答的是「这个实例能不能接流量」，不是「后台队列健不健康」。
//
// 状态码只由 assessment.available 决定（DB 通 + durable 模式下两个队列都有
// 当前版本的 worker 心跳）。死信、卡死的 RUNNING、积压年龄一律只进
// `warnings` 与 `jobs` 计数，**刻意不影响状态码**：
//   - deploy/update.sh 第 9 步 `curl -fsS` 本端点判定发布成败，此刻
//     DEPLOYMENT_QUIESCED=1，非 200 会让 Web 与两个 worker 保持停止并禁止
//     回滚。一条昨天失败的月结死信不该有这种杀伤力。
//   - scripts/deploy-smoke.mjs 硬要求 200。
//   - docs/production-slo-and-recovery.md 用本端点采样 Web 可用性 SLO。
// 队列告警走 GET /api/health/jobs（死信/卡死 RUNNING → 503）。
export async function GET(): Promise<Response> {
  const version = process.env.APP_VERSION ?? 'dev';
  const fallbackTime = new Date().toISOString();
  try {
    const [, integrityRows, jobs] = await Promise.all([
      db.$queryRaw`SELECT 1`,
      db.$queryRaw<{ mismatchCount: bigint }[]>`
        SELECT COUNT(*)::bigint AS "mismatchCount"
          FROM "Material" m
          LEFT JOIN (
            SELECT "materialId", COALESCE(SUM("currentStock"), 0) AS total
              FROM "MaterialLocationStock"
             GROUP BY "materialId"
          ) s ON s."materialId" = m.id
         WHERE m."currentStock" <> COALESCE(s.total, 0)
      `,
      getBackgroundJobHealth(),
    ]);
    const assessment = assessBackgroundJobHealth(jobs, {
      requireWorkers: backgroundJobsMode() === 'durable',
      expectedVersion: version,
    });
    const inventoryMismatchCount = Number(
      integrityRows[0]?.mismatchCount ?? 0,
    );
    const warnings = [...assessment.warnings];
    if (inventoryMismatchCount > 0) warnings.push('inventory-summary-mismatch');
    return NextResponse.json(
      {
        status:
          assessment.status === 'ok' && warnings.length > 0
            ? 'degraded'
            : assessment.status,
        db: 'ok',
        time: jobs.observedAt.toISOString(),
        inventory: {
          status: inventoryMismatchCount === 0 ? 'ok' : 'mismatch',
          mismatchCount: inventoryMismatchCount,
        },
        // 计数随 body 给出，方便监控做 body 匹配；状态码仍只看
        // assessment.available（原因见文件顶部注释）。
        jobs: {
          pending: jobs.pending,
          running: jobs.running,
          staleRunning: jobs.staleRunning,
          deadLast24h: jobs.deadLast24h,
        },
        warnings,
      },
      { status: assessment.available ? 200 : 503 },
    );
  } catch {
    return NextResponse.json(
      { status: 'error', db: 'down', time: fallbackTime },
      { status: 503 },
    );
  }
}
