import { db } from '@/lib/db';

/** Internal delivery check; never changes the customer's ordered/shipment quantity. */
export async function ProductionDeliverySummary({ orderId, version }: { orderId: string; version: number }) {
  const jobs = await db.productionJob.findMany({ where: { orderId, workOrderVersion: version, status: 'COMPLETED' }, select: { id: true, label: true, workerName: true, plannedQty: true, completedQty: true } });
  const differences = jobs.filter(job => job.completedQty && !job.completedQty.eq(job.plannedQty));
  if (!differences.length) return null;
  return <aside className="space-y-2 rounded-lg border p-3" aria-label="生产数量差异"><h3 className="font-medium">发货前核对数量</h3>{differences.map(job => <p key={job.id} className="text-sm">{job.label} · {job.workerName}：计划 {job.plannedQty.toString()} 个，核定完成 {job.completedQty!.toString()} 个。请核对本票交付数量。</p>)}</aside>;
}
