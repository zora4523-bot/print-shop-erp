import { notFound, redirect } from 'next/navigation';
import { requirePermission } from '@/lib/auth/permissions';
import { getProductSummary } from '@/lib/product';
export default async function LegacyStockSkuPage({ params }: { params: Promise<{ id: string }> }) {
  await requirePermission('dict:product:manage');
  const { id } = await params;
  const product = await getProductSummary(id);
  if (!product) notFound();
  redirect(product.category === 'BLANK_STOCK'
    ? '/owner/rules/customer-pricing?section=blank'
    : `/owner/rules/product-categories/items/${encodeURIComponent(id)}`);
}
