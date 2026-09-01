import { NextResponse } from 'next/server';
import type { NextAuthRequest } from 'next-auth';
import { Role } from '@/generated/prisma/enums';
import { auth } from '@/lib/auth/config';
import { UnauthorizedError } from '@/lib/auth/errors';
import { requireSessionPermission } from '@/lib/auth/permissions';
import { getAdminOrderByOrderNo } from '@/lib/order/admin-workspace';
import { getSetting } from '@/lib/settings';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

type Context = { params: Promise<{ orderNo: string }> };

export async function handleAdminOrderWorkspaceDetail(
  request: NextAuthRequest,
  context: Context,
): Promise<Response> {
  let actor;
  try {
    actor = await requireSessionPermission('order:view:all', request.auth);
  } catch (error) {
    if (error instanceof UnauthorizedError) {
      return NextResponse.json({ error: '未授权' }, { status: 401 });
    }
    throw error;
  }

  if (actor.role !== Role.ADMIN) {
    return NextResponse.json(
      { error: '仅管理员可读取管理端工单' },
      { status: 403 },
    );
  }

  const { orderNo } = await context.params;
  const stagnation = await getSetting('production_stagnation_days');
  const order = await getAdminOrderByOrderNo(
    actor,
    orderNo,
    new Date(),
    stagnation.days,
  );
  if (!order) {
    return NextResponse.json(
      { error: '工单不存在或无权访问' },
      { status: 404 },
    );
  }

  return NextResponse.json(
    { order },
    {
      headers: {
        'Cache-Control': 'private, no-store',
        'X-Content-Type-Options': 'nosniff',
      },
    },
  );
}

export const GET = auth(handleAdminOrderWorkspaceDetail);
