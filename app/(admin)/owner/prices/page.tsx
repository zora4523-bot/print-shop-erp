import Link from 'next/link';
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

export const metadata = {
  title: '价格字典 · 红包印刷 ERP',
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
        title="价格字典"
        subtitle="维护产品建议价阶梯和加价规则；工单与账单金额仍由人工录入。"
        actions={
          <>
            <Link
              href="/owner/prices/adjustments/new"
              className={buttonVariants({ variant: 'outline' })}
            >
              新建加价规则
            </Link>
            <Link href="/owner/prices/tiers/new" className={buttonVariants()}>
              新建价格阶梯
            </Link>
          </>
        }
      />

      <AdminListToolbar
        action={PRICES_PATH}
        query={q}
        placeholder="搜索产品编码、产品名、分类、加价规则"
        clearHref={PRICES_PATH}
      />

      <section className="space-y-3">
        <div>
          <h2 className="text-base font-semibold">价格阶梯</h2>
          <p className="text-sm text-muted-foreground">
            同一产品、同一起订量的有效期窗口不能重叠。
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
          <h2 className="text-base font-semibold">加价规则</h2>
          <p className="text-sm text-muted-foreground">
            触发条件只保存 JSON object，具体自动报价后续单独实现。
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
  );
}
