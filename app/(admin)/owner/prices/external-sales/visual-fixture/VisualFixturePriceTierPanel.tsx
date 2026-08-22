'use client';

import { Badge } from '@/components/ui/badge';
import Decimal from 'decimal.js';
import { CustomerPriceCalculationType } from '@/generated/prisma/enums';
import {
  ExternalSalesPriceTierGroupEditor,
} from '@/components/business/price/ExternalSalesPriceTierGroupEditor';
import {
  VISUAL_PRICE_TIERS,
  VISUAL_PER_PIECE_PRICE_TIERS,
  VISUAL_TIER_PAPER,
  VISUAL_TIER_PRODUCT,
  VISUAL_TIER_SIZE,
} from './price-tier-data';

const quantityFormatter = new Intl.NumberFormat('zh-CN', {
  maximumFractionDigits: 0,
});

function amountLabel(amount: string): string {
  const [integer = '0', fraction = ''] = new Decimal(amount)
    .toFixed(4)
    .replace(/\.0+$/, '')
    .replace(/(\.\d*?)0+$/, '$1')
    .split('.');
  const grouped = integer.replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  return `¥${grouped}${fraction ? `.${fraction}` : ''}`;
}

function unitAmountLabel(amount: string, quantity: number): string {
  return `${amountLabel(new Decimal(amount).div(quantity).toFixed(4))} / 个`;
}

function CurrentPriceTierPanel() {
  return (
    <section
      aria-label="当前产品价格阶梯"
      className="min-w-0 rounded-xl border bg-card shadow-sm"
    >
      <header className="min-w-0 border-b bg-muted/30 p-4">
        <div className="flex min-w-0 flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
          <div className="min-w-0">
            <p className="text-xs font-medium text-muted-foreground">
              当前生效·产品价格阶梯
            </p>
            <h2 className="admin-wrap-anywhere mt-1 text-base font-semibold">
              {VISUAL_TIER_PRODUCT}
            </h2>
          </div>
          <Badge variant="outline" className="w-fit font-sans tabular-nums">
            {VISUAL_PRICE_TIERS.length} 个数量档
          </Badge>
        </div>
        <dl className="mt-3 flex min-w-0 flex-wrap gap-x-5 gap-y-2 text-sm">
          <div className="flex min-w-0 gap-2">
            <dt className="shrink-0 text-muted-foreground">纸张</dt>
            <dd className="admin-wrap-anywhere font-medium">
              {VISUAL_TIER_PAPER}
            </dd>
          </div>
          <div className="flex min-w-0 gap-2">
            <dt className="shrink-0 text-muted-foreground">规格</dt>
            <dd className="admin-wrap-anywhere font-medium">
              {VISUAL_TIER_SIZE}
            </dd>
          </div>
          <div className="flex min-w-0 gap-2">
            <dt className="shrink-0 text-muted-foreground">计价</dt>
            <dd className="font-medium">整批固定总价</dd>
          </div>
        </dl>
      </header>

      <div
        aria-hidden="true"
        className="hidden min-w-0 grid-cols-3 gap-3 border-b bg-muted/20 px-4 py-2 text-xs font-medium text-muted-foreground sm:grid"
      >
        <span>数量</span>
        <span>当前总价</span>
        <span>折合单价</span>
      </div>
      <ol className="min-w-0 divide-y">
        {VISUAL_PRICE_TIERS.map((tier) => (
          <li
            key={tier.ruleId}
            className="grid min-w-0 gap-3 p-4 sm:grid-cols-3 sm:items-center"
          >
            <div className="min-w-0">
              <p className="text-xs text-muted-foreground sm:hidden">数量</p>
              <p className="font-sans font-semibold tabular-nums">
                {quantityFormatter.format(tier.quantity)} 个
              </p>
            </div>
            <div className="min-w-0">
              <p className="text-xs text-muted-foreground sm:hidden">
                当前总价
              </p>
              <p className="font-sans font-medium tabular-nums">
                {amountLabel(tier.currentAmount ?? '0')}
              </p>
            </div>
            <div className="min-w-0">
              <p className="text-xs text-muted-foreground sm:hidden">
                折合单价
              </p>
              <p className="admin-wrap-anywhere font-sans text-sm tabular-nums">
                {unitAmountLabel(tier.currentAmount ?? '0', tier.quantity)}
              </p>
            </div>
          </li>
        ))}
      </ol>
      <p className="border-t p-4 text-xs text-muted-foreground">
        当前生效价格仅供查看；发起调价后才能修改。
      </p>
    </section>
  );
}

export function VisualFixturePriceTierPanel({
  state,
}: {
  state: 'current' | 'draft' | 'draft-piece';
}) {
  if (state === 'current') return <CurrentPriceTierPanel />;

  const perPiece = state === 'draft-piece';

  return (
    <ExternalSalesPriceTierGroupEditor
      productTitle={VISUAL_TIER_PRODUCT}
      paperLabel={VISUAL_TIER_PAPER}
      sizeLabel={VISUAL_TIER_SIZE}
      calculationType={
        perPiece
          ? CustomerPriceCalculationType.PER_PIECE
          : CustomerPriceCalculationType.FIXED_AMOUNT
      }
      priceBookId="visual-price-book"
      anchorRuleId={
        (perPiece ? VISUAL_PER_PIECE_PRICE_TIERS : VISUAL_PRICE_TIERS)[0]!
          .ruleId
      }
      tiers={perPiece ? VISUAL_PER_PIECE_PRICE_TIERS : VISUAL_PRICE_TIERS}
      saveAction={async () => ({
        status: 'error',
        message: '视觉验收页仅用于展示，不会保存价格。',
      })}
    />
  );
}
