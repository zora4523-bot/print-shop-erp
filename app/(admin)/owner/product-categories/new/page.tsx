import Link from 'next/link';
import { createProductCategoryNodeAction } from '@/actions/owner-product-categories';
import { ProductCategoryForm } from '@/components/business/product-category/ProductCategoryForm';
import { buttonVariants } from '@/components/ui/button';
import { PageHeader } from '@/components/ui-business';
import { requirePermission } from '@/lib/auth/permissions';

export const metadata = {
  title: '新建产品分类 · 红包印刷 ERP',
};

export default async function NewProductCategoryPage() {
  await requirePermission('dict:product:manage');

  return (
    <div className="space-y-6">
      <PageHeader
        title="新建产品分类"
        subtitle="新分类默认启用；路径用于树查询和排序辅助，不会改写历史产品。"
        actions={
          <Link
            href="/owner/product-categories"
            className={buttonVariants({ variant: 'outline' })}
          >
            返回列表
          </Link>
        }
      />

      <section className="rounded-xl border bg-card p-6 shadow-sm">
        <ProductCategoryForm
          mode="create"
          action={createProductCategoryNodeAction}
        />
      </section>
    </div>
  );
}
