import { notFound } from 'next/navigation';
import { randomUUID } from 'node:crypto';
import { getOrderForOutsourceForm } from '@/lib/outsource';
import { CreateOutsourceForm } from '@/components/business/outsource/CreateOutsourceForm';
import { requirePermission } from '@/lib/auth/permissions';

type PageProps = {
  searchParams: Promise<{ orderId?: string }>;
};

export const metadata = { title: '创建外协单' };

export default async function NewOutsourcePage({ searchParams }: PageProps) {
  // Page-level server-side authz (defense-in-depth: layout gate
  // doesn't re-run on soft navigation; lib read is unscoped global data).
  await requirePermission('outsource:manage');
  const { orderId } = await searchParams;
  if (!orderId) notFound();

  // Foreman layout already gates the role. We fetch the order + items
  // directly (no scope filter needed — foreman sees everything) so
  // the form can list items as checkboxes.
  const order = await getOrderForOutsourceForm(orderId);
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
        initialIdempotencyKey={randomUUID()}
      />
    </div>
  );
}
