import Link from 'next/link';
import {
  AdminRowActions,
  AdminStatusBadge,
} from '@/components/business/admin/AdminDataTable';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import type {
  PriceAdjustmentSummary,
  PriceTierSummary,
} from '@/lib/price';
import { ADJUSTMENT_TYPE_LABELS } from '@/lib/price-labels';
import {
  internalPriceAdjustmentHref,
  internalPriceTierHref,
} from '@/lib/navigation/rule-center';
import {
  externalPriceBusinessText,
  externalPriceRuleDisplayName,
} from '@/lib/price/external-price-display';

function decimal(value: unknown): string {
  if (value === null || value === undefined) return '—';
  return String(value);
}

function date(value: Date | null): string {
  if (!value) return '长期有效';
  return value.toISOString().slice(0, 10);
}

function condition(value: PriceAdjustmentSummary['triggerCondition']): string {
  if (value === null || value === undefined) return '不限';
  if (typeof value !== 'object' || Array.isArray(value)) return '需要重新设置';
  const count = Object.keys(value).length;
  return count === 0 ? '不限' : `已设置 ${count} 项条件`;
}

export function PriceTiersTable({ tiers }: { tiers: PriceTierSummary[] }) {
  return (
    <Table label="产品价格阶梯">
      <TableHeader>
        <TableRow>
          <TableHead>产品</TableHead>
          <TableHead>分类</TableHead>
          <TableHead className="text-right">起订量</TableHead>
          <TableHead className="text-right">单价</TableHead>
          <TableHead>有效起始</TableHead>
          <TableHead>有效截止（不含）</TableHead>
          <TableHead className="w-24">操作</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {tiers.map((tier) => (
          <TableRow
            key={tier.id}
            className={!tier.product.isActive ? 'opacity-60' : undefined}
          >
            <TableCell>
              <div className="font-medium">
                {externalPriceBusinessText(tier.product.name)}
              </div>
              <div className="font-sans tabular-nums text-xs text-muted-foreground">
                {tier.product.code ?? '无编码'}
              </div>
            </TableCell>
            <TableCell className="text-muted-foreground">
              {externalPriceBusinessText(tier.product.categoryNode.name)}
            </TableCell>
            <TableCell className="text-right font-sans tabular-nums text-xs">
              {tier.minQty}
            </TableCell>
            <TableCell className="text-right font-sans tabular-nums text-xs">
              {decimal(tier.unitPrice)}
            </TableCell>
            <TableCell>{date(tier.effectiveFrom)}</TableCell>
            <TableCell>{date(tier.effectiveTo)}</TableCell>
            <TableCell>
              <AdminRowActions>
                <Link
                  href={internalPriceTierHref(tier.id)}
                  prefetch={false}
                  className="text-sm text-primary underline hover:no-underline"
                >
                  编辑
                </Link>
              </AdminRowActions>
            </TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  );
}

export function PriceAdjustmentsTable({
  adjustments,
}: {
  adjustments: PriceAdjustmentSummary[];
}) {
  return (
    <Table label="价格加价规则">
      <TableHeader>
        <TableRow>
          <TableHead>收费项目</TableHead>
          <TableHead>类型</TableHead>
          <TableHead className="text-right">金额</TableHead>
          <TableHead>触发条件</TableHead>
          <TableHead>状态</TableHead>
          <TableHead className="w-24">操作</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {adjustments.map((adjustment) => (
          <TableRow
            key={adjustment.id}
            className={!adjustment.isActive ? 'opacity-60' : undefined}
          >
            <TableCell>{externalPriceRuleDisplayName(adjustment.name)}</TableCell>
            <TableCell className="text-muted-foreground">
              {ADJUSTMENT_TYPE_LABELS[adjustment.adjustmentType]}
            </TableCell>
            <TableCell className="text-right font-sans tabular-nums text-xs">
              {decimal(adjustment.amount)}
            </TableCell>
            <TableCell className="max-w-md text-sm text-muted-foreground">
              {condition(adjustment.triggerCondition)}
            </TableCell>
            <TableCell>
              <AdminStatusBadge active={adjustment.isActive} />
            </TableCell>
            <TableCell>
              <AdminRowActions>
                <Link
                  href={internalPriceAdjustmentHref(adjustment.id)}
                  prefetch={false}
                  className="text-sm text-primary underline hover:no-underline"
                >
                  编辑
                </Link>
              </AdminRowActions>
            </TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  );
}
