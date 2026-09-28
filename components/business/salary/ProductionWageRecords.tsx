import { paginationWindow, parsePositiveInt } from '@/lib/admin/table';
import { AdminPagination } from '@/components/business/admin/AdminDataTable';
import type { Prisma } from '@/generated/prisma/client';
import { formatMoney } from '@/lib/dashboard/format';
import Link from 'next/link';
import type { Role } from '@/generated/prisma/enums';
import { db } from '@/lib/db';
import { assertWorkerPortalActor } from '@/lib/production/worker-report-portal';
import { parseStrictYmd } from '@/lib/auth/schemas';

export async function WorkerProductionWages({ actor, from, to, page }: { actor: { id: string; role: Role }; from?: string; to?: string; page?: string | string[] }) {
  await assertWorkerPortalActor(actor);
  const where: Prisma.ProductionWageWhereInput = { workerId: actor.id, settlementId: null,
    ...((from || to) ? { workDate: { ...(from ? { gte: parseStrictYmd(from)! } : {}), ...(to ? { lte: parseStrictYmd(to)! } : {}) } } : {}) };
  const total = await db.productionWage.count({ where });
  const window = paginationWindow(total, parsePositiveInt(page, { defaultValue: 1 }), 20);
  const wages = await db.productionWage.findMany({ where,
    orderBy: [{ workDate: 'desc' }, { id: 'asc' }], skip: window.skip, take: window.take, include: { job: { select: { label: true, orderId: true, order: { select: { orderNo: true, customName: true } } } } } });
  if (!wages.length) return null;
  return <section className="min-w-0 space-y-3 rounded-xl border bg-card p-4"><h2 className="font-semibold">完工提成 · 待结算</h2><ul className="divide-y">{wages.map(wage => <li className="space-y-1 py-3" key={wage.id}><p>{wage.workDate.toISOString().slice(0, 10)} · {wage.job.label}</p><p className="break-words">{wage.job.order.customName || wage.job.order.orderNo}</p><strong>{wage.amount === null ? '待管理员补录' : formatMoney(wage.amount)}</strong></li>)}</ul>{window.pageCount > 1 && <AdminPagination basePath="/worker/salary" total={total} {...window} pageParam="wagePage" queryParams={{ from, to }} />}</section>;
}

type WageRow = { id: string; amount: { toString(): string } | null; job: { orderId: string; label: string; completedQty: { toString(): string } | null } };
export function SettledProductionWages({ wages, admin = false }: { wages: WageRow[]; admin?: boolean }) {
  if (!wages.length) return null;
  return <section className="min-w-0 space-y-3 rounded-xl border bg-card p-4"><h2 className="font-semibold">完工提成明细（{wages.length}）</h2><ul className="divide-y">{wages.map(wage => <li className="flex flex-wrap items-center justify-between gap-3 py-3" key={wage.id}><Link className="inline-flex min-h-11 items-center underline" href={`${admin ? '/orders' : '/worker/orders'}/${wage.job.orderId}`}>{wage.job.label} · {wage.job.completedQty?.toString()} 个</Link><strong>{formatMoney(wage.amount?.toString() ?? '0')}</strong></li>)}</ul></section>;
}
