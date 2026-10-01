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
    },
    {
      key: 'boms',
      label: '用料清单',
      count: impact.bomCount,
      unit: '个',
    },
    {
      key: 'external-rules',
      label: '当前客户计价规则',
      count: impact.currentExternalPriceRuleCount,
      unit: '条',
    },
  ];
}

export function productActiveChangeImpactItems(
  impact: ProductReferenceImpactValue,
  nextActive: boolean,
): string[] {
  if (nextActive) {
    return [
      '该产品会重新参与新建工单的产品结构、纸张与规格匹配。',
      `当前绑定 ${impact.currentExternalPriceRuleCount} 条客户计价规则；重新启用不会改写已发布价格。`,
      `${impact.orderCount} 张已有工单与 ${impact.bomCount} 个用料清单不会被改写。`,
    ];
  }

  return [
    '该产品将退出新建工单的产品结构、纸张与规格匹配。',
    `${impact.currentExternalPriceRuleCount} 条当前客户计价规则保留且不被改写。`,
    `${impact.orderCount} 张已有工单的产品和成交价保留。`,
    `${impact.bomCount} 个用料清单和已有用料记录继续保留。`,
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
