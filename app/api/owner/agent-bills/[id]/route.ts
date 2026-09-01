import { NextResponse } from 'next/server';
import type { NextAuthRequest } from 'next-auth';
import { auth } from '@/lib/auth/config';
import { UnauthorizedError } from '@/lib/auth/errors';
import { requireSessionPermission } from '@/lib/auth/permissions';
import { getAgentMonthlyBillDetail } from '@/lib/agent-monthly-billing/query';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

type Context = { params: Promise<{ id: string }> };

export async function handleAgentMonthlyBillDetailGet(
  request: NextAuthRequest,
  context: Context,
) {
  try {
    await requireSessionPermission('bill:view:all', request.auth);
  } catch (error) {
    if (error instanceof UnauthorizedError) {
      return NextResponse.json({ error: '未授权' }, { status: 401 });
    }
    throw error;
  }
  const { id } = await context.params;
  if (!/^\S{1,128}$/.test(id)) {
    return NextResponse.json({ error: '账单标识不合法' }, { status: 400 });
  }
  const bill = await getAgentMonthlyBillDetail(id);
  if (!bill) {
    return NextResponse.json({ error: '账单不存在' }, { status: 404 });
  }
  return NextResponse.json(
    { bill },
    {
      headers: {
        'Cache-Control': 'private, no-store',
        'X-Content-Type-Options': 'nosniff',
      },
    },
  );
}

export const GET = auth(handleAgentMonthlyBillDetailGet);
