import { NextResponse } from 'next/server';
import type { NextAuthRequest } from 'next-auth';
import { AgentMonthlyBillStatus } from '@/generated/prisma/enums';
import { UnauthorizedError } from '@/lib/auth/errors';
import { requireSessionPermission } from '@/lib/auth/permissions';
import { isAgentBillPeriod } from '@/lib/agent-monthly-billing/period';
import {
  getAgentMonthlyBillingStats,
  listAgentMonthlyBills,
} from '@/lib/agent-monthly-billing/query';


function one(params: URLSearchParams, key: string): string | null | undefined {
  const values = params.getAll(key);
  if (values.length > 1) return null;
  return values[0];
}

export async function handleAgentMonthlyBillsGet(request: NextAuthRequest) {
  try {
    await requireSessionPermission('bill:view:all', request.auth);
  } catch (error) {
    if (error instanceof UnauthorizedError) {
      return NextResponse.json({ error: '未授权' }, { status: 401 });
    }
    throw error;
  }

  const period = one(request.nextUrl.searchParams, 'period');
  const status = one(request.nextUrl.searchParams, 'status');
  const agentUserId = one(request.nextUrl.searchParams, 'agentUserId');
  const pageRaw = one(request.nextUrl.searchParams, 'page');
  if (
    period === null ||
    status === null ||
    agentUserId === null ||
    pageRaw === null ||
    (period !== undefined && !isAgentBillPeriod(period)) ||
    (status !== undefined &&
      !(Object.values(AgentMonthlyBillStatus) as string[]).includes(status)) ||
    (agentUserId !== undefined && !/^\S{1,128}$/.test(agentUserId)) ||
    (pageRaw !== undefined && !/^[1-9]\d*$/.test(pageRaw))
  ) {
    return NextResponse.json({ error: '筛选条件不合法' }, { status: 400 });
  }

  const [bills, stats] = await Promise.all([
    listAgentMonthlyBills({
      period,
      status: status as AgentMonthlyBillStatus | undefined,
      agentUserId,
      page: pageRaw ? Number(pageRaw) : undefined,
    }),
    getAgentMonthlyBillingStats(),
  ]);
  return NextResponse.json(
    { bills, stats },
    {
      headers: {
        'Cache-Control': 'private, no-store',
        'X-Content-Type-Options': 'nosniff',
      },
    },
  );
}
