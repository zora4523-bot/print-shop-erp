import { NextResponse } from 'next/server';
import type { NextAuthRequest } from 'next-auth';
import { auth } from '@/lib/auth/config';
import { UnauthorizedError } from '@/lib/auth/errors';
import { requireSessionPermission } from '@/lib/auth/permissions';
import {
  AgentMonthlyBillExportNotFoundError,
  getAgentMonthlyBillExportStatus,
} from '@/lib/agent-monthly-billing/export';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

type Context = { params: Promise<{ id: string }> };

export async function handleAgentMonthlyBillExportStatus(
  request: NextAuthRequest,
  context: Context,
) {
  let actor;
  try {
    actor = await requireSessionPermission('bill:view:all', request.auth);
  } catch (error) {
    if (error instanceof UnauthorizedError) {
      return NextResponse.json({ error: '未授权' }, { status: 401 });
    }
    throw error;
  }
  const { id } = await context.params;
  try {
    const item = await getAgentMonthlyBillExportStatus(id, actor);
    return NextResponse.json(
      { export: item },
      {
        headers: {
          'Cache-Control': 'private, no-store',
          'X-Content-Type-Options': 'nosniff',
        },
      },
    );
  } catch (error) {
    if (error instanceof AgentMonthlyBillExportNotFoundError) {
      return NextResponse.json(
        { error: '导出记录不存在或无权查看' },
        { status: 404 },
      );
    }
    throw error;
  }
}

export const GET = auth(handleAgentMonthlyBillExportStatus);
