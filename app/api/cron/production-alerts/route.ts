import { NextResponse } from 'next/server';
import { enqueueCronJob } from '@/lib/background-jobs/cron';
import { databaseClockNow } from '@/lib/background-jobs/clock';
import { backgroundJobsMode } from '@/lib/background-jobs/mode';
import { BACKGROUND_JOB_TYPES } from '@/lib/background-jobs/types';
import { requireCronAuth } from '@/lib/cron-auth';
import { shanghaiCalendarDate } from '@/lib/cron/schedule';
import { runProductionAlertNotificationTask } from '@/lib/notification/production-alerts';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(req: Request) {
  const denied = requireCronAuth(req);
  if (denied) return denied;
  const databaseNow = await databaseClockNow();
  const runDate = shanghaiCalendarDate(databaseNow);

  if (backgroundJobsMode() === 'durable') {
    const bucket = new Date(databaseNow);
    bucket.setUTCMinutes(Math.floor(bucket.getUTCMinutes() / 10) * 10, 0, 0);
    const scope = bucket.toISOString().slice(0, 16) + 'Z';
    const queued = await enqueueCronJob({
      type: BACKGROUND_JOB_TYPES.CRON_PRODUCTION_ALERTS,
      scope,
      payload: { runDate },
    });
    return NextResponse.json(
      { status: 'queued', runDate, ...queued },
      { status: 202 },
    );
  }

  try {
    return NextResponse.json(
      await runProductionAlertNotificationTask(runDate),
    );
  } catch {
    return NextResponse.json(
      { status: 'error', message: '生产异常扫描失败；请查看后台任务日志' },
      { status: 500 },
    );
  }
}
