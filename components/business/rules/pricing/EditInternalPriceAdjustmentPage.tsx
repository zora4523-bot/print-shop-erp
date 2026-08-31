import { notFound } from 'next/navigation';
import { updatePriceAdjustmentAction } from '@/actions/owner-prices';
import { PriceAdjustmentForm } from '@/components/business/price/PriceAdjustmentForm';
import { TogglePriceAdjustmentActiveButton } from '@/components/business/price/TogglePriceAdjustmentActiveButton';
import { PageHeader, StatusBadge } from '@/components/ui-business';
import { requirePermission } from '@/lib/auth/permissions';
import { ADJUSTMENT_TYPE_LABELS } from '@/lib/price-labels';
import { getPriceAdjustmentSummary } from '@/lib/price';
import { listProductOptions } from '@/lib/product';
import { listCrafts } from '@/lib/craft';
import {
  externalPriceBusinessText,
  externalPriceRuleDisplayName,
} from '@/lib/price/external-price-display';

type PageProps = { params: Promise<{ id: string }> };

function conditionInput(value: unknown): string {
  if (value === null || value === undefined) return '';
  return JSON.stringify(value, null, 2);
}

function conditionStringIds(value: unknown, key: string): string[] {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return [];
  const candidate = (value as Record<string, unknown>)[key];
  return Array.isArray(candidate)
    ? candidate.filter((entry): entry is string => typeof entry === 'string')
    : [];
}

export async function generateMetadata({ params }: PageProps) {
  const { id } = await params;
  const adjustment = await getPriceAdjustmentSummary(id);
  return {
    title: adjustment
      ? `编辑 ${externalPriceRuleDisplayName(adjustment.name)} · 加价规则`
      : '加价规则不存在',
  };
}

export default async function EditInternalPriceAdjustmentPage({ params }: PageProps) {
  await requirePermission('dict:price:manage');
  const { id } = await params;
  const adjustment = await getPriceAdjustmentSummary(id);
  if (!adjustment) notFound();

  const currentProductIds = conditionStringIds(
    adjustment.triggerCondition,
    'productIds',
  );
  const currentCraftIds = new Set(
    conditionStringIds(adjustment.triggerCondition, 'craftIds'),
  );
  const [products, crafts] = await Promise.all([
    listProductOptions({ includeInactiveIds: currentProductIds }),
    listCrafts(),
  ]);

  const boundUpdate = updatePriceAdjustmentAction.bind(null, id);
  const formInitial = {
    name: adjustment.name,
    adjustmentType: adjustment.adjustmentType,
    amount: String(adjustment.amount),
    triggerCondition: conditionInput(adjustment.triggerCondition),
  };

  return (
    <div className="space-y-6">
      <PageHeader
        title={`编辑加价规则：${externalPriceRuleDisplayName(adjustment.name)}`}
        subtitle={`${ADJUSTMENT_TYPE_LABELS[adjustment.adjustmentType]} · ${String(adjustment.amount)}`}
        actions={
          <StatusBadge tone={adjustment.isActive ? 'success' : 'neutral'}>
            {adjustment.isActive ? '启用' : '停用'}
          </StatusBadge>
        }
      />

      <section className="rounded-xl border bg-card p-6 shadow-sm">
        <h2 className="mb-4 text-base font-semibold">基本信息</h2>
        <PriceAdjustmentForm
          key={`${adjustment.id}-${adjustment.updatedAt.toISOString()}`}
          mode="edit"
          action={boundUpdate}
          initial={formInitial}
          products={products.map((product) => ({
            id: product.id,
            label: `${product.code ? `${product.code} · ` : ''}${externalPriceBusinessText(product.name)}${product.isActive ? '' : '（已停用）'}`,
          }))}
          crafts={crafts
            .filter((craft) => craft.isActive || currentCraftIds.has(craft.id))
            .map((craft) => ({
              id: craft.id,
              label: `${craft.name}${craft.isActive ? '' : '（已停用）'}`,
            }))}
        />
      </section>

      <section className="rounded-xl border bg-card p-6 shadow-sm">
        <h2 className="mb-2 text-base font-semibold">
          {adjustment.isActive ? '停用加价规则' : '启用加价规则'}
        </h2>
        <p className="mb-3 text-sm text-muted-foreground">
          {adjustment.isActive
            ? '停用后不再用于新报价；历史记录保留。'
            : '启用后用于新报价。'}
        </p>
        <TogglePriceAdjustmentActiveButton
          adjustmentId={adjustment.id}
          currentlyActive={adjustment.isActive}
        />
      </section>
    </div>
  );
}
