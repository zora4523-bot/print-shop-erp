import { db } from '@/lib/db';
import { isRetiredProductCategory } from '@/lib/product';
import type { SupplementContext } from './model';

/** The action verifies both origin and catalog permissions before calling. */
export async function resolveActiveSupplement(context: SupplementContext, entityId: string) {
  if (context.entityType === 'SUPPLIER') {
    const party = await db.party.findFirst({ where: { id: entityId, isActive: true, type: { in: ['SUPPLIER', 'BOTH'] } }, select: { id: true } });
    if (party) return { status: 'valid' as const, entityId: party.id };
  } else if (context.entityType === 'MATERIAL') {
    const material = await db.material.findFirst({ where: { id: entityId, isActive: true }, select: { id: true } });
    if (material) return { status: 'valid' as const, entityId: material.id };
  } else {
    const node = await db.productCategoryNode.findFirst({ where: { id: entityId, isActive: true }, select: { id: true, path: true, legacyCategory: true } });
    if (node && !isRetiredProductCategory(node)) return { status: 'valid' as const, entityId: node.id };
  }
  return { status: 'invalid' as const, message: '补充的资料已停用或不适用，请重新选择' };
}
