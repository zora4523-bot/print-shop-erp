import { notFound } from 'next/navigation';
import Decimal from 'decimal.js';
import {
  ExternalSalesChargeWorkspace,
  type ExternalSalesChargeWorkspaceItem,
} from '@/components/business/price/ExternalSalesChargeWorkspace';
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

type PageProps = {
  searchParams: Promise<{ state?: string | string[] }>;
};

export const metadata = {
  title: '收费工作台视觉验收 · 红包印刷 ERP',
};

function first(value: string | string[] | undefined): string {
  return Array.isArray(value) ? (value[0] ?? '') : (value ?? '');
}

function compactAmount(value: string): string {
  const [integer = '0', fraction = ''] = new Decimal(value)
    .toFixed(4)
    .replace(/\.0+$/, '')
    .replace(/(\.\d*?)0+$/, '$1')
    .split('.');
  const grouped = integer.replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  return `${grouped}${fraction ? `.${fraction}` : ''}`;
}

export default async function ExternalSalesPriceVisualFixturePage({
  searchParams,
}: PageProps) {
  if (process.env.NODE_ENV === 'production') notFound();
  await requirePermission('dict:price:manage');
  const requestedState = first((await searchParams).state);
  const state =
    requestedState === 'draft-piece'
      ? 'draft-piece'
      : requestedState === 'draft'
        ? 'draft'
        : 'current';
  const hasDraft = state !== 'current';
  const perPiece = state === 'draft-piece';
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
    currentAmountLabel: perPiece ? '¥0.19–¥0.52 / 个' : '¥295–¥2,300 / 批',
    draftAmountLabel: hasDraft
      ? perPiece
        ? '¥0.18–¥0.54 / 个'
        : '¥310–¥2,480 / 批'
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
      currentAmountLabel: `¥${compactAmount(tier.currentAmount ?? '0')}${amountSuffix}`,
      draftAmountLabel: tier.draftAmount
        ? `¥${compactAmount(tier.draftAmount)}${amountSuffix}`
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
      <ExternalSalesChargeWorkspace
        purpose="processing"
        workspaceStatus="CURRENT"
        purposeHrefs={{ processing: '#', logistics: '#' }}
        searchAction="#"
        hiddenSearchFields={{ purpose: 'processing' }}
        filters={{
          query: '',
          category: '',
          subject: '',
          kind: '',
          calculation: '',
          quantity: '',
          automation: '',
          status: '',
          changedOnly: false,
        }}
        filterOptions={{ categories: [], subjects: [], calculations: [] }}
        clearFiltersHref="#"
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
              <textarea
                id="visual-change-reason"
                required
                className="min-h-24 w-full min-w-0 rounded-lg border px-3 py-2"
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
