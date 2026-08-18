import Link from 'next/link';
import { ChevronDown } from 'lucide-react';
import { buttonVariants } from '@/components/ui/button';
import {
  AdminListToolbar,
  AdminTableCard,
} from '@/components/business/admin/AdminDataTable';
import {
  PriceAdjustmentsTable,
  PriceTiersTable,
} from '@/components/business/price/PriceTables';
import { PageHeader } from '@/components/ui-business';
import { firstSearchParam } from '@/lib/admin/table';
import { requirePermission } from '@/lib/auth/permissions';
import { listPriceAdjustments, listPriceTiers } from '@/lib/price';
import { cn } from '@/lib/utils';

export const metadata = {
  title: '报价管理 · 红包印刷 ERP',
};

type PageProps = {
  searchParams: Promise<{ q?: string | string[] }>;
};

const PRICES_PATH = '/owner/prices';

export default async function OwnerPricesPage({ searchParams }: PageProps) {
  await requirePermission('dict:price:manage');
  const sp = await searchParams;
  const q = firstSearchParam(sp.q).trim();
  const [tiers, adjustments] = await Promise.all([
    listPriceTiers({ q }),
    listPriceAdjustments({ q }),
  ]);

  return (
    <div className="space-y-6">
      <PageHeader
        title="报价管理"
        subtitle="外部销售报价统一管理加工费、快递费、打包耗材与发布版本；下方规则仅服务内部销售与工厂直单，两个结算方向不会混用。"
        actions={
          <Link
            href="/owner/prices/external-sales/items"
            className={cn(buttonVariants(), 'min-h-11')}
          >
            外部销售报价管理
          </Link>
        }
      />

      <section className="rounded-xl border bg-muted/30 p-4 text-sm">
        <h2 className="font-semibold">金额口径</h2>
        <p className="mt-1 text-muted-foreground">
          内部销售/工厂直单的款式小计 = 数量 × 成交单价 +
          一次性费用；使用下方兼容规则时，系统才会从产品基础价和阶梯价计算。
          外部销售只读取“外部销售报价管理”的版本化规则；人工改价必须说明原因。
          员工工资与外协应付另有独立规则和账本。
        </p>
        <div className="mt-3 flex flex-wrap gap-2" aria-label="其他结算规则入口">
          <Link
            href="/owner/bills"
            className={buttonVariants({ size: 'sm', variant: 'outline' })}
          >
            外部销售加工费账单
          </Link>
          <Link
            href="/owner/salary/rules"
            className={buttonVariants({ size: 'sm', variant: 'outline' })}
          >
            内部员工工资
          </Link>
          <Link
            href="/owner/salary/piecework-rules"
            className={buttonVariants({ size: 'sm', variant: 'outline' })}
          >
            师傅计件规则
          </Link>
          <Link
            href="/foreman/outsource"
            className={buttonVariants({ size: 'sm', variant: 'outline' })}
          >
            外协应付与付款
          </Link>
        </div>
      </section>

      <details
        className="group min-w-0 rounded-xl border bg-card p-4 shadow-sm"
        open={q ? true : undefined}
      >
        <summary className="flex min-h-11 cursor-pointer list-none items-center justify-between gap-3 rounded-md font-semibold focus-visible:outline-none focus-visible:ring-3 focus-visible:ring-ring/50 [&::-webkit-details-marker]:hidden">
          <span className="admin-wrap-anywhere min-w-0">
            内部销售/工厂直单兼容价格（低频）
          </span>
          <ChevronDown
            aria-hidden="true"
            className="size-4 shrink-0 text-muted-foreground transition-transform group-open:rotate-180"
          />
        </summary>

        <div className="min-w-0 space-y-6 border-t pt-4">
          <div className="flex min-w-0 flex-wrap gap-2">
            <Link
              href="/owner/prices/adjustments/new"
              className={cn(
                buttonVariants({ variant: 'outline' }),
                'min-h-11',
              )}
            >
              新建内部加价规则
            </Link>
            <Link
              href="/owner/prices/tiers/new"
              className={cn(
                buttonVariants({ variant: 'outline' }),
                'min-h-11',
              )}
            >
              新建内部价格阶梯
            </Link>
          </div>

          <AdminListToolbar
            action={PRICES_PATH}
            query={q}
            placeholder="搜索产品编码、产品名、分类、加价规则"
            clearHref={PRICES_PATH}
          />

          <section className="space-y-3">
            <div>
              <h2 className="text-base font-semibold">
                内部销售/工厂直单价格阶梯
              </h2>
              <p className="text-sm text-muted-foreground">
                供内部销售与工厂直单使用：选用“不超过当前数量的最大起订量”档位；无命中档位时回退到产品基础单价。
              </p>
            </div>
            <AdminTableCard
              isEmpty={tiers.length === 0}
              emptyTitle="暂无价格阶梯"
              emptyDescription={q ? '没有匹配当前搜索条件的价格阶梯。' : undefined}
            >
              <PriceTiersTable tiers={tiers} />
            </AdminTableCard>
          </section>

          <section className="space-y-3">
            <div>
              <h2 className="text-base font-semibold">
                内部销售/工厂直单加价规则
              </h2>
              <p className="text-sm text-muted-foreground">
                供内部销售与工厂直单使用；外部销售只读取版本化价目簿，不会误用这里的全局规则。
              </p>
            </div>
            <AdminTableCard
              isEmpty={adjustments.length === 0}
              emptyTitle="暂无加价规则"
              emptyDescription={q ? '没有匹配当前搜索条件的加价规则。' : undefined}
            >
              <PriceAdjustmentsTable adjustments={adjustments} />
            </AdminTableCard>
          </section>
        </div>
      </details>
    </div>
  );
}
