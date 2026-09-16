import { listOrderWages } from '@/lib/salary/order-wage-review';
import type { AuditActor } from '@/lib/audit-log';
import { OrderWageReviewForm } from './OrderWageReviewForm';
export async function OrderWagePanel({ orderId, actor }: { orderId: string; actor: AuditActor }) {
  const wages = await listOrderWages(orderId, actor);
  if (!wages.length) return null;
  return <section className="space-y-3 rounded-xl border bg-card p-4 sm:p-6" aria-label="工单提成明细"><h2 className="text-base font-semibold">工单提成明细</h2>{wages.map((wage) => <OrderWageReviewForm key={`${wage.id}:${wage.revision}:${wage.reviewRequired}`} wage={wage} />)}</section>;
}
