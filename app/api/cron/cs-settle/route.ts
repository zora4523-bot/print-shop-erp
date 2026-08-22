import { NextResponse } from 'next/server';
import { BACKGROUND_JOB_TYPES } from '@/lib/background-jobs/types';
import { enqueueCronJob } from '@/lib/background-jobs/cron';
import { backgroundJobsMode } from '@/lib/background-jobs/mode';
import { requireCronAuth } from '@/lib/cron-auth';
import { shanghaiCalendarDate } from '@/lib/cron/schedule';
import { runCsSettleTask } from '@/lib/cron/tasks';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(req: Request) {
  const denied = requireCronAuth(req);
  if (denied) return denied;

  if (backgroundJobsMode() === 'durable') {
    const runDate = shanghaiCalendarDate();
    const queued = await enqueueCronJob({
      type: BACKGROUND_JOB_TYPES.CRON_CS_SETTLE,
      scope: runDate,
      payload: { runDate },
    });
    return NextResponse.json(
      { status: 'queued', runDate, ...queued },
      { status: 202 },
    );
  }

  try {
    return NextResponse.json(await runCsSettleTask());
  } catch {
    return NextResponse.json(
      {
        status: 'error',
        message: '批处理失败；查看 owner /owner/salary/cs 页面确认',
      },
      { status: 500 },
    );
  }
}
