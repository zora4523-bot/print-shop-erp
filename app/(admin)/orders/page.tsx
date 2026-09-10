import { Suspense } from 'react';
import Link from 'next/link';
import { Role } from '../../../generated/prisma/enums';
import { buttonVariants } from '@/components/ui/button';
import { requireSession } from '@/lib/auth/session';
import type { OrderListSearchParams } from '@/lib/order/list-query';
import { ErrorBoundary, PageHeader } from '@/components/ui-business';
import { OrdersListContent } from './_components/OrdersListContent';
import {
  AdminOrdersWorkspaceSkeleton,
  OrdersListContentSkeleton,
  SalesOrdersListContentSkeleton,
} from './_components/OrdersListContentSkeleton';

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
      {user.role !== Role.ADMIN ? (
        <PageHeader
          title="工单"
          actions={
            canCreate ? (
              <Link href="/orders/new" className={buttonVariants()}>
                新建工单
              </Link>
            ) : null
          }
        />
      ) : null}
      <ErrorBoundary
        scope="section"
        title="工单页面数据暂时无法加载"
        description="请重试加载工单数据。"
      >
        <Suspense
          fallback={
            user.role === Role.ADMIN ? (
              <AdminOrdersWorkspaceSkeleton />
            ) : user.role === Role.SALES ? (
              <SalesOrdersListContentSkeleton />
            ) : (
              <OrdersListContentSkeleton />
            )
          }
        >
          <OrdersListContent
            searchParams={searchParams}
            user={{ id: user.id, role: user.role }}
          />
        </Suspense>
      </ErrorBoundary>
    </div>
  );
}
