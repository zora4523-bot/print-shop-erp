import { NextResponse } from 'next/server';
import { BACKGROUND_JOB_TYPES } from '@/lib/background-jobs/types';
import { databaseClockNow } from '@/lib/background-jobs/clock';
import { enqueueCronJob } from '@/lib/background-jobs/cron';
import { backgroundJobsMode } from '@/lib/background-jobs/mode';
import { requireCronAuth } from '@/lib/cron-auth';
import { isStrictYmd, yesterdayShanghai } from '@/lib/cron/schedule';
import { runDailySalaryTask } from '@/lib/cron/tasks';
import {
  isFutureShanghaiDate,
  todayShanghai,
} from '@/lib/dashboard/shanghai-clock';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(req: Request) {
  const denied = requireCronAuth(req);
  if (denied) return denied;

  const body = await readJsonBody(req);
  const requestedDate = extractString(body, 'date');
  if (requestedDate && !isStrictYmd(requestedDate)) {
    return NextResponse.json(
      { error: `invalid date: ${requestedDate}` },
      { status: 400 },
    );
  }
  const now = await databaseClockNow();
  const date = requestedDate ?? yesterdayShanghai(now);
  // 【对外契约变更】新增状态码 400 + { error: "open/future date: <date>" }，
  // 触发条件：body.date 不早于上海日历的今天。原有 202/200/401/503 的
  // 形状一律不变（CLAUDE.md §15.4：cron 响应形状是对调度器的契约）。
  // 默认参数 yesterdayShanghai() 永远不会命中这条分支，只有手工带 body 的
  // 调用会 —— 所以正常调度器完全感知不到这个新分支。
  //
  // 权威闸口是 piecework-settlement.ts 中 lockPieceworkSettlement(s)
  // 的 closed-work-date guard；这里只是提前失败，durable 模式下
  // 路由直接入队，一个开放/未来日期会变成一条
  // BackgroundJob，烧满 maxAttempts=4 次才落到 FAILED。
  if (date === todayShanghai(now)) {
    return NextResponse.json({ error: `open date: ${date}` }, { status: 400 });
  }
  if (isFutureShanghaiDate(date, now)) {
    return NextResponse.json({ error: `future date: ${date}` }, { status: 400 });
  }

  if (backgroundJobsMode() === 'durable') {
    const queued = await enqueueCronJob({
      type: BACKGROUND_JOB_TYPES.CRON_DAILY_SALARY,
      scope: date,
      payload: { date },
    });
    return NextResponse.json(
      { status: 'queued', date, ...queued },
      { status: 202 },
    );
  }

  try {
    return NextResponse.json(await runDailySalaryTask(date));
  } catch {
    return NextResponse.json(
      { status: 'error', date, message: '批处理失败；查看 owner 页面确认' },
      { status: 500 },
    );
  }
}
async function readJsonBody(req: Request): Promise<unknown> {
  try {
    return await req.json();
  } catch {
    return {};
  }
}

function extractString(body: unknown, key: string): string | null {
  if (!body || typeof body !== 'object' || !(key in body)) return null;
  const value = (body as Record<string, unknown>)[key];
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}
