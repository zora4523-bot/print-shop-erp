import { notFound } from 'next/navigation';
import { randomUUID } from 'node:crypto';
import { getOrderForOutsourceForm } from '@/lib/outsource';
import { CreateOutsourceForm } from '@/components/business/outsource/CreateOutsourceForm';
import { requirePermission } from '@/lib/auth/permissions';
import { outsourceUnavailableReason } from '@/lib/order/outsource-eligibility';
import { DisabledReason, PageHeader } from '@/components/ui-business';
import { FormPage } from '@/app/_components/FormPage';

type PageProps = {
  searchParams: Promise<{ orderId?: string }>;
};

export const metadata = { title: '新建外协单' };

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
  const unavailableReason = outsourceUnavailableReason(order);

  return (
    <FormPage>
      <PageHeader
        // 表单内自带提交中锁定的返回入口（PendingLink）；只有表单不渲染时才由页头提供。
        back={unavailableReason ? { href: `/orders/${order.id}`, label: '返回工单详情' } : undefined}
        title="新建外协单"
      />

      {unavailableReason ? (
        <DisabledReason cause="status" reason={unavailableReason} />
      ) : (
        <CreateOutsourceForm
          orderId={order.id}
          orderNo={order.orderNo}
          items={order.items}
          initialIdempotencyKey={randomUUID()}
        />
      )}
    </FormPage>
  );
}
