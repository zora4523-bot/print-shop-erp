import { requirePermission } from '@/lib/auth/permissions';
import { UnauthorizedError } from '@/lib/auth/errors';
import { ActionNotice, PageHeader } from '@/components/ui-business';
import { loadDispatchPageOrders } from '@/lib/production/dispatch-page';
import { ProductionDispatchForm } from '@/components/business/production/ProductionDispatchForm';

export const metadata = { title: '安排生产师傅' };
export default async function ProductionDispatchPage({ searchParams }: { searchParams: Promise<{ ids?: string }> }) {
  const actor = await requirePermission('production:manage').catch((error: unknown) => { if (error instanceof UnauthorizedError) return null; throw error; });
  if (!actor || actor.role !== 'ADMIN') return <div className="space-y-4"><PageHeader title="安排生产师傅" /><ActionNotice tone="warning" title="仅管理员可安排生产，请联系管理员。" /></div>;
  const ids = [...new Set(((await searchParams).ids ?? '').split(',').filter(Boolean))];
  if (!ids.length || ids.length > 20) return <div className="space-y-4"><PageHeader title="安排生产师傅" /><p>请在工单列表选择 1–20 张工单。</p></div>;
  const rows = await loadDispatchPageOrders(ids);
  return <div className="min-w-0 space-y-5"><PageHeader title="安排生产师傅" subtitle={`已选择 ${rows.length} 张工单`} /><ProductionDispatchForm orders={rows} actorId={actor.id} /></div>;
}
