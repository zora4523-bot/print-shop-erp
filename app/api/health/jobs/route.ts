import { NextResponse } from 'next/server';
import {
  assessBackgroundJobHealth,
  classifyBackgroundJobAlerts,
  getBackgroundJobHealth,
  summarizeSmartBotConnection,
  summarizeSmartBotOperationalHealth,
  smartBotRecoveryWaitMs,
} from '@/lib/background-jobs/health';
import { backgroundJobsMode } from '@/lib/background-jobs/mode';
import { configuredSmartBotIdDigest } from '@/lib/notification/smart-bot-identity';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// 后台任务队列探针 —— 与 /api/health/ready 刻意分开的第二个端点。
//
// 为什么不合并进 ready：ready 回答的是「这个实例能不能接流量」。
// deploy/update.sh 第 9 步用 `curl -fsS` 判定发布成败，失败会让 Web 与
// 两个 worker 保持停止并禁止回滚；scripts/deploy-smoke.mjs 硬要求 200；
// docs/production-slo-and-recovery.md 还把 ready 当 Web 可用性 SLO 的
// 采样点。死信和卡死的 RUNNING 说明「队列坏了」，不说明「网页坏了」——
// 让它们把 ready 打成 503，就是用一条昨天失败的月结任务掐掉今天的发布，
// 并把队列故障计进 Web 可用性。
//
//   200 {status:'ok'}       → 队列健康
//   200 {status:'degraded'} → 只有会自愈的积压，或只有通知类死信
//   503 {status:'alert'}    → 必须有人处理：非通知类死信 / 卡死 RUNNING /
//                             worker 心跳异常 / 智能机器人配置、身份或连接故障
//   503 {status:'error', db:'down'} → 库不通
//
// 通知类死信刻意只降级不报警：企业微信中断一次就能一口气产出上百条
// （runOrderOverdueTask 单次上限 200），让它把这个端点钉在 503 上 24 小时，
// 等于用一次第三方抖动掩盖掉当天真正的结算死信。计数仍然回出
// （deadNotificationLast24h），处置渠道是 /owner/notifications。
//
// 匿名（proxy.ts 的 matcher 排除了 api/health），因此只回计数与告警码，
// 不回 worker 明细、任务 id、类型或错误信息。
//
// 用法：外部监控每分钟 `curl -fsS https://host/api/health/jobs`
export async function GET(): Promise<Response> {
  const version = process.env.APP_VERSION ?? 'dev';
  const fallbackTime = new Date().toISOString();
  const mode = backgroundJobsMode();

  try {
    const health = await getBackgroundJobHealth();
    const expectedBotDigest = configuredSmartBotIdDigest();
    const assessment = assessBackgroundJobHealth(health, {
      requireWorkers: mode === 'durable',
      expectedVersion: version,
      expectedSmartBotDigest: expectedBotDigest,
    });
    const report = classifyBackgroundJobAlerts(assessment.warnings);
    const smartBot = summarizeSmartBotConnection(health, {
      expectedVersion: version,
    });
    const smartBotOperational = summarizeSmartBotOperationalHealth(health, {
      expectedVersion: version,
      expectedBotDigest,
    });

    return NextResponse.json(
      {
        status: report.level,
        time: health.observedAt.toISOString(),
        mode,
        jobs: {
          pending: health.pending,
          running: health.running,
          staleRunning: health.staleRunning,
          deadLast24h: health.deadLast24h,
          deadNotificationLast24h: health.deadNotificationLast24h,
        },
        smartBot: {
          status: smartBot.status,
          required: smartBotOperational.required,
          configurationValid: smartBotOperational.configurationValid,
          identityMatch: smartBotOperational.identityMatch,
          operational: smartBotOperational.operational,
          recoveryWaitMs: smartBotRecoveryWaitMs(health),
        },
        alerts: report.alerts,
        warnings: report.warnings,
      },
      { status: report.level === 'alert' ? 503 : 200 },
    );
  } catch {
    return NextResponse.json(
      { status: 'error', db: 'down', time: fallbackTime },
      { status: 503 },
    );
  }
}
