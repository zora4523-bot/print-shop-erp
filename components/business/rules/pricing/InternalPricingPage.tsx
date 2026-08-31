import Link from 'next/link';
import { Suspense } from 'react';
import { ChevronDown } from 'lucide-react';
import { buttonVariants } from '@/components/ui/button';
import { Disclosure, DisclosureSummary } from '@/components/ui/disclosure';
import {
  AdminListToolbar,
  AdminTableCard,
} from '@/components/business/admin/AdminDataTable';
import {
  PriceAdjustmentsTable,
  PriceTiersTable,
} from '@/components/business/price/PriceTables';
import {
  ContentSkeleton,
  ErrorBoundary,
  PageHeader,
} from '@/components/ui-business';
import { firstSearchParam } from '@/lib/admin/table';
import { requirePermission } from '@/lib/auth/permissions';
import { listPriceAdjustments, listPriceTiers } from '@/lib/price';
import { RULE_CENTER_HREFS } from '@/lib/navigation/rule-center';
import { cn } from '@/lib/utils';

export const metadata = {
  title: '内部直单价格 · 红包印刷 ERP',
};

type PageProps = {
  searchParams: Promise<{ q?: string | string[] }>;
};

const PRICES_PATH = RULE_CENTER_HREFS.internalPricing;

type PriceTiersPromise = ReturnType<typeof listPriceTiers>;
type PriceAdjustmentsPromise = ReturnType<typeof listPriceAdjustments>;

export default async function InternalPricingPage({ searchParams }: PageProps) {
  await requirePermission('dict:price:manage');
  const sp = await searchParams;
  const q = firstSearchParam(sp.q).trim();

  // 权限校验通过后各启动一次；两块数据独立等待，互不拖累。
  const tiersPromise = listPriceTiers({ q });
  const adjustmentsPromise = listPriceAdjustments({ q });

  return (
    <div className="space-y-6">
      <PageHeader
        title="内部直单价格"
      />

      <Disclosure
        className="group min-w-0 rounded-xl border bg-card p-4 shadow-sm"
        open={q ? true : undefined}
      >
        <DisclosureSummary className="justify-between gap-3 font-semibold">
          <span className="admin-wrap-anywhere min-w-0">
            价格规则
          </span>
          <ChevronDown
            aria-hidden="true"
            className="size-4 shrink-0 text-muted-foreground transition-transform group-open:rotate-180"
          />
        </DisclosureSummary>

        <div className="min-w-0 space-y-6 border-t pt-4">
          <div className="flex min-w-0 flex-wrap gap-2">
            <Link
              href={`${RULE_CENTER_HREFS.internalPricing}/adjustments/new`}
              className={cn(
                buttonVariants({ variant: 'outline' }),
                'min-h-11',
              )}
            >
              新增加价规则
            </Link>
            <Link
              href={`${RULE_CENTER_HREFS.internalPricing}/tiers/new`}
              className={cn(
                buttonVariants({ variant: 'outline' }),
                'min-h-11',
              )}
            >
              新增价格阶梯
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
                价格阶梯
              </h2>
              <p className="text-sm text-muted-foreground">
                按不超过数量的最大起订量匹配；未命中时使用基础单价。
              </p>
            </div>
            <ErrorBoundary
              scope="section"
              title="价格阶梯暂时无法加载"
              description="请重试。"
            >
              <Suspense fallback={<ContentSkeleton variant="table" rows={6} />}>
                <PriceTiersSection tiersPromise={tiersPromise} q={q} />
              </Suspense>
            </ErrorBoundary>
          </section>

          <section className="space-y-3">
            <div>
              <h2 className="text-base font-semibold">
                加价规则
              </h2>
            </div>
            <ErrorBoundary
              scope="section"
              title="加价规则暂时无法加载"
              description="请重试。"
            >
              <Suspense fallback={<ContentSkeleton variant="table" rows={6} />}>
                <PriceAdjustmentsSection
                  adjustmentsPromise={adjustmentsPromise}
                  q={q}
                />
              </Suspense>
            </ErrorBoundary>
          </section>
        </div>
      </Disclosure>
    </div>
  );
}

async function PriceTiersSection({
  tiersPromise,
  q,
}: {
  tiersPromise: PriceTiersPromise;
  q: string;
}) {
  const tiers = await tiersPromise;

  return (
    <AdminTableCard
      isEmpty={tiers.length === 0}
      emptyTitle="暂无价格阶梯"
      emptyDescription={q ? '没有匹配当前搜索条件的价格阶梯。' : undefined}
    >
      <PriceTiersTable tiers={tiers} />
    </AdminTableCard>
  );
}

async function PriceAdjustmentsSection({
  adjustmentsPromise,
  q,
}: {
  adjustmentsPromise: PriceAdjustmentsPromise;
  q: string;
}) {
  const adjustments = await adjustmentsPromise;

  return (
    <AdminTableCard
      isEmpty={adjustments.length === 0}
      emptyTitle="暂无加价规则"
      emptyDescription={q ? '没有匹配当前搜索条件的加价规则。' : undefined}
    >
      <PriceAdjustmentsTable adjustments={adjustments} />
    </AdminTableCard>
  );
}
