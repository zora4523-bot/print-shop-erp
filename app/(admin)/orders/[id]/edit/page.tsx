import { notFound, redirect } from 'next/navigation';
import { getSession, requireSession } from '@/lib/auth/session';
import { getOrderDetail } from '@/lib/order';
import { getOrderTitleRef } from '@/lib/page-title/refs';
import { orderEditTitle } from '@/lib/page-title/titles';
import {
  editableFieldsetForStatus,
} from '@/lib/order/editable-fields';
import { EditOrderForm } from '@/components/business/order/EditOrderForm';
import { BreadcrumbEntity } from '@/components/business/admin/breadcrumb-entity';

type PageProps = { params: Promise<{ id: string }> };

export async function generateMetadata({ params }: PageProps) {
  const { id } = await params;
  const session = await getSession();
  if (!session) return { title: '编辑工单' };
  const ref = await getOrderTitleRef(id, session.user.id, session.user.role);
  return { title: orderEditTitle(ref?.orderNo ?? null) };
}

export default async function EditOrderPage({ params }: PageProps) {
  const { user } = await requireSession();
  const { id } = await params;
  const order = await getOrderDetail(id, { id: user.id, role: user.role });
  if (!order) notFound();

  const fieldset = editableFieldsetForStatus(order.status);
  if (fieldset === 'NONE') {
    // Status doesn't permit editing at all — bounce back to the detail
    // page. The action layer enforces this again server-side, so a
    // stale link or direct URL can't slip past.
    redirect(`/orders/${id}`);
  }

  return (
    <div className="space-y-6">
      {/* 顶栏面包屑显示业务编号。值来自上面已经查出来的数据，
          不产生额外请求；组件自身不渲染任何 DOM。 */}
      <BreadcrumbEntity label={order.orderNo} />
      <div>
        <h1 className="text-xl font-semibold">
          编辑工单 <span className="font-sans tabular-nums">{order.orderNo}</span>
        </h1>
        <p className="text-sm text-muted-foreground">
          当前仅支持修改本页字段，暂不支持增删改款式。
        </p>
      </div>

      <EditOrderForm
        orderId={order.id}
        fieldset={fieldset}
        initial={{
          customName: order.customName,
          customerRef: order.customerRef,
          receiverAddress: order.receiverAddress,
          expressCode: order.expressCode,
          packageRequirement: order.packageRequirement,
          remark: order.remark,
          promisedDate: order.promisedDate
            ? order.promisedDate.toISOString().slice(0, 10)
            : null,
          isUrgent: order.isUrgent,
        }}
      />
    </div>
  );
}
