import { paginationWindow, parsePositiveInt } from '@/lib/admin/table';
import { AdminPagination } from '@/components/business/admin/AdminDataTable';
import type { Prisma } from '@/generated/prisma/client';
import Link from 'next/link';
import { db } from '@/lib/db';
import type { Role } from '@/generated/prisma/enums';
import { assertWorkerPortalActor } from '@/lib/production/worker-report-portal';

export async function WorkerProductionJobs({ actor, orderId, query = '', page }: { actor: { id: string; role: Role }; orderId?: string; query?: string; page?: string }) {
  await assertWorkerPortalActor(actor);
  const where: Prisma.ProductionJobWhereInput = { workerId: actor.id, ...(orderId ? { orderId } : {}), status: { in: ['PENDING', 'REQUESTED'] },
    order: { status: { in: ['RELEASED', 'FOILING', 'PACKING'] }, ...(query ? { OR: [{ customName: { contains: query, mode: 'insensitive' } }, { orderNo: { contains: query, mode: 'insensitive' } }] } : {}) } };
  const total = await db.productionJob.count({ where });
  const window = paginationWindow(total, parsePositiveInt(page, { defaultValue: 1 }), 20);
  const jobs = await db.productionJob.findMany({ where, orderBy: [{ order: { isUrgent: 'desc' } }, { createdAt: 'asc' }, { id: 'asc' }], skip: window.skip, take: window.take,
    include: { order: { select: { orderNo: true, customName: true, workOrderVersion: true } } } });
  if (!jobs.length) return null;
  return <section className="min-w-0 space-y-3" aria-label="已安排的生产"><h2 className="font-semibold">我的生产工单</h2><ul className="space-y-3">{jobs.filter(job => job.workOrderVersion === job.order.workOrderVersion).map(job => <li key={job.id}><Link href={`/worker/tasks/${job.id}`} className="block min-h-11 break-words rounded-xl border bg-card p-4"><strong>{job.order.customName || job.order.orderNo}</strong><p>{job.label} · {job.plannedQty.toString()} 个 · v{job.workOrderVersion}</p><p className="text-sm text-muted-foreground">{job.status === 'REQUESTED' ? '数量待审批' : '登记完成'}</p></Link></li>)}</ul>{window.pageCount > 1 && <AdminPagination basePath={orderId ? `/worker/orders/${orderId}` : "/worker/tasks"} total={total} {...window} pageParam="productionPage" queryParams={{ q: query }} />}</section>;
}
