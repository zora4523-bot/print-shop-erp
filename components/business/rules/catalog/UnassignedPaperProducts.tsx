import Link from 'next/link';
import { db } from '@/lib/db';
import { unassignedPaperProducts } from '@/lib/price/unassigned-paper-products';
import { externalPriceBusinessText } from '@/lib/price/external-price-display';

export async function UnassignedPaperProducts() {
  const [papers, products] = await Promise.all([
    db.material.findMany({ where: { category: 'PAPER' }, select: { id: true, name: true, specification: true } }),
    db.product.findMany({ where: { category: { in: ['BLANK_STOCK', 'COLOR_PRINT'] }, isActive: true } }),
  ]);
  const rows = unassignedPaperProducts(products, papers);
  if (!rows.length) return null;
  return <section className="space-y-3 rounded-xl border bg-card p-4">
    <h2 className="font-semibold">未归属产品</h2>
    <p className="text-sm text-muted-foreground">以下启用组合尚未匹配到纸张资料。</p>
    <ul className="space-y-2">{rows.map((product) => <li key={product.id} className="admin-wrap-anywhere">
      <Link href={`/owner/rules/stock-skus/${product.id}`} className="text-sm text-primary underline">{externalPriceBusinessText(product.name) || '未命名组合'} · {externalPriceBusinessText(product.specification ?? '')}</Link>
    </li>)}</ul>
  </section>;
}
