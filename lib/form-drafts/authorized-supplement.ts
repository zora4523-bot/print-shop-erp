import { requirePermission } from '@/lib/auth/permissions';
import type { SupplementContext } from './model';
import { readSupplementContext } from './return-context';

/** Each child still runs its own category-specific permission and validation. */
export async function authorizedSupplement(formData: FormData, entityType: SupplementContext['entityType']) {
  const context = readSupplementContext(formData);
  if (!context || context.entityType !== entityType) return null;
  await requirePermission(context.origin === 'purchase-new' ? 'purchase:manage' : 'bom:manage');
  return context;
}
