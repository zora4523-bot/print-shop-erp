import { notFound, redirect } from 'next/navigation';
import { requireSession } from '@/lib/auth/session';
import { getOrderDetail } from '@/lib/order';
import {
  editableFieldsetForStatus,
} from '@/lib/order/editable-fields';
import { EditOrderForm } from '@/components/business/order/EditOrderForm';

type PageProps = { params: Promise<{ id: string }> };

export async function generateMetadata({ params }: PageProps) {
  const { id } = await params;
  return { title: `编辑工单 · ${id.slice(0, 8)}` };
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
      <div>
        <h1 className="text-xl font-semibold">
          编辑工单 <span className="font-mono">{order.orderNo}</span>
        </h1>
        <p className="text-sm text-muted-foreground">
          仅修改本页字段会写入修改日志；款式增删改暂未支持（计划在 P1 补齐）。
        </p>
      </div>

      <EditOrderForm
        orderId={order.id}
        fieldset={fieldset}
        initial={{
          customerRef: order.customerRef,
          receiverName: order.receiverName,
          receiverPhone: order.receiverPhone,
          receiverAddress: order.receiverAddress,
          expressCode: order.expressCode,
          packageRequirement: order.packageRequirement,
          remark: order.remark,
          isUrgent: order.isUrgent,
        }}
      />
    </div>
  );
}
