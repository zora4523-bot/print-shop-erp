import type { Prisma } from '@/generated/prisma/client';

export type ProductionScope = { sourceKey: string; snapshot: Prisma.JsonValue };
/** Dependencies share a craft and physical style; unrelated crafts cannot block recovery. */
export function productionScopesOverlap(left: ProductionScope, right: ProductionScope) {
  function scope(job: ProductionScope) {
    const snapshot = job.snapshot as { lane?: string; items?: Array<{ id: string }> } | null;
    if (!snapshot || !Array.isArray(snapshot.items) || !snapshot.items.length || snapshot.items.some(item => typeof item.id !== 'string')) throw new Error('原生产款式资料缺失，请先核对历史任务');
    return { lane: snapshot.lane ?? job.sourceKey.split(':').slice(0, -1).join(':'), ids: snapshot.items.map(item => item.id) };
  }
  const a = scope(left); const b = scope(right);
  return a.lane === b.lane && a.ids.some(id => b.ids.includes(id));
}
