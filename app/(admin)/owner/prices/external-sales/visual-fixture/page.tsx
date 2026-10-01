import { notFound } from 'next/navigation';
import { formatRate } from '@/lib/format/unit-price';
import {
  RulePriceWorkbench,
  type ExternalSalesChargeWorkspaceItem,
} from '@/components/business/price/RulePriceWorkbench';
import { Button } from '@/components/ui/button';
import { PageHeader } from '@/components/ui-business';
import { requirePermission } from '@/lib/auth/permissions';
import {
  VISUAL_TIER_PAPER,
  VISUAL_TIER_PRODUCT,
  VISUAL_TIER_SIZE,
  VISUAL_PRICE_TIERS,
  VISUAL_PER_PIECE_PRICE_TIERS,
} from './price-tier-data';
import { VisualFixturePriceTierPanel } from './VisualFixturePriceTierPanel';
import { Textarea } from '@/components/ui/textarea';

type PageProps = {
  searchParams: Promise<{
    state?: string | string[];
    q?: string | string[];
    category?: string | string[];
    subject?: string | string[];
    kind?: string | string[];
    calculation?: string | string[];
    quantity?: string | string[];
    automation?: string | string[];
    status?: string | string[];
    changed?: string | string[];
  }>;
};

const FIXTURE_PATH = '/owner/prices/external-sales/visual-fixture';

export const metadata = {
  title: '收费工作台视觉验收',
};

function first(value: string | string[] | undefined): string {
  return Array.isArray(value) ? (value[0] ?? '') : (value ?? '');
}

export default async function ExternalSalesPriceVisualFixturePage({
  searchParams,
}: PageProps) {
  if (process.env.NODE_ENV === 'production') notFound();
  await requirePermission('dict:price:manage');
  const params = await searchParams;
  const requestedState = first(params.state);
  const state =
    requestedState === 'draft-piece'
      ? 'draft-piece'
      : requestedState === 'draft'
        ? 'draft'
        : 'current';
  const hasDraft = state !== 'current';
  const perPiece = state === 'draft-piece';
  const kind = first(params.kind);
  const automation = first(params.automation);
  const status = first(params.status);
  const priceTiers = perPiece
    ? VISUAL_PER_PIECE_PRICE_TIERS
    : VISUAL_PRICE_TIERS;
  const amountSuffix = perPiece ? ' / 个' : ' / 批';
  const item: ExternalSalesChargeWorkspaceItem = {
    id: 'visual-price-rule',
    name: VISUAL_TIER_SIZE,
    categoryLabel: '彩印基础加工费',
    subjectLabel: VISUAL_TIER_PAPER,
    quantityLabel: '7 个数量档·1,000 / 2,000 / 3,000 / 4,000 / 5,000 / 10,000 / 20,000 个',
    calculationLabel: perPiece ? '按个计价' : '整批固定总价',
    currentAmountLabel: perPiece ? '¥ 0.19–¥ 0.52 / 个' : '¥ 295.00–¥ 2,300.00 / 批',
    draftAmountLabel: hasDraft
      ? perPiece
        ? '¥ 0.18–¥ 0.54 / 个'
        : '¥ 310.00–¥ 2,480.00 / 批'
      : null,
    priceChangeLabel: hasDraft ? '4 个数量档已调整' : null,
    changeSummaryLabels: hasDraft
      ? ['价格阶梯：4 档金额已修改，其余 3 档保持不变']
      : [],
    automation: 'AUTO',
    status: 'ACTIVE',
    changed: hasDraft,
    detailHref: '#selected-charge-detail',
    priceTiers: priceTiers.map((tier) => ({
      quantityLabel: `${tier.quantity.toLocaleString('zh-CN')} 个`,
      currentAmountLabel: `${formatRate(tier.currentAmount ?? '0')}${amountSuffix}`,
      draftAmountLabel: tier.draftAmount
        ? `${formatRate(tier.draftAmount)}${amountSuffix}`
        : null,
      changed: tier.changed,
    })),
  };

  return (
    <div className="min-w-0 space-y-6" data-visual-fixture={state}>
      <PageHeader
        title="收费工作台视觉验收"
        subtitle="仅在非生产环境渲染的无写入回归页。"
      />
      <RulePriceWorkbench
        purpose="processing"
        workspaceStatus="CURRENT"
        searchAction={FIXTURE_PATH}
        hiddenSearchFields={{ state }}
        filters={{
          query: first(params.q),
          category: first(params.category),
          subject: first(params.subject),
          kind:
            kind === 'BASE' || kind === 'ADD_ON' || kind === 'REFERENCE'
              ? kind
              : '',
          calculation: first(params.calculation),
          quantity: first(params.quantity),
          automation:
            automation === 'AUTO' || automation === 'MANUAL'
              ? automation
              : '',
          status:
            status === 'ACTIVE' || status === 'INACTIVE' ? status : '',
          changedOnly: first(params.changed) === '1',
        }}
        filterOptions={{
          categories: [{ value: 'print', label: '彩印基础加工费' }],
          subjects: [{ value: 'paper', label: VISUAL_TIER_PAPER }],
          calculations: [{ value: 'fixed', label: '整批固定金额' }],
        }}
        clearFiltersHref={`${FIXTURE_PATH}?state=${state}`}
        items={[item]}
        selectedItem={item}
        selectedItemId={item.id}
        selectedEditor={
          hasDraft ? <VisualFixturePriceTierPanel state={state} /> : undefined
        }
        draft={
          hasDraft
            ? {
                version: 9,
                changeReason: '视觉回归长文本调价草稿',
                changedCount: 4,
                lastSavedLabel: '2026/08/11 20:00',
                compareHref: '#',
                publishHref: '#',
              }
            : null
        }
        createDraftEditor={
          !hasDraft ? (
            <form aria-label="创建加工费调价草稿" className="space-y-3">
              <label htmlFor="visual-change-reason">调价原因（必填）</label>
              <Textarea
                id="visual-change-reason"
                required
                className="min-h-24 w-full min-w-0"
              />
              <Button type="button" className="min-h-11">
                复制当前价目并开始调价
              </Button>
            </form>
          ) : undefined
        }
        createDraftOpen={false}
        changedFilterAvailable={hasDraft}
        pagination={{ page: 1, pageCount: 1, total: 1 }}
      />
      {!hasDraft ? <VisualFixturePriceTierPanel state="current" /> : null}
      <p className="sr-only">视觉验收产品：{VISUAL_TIER_PRODUCT}</p>
    </div>
  );
}
