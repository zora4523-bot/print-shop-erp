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
      description: '按工单去重统计；停用产品不会删除已有款式与计价快照。',
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
      label: '当前外部销售规则',
      count: impact.currentExternalPriceRuleCount,
      unit: '条',
      description: '仅统计当前生效价目簿中的启用规则；产品停用时，该产品的新报价会被拒绝。',
    },
    {
      key: 'internal-tiers',
      label: '当前内部数量档',
      count: impact.currentInternalPriceTierCount,
      unit: '条',
      description: '仅统计当前在生效区间内的数量价格档；产品停用时新报价会被拒绝。',
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
      `该产品将重新具备新报价资格；当前有 ${impact.currentExternalPriceRuleCount} 条外部销售规则和 ${impact.currentInternalPriceTierCount} 条内部数量档符合生效条件。`,
      `${impact.orderCount} 张已有工单与 ${impact.bomCount} 个 BOM 版本不会被改写。`,
    ];
  }

  return [
    '产品将不再出现在新建工单的产品选择器中。',
    `该产品的新报价将因产品已停用而被拒绝；${impact.currentExternalPriceRuleCount} 条当前外部销售规则和 ${impact.currentInternalPriceTierCount} 条当前内部数量档本身不删除。`,
    `${impact.orderCount} 张已有工单继续保留产品、成交价与计价快照。`,
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
