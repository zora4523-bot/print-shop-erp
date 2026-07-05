import Link from 'next/link';
import { Search } from 'lucide-react';
import { Role } from '../../../generated/prisma/enums';
import { buttonVariants } from '@/components/ui/button';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { requireSession } from '@/lib/auth/session';
import { listOrders } from '@/lib/order';
import { OrdersTable } from '@/components/business/order/OrdersTable';
import { PageHeader } from '@/components/ui-business';

export const metadata = {
  title: '工单列表 · 红包印刷 ERP',
};

type PageProps = {
  searchParams: Promise<{ q?: string | string[] }>;
};

function firstParam(v: string | string[] | undefined): string {
  if (Array.isArray(v)) return v[0] ?? '';
  return v ?? '';
}

export default async function OrdersListPage({ searchParams }: PageProps) {
  const sp = await searchParams;
  const q = firstParam(sp.q).trim();
  const { user } = await requireSession();
  const canCreate =
    user.role === Role.SALES ||
    user.role === Role.CUSTOMER_SERVICE ||
    user.role === Role.OWNER ||
    user.role === Role.FOREMAN;

  const orders = await listOrders({ id: user.id, role: user.role }, { q });

  return (
    <div className="space-y-6">
      <PageHeader
        title="工单"
        subtitle="销售 / 客服只看自己提交的；车间主管和老板看全部；师傅看分配给自己的任务所在工单。"
        actions={
          canCreate ? (
            <Link href="/orders/new" className={buttonVariants()}>
              新建工单
            </Link>
          ) : null
        }
      />
      <form
        action="/orders"
        className="flex max-w-2xl flex-col gap-2 rounded-lg border bg-card p-3 shadow-sm sm:flex-row"
      >
        <div className="relative min-w-0 flex-1">
          <Search className="pointer-events-none absolute left-2.5 top-2 size-4 text-muted-foreground" />
          <Input
            name="q"
            defaultValue={q}
            placeholder="搜索工单号、客户、收货人、电话、快递号"
            className="pl-8"
          />
        </div>
        <div className="flex gap-2">
          <Button type="submit">搜索</Button>
          {q ? (
            <Link href="/orders" className={buttonVariants({ variant: 'outline' })}>
              清空
            </Link>
          ) : null}
        </div>
      </form>
      <div className="rounded-xl border bg-card p-4 shadow-sm">
        <OrdersTable orders={orders} />
      </div>
    </div>
  );
}
