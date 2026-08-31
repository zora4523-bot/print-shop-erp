import type { ProductReferenceImpact as ProductReferenceImpactValue } from '@/lib/product';
import {
  ReferenceImpactSummary,
  type ReferenceImpactItem,
} from '@/components/business/master-data/ReferenceImpactSummary';

export function productReferenceImpactItems(
  impact: ProductReferenceImpactValue,
): ReferenceImpactItem[] {
  return [
    {
      key: 'orders',
      label: '历史/现有工单',
      count: impact.orderCount,
      unit: '张',
      description: '停用后，已有款式和价格保留。',
    },
    {
      key: 'boms',
      label: 'BOM 版本',
      count: impact.bomCount,
      unit: '个',
      description: '已建立的 BOM 与历史用料记录保留。',
    },
    {
      key: 'external-rules',
      label: '当前客户计价规则',
      count: impact.currentExternalPriceRuleCount,
      unit: '条',
      description: '停用后，新报价不可用；现有规则保留。',
    },
    {
      key: 'internal-tiers',
      label: '当前内部计价档',
      count: impact.currentInternalPriceTierCount,
      unit: '条',
      description: '停用后，新报价不可用；现有价格档保留。',
    },
  ];
}

export function productActiveChangeImpactItems(
  impact: ProductReferenceImpactValue,
  nextActive: boolean,
): string[] {
  if (nextActive) {
    return [
      '产品会重新出现在新建工单的产品选择器中。',
      `该产品可重新报价；当前有 ${impact.currentExternalPriceRuleCount} 条客户计价规则和 ${impact.currentInternalPriceTierCount} 条内部计价档。`,
      `${impact.orderCount} 张已有工单与 ${impact.bomCount} 个 BOM 版本不会被改写。`,
    ];
  }

  return [
    '产品将不再出现在新建工单的产品选择器中。',
    `该产品不可用于新报价；${impact.currentExternalPriceRuleCount} 条客户计价规则和 ${impact.currentInternalPriceTierCount} 条内部计价档保留。`,
    `${impact.orderCount} 张已有工单的产品和成交价保留。`,
    `${impact.bomCount} 个 BOM 版本和已有用料记录继续保留。`,
  ];
}

export function ProductReferenceImpact({
  impact,
  variant = 'full',
}: {
  impact: ProductReferenceImpactValue;
  variant?: 'full' | 'compact';
}) {
  return (
    <ReferenceImpactSummary
      items={productReferenceImpactItems(impact)}
      variant={variant}
    />
  );
}
