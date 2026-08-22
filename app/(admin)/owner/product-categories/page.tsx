import Link from 'next/link';
import {
  AdminTableCard,
} from '@/components/business/admin/AdminDataTable';
import { ProductCategoryNodesTable } from '@/components/business/product-category/ProductCategoryNodesTable';
import { buttonVariants } from '@/components/ui/button';
import { PageHeader } from '@/components/ui-business';
import { requirePermission } from '@/lib/auth/permissions';
import { listProductCategoryNodes } from '@/lib/product';

export const metadata = {
  title: '产品分类 · 红包印刷 ERP',
};

export default async function ProductCategoriesPage() {
  await requirePermission('dict:product:manage');
  const nodes = await listProductCategoryNodes();

  return (
    <div className="space-y-6">
      <PageHeader
        title="产品分类"
        subtitle="维护产品分类树；旧分类快照继续用于历史报表和工单统计。"
        actions={
          <Link href="/owner/product-categories/new" className={buttonVariants()}>
            新建分类
          </Link>
        }
      />

      <AdminTableCard
        isEmpty={nodes.length === 0}
        emptyTitle="暂无产品分类"
      >
        <ProductCategoryNodesTable nodes={nodes} />
      </AdminTableCard>
    </div>
  );
}
