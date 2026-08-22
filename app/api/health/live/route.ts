import { NextResponse } from 'next/server';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// Process-only liveness. Never checks dependencies, so a temporary database
// outage does not create a PM2 restart loop.
export function GET(): Response {
  return NextResponse.json({
    status: 'ok',
    version: process.env.APP_VERSION ?? 'dev',
    uptimeSeconds: Math.floor(process.uptime()),
    time: new Date().toISOString(),
  });
}
