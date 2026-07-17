import { NextResponse } from 'next/server';
import { db } from '@/lib/db';
import {
  assessBackgroundJobHealth,
  getBackgroundJobHealth,
} from '@/lib/background-jobs/health';
import { backgroundJobsMode } from '@/lib/background-jobs/mode';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(): Promise<Response> {
  const version = process.env.APP_VERSION ?? 'dev';
  const time = new Date().toISOString();
  try {
    await db.$queryRaw`SELECT 1`;
    const jobs = await getBackgroundJobHealth();
    const assessment = assessBackgroundJobHealth(jobs, {
      requireWorkers: backgroundJobsMode() === 'durable',
      expectedVersion: version,
    });
    return NextResponse.json(
      {
        status: assessment.status,
        db: 'ok',
        version,
        time,
        warnings: assessment.warnings,
        workers: jobs.activeWorkers,
        jobs: {
          pending: jobs.pending,
          oldestPendingAt: jobs.oldestPendingAt,
          running: jobs.running,
          staleRunning: jobs.staleRunning,
          deadLast24h: jobs.deadLast24h,
        },
      },
      { status: assessment.available ? 200 : 503 },
    );
  } catch {
    return NextResponse.json(
      { status: 'error', db: 'down', version, time },
      { status: 503 },
    );
  }
}
