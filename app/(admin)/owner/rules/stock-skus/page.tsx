import { redirect } from 'next/navigation';
import { requirePermission } from '@/lib/auth/permissions';
export default async function LegacyStockSkusPage() {
  await requirePermission('dict:product:manage');
  redirect('/owner/rules/customer-pricing?section=blank');
}
