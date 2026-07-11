import Link from 'next/link';
import { Search } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { buttonVariants } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { listProducts } from '@/lib/product';
import { ProductsTable } from '@/components/business/product/ProductsTable';
import { PageHeader } from '@/components/ui-business';
import { requirePermission } from '@/lib/auth/permissions';

export const metadata = {
  title: '产品字典 · 红包印刷 ERP',
};

type PageProps = {
  searchParams: Promise<{ q?: string | string[] }>;
};

function firstParam(v: string | string[] | undefined): string {
  if (Array.isArray(v)) return v[0] ?? '';
  return v ?? '';
}

export default async function ProductsListPage({ searchParams }: PageProps) {
  // Page-level server-side authz (defense-in-depth: layout gate
  // doesn't re-run on soft navigation; lib read is unscoped global data).
  await requirePermission('dict:product:manage');
  const sp = await searchParams;
  const q = firstParam(sp.q).trim();
  const products = await listProducts({ q });

  return (
    <div className="space-y-6">
      <PageHeader
        title="产品字典"
        subtitle="管理产品清单（SPEC §4.1 / 附录 C）。单价作为录单时的建议价参考，不参与账单计算。停用只影响新录工单。"
        actions={
          <>
            <Link
              href="/owner/product-categories"
              className={buttonVariants({ variant: 'outline' })}
            >
              管理分类
            </Link>
            <Link href="/owner/products/new" className={buttonVariants()}>
              新建产品
            </Link>
          </>
        }
      />
      <form
        action="/owner/products"
        className="flex max-w-2xl flex-col gap-2 rounded-lg border bg-card p-3 shadow-sm sm:flex-row"
      >
        <div className="relative min-w-0 flex-1">
          <Search className="pointer-events-none absolute left-2.5 top-2 size-4 text-muted-foreground" />
          <Input
            name="q"
            defaultValue={q}
            placeholder="搜索产品编码、产品名、规格、纸张"
            className="pl-8"
          />
        </div>
        <div className="flex gap-2">
          <Button type="submit">搜索</Button>
          {q ? (
            <Link href="/owner/products" className={buttonVariants({ variant: 'outline' })}>
              清空
            </Link>
          ) : null}
        </div>
      </form>
      <div className="rounded-xl border bg-card p-4 shadow-sm">
        <ProductsTable products={products} />
      </div>
    </div>
  );
}
