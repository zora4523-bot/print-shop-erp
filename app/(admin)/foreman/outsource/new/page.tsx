import { notFound } from 'next/navigation';
import { db } from '@/lib/db';
import { CreateOutsourceForm } from '@/components/business/outsource/CreateOutsourceForm';

type PageProps = {
  searchParams: Promise<{ orderId?: string }>;
};

export const metadata = { title: '创建外协单' };

export default async function NewOutsourcePage({ searchParams }: PageProps) {
  const { orderId } = await searchParams;
  if (!orderId) notFound();

  // Foreman layout already gates the role. We fetch the order + items
  // directly (no scope filter needed — foreman sees everything) so
  // the form can list items as checkboxes.
  const order = await db.order.findUnique({
    where: { id: orderId },
    select: {
      id: true,
      orderNo: true,
      items: {
        orderBy: { sequence: 'asc' },
        select: {
          id: true,
          sequence: true,
          name: true,
          quantity: true,
        },
      },
    },
  });
  if (!order) notFound();

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-xl font-semibold">创建外协单</h1>
        <p className="text-sm text-muted-foreground">
          选择要外协的款式，填写外协厂信息。保存后状态默认为&ldquo;已发出&rdquo;。
        </p>
      </div>

      <CreateOutsourceForm
        orderId={order.id}
        orderNo={order.orderNo}
        items={order.items}
      />
    </div>
  );
}
