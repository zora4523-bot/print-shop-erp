import Link from 'next/link';
import { buttonVariants } from '@/components/ui/button';
import { listProducts } from '@/lib/product';
import { ProductsTable } from '@/components/business/product/ProductsTable';
import { PageHeader } from '@/components/ui-business';

export const metadata = {
  title: '产品字典 · 红包印刷 ERP',
};

export default async function ProductsListPage() {
  const products = await listProducts();

  return (
    <div className="space-y-6">
      <PageHeader
        title="产品字典"
        subtitle="管理产品清单（SPEC §4.1 / 附录 C）。单价作为录单时的建议价参考，不参与账单计算。停用只影响新录工单。"
        actions={
          <Link href="/owner/products/new" className={buttonVariants()}>
            新建产品
          </Link>
        }
      />
      <div className="rounded-xl border bg-card p-4 shadow-sm">
        <ProductsTable products={products} />
      </div>
    </div>
  );
}
