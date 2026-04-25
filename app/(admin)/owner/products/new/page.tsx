import Link from 'next/link';
import { createProductAction } from '@/actions/owner-products';
import { ProductForm } from '@/components/business/product/ProductForm';

export const metadata = {
  title: '新建产品 · 红包印刷 ERP',
};

export default function NewProductPage() {
  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-xl font-semibold">新建产品</h1>
        <p className="text-sm text-muted-foreground">
          新产品默认启用；规格 / 纸张 / 单价 / 起订量均选填。
          <Link href="/owner/products" className="ml-2 text-primary underline hover:no-underline">
            返回列表
          </Link>
        </p>
      </div>
      <div className="rounded-xl border bg-card p-6 shadow-sm">
        <ProductForm mode="create" action={createProductAction} />
      </div>
    </div>
  );
}
