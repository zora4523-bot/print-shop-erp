import { requirePermission } from '@/lib/auth/permissions';
import { UnauthorizedError } from '@/lib/auth/errors';
import { ActionNotice, PageHeader } from '@/components/ui-business';
import { loadDispatchPageOrders } from '@/lib/production/dispatch-page';
import { ProductionDispatchForm } from '@/components/business/production/ProductionDispatchForm';
import Link from 'next/link';
import { buttonVariants } from '@/components/ui/button';

export const metadata = { title: '安排生产师傅' };
export default async function ProductionDispatchPage({ searchParams }: { searchParams: Promise<{ ids?: string }> }) {
  const actor = await requirePermission('production:manage').catch((error: unknown) => { if (error instanceof UnauthorizedError) return null; throw error; });
  if (!actor || actor.role !== 'ADMIN') return <div className="space-y-4"><PageHeader title="安排生产师傅" /><ActionNotice tone="warning" title="仅管理员可安排生产，请联系管理员。" /></div>;
  const ids = [...new Set(((await searchParams).ids ?? '').split(',').filter(Boolean))];
  if (!ids.length || ids.length > 20) return <div className="space-y-4"><PageHeader title="安排生产师傅" /><p>请在工单列表选择 1–20 张工单。</p></div>;
  const rows = await loadDispatchPageOrders(ids);
  const blocked = rows.filter(row => row.issues?.length);
  if (blocked.length) return <div className="min-w-0 space-y-5">
    <PageHeader title="安排生产师傅" subtitle={`已选择 ${rows.length} 张工单`} />
    <ActionNotice tone="warning" title="工单资料不完整，暂不能安排本批生产" description="请完善以下工单后重试，或返回工单列表重新选择。" />
    <ul aria-label="待完善工单" className="min-w-0 space-y-4">
      {blocked.map(order => <li key={order.id} className="min-w-0 space-y-2 rounded-xl border bg-card p-4">
        <Link href={`/orders/${order.id}`} className="inline-flex min-h-11 max-w-full items-center break-all text-primary underline underline-offset-4">{order.name}</Link>
        <ul className="list-disc space-y-1 pl-5 text-sm">{order.issues!.map(issue => <li key={issue}>{issue}</li>)}</ul>
      </li>)}
    </ul>
    <Link href="/orders" className={buttonVariants({ variant: 'outline', className: 'min-h-11' })}>返回工单列表</Link>
  </div>;
  return <div className="min-w-0 space-y-5"><PageHeader title="安排生产师傅" subtitle={`已选择 ${rows.length} 张工单`} /><ProductionDispatchForm orders={rows} actorId={actor.id} /></div>;
}
