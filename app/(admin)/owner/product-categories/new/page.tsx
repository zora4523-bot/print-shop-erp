import Link from 'next/link';
import { createProductCategoryNodeAction } from '@/actions/owner-product-categories';
import { ProductCategoryForm } from '@/components/business/product-category/ProductCategoryForm';
import { buttonVariants } from '@/components/ui/button';
import { PageHeader } from '@/components/ui-business';
import { requirePermission } from '@/lib/auth/permissions';
import { listProductCategoryNodes } from '@/lib/product';

export const metadata = {
  title: '新建产品分类 · 红包印刷 ERP',
};

export default async function NewProductCategoryPage() {
  await requirePermission('dict:product:manage');
  // 上级分类选项：仅激活节点；按 path 排序让子分类紧跟父级，缩进由
  // 层级深度派生（ltree 路径本身不展示给用户）。
  const nodes = await listProductCategoryNodes();
  const parentOptions = nodes
    .filter((n) => n.isActive)
    .sort((a, b) => a.path.localeCompare(b.path))
    .map((n) => {
      const depth = Math.max(0, n.path.split('.').length - 2);
      return { id: n.id, label: `${'　'.repeat(depth)}${n.name}` };
    });

  return (
    <div className="space-y-6">
      <PageHeader
        title="新建产品分类"
        subtitle="新分类默认启用；选择上级分类即可形成层级，不会改写历史产品。"
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
          parentOptions={parentOptions}
        />
      </section>
    </div>
  );
}
