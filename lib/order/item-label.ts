import type { OrderItemPricingRoute } from '@/generated/prisma/enums';
import { isNewOrderPricingRoute, ORDER_PRICING_ROUTE_LABELS } from './pricing-route';

/**
 * 设计款名称由用户自定（业主 2026-09-26）：同一设计款的多个规格行共用一个款名，
 * 只写款名已经分不清是哪一行。凡是在同一工单的多行里指认某一款（提示、日志、
 * 分配表单），都带上款式序号与规格。
 */
export type OrderItemIdentity = {
  sequence: number;
  name: string;
  specification?: string | null;
};

/** 行内短标签：`#2 福字款 · 大号封`；没有规格时只到款名。 */
export function orderItemRowLabel(item: OrderItemIdentity): string {
  const specification = item.specification?.trim();
  return `#${item.sequence} ${item.name}${specification ? ` · ${specification}` : ''}`;
}

/** 提示 / 日志里的完整指认：`第 2 款“福字款”（大号封）`；没有规格时省略括号。 */
export function orderItemMessageLabel(item: OrderItemIdentity): string {
  const specification = item.specification?.trim();
  return `第 ${item.sequence} 款“${item.name}”${specification ? `（${specification}）` : ''}`;
}

/**
 * 款式「类型」，打印单与导出同一口径：计价路线的业务名（打样款式带真实计价路线，
 * 照此称呼）。MANUAL_QUOTE 是待定价状态而不是产品类型（寄样品款式即挂这条占位路线），
 * 返回 null，由调用方留空。
 */
export function orderItemTypeLabel(pricingRoute: OrderItemPricingRoute): string | null {
  return isNewOrderPricingRoute(pricingRoute) ? ORDER_PRICING_ROUTE_LABELS[pricingRoute] : null;
}
