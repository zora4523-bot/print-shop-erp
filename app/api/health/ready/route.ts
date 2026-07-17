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
    const [, integrityRows, jobs] = await Promise.all([
      db.$queryRaw`SELECT 1`,
      db.$queryRaw<{ mismatchCount: bigint }[]>`
        SELECT COUNT(*)::bigint AS "mismatchCount"
          FROM "Material" m
          LEFT JOIN (
            SELECT "materialId", COALESCE(SUM("currentStock"), 0) AS total
              FROM "MaterialLocationStock"
             GROUP BY "materialId"
          ) s ON s."materialId" = m.id
         WHERE m."currentStock" <> COALESCE(s.total, 0)
      `,
      getBackgroundJobHealth(),
    ]);
    const assessment = assessBackgroundJobHealth(jobs, {
      requireWorkers: backgroundJobsMode() === 'durable',
      expectedVersion: version,
    });
    const inventoryMismatchCount = Number(
      integrityRows[0]?.mismatchCount ?? 0,
    );
    const warnings = [...assessment.warnings];
    if (inventoryMismatchCount > 0) warnings.push('inventory-summary-mismatch');
    return NextResponse.json(
      {
        status:
          assessment.status === 'ok' && warnings.length > 0
            ? 'degraded'
            : assessment.status,
        db: 'ok',
        time,
        inventory: {
          status: inventoryMismatchCount === 0 ? 'ok' : 'mismatch',
          mismatchCount: inventoryMismatchCount,
        },
        warnings,
      },
      { status: assessment.available ? 200 : 503 },
    );
  } catch {
    return NextResponse.json(
      { status: 'error', db: 'down', time },
      { status: 503 },
    );
  }
}
