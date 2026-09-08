import { notFound, redirect } from 'next/navigation';
import { Role } from '@/generated/prisma/enums';
import { requireSession } from '@/lib/auth/session';
import { getOrderScopeFilter } from '@/lib/auth/order-scope';
import { db } from '@/lib/db';
import {
  isCurrentWorkOrderVersion,
  parseScannedWorkOrderVersion,
} from '@/lib/order/work-order-version';
import { resolveWorkerWorkOrderScan } from '@/lib/production/work-order-scan';

function firstQueryValue(
  value: string | string[] | undefined,
): string | undefined {
  const candidate = Array.isArray(value) ? value[0] : value;
  return candidate?.trim() || undefined;
}

function ObsoleteWorkOrderAlert({
  currentVersion,
}: {
  currentVersion: number;
}) {
  return (
    <main className="flex min-h-svh items-center justify-center bg-destructive p-6 text-destructive-foreground">
      <section
        role="alert"
        className="w-full max-w-xl rounded-2xl border-4 border-destructive-foreground bg-destructive p-8 text-center shadow-2xl"
      >
        <p className="text-sm font-black uppercase tracking-[0.22em]">
          禁止继续生产
        </p>
        <h1 className="mt-4 text-3xl font-black">
          此工单已作废，当前版本 v{currentVersion}
        </h1>
        <p className="mt-4 text-lg font-semibold">
          请停止使用当前纸张，并向工厂管理员索取最新打印件。
        </p>
      </section>
    </main>
  );
}

export default async function WorkOrderQrRedirectPage({
  params,
  searchParams,
}: PageProps<'/wo/[orderNo]'>) {
  const { user } = await requireSession();
  const { orderNo } = await params;
  const query = await searchParams;
  const scannedVersion = parseScannedWorkOrderVersion(query.v);
  const requestedTaskId = firstQueryValue(query.task);

  if (user.role === Role.WORKER) {
    const target = await resolveWorkerWorkOrderScan(
      orderNo,
      { id: user.id, role: user.role },
      requestedTaskId,
    );
    if (!target) notFound();
    if (!isCurrentWorkOrderVersion(scannedVersion, target.workOrderVersion)) {
      return (
        <ObsoleteWorkOrderAlert currentVersion={target.workOrderVersion} />
      );
    }
    if (!target.requestedTaskAllowed) notFound();
    const taskId = requestedTaskId ?? target.defaultTaskId;
    redirect(taskId
      ? `/worker/tasks/${encodeURIComponent(taskId)}`
      : `/worker/orders/${encodeURIComponent(target.orderId)}`);
  }

  const order = await db.order.findFirst({
    where: {
      orderNo,
      ...getOrderScopeFilter({ id: user.id, role: user.role }),
    },
    select: { id: true, workOrderVersion: true },
  });

  if (!order) notFound();
  if (!isCurrentWorkOrderVersion(scannedVersion, order.workOrderVersion)) {
    return <ObsoleteWorkOrderAlert currentVersion={order.workOrderVersion} />;
  }
  redirect(`/orders/${order.id}`);
}
