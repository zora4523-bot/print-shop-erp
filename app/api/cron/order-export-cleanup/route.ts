import { NextResponse } from 'next/server';
import { enqueueCronJob } from '@/lib/background-jobs/cron';
import { backgroundJobsMode } from '@/lib/background-jobs/mode';
import { BACKGROUND_JOB_TYPES } from '@/lib/background-jobs/types';
import { requireCronAuth } from '@/lib/cron-auth';
import { shanghaiCalendarDate } from '@/lib/cron/schedule';
import { runOrderExportCleanupTask } from '@/lib/cron/tasks';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(req: Request) {
  const denied = requireCronAuth(req);
  if (denied) return denied;
  const runDate = shanghaiCalendarDate();

  if (backgroundJobsMode() === 'durable') {
    const queued = await enqueueCronJob({
      type: BACKGROUND_JOB_TYPES.CRON_ORDER_EXPORT_CLEANUP,
      scope: runDate,
      payload: { runDate },
    });
    return NextResponse.json(
      { status: 'queued', runDate, ...queued },
      { status: 202 },
    );
  }

  try {
    return NextResponse.json(await runOrderExportCleanupTask(runDate));
  } catch {
    return NextResponse.json(
      {
        status: 'error',
        runDate,
        message: '导出产物清理失败；查看后台任务页确认',
      },
      { status: 500 },
    );
  }
}
