import { NextResponse } from 'next/server';
import { BACKGROUND_JOB_TYPES } from '@/lib/background-jobs/types';
import { enqueueCronJob } from '@/lib/background-jobs/cron';
import { backgroundJobsMode } from '@/lib/background-jobs/mode';
import { requireCronAuth } from '@/lib/cron-auth';
import { isStrictYmd, yesterdayShanghai } from '@/lib/cron/schedule';
import { runDailySalaryTask } from '@/lib/cron/tasks';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(req: Request) {
  const denied = requireCronAuth(req);
  if (denied) return denied;

  const body = await readJsonBody(req);
  const date = extractString(body, 'date') ?? yesterdayShanghai();
  if (!isStrictYmd(date)) {
    return NextResponse.json({ error: `invalid date: ${date}` }, { status: 400 });
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
