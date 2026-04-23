import Link from 'next/link';
import { Role } from '../../generated/prisma/enums';
import { buttonVariants } from '@/components/ui/button';
import { requireSession } from '@/lib/auth/session';
import { listOrders } from '@/lib/order';
import { OrdersTable } from '@/components/business/order/OrdersTable';

export const metadata = {
  title: '工单列表 · 红包印刷 ERP',
};

export default async function OrdersListPage() {
  const { user } = await requireSession();
  const canCreate =
    user.role === Role.SALES ||
    user.role === Role.CUSTOMER_SERVICE ||
    user.role === Role.OWNER ||
    user.role === Role.FOREMAN;

  const orders = await listOrders({ id: user.id, role: user.role });

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-semibold">工单</h1>
          <p className="text-sm text-muted-foreground">
            销售 / 客服只看自己提交的；车间主管和老板看全部；师傅看分配给自己的任务所在工单。
          </p>
        </div>
        {canCreate ? (
          <Link href="/orders/new" className={buttonVariants()}>
            新建工单
          </Link>
        ) : null}
      </div>
      <div className="rounded-xl border bg-card p-4 shadow-sm">
        <OrdersTable orders={orders} />
      </div>
    </div>
  );
}
