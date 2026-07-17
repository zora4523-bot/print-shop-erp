import { NextResponse } from 'next/server';
import { BACKGROUND_JOB_TYPES } from '@/lib/background-jobs/types';
import { enqueueCronJob } from '@/lib/background-jobs/cron';
import { backgroundJobsMode } from '@/lib/background-jobs/mode';
import { requireCronAuth } from '@/lib/cron-auth';
import { isStrictYearMonth, previousShanghaiMonth } from '@/lib/cron/schedule';
import { runGenerateBillsTask } from '@/lib/cron/tasks';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(req: Request) {
  const denied = requireCronAuth(req);
  if (denied) return denied;

  const body = await readJsonBody(req);
  const extracted = extractOptionalString(body, 'period');
  if (extracted.explicit && extracted.value === null) {
    return NextResponse.json(
      { error: 'invalid period: present but malformed' },
      { status: 400 },
    );
  }
  const period = extracted.value ?? previousShanghaiMonth();
  if (!isStrictYearMonth(period)) {
    return NextResponse.json({ error: `invalid period: ${period}` }, { status: 400 });
  }

  if (backgroundJobsMode() === 'durable') {
    const queued = await enqueueCronJob({
      type: BACKGROUND_JOB_TYPES.CRON_GENERATE_BILLS,
      scope: period,
      payload: { period },
    });
    return NextResponse.json(
      { status: 'queued', period, ...queued },
      { status: 202 },
    );
  }

  try {
    return NextResponse.json(await runGenerateBillsTask(period));
  } catch {
    return NextResponse.json(
      {
        status: 'error',
        period,
        message: '账单生成批处理失败；查看 owner 页面确认',
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

function extractOptionalString(
  body: unknown,
  key: string,
): { value: string | null; explicit: boolean } {
  if (body && typeof body === 'object' && key in body) {
    const value = (body as Record<string, unknown>)[key];
    if (typeof value === 'string' && value.trim()) {
      return { value: value.trim(), explicit: true };
    }
    return { value: null, explicit: true };
  }
  return { value: null, explicit: false };
}
