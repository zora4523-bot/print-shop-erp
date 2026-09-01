import { NextResponse } from 'next/server';
import { enqueueCronJob } from '@/lib/background-jobs/cron';
import { backgroundJobsMode } from '@/lib/background-jobs/mode';
import { BACKGROUND_JOB_TYPES } from '@/lib/background-jobs/types';
import { requireCronAuth } from '@/lib/cron-auth';
import { runPendingFactoryBacklogTask } from '@/lib/cron/pending-factory-backlog';
import { shanghaiCalendarDate } from '@/lib/cron/schedule';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(req: Request) {
  const denied = requireCronAuth(req);
  if (denied) return denied;
  const runDate = shanghaiCalendarDate();

  if (backgroundJobsMode() === 'durable') {
    const queued = await enqueueCronJob({
      type: BACKGROUND_JOB_TYPES.CRON_PENDING_FACTORY_BACKLOG,
      scope: runDate,
      payload: { runDate },
    });
    return NextResponse.json(
      { status: 'queued', runDate, ...queued },
      { status: 202 },
    );
  }

  try {
    return NextResponse.json(await runPendingFactoryBacklogTask(runDate));
  } catch {
    return NextResponse.json(
      { status: 'error', message: '批处理失败；查看 owner /owner 页面确认' },
      { status: 500 },
    );
  }
}
