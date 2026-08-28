import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { cache } from 'react';
import Decimal from 'decimal.js';
import {
  PieceworkOperationType,
  ProductionOperationStatus,
  Role,
} from '@/generated/prisma/enums';
import { requirePermission } from '@/lib/auth/permissions';
import { getSession } from '@/lib/auth/session';
import { getWorkerOrderDetail } from '@/lib/worker-portal';
import { orderStatusZh } from '@/lib/order/log-format';
import { formatDateShanghai } from '@/lib/format/dates';
import { Badge } from '@/components/ui/badge';
import { StatusBadge } from '@/components/ui-business';
import { DesignImageGallery } from '@/components/business/order/DesignImageGallery';
import { signDesignReadUrl } from '@/lib/oss/read-url';
import { HighlightedRemark } from '@/components/business/order/HighlightedRemark';
import { UrgentBadge } from '@/components/business/order/UrgentBadge';
import { formatFoilColors } from '@/lib/order/foil-colors';
import { externalPriceBusinessText } from '@/lib/price/external-price-display';
import { formatMoney } from '@/lib/dashboard/format';
import { PRODUCTION_OPERATION_STATUS_REGISTRY } from '@/lib/ui/status-registry';

type PageProps = { params: Promise<{ id: string }> };

const OPERATION_LABELS: Record<PieceworkOperationType, string> = {
  [PieceworkOperationType.PARTIAL]: '局部烫金',
  [PieceworkOperationType.FULL]: '专版烫金',
  [PieceworkOperationType.PACKING]: '打包入袋',
};

const getWorkerOrderPageData = cache(
  (id: string, actorId: string, actorRole: Role) =>
    getWorkerOrderDetail(id, { id: actorId, role: actorRole }),
);

export async function generateMetadata({ params }: PageProps): Promise<Metadata> {
  const session = await getSession();
  if (!session || session.user.role !== Role.WORKER) {
    return { title: '我的工单' };
  }
  const { id } = await params;
  const order = await getWorkerOrderPageData(
    id,
    session.user.id,
    session.user.role,
  );
  return { title: order ? `${order.orderNo} · 我的工单` : '工单不存在' };
}

export default async function WorkerOrderDetailPage({ params }: PageProps) {
  const user = await requirePermission('order:view:self');
  const { id } = await params;
  const order = await getWorkerOrderPageData(id, user.id, user.role);
  if (!order) notFound();

  return (
    <div className="min-w-0 space-y-5">
      <header className="worker-wrap-anywhere min-w-0 space-y-1">
        <div className="flex min-w-0 flex-wrap items-center gap-2">
          <span className="font-sans text-sm tabular-nums">{order.orderNo}</span>
          <Badge variant="outline">{orderStatusZh(order.status)}</Badge>
          {order.isUrgent ? <UrgentBadge /> : null}
        </div>
        <h1 className="text-lg font-semibold">工序工单</h1>
        {order.customName ? (
          <p className="text-sm font-semibold">{order.customName}</p>
        ) : null}
        <p className="text-xs text-muted-foreground">
          客户名称/简称：{order.customerRef ?? '—'}
          {order.promisedDate
            ? ` · 交期 ${formatDateShanghai(order.promisedDate)}`
            : ''}
          {' · '}接单人：{order.submitter.displayName}
        </p>
      </header>

      {order.packageRequirement || order.remark ? (
        <section className="rounded-xl border bg-card p-4 text-sm shadow-sm">
          <h2 className="mb-2 font-semibold">生产备注</h2>
          <p>包装要求：{order.packageRequirement ?? '—'}</p>
          <p className="mt-1">工单备注：{order.remark ?? '—'}</p>
        </section>
      ) : null}

      <section className="space-y-3" aria-labelledby="operation-heading">
        <h2 id="operation-heading" className="text-sm font-semibold">
          本岗位工序
        </h2>
        {order.productionOperations.map((operation) => {
          const completed = operation.reports.reduce(
            (sum, report) => sum.plus(report.reportedCompletedQty),
            new Decimal(0),
          );
          const myAmount = operation.reports
            .filter((report) => report.reporterId === user.id)
            .reduce(
              (sum, report) => sum.plus(report.amount),
              new Decimal(0),
            );
          return (
            <Link
              key={operation.id}
              href={`/worker/tasks/${operation.id}`}
              className="block min-h-11 rounded-xl border bg-card p-4 shadow-sm hover:bg-muted/40"
            >
              <div className="flex flex-wrap items-center gap-2">
                <strong>{OPERATION_LABELS[operation.operationType]}</strong>
                <OperationStatusBadge status={operation.status} />
              </div>
              <p className="mt-2 text-xs text-muted-foreground">
                已报合格 {completed.toString()} · 计划计价单位{' '}
                {operation.plannedQty.toString()}
              </p>
              <p className="mt-1 font-sans text-sm tabular-nums">
                我的已报计件 {formatMoney(myAmount)}
              </p>
            </Link>
          );
        })}
      </section>

      <div className="space-y-3">
        {order.items.map((item) => (
          <section
            key={item.id}
            className="min-w-0 rounded-xl border bg-card p-4 shadow-sm"
          >
            <h2 className="worker-wrap-anywhere font-medium">
              #{item.sequence} · {item.name}
            </h2>
            <p className="worker-wrap-anywhere mt-1 text-xs text-muted-foreground">
              {item.specification
                ? externalPriceBusinessText(item.specification)
                : '未填规格'}
              {' · '}
              {item.paperType
                ? externalPriceBusinessText(item.paperType)
                : '未填纸张'}
              {' · '}数量 {item.quantity.toLocaleString()} · 烫金色{' '}
              {formatFoilColors(item.foilColors, '未填')} ·{' '}
              {item.isDoubleSided ? '双面' : '单面'} ·{' '}
              {item.isDoubleColor ? '双色' : '单色'}
            </p>
            {item.remark ? (
              <HighlightedRemark className="mt-3">{item.remark}</HighlightedRemark>
            ) : null}
            <DesignImageGallery
              images={item.designs.map((design) => ({
                ...design,
                fileUrl: signDesignReadUrl(design.fileUrl),
              }))}
            />
          </section>
        ))}
      </div>
    </div>
  );
}

function OperationStatusBadge({
  status,
}: {
  status: ProductionOperationStatus;
}) {
  const definition = PRODUCTION_OPERATION_STATUS_REGISTRY[status];
  return (
    <StatusBadge tone={definition.tone} dot={definition.dot}>
      {definition.label}
    </StatusBadge>
  );
}
