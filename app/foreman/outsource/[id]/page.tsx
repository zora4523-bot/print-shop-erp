import Link from 'next/link';
import { notFound } from 'next/navigation';
import { OutsourceStatus } from '@/generated/prisma/enums';
import { getOutsourceOrderDetail } from '@/lib/outsource';
import { isTerminalOutsourceStatus } from '@/lib/outsource/status-machine';
import { Badge } from '@/components/ui/badge';
import { OutsourceActions } from '@/components/business/outsource/OutsourceActions';

type PageProps = { params: Promise<{ id: string }> };

const STATUS_LABELS: Record<OutsourceStatus, string> = {
  [OutsourceStatus.SENT]: '已发出',
  [OutsourceStatus.IN_PROGRESS]: '进行中',
  [OutsourceStatus.RECEIVED]: '已回货',
  [OutsourceStatus.CANCELLED]: '已取消',
};

function formatDate(d: Date | null): string {
  if (!d) return '—';
  return new Intl.DateTimeFormat('zh-CN', {
    timeZone: 'Asia/Shanghai',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(d);
}

export async function generateMetadata({ params }: PageProps) {
  const { id } = await params;
  return { title: `外协单 · ${id.slice(0, 8)}` };
}

export default async function OutsourceDetailPage({ params }: PageProps) {
  const { id } = await params;
  const row = await getOutsourceOrderDetail(id);
  if (!row) notFound();

  const canReceive = !isTerminalOutsourceStatus(row.status);
  // Don't offer cancel once the goods have landed — SPEC §4.3 makes
  // RECEIVED terminal. SENT / IN_PROGRESS only.
  const canCancel =
    row.status === OutsourceStatus.SENT ||
    row.status === OutsourceStatus.IN_PROGRESS;

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-semibold">
            外协单 · {row.supplierName}
          </h1>
          <p className="text-sm text-muted-foreground">
            工单号：
            {row.order ? (
              <Link
                href={`/orders/${row.order.id}`}
                className="font-mono underline hover:text-foreground"
              >
                {row.order.orderNo}
              </Link>
            ) : (
              '—'
            )}
          </p>
        </div>
        <Badge
          variant={
            row.status === OutsourceStatus.RECEIVED
              ? 'default'
              : row.status === OutsourceStatus.CANCELLED
                ? 'outline'
                : row.status === OutsourceStatus.IN_PROGRESS
                  ? 'secondary'
                  : 'outline'
          }
        >
          {STATUS_LABELS[row.status]}
        </Badge>
      </div>

      <section className="rounded-xl border bg-card p-6 text-sm shadow-sm space-y-3">
        <h2 className="text-base font-semibold">基本信息</h2>
        <dl className="grid grid-cols-2 gap-x-6 gap-y-2">
          <Row label="外协厂" value={row.supplierName} />
          <Row label="联系方式" value={row.supplierContact ?? '—'} />
          <Row label="工艺" value={row.craftDescription ?? '—'} full />
          <Row
            label="特殊要求"
            value={row.specialRequirement ?? '—'}
            full
          />
          <Row
            label="总数量"
            value={row.totalQty?.toLocaleString() ?? '—'}
            mono
          />
          <Row label="金额" value={row.amount ? `¥ ${row.amount}` : '—'} mono />
          <Row label="预计回货" value={formatDate(row.expectedDate)} />
          <Row label="实际回货" value={formatDate(row.actualDate)} />
          <Row
            label="关联款式"
            value={row.orderItemIds.length.toString()}
            mono
          />
          {row.remark ? <Row label="备注" value={row.remark} full /> : null}
        </dl>
      </section>

      {canReceive || canCancel ? (
        <section className="rounded-xl border bg-card p-6 shadow-sm space-y-3">
          <h2 className="text-base font-semibold">状态操作</h2>
          <OutsourceActions
            id={row.id}
            canReceive={canReceive}
            canCancel={canCancel}
          />
        </section>
      ) : null}
    </div>
  );
}

function Row({
  label,
  value,
  mono,
  full,
}: {
  label: string;
  value: string;
  mono?: boolean;
  full?: boolean;
}) {
  return (
    <div className={full ? 'col-span-2' : undefined}>
      <dt className="text-xs text-muted-foreground">{label}</dt>
      <dd className={mono ? 'font-mono' : undefined}>{value}</dd>
    </div>
  );
}
