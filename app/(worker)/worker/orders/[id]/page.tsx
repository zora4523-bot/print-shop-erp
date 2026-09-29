import { PageHeader } from '@/components/ui-business';
import { WorkerProductionJobs } from '@/components/business/production/WorkerProductionJobs';
import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { cache } from 'react';
import Decimal from 'decimal.js';
import {
  PieceworkOperationType,
  Role,
} from '@/generated/prisma/enums';
import { requirePermission } from '@/lib/auth/permissions';
import { getSession } from '@/lib/auth/session';
import { getWorkerOrderDetail } from '@/lib/worker-portal';
import { orderStatusZh } from '@/lib/order/log-format';
import { formatDateShanghai } from '@/lib/format/dates';
import { Badge } from '@/components/ui/badge';
import { DesignImageGallery } from '@/components/business/order/DesignImageGallery';
import { signDesignReadUrl } from '@/lib/oss/read-url';
import { HighlightedRemark } from '@/components/business/order/HighlightedRemark';
import { UrgentBadge } from '@/components/business/order/UrgentBadge';
import { formatFoilColors } from '@/lib/order/foil-colors';
import { externalPriceBusinessText } from '@/lib/price/external-price-display';
import { formatMoney } from '@/lib/dashboard/format';
import { WorkerOrderTaskList } from '@/components/business/production/WorkerOrderTaskList';
import { productionOperationPassCount } from '@/lib/production/operation-quantity';

type PageProps = { params: Promise<{ id: string }>; searchParams?: Promise<{ productionPage?: string }> };

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

export default async function WorkerOrderDetailPage({ params, searchParams }: PageProps) {
  const query = await searchParams;
  const user = await requirePermission('order:view:self');
  const { id } = await params;
  const order = await getWorkerOrderPageData(id, user.id, user.role);
  if (!order) notFound();

  return (
    <div className="min-w-0 space-y-5">
      <PageHeader
        size="worker"
        className="worker-wrap-anywhere"
        back={{ href: '/worker/orders', label: '返回我的工单' }}
        eyebrow={<span className="font-sans tabular-nums">{order.orderNo} · 第 {order.workOrderVersion} 版</span>}
        title="工序工单"
        status={<><Badge variant="outline">{orderStatusZh(order.status)}</Badge>{order.isUrgent ? <UrgentBadge /> : null}</>}
        subtitle={<>
          {order.customName ? <span className="block text-sm font-semibold text-foreground">{order.customName}</span> : null}
          <span className="block">
            外部销售：{order.externalSalesName ?? '未填'}
            {order.promisedDate ? ` · 交期 ${formatDateShanghai(order.promisedDate)}` : ''}
          </span>
        </>}
      />

      {order.packageRequirement || order.remark ? (
        <section className="worker-wrap-anywhere min-w-0 rounded-xl border bg-card p-4 text-sm shadow-sm">
          <h2 className="mb-2 font-semibold">生产备注</h2>
          <p>包装补充说明：{order.packageRequirement ?? '—'}</p>
          <p className="mt-1">工单备注：{order.remark ?? '—'}</p>
        </section>
      ) : null}

      {order.simpleProduction ? <WorkerProductionJobs actor={user} orderId={id} page={query?.productionPage} /> : <WorkerOrderTaskList
        reporterName={user.displayName}
        laneLabel={order.productionOperations[0]
          ? OPERATION_LABELS[order.productionOperations[0].operationType]
          : '共享进度报工'}
        operations={order.productionOperations.map((operation) => {
          const completed = operation.reports.reduce(
            (sum, report) => sum.plus(report.reportedCompletedQty),
            new Decimal(operation.carriedCompletedQty),
          );
          const planned = new Decimal(operation.plannedQty).div(
            productionOperationPassCount(
              operation.operationType, operation.sources,
            ),
          );
          const myAmount = operation.reports
            .filter((report) => report.reporterId === user.id)
            .reduce((sum, report) => sum.plus(report.amount), new Decimal(0));
          const groups = operation.sources.flatMap((source) =>
            source.packagingGroup ? [source.packagingGroup] : [],
          );
          return {
            id: operation.id,
            title: groups.length > 0
              ? groups.map((group) =>
                `包装组 #${group.sequence}${group.name ? ` · ${group.name}` : ''}`,
              ).join('、')
              : OPERATION_LABELS[operation.operationType],
            sources: operation.sources.flatMap((source) => {
              if (source.packagingGroup) {
                return source.packagingGroup.lines.map((line) =>
                  `#${line.orderItem.sequence} · ${line.orderItem.name} · 每袋 ${line.unitsPerBag} 个`,
                );
              }
              return source.orderItem
                ? [`#${source.orderItem.sequence} · ${source.orderItem.name}`]
                : [];
            }),
            status: operation.status,
            planned: planned.toString(),
            completed: completed.toString(),
            remaining: Decimal.max(planned.minus(completed), 0).toString(),
            unit: operation.unit === 'PER_BOX' ? '盒' : operation.operationType === PieceworkOperationType.PACKING ? '袋' : '个',
            myAmount: formatMoney(myAmount),
          };
        })}
        progressSteps={order.productionProgressSteps.map((step) => {
          const completed = step.reports.reduce(
            (sum, report) => sum.plus(report.completedQty),
            new Decimal(step.carriedCompletedQty),
          );
          return {
            id: step.id,
            title: step.craftName,
            sources: [`#${step.orderItem.sequence} · ${step.orderItem.name}`],
            status: step.status,
            planned: step.plannedQty.toString(),
            completed: completed.toString(),
            remaining: Decimal.max(
              new Decimal(step.plannedQty).minus(completed), 0,
            ).toString(),
            unit: '个',
            readOnly: !step.reportable,
          };
        })}
      />}

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
