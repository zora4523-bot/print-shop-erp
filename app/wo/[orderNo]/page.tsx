import { notFound, redirect } from 'next/navigation';
import { requireSession } from '@/lib/auth/session';
import { getOrderScopeFilter } from '@/lib/auth/order-scope';
import { db } from '@/lib/db';

export default async function WorkOrderQrRedirectPage({
  params,
}: PageProps<'/wo/[orderNo]'>) {
  const { user } = await requireSession();
  const { orderNo } = await params;
  const order = await db.order.findFirst({
    where: {
      orderNo,
      ...getOrderScopeFilter({ id: user.id, role: user.role }),
    },
    select: { id: true },
  });

  if (!order) notFound();
  redirect(`/orders/${order.id}`);
}
