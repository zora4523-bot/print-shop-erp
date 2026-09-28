import { listOrderWages } from '@/lib/salary/order-wage-review';
import type { AuditActor } from '@/lib/audit-log';
import { OrderWageReviewForm } from './OrderWageReviewForm';
export async function OrderWagePanel({ orderId, actor, headingLevel = 2 }: { headingLevel?: 2 | 3; orderId: string; actor: AuditActor }) {
  const Heading = headingLevel === 3 ? 'h3' : 'h2';
  const wages = await listOrderWages(orderId, actor);
  if (!wages.length) return null;
  return <section className="space-y-3 rounded-xl border bg-card p-4 sm:p-6" aria-label="工单提成明细"><Heading className="text-base font-semibold">工单提成明细</Heading>{wages.map((wage) => <OrderWageReviewForm key={`${wage.id}:${wage.revision}:${wage.reviewRequired}`} wage={wage} />)}</section>;
}
