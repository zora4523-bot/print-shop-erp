import { NextResponse } from 'next/server';
import type { NextAuthRequest } from 'next-auth';
import { Role } from '@/generated/prisma/enums';
import { UnauthorizedError } from '@/lib/auth/errors';
import { requireSessionPermission } from '@/lib/auth/permissions';
import { getSalesOrderByOrderNo } from '@/lib/order/sales-list-query';


type Context = { params: Promise<{ orderNo: string }> };

export async function handleSalesOrderDetail(
  request: NextAuthRequest,
  context: Context,
): Promise<Response> {
  let actor;
  try {
    actor = await requireSessionPermission('order:view:self', request.auth);
  } catch (error) {
    if (error instanceof UnauthorizedError) {
      return NextResponse.json({ error: '未授权' }, { status: 401 });
    }
    throw error;
  }

  if (actor.role !== Role.SALES) {
    return NextResponse.json({ error: '仅销售账号可读取' }, { status: 403 });
  }

  const { orderNo } = await context.params;
  const order = await getSalesOrderByOrderNo(actor, orderNo);
  if (!order) {
    return NextResponse.json({ error: '工单不存在或无权访问' }, { status: 404 });
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
