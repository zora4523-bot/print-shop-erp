import { Suspense } from 'react';
import Link from 'next/link';
import { Role } from '../../../generated/prisma/enums';
import { buttonVariants } from '@/components/ui/button';
import { requireSession } from '@/lib/auth/session';
import type { OrderListSearchParams } from '@/lib/order/list-query';
import { PageHeader } from '@/components/ui-business';
import { OrdersListContent } from './_components/OrdersListContent';
import { OrdersListContentSkeleton } from './_components/OrdersListContentSkeleton';

export const metadata = {
  title: '工单列表 · 红包印刷 ERP',
};

type PageProps = {
  searchParams: Promise<OrderListSearchParams>;
};

export default async function OrdersListPage({ searchParams }: PageProps) {
  const { user } = await requireSession();
  const canCreate =
    user.role === Role.SALES ||
    user.role === Role.CUSTOMER_SERVICE ||
    user.role === Role.ADMIN;
  return (
    <div className="space-y-6">
      <PageHeader
        title="工单"
        subtitle="销售 / 客服只看自己提交的；管理员看全部；师傅看分配给自己的任务所在工单。"
        actions={
          canCreate ? (
            <Link href="/orders/new" className={buttonVariants()}>
              新建工单
            </Link>
          ) : null
        }
      />
      <Suspense fallback={<OrdersListContentSkeleton />}>
        <OrdersListContent
          searchParams={searchParams}
          user={{ id: user.id, role: user.role }}
        />
      </Suspense>
    </div>
  );
}
