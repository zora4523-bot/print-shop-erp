import { NextResponse } from 'next/server';
import { BACKGROUND_JOB_TYPES } from '@/lib/background-jobs/types';
import { enqueueCronJob } from '@/lib/background-jobs/cron';
import { backgroundJobsMode } from '@/lib/background-jobs/mode';
import { requireCronAuth } from '@/lib/cron-auth';
import { isStrictYearMonth, previousShanghaiMonth } from '@/lib/cron/schedule';
import { runHourlyPayrollTask } from '@/lib/cron/tasks';
import { HourlyAggregateError } from '@/lib/salary/hourly-aggregate';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(req: Request) {
  const denied = requireCronAuth(req);
  if (denied) return denied;

  const body = await readJsonBody(req);
  const month = extractString(body, 'month') ?? previousShanghaiMonth();
  if (!isStrictYearMonth(month)) {
    return NextResponse.json({ error: `invalid month: ${month}` }, { status: 400 });
  }

  if (backgroundJobsMode() === 'durable') {
    const queued = await enqueueCronJob({
      type: BACKGROUND_JOB_TYPES.CRON_HOURLY_PAYROLL,
      scope: month,
      payload: { month },
    });
    return NextResponse.json(
      { status: 'queued', month, ...queued },
      { status: 202 },
    );
  }

  try {
    return NextResponse.json(await runHourlyPayrollTask(month));
  } catch (error) {
    if (error instanceof HourlyAggregateError) {
      return NextResponse.json(
        { status: 'error', month, message: error.message },
        { status: 500 },
      );
    }
    console.error(
      '[cron:hourly-payroll] unexpected error:',
      error instanceof Error ? error.name : 'UnknownError',
    );
    return NextResponse.json(
      {
        status: 'error',
        month,
        message: '批处理失败；查看 owner /owner/salary/hourly 页面确认',
      },
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
